import { randomUUID } from "node:crypto";
import type {
  ConversationRecord,
  MessageRecord,
  MessageRole,
} from "../../core/domain";
import type { ConversationRepository } from "../../core/ports";
import type { DatabaseSync } from "node:sqlite";

interface ConversationRow {
  id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  project_id: string | null;
  created_at: string;
  token_estimate: number;
}

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly database: DatabaseSync) {}

  ensureConversation(input: {
    conversationId?: string;
    projectId?: string | null;
    title?: string;
  }): ConversationRecord {
    if (input.conversationId) {
      const existing = this.database
        .prepare(
          `SELECT id, title, project_id, created_at, updated_at
           FROM conversations WHERE id = ?`,
        )
        .get(input.conversationId) as ConversationRow | undefined;
      if (!existing) {
        throw new Error("CONVERSATION_NOT_FOUND");
      }
      return mapConversation(existing);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const title = input.title?.trim().slice(0, 80) || "新对话";
    this.database
      .prepare(
        `INSERT INTO conversations (id, title, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title, input.projectId ?? null, now, now);

    return {
      id,
      title,
      projectId: input.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  appendMessage(input: {
    id?: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    projectId?: string | null;
  }): MessageRecord {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const tokenEstimate = estimateTokens(input.content);
    const projectId = input.projectId ?? null;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO messages
            (id, conversation_id, role, content, created_at, token_estimate, project_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.conversationId,
          input.role,
          input.content,
          now,
          tokenEstimate,
          projectId,
        );

      const titleCandidate =
        input.role === "user" ? input.content.trim().slice(0, 36) : "";
      this.database
        .prepare(
          `UPDATE conversations
           SET updated_at = ?,
               title = CASE
                 WHEN title = '新对话' AND ? <> '' THEN ?
                 ELSE title
               END
           WHERE id = ?`,
        )
        .run(now, titleCandidate, titleCandidate, input.conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      projectId,
      createdAt: now,
      tokenEstimate,
    };
  }

  listRecentMessages(conversationId: string, limit: number): MessageRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, role, content, project_id, created_at,
                token_estimate
         FROM messages
         WHERE conversation_id = ? AND retention_status = 'active'
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(conversationId, safeLimit) as unknown as MessageRow[];
    return rows.reverse().map(mapMessage);
  }

  getMostRecentConversation(): ConversationRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, title, project_id, created_at, updated_at
         FROM conversations
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get() as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    projectId: row.project_id,
    createdAt: row.created_at,
    tokenEstimate: row.token_estimate,
  };
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}
