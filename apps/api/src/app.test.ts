import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuthResponse } from "@companion/contracts";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

describe("personal companion api", () => {
  it("bootstraps, supports multiple devices and keeps assistant identity", async () => {
    const { app, database } = await createApp();
    try {
      const bootstrapped = await app.inject({
        method: "POST",
        url: "/v1/bootstrap",
        payload: {
          bootstrapToken: "test-bootstrap-token-long",
          email: "owner@example.com",
          password: "test-password-123",
          displayName: "Owner",
          workspaceName: "Home",
          assistantName: "Friday",
          deviceName: "Desktop",
          platform: "windows",
        },
      });
      expect(bootstrapped.statusCode).toBe(200);
      const auth = bootstrapped.json<AuthResponse>();
      const assistants = await app.inject({
        method: "GET",
        url: "/v1/assistants",
        headers: { authorization: `Bearer ${auth.token}` },
      });
      expect(assistants.statusCode).toBe(200);
      expect(assistants.json()).toHaveLength(1);
      const assistant = assistants.json<Array<{ id: string; name: string }>>()[0];
      expect(assistant?.name).toBe("Friday");

      const second = await app.inject({
        method: "POST",
        url: "/v1/assistants",
        headers: { authorization: `Bearer ${auth.token}` },
        payload: {
          name: "小栖",
          summary: "生活伙伴",
          persona: {
            role: "温柔的生活伙伴",
            tone: "自然、有温度",
            values: "尊重用户自主",
            boundaries: "高风险动作先确认",
          },
          appearance: {
            avatarUrl: null,
            form: "orb",
            outfit: "日常",
            primaryColor: "#4477DD",
            secondaryColor: "#BBD5FF",
            scene: "透明桌面",
          },
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ name: "小栖", revision: expect.any(Number) });

      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "owner@example.com",
          password: "test-password-123",
          deviceName: "Phone",
          platform: "android",
        },
      });
      expect(login.statusCode).toBe(200);
      const phone = login.json<AuthResponse>();
      expect(phone.workspace.id).toBe(auth.workspace.id);
      expect(phone.device.id).not.toBe(auth.device.id);
      const phoneAssistants = await app.inject({
        method: "GET",
        url: "/v1/assistants",
        headers: { authorization: `Bearer ${phone.token}` },
      });
      expect(phoneAssistants.json()).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("stores shared and assistant-private memory with scoped retrieval", async () => {
    const { app, database } = await createApp();
    try {
      const auth = await bootstrap(app);
      const assistant = (await app.inject({
        method: "GET",
        url: "/v1/assistants",
        headers: { authorization: `Bearer ${auth.token}` },
      })).json<Array<{ id: string }>>()[0];
      const assistantId = assistant!.id;
      await app.inject({
        method: "POST",
        url: "/v1/memories",
        headers: { authorization: `Bearer ${auth.token}` },
        payload: {
          assistantId,
          scope: "assistant",
          type: "preference",
          content: "周五喜欢安静的早晨",
          source: "manual",
          importance: 0.8,
        },
      });
      await app.inject({
        method: "POST",
        url: "/v1/memories",
        headers: { authorization: `Bearer ${auth.token}` },
        payload: {
          assistantId: null,
          scope: "personal",
          type: "profile",
          content: "用户喜欢简洁回答",
          source: "manual",
          importance: 0.9,
        },
      });
      const memories = await app.inject({
        method: "GET",
        url: "/v1/memories",
        headers: { authorization: `Bearer ${auth.token}` },
      });
      expect(memories.json()).toHaveLength(2);
      const chat = await app.inject({
        method: "POST",
        url: `/v1/assistants/${assistantId}/chat`,
        headers: { authorization: `Bearer ${auth.token}` },
        payload: { content: "你还记得我吗？" },
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json()).toMatchObject({
        conversation: { assistantId },
        userMessage: { role: "user" },
        assistantMessage: { role: "assistant" },
      });
    } finally {
      database.close();
    }
  });

  it("rejects unauthenticated access", async () => {
    const { app, database } = await createApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/assistants",
      });
      expect(response.statusCode).toBe(401);
    } finally {
      database.close();
    }
  });
});

async function createApp(): Promise<{
  app: FastifyInstance;
  database: ReturnType<typeof openDatabase>["database"];
}> {
  const opened = openDatabase(":memory:");
  const app = await buildApp({
    database: opened.database,
    config: loadConfig({
      bootstrapToken: "test-bootstrap-token-long",
      jwtSecret: "test-jwt-secret-that-is-long-enough-12345",
      modelProvider: "mock",
      modelApiKey: "",
    }),
  });
  apps.push(app);
  return { app, database: opened.database };
}

async function bootstrap(app: FastifyInstance): Promise<AuthResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    payload: {
      bootstrapToken: "test-bootstrap-token-long",
      email: "owner@example.com",
      password: "test-password-123",
      displayName: "Owner",
      workspaceName: "Home",
      assistantName: "Friday",
      deviceName: "Desktop",
      platform: "windows",
    },
  });
  return response.json<AuthResponse>();
}
