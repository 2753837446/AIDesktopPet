import { timingSafeEqual } from "node:crypto";
import { hashSync, compareSync } from "bcryptjs";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { DatabaseSync } from "node:sqlite";
import {
  appearanceSchema,
  bootstrapSchema,
  chatRequestSchema,
  createAssistantSchema,
  loginSchema,
  memoryInputSchema,
  personaSchema,
  taskInputSchema,
  type Appearance,
  type AssistantView,
  type AuthResponse,
  type ConversationView,
  type MemoryView,
  type MessageView,
  type Persona,
  type TaskView,
} from "@companion/contracts";
import type { AppConfig } from "./config.js";
import {
  createId,
  nextRevision,
  recordSyncEvent,
} from "./database.js";
import { generateReply } from "./model.js";

interface AuthPayload {
  sub: string;
  workspaceId: string;
  deviceId: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

export interface BuildAppOptions {
  database: DatabaseSync;
  config: AppConfig;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  if (options.config.webDistDir) {
    await app.register(staticFiles, {
      root: options.config.webDistDir,
      wildcard: false,
    });
  }
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(jwt, { secret: options.config.jwtSecret });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      await request.jwtVerify();
      const device = options.database
        .prepare(
          `SELECT id FROM devices
           WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
        )
        .get(request.user.deviceId, request.user.workspaceId);
      if (!device) {
        return reply.code(401).send({ error: "DEVICE_REVOKED" });
      }
      options.database
        .prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
        .run(now(), request.user.deviceId);
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  };

  app.get("/health", async () => ({
    ok: true,
    bootstrapped: userCount(options.database) > 0,
    schemaVersion: 1,
  }));

  if (options.config.webDistDir) {
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/v1/") &&
        request.url !== "/health"
      ) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }

  app.post(
    "/v1/bootstrap",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "10 minutes",
        },
      },
    },
    async (request, reply) => {
    if (userCount(options.database) > 0) {
      return reply.code(409).send({ error: "ALREADY_BOOTSTRAPPED" });
    }
    const input = bootstrapSchema.parse(request.body);
    if (!secureEqual(input.bootstrapToken, options.config.bootstrapToken)) {
      return reply.code(403).send({ error: "INVALID_BOOTSTRAP_TOKEN" });
    }
    const userId = createId();
    const workspaceId = createId();
    const deviceId = createId();
    const assistantId = createId();
    const createdAt = now();
    options.database.exec("BEGIN IMMEDIATE");
    try {
      options.database
        .prepare(
          `INSERT INTO users
            (id, email, password_hash, display_name, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          input.email.toLowerCase(),
          hashSync(input.password, 12),
          input.displayName,
          createdAt,
        );
      options.database
        .prepare(
          `INSERT INTO workspaces
            (id, owner_user_id, name, revision, created_at)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(workspaceId, userId, input.workspaceName, createdAt);
      options.database
        .prepare(
          `INSERT INTO devices
            (id, workspace_id, name, platform, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          deviceId,
          workspaceId,
          input.deviceName,
          input.platform,
          createdAt,
          createdAt,
        );
      const appearance = appearanceSchema.parse({});
      const persona = personaSchema.parse({
        role: "兼顾任务执行、生活整理和情绪陪伴的个人数字伙伴",
        tone: "自然、可靠、有温度，简洁但有判断",
        values: "尊重用户自主性，记住重要关系与承诺",
        boundaries: "不冒充真人，不声称未执行的动作，高风险操作先确认",
      });
      options.database
        .prepare(
          `INSERT INTO assistants
            (id, workspace_id, name, summary, persona_json, appearance_json,
             revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          assistantId,
          workspaceId,
          input.assistantName,
          "你的第一位长期数字伙伴",
          JSON.stringify(persona),
          JSON.stringify(appearance),
          createdAt,
          createdAt,
        );
      options.database.exec("COMMIT");
    } catch (error) {
      options.database.exec("ROLLBACK");
      throw error;
    }
    const token = app.jwt.sign({
      sub: userId,
      workspaceId,
      deviceId,
    });
    const response: AuthResponse = {
      token,
      user: {
        id: userId,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
      },
      workspace: { id: workspaceId, name: input.workspaceName },
      device: {
        id: deviceId,
        name: input.deviceName,
        platform: input.platform,
      },
    };
    return response;
    },
  );

  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "10 minutes",
        },
      },
    },
    async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = options.database
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(input.email.toLowerCase()) as
      | {
          id: string;
          email: string;
          password_hash: string;
          display_name: string;
        }
      | undefined;
    if (!user || !compareSync(input.password, user.password_hash)) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    const workspace = options.database
      .prepare("SELECT id, name FROM workspaces WHERE owner_user_id = ?")
      .get(user.id) as { id: string; name: string };
    const timestamp = now();
    let device =
      input.deviceId === undefined
        ? undefined
        : (options.database
            .prepare(
              `SELECT id, name, platform FROM devices
               WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
            )
            .get(input.deviceId, workspace.id) as
            | { id: string; name: string; platform: string }
            | undefined);
    if (device) {
      options.database
        .prepare(
          "UPDATE devices SET name = ?, platform = ?, last_seen_at = ? WHERE id = ?",
        )
        .run(input.deviceName, input.platform, timestamp, device.id);
      device = {
        id: device.id,
        name: input.deviceName,
        platform: input.platform,
      };
    } else {
      device = {
        id: createId(),
        name: input.deviceName,
        platform: input.platform,
      };
      options.database
        .prepare(
          `INSERT INTO devices
            (id, workspace_id, name, platform, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          device.id,
          workspace.id,
          device.name,
          device.platform,
          timestamp,
          timestamp,
        );
    }
    const token = app.jwt.sign({
      sub: user.id,
      workspaceId: workspace.id,
      deviceId: device.id,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
      workspace,
      device,
    } satisfies AuthResponse;
    },
  );

  app.get(
    "/v1/me",
    { preHandler: authenticate },
    async (request) => {
      const user = options.database
        .prepare("SELECT id, email, display_name FROM users WHERE id = ?")
        .get(request.user.sub) as {
        id: string;
        email: string;
        display_name: string;
      };
      const workspace = options.database
        .prepare("SELECT id, name FROM workspaces WHERE id = ?")
        .get(request.user.workspaceId) as { id: string; name: string };
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
        },
        workspace,
      };
    },
  );

  app.get(
    "/v1/assistants",
    { preHandler: authenticate },
    async (request) => listAssistants(options.database, request.user.workspaceId),
  );

  app.post(
    "/v1/assistants",
    { preHandler: authenticate },
    async (request) => {
      const input = createAssistantSchema.parse(request.body);
      const id = createId();
      const timestamp = now();
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare(
          `INSERT INTO assistants
            (id, workspace_id, name, summary, persona_json, appearance_json,
             revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          request.user.workspaceId,
          input.name,
          input.summary,
          JSON.stringify(input.persona),
          JSON.stringify(input.appearance),
          revision,
          timestamp,
          timestamp,
        );
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "assistant",
        entityId: id,
        operation: "create",
        revision,
      });
      return getAssistant(options.database, request.user.workspaceId, id);
    },
  );

  app.patch(
    "/v1/assistants/:id/appearance",
    { preHandler: authenticate },
    async (request) => {
      const id = (request.params as { id: string }).id;
      const appearance = appearanceSchema.parse(request.body);
      const assistant = getAssistant(
        options.database,
        request.user.workspaceId,
        id,
      );
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare(
          `UPDATE assistants
           SET appearance_json = ?, revision = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        )
        .run(
          JSON.stringify(appearance),
          revision,
          now(),
          assistant.id,
          request.user.workspaceId,
        );
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "assistant",
        entityId: id,
        operation: "update_appearance",
        revision,
      });
      return getAssistant(options.database, request.user.workspaceId, id);
    },
  );

  app.post(
    "/v1/assistants/:id/chat",
    { preHandler: authenticate },
    async (request) => {
      const assistantId = (request.params as { id: string }).id;
      const input = chatRequestSchema.parse(request.body);
      const assistant = getAssistant(
        options.database,
        request.user.workspaceId,
        assistantId,
      );
      const conversation = input.conversationId
        ? getConversation(
            options.database,
            request.user.workspaceId,
            input.conversationId,
          )
        : createConversation(
            options.database,
            request.user.workspaceId,
            assistantId,
            titleFromMessage(input.content),
          );
      if (conversation.assistantId !== assistantId) {
        throw new ApiError(400, "CONVERSATION_ASSISTANT_MISMATCH");
      }
      const userMessage = insertMessage(
        options.database,
        conversation.id,
        "user",
        input.content,
      );
      const history = options.database
        .prepare(
          `SELECT role, content FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at DESC LIMIT 30`,
        )
        .all(conversation.id)
        .reverse() as Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      const memories = options.database
        .prepare(
          `SELECT scope, type, content FROM memories
           WHERE workspace_id = ? AND deleted_at IS NULL
             AND (scope IN ('personal','project') OR assistant_id = ?)
           ORDER BY importance DESC, updated_at DESC LIMIT 30`,
        )
        .all(request.user.workspaceId, assistantId) as Array<{
        scope: string;
        type: string;
        content: string;
      }>;
      const reply = await generateReply(options.config, {
        assistantName: assistant.name,
        persona: assistant.persona,
        memories,
        history,
      });
      const assistantMessage = insertMessage(
        options.database,
        conversation.id,
        "assistant",
        reply,
      );
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(now(), conversation.id);
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "conversation",
        entityId: conversation.id,
        operation: "append_message",
        revision,
      });
      return {
        conversation,
        userMessage,
        assistantMessage,
      };
    },
  );

  app.get(
    "/v1/conversations/:id/messages",
    { preHandler: authenticate },
    async (request) => {
      const id = (request.params as { id: string }).id;
      getConversation(options.database, request.user.workspaceId, id);
      return options.database
        .prepare(
          `SELECT * FROM messages WHERE conversation_id = ?
           ORDER BY created_at ASC LIMIT 200`,
        )
        .all(id)
        .map(mapMessage);
    },
  );

  app.get(
    "/v1/memories",
    { preHandler: authenticate },
    async (request) => listMemories(options.database, request.user.workspaceId),
  );

  app.post(
    "/v1/memories",
    { preHandler: authenticate },
    async (request) => {
      const input = memoryInputSchema.parse(request.body);
      if (input.scope === "assistant" && !input.assistantId) {
        throw new ApiError(400, "ASSISTANT_MEMORY_REQUIRES_ASSISTANT");
      }
      if (input.assistantId) {
        getAssistant(
          options.database,
          request.user.workspaceId,
          input.assistantId,
        );
      }
      const id = createId();
      const timestamp = now();
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare(
          `INSERT INTO memories
            (id, workspace_id, assistant_id, scope, type, content, source,
             importance, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          request.user.workspaceId,
          input.assistantId,
          input.scope,
          input.type,
          input.content,
          input.source,
          input.importance,
          revision,
          timestamp,
          timestamp,
        );
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "memory",
        entityId: id,
        operation: "create",
        revision,
      });
      return getMemory(options.database, request.user.workspaceId, id);
    },
  );

  app.delete(
    "/v1/memories/:id",
    { preHandler: authenticate },
    async (request) => {
      const id = (request.params as { id: string }).id;
      getMemory(options.database, request.user.workspaceId, id);
      const revision = nextRevision(options.database, request.user.workspaceId);
      const timestamp = now();
      options.database
        .prepare(
          `UPDATE memories SET deleted_at = ?, updated_at = ?, revision = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(timestamp, timestamp, revision, id, request.user.workspaceId);
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "memory",
        entityId: id,
        operation: "delete",
        revision,
      });
      return { deleted: true };
    },
  );

  app.get(
    "/v1/tasks",
    { preHandler: authenticate },
    async (request) => listTasks(options.database, request.user.workspaceId),
  );

  app.post(
    "/v1/tasks",
    { preHandler: authenticate },
    async (request) => {
      const input = taskInputSchema.parse(request.body);
      if (input.assistantId) {
        getAssistant(
          options.database,
          request.user.workspaceId,
          input.assistantId,
        );
      }
      const id = createId();
      const timestamp = now();
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare(
          `INSERT INTO tasks
            (id, workspace_id, assistant_id, title, description, status,
             due_at, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          id,
          request.user.workspaceId,
          input.assistantId,
          input.title,
          input.description,
          input.dueAt,
          revision,
          timestamp,
          timestamp,
        );
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "task",
        entityId: id,
        operation: "create",
        revision,
      });
      return getTask(options.database, request.user.workspaceId, id);
    },
  );

  app.patch(
    "/v1/tasks/:id/complete",
    { preHandler: authenticate },
    async (request) => {
      const id = (request.params as { id: string }).id;
      getTask(options.database, request.user.workspaceId, id);
      const revision = nextRevision(options.database, request.user.workspaceId);
      options.database
        .prepare(
          `UPDATE tasks SET status = 'completed', revision = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(revision, now(), id, request.user.workspaceId);
      recordSyncEvent(options.database, {
        workspaceId: request.user.workspaceId,
        entityType: "task",
        entityId: id,
        operation: "complete",
        revision,
      });
      return getTask(options.database, request.user.workspaceId, id);
    },
  );

  app.get(
    "/v1/sync",
    { preHandler: authenticate },
    async (request) => {
      const after = Number(
        (request.query as { after?: string }).after ?? "0",
      );
      const events = options.database
        .prepare(
          `SELECT * FROM sync_events
           WHERE workspace_id = ? AND sequence > ?
           ORDER BY sequence ASC LIMIT 1000`,
        )
        .all(request.user.workspaceId, Number.isFinite(after) ? after : 0);
      return { events };
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "MODEL_EMPTY_RESPONSE") {
      return reply.code(502).send({ error: "MODEL_EMPTY_RESPONSE" });
    }
    if (message.startsWith("MODEL_HTTP_")) {
      return reply.code(502).send({ error: message });
    }
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? "INTERNAL_ERROR" : message,
    });
  });

  return app;
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function userCount(database: DatabaseSync): number {
  return (
    database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
      count: number;
    }
  ).count;
}

function listAssistants(
  database: DatabaseSync,
  workspaceId: string,
): AssistantView[] {
  return (
    database
      .prepare(
        `SELECT * FROM assistants
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all(workspaceId) as unknown as AssistantRow[]
  ).map(mapAssistant);
}

function getAssistant(
  database: DatabaseSync,
  workspaceId: string,
  id: string,
): AssistantView {
  const row = database
    .prepare(
      `SELECT * FROM assistants
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .get(id, workspaceId) as AssistantRow | undefined;
  if (!row) {
    throw new ApiError(404, "ASSISTANT_NOT_FOUND");
  }
  return mapAssistant(row);
}

function listMemories(
  database: DatabaseSync,
  workspaceId: string,
): MemoryView[] {
  return (
    database
      .prepare(
        `SELECT * FROM memories
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 300`,
      )
      .all(workspaceId) as unknown as MemoryRow[]
  ).map(mapMemory);
}

function getMemory(
  database: DatabaseSync,
  workspaceId: string,
  id: string,
): MemoryView {
  const row = database
    .prepare(
      `SELECT * FROM memories
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .get(id, workspaceId) as MemoryRow | undefined;
  if (!row) {
    throw new ApiError(404, "MEMORY_NOT_FOUND");
  }
  return mapMemory(row);
}

function listTasks(database: DatabaseSync, workspaceId: string): TaskView[] {
  return (
    database
      .prepare(
        `SELECT * FROM tasks
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
                  due_at IS NULL, due_at ASC, created_at DESC
         LIMIT 300`,
      )
      .all(workspaceId) as unknown as TaskRow[]
  ).map(mapTask);
}

function getTask(
  database: DatabaseSync,
  workspaceId: string,
  id: string,
): TaskView {
  const row = database
    .prepare(
      `SELECT * FROM tasks
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .get(id, workspaceId) as TaskRow | undefined;
  if (!row) {
    throw new ApiError(404, "TASK_NOT_FOUND");
  }
  return mapTask(row);
}

function createConversation(
  database: DatabaseSync,
  workspaceId: string,
  assistantId: string,
  title: string,
): ConversationView {
  const id = createId();
  const timestamp = now();
  database
    .prepare(
      `INSERT INTO conversations
        (id, workspace_id, assistant_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, assistantId, title, timestamp, timestamp);
  return { id, assistantId, title, createdAt: timestamp, updatedAt: timestamp };
}

function getConversation(
  database: DatabaseSync,
  workspaceId: string,
  id: string,
): ConversationView {
  const row = database
    .prepare(
      `SELECT * FROM conversations
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .get(id, workspaceId) as
    | {
        id: string;
        assistant_id: string;
        title: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND");
  }
  return {
    id: row.id,
    assistantId: row.assistant_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertMessage(
  database: DatabaseSync,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): MessageView {
  const id = createId();
  const createdAt = now();
  database
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, conversationId, role, content, createdAt);
  return { id, conversationId, role, content, createdAt };
}

function titleFromMessage(content: string): string {
  const title = content.replace(/\s+/g, " ").trim().slice(0, 36);
  return title || "新会话";
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function now(): string {
  return new Date().toISOString();
}

interface AssistantRow {
  id: string;
  name: string;
  summary: string;
  persona_json: string;
  appearance_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  id: string;
  assistant_id: string | null;
  scope: MemoryView["scope"];
  type: MemoryView["type"];
  content: string;
  source: string;
  importance: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  assistant_id: string | null;
  title: string;
  description: string;
  status: TaskView["status"];
  due_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function mapAssistant(row: AssistantRow): AssistantView {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    persona: JSON.parse(row.persona_json) as Persona,
    appearance: JSON.parse(row.appearance_json) as Appearance,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: MemoryRow): MemoryView {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    scope: row.scope,
    type: row.type,
    content: row.content,
    source: row.source,
    importance: row.importance,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): TaskView {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    title: row.title,
    description: row.description,
    status: row.status,
    dueAt: row.due_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: unknown): MessageView {
  const value = row as {
    id: string;
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
  };
  return {
    id: value.id,
    conversationId: value.conversation_id,
    role: value.role,
    content: value.content,
    createdAt: value.created_at,
  };
}
