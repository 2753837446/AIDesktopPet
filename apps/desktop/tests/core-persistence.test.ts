import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { MemoryService } from "../src/core/memory-service";
import { openDatabase, type OpenedDatabase } from "../src/main/persistence/database";
import { SqliteConversationRepository } from "../src/main/persistence/conversation-repository";
import { SqliteMemoryRepository } from "../src/main/persistence/memory-repository";

describe("核心 SQLite 持久化", () => {
  let opened: OpenedDatabase;
  let database: DatabaseSync;
  let conversations: SqliteConversationRepository;
  let memories: MemoryService;

  beforeEach(() => {
    opened = openDatabase(":memory:");
    database = opened.database;
    conversations = new SqliteConversationRepository(database);
    memories = new MemoryService(new SqliteMemoryRepository(database));
  });

  afterEach(() => {
    database.close();
  });

  it("执行初始迁移并持久化会话消息", () => {
    expect(opened.schemaVersion).toBe(11);
    const conversation = conversations.ensureConversation({});
    const user = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "你好",
    });
    const assistant = conversations.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "你好呀",
    });

    const history = conversations.listRecentMessages(conversation.id, 10);
    expect(history.map((message) => message.id)).toEqual([user.id, assistant.id]);
    expect(conversations.getMostRecentConversation()?.id).toBe(conversation.id);
  });

  it("把明确表达写成可追溯偏好并支持 FTS 检索", async () => {
    const conversation = conversations.ensureConversation({});
    const message = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "请记住：我喜欢简洁回答",
    });

    const memory = memories.captureExplicitMessage(message);
    expect(memory).toMatchObject({
      type: "preference",
      origin: "user_explicit",
      content: "我喜欢简洁回答",
    });

    const results = await memories.search({
      query: "喜欢简洁回答",
      modelDestination: "cloud",
    });
    expect(results[0]?.content).toBe("我喜欢简洁回答");
    expect(results[0]?.sourceIds).toEqual([message.id]);

    const sourceCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_sources")
      .get() as { count: number };
    expect(sourceCount.count).toBe(1);
  });

  it("云端目的地不会包含 local_only 记忆", async () => {
    const conversation = conversations.ensureConversation({});
    const message = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "请记住：这是私密内容，仅本地上传",
    });
    memories.captureExplicitMessage(message);

    const cloudResults = await memories.search({
      query: "私密内容",
      modelDestination: "cloud",
    });
    const localResults = await memories.search({
      query: "私密内容",
      modelDestination: "local",
    });

    expect(cloudResults).toEqual([]);
    expect(localResults[0]?.privacyLevel).toBe("local_only");
    await memories.flushIndexing();
    const embeddingCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_embeddings")
      .get() as { count: number };
    expect(embeddingCount.count).toBe(0);
  });

  it("可以纠正和删除记忆，并同步清理检索索引", async () => {
    const conversation = conversations.ensureConversation({});
    const message = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "请记住：我喜欢简短回答",
    });
    const memory = memories.captureExplicitMessage(message);
    expect(memory).not.toBeNull();
    if (!memory) {
      return;
    }

    const updated = memories.update(memory.id, {
      content: "我喜欢结构化且简洁的回答",
    });
    expect(updated?.content).toBe("我喜欢结构化且简洁的回答");
    const afterUpdate = await memories.search({
      query: "简短回答",
      modelDestination: "cloud",
    });
    expect(afterUpdate.some((item) => item.content === "我喜欢简短回答")).toBe(false);
    expect(
      (
        await memories.search({
          query: "结构化简洁回答",
          modelDestination: "cloud",
        })
      )[0]?.content,
    ).toBe("我喜欢结构化且简洁的回答");

    expect(memories.delete(memory.id)).toBe(true);
    expect(memories.list({ limit: 20 })).toEqual([]);
    expect(
      await memories.search({
        query: "结构化简洁回答",
        modelDestination: "local",
      }),
    ).toEqual([]);
    const chunkCount = database
      .prepare("SELECT COUNT(*) AS count FROM memory_chunks WHERE owner_id = ?")
      .get(memory.id) as { count: number };
    const source = database
      .prepare(
        "SELECT source_status, excerpt FROM memory_sources WHERE memory_id = ?",
      )
      .get(memory.id) as { source_status: string; excerpt: string | null };
    expect(chunkCount.count).toBe(0);
    expect(source).toEqual({ source_status: "deleted", excerpt: null });
  });
});
