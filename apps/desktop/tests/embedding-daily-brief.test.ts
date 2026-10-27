import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { ModelProvider } from "../src/core/ports";
import type { EmbeddingProvider } from "../src/core/ports";
import { DailyBriefService, dateInTimezone } from "../src/core/daily-brief-service";
import { MemoryService } from "../src/core/memory-service";
import { SiliconFlowEmbeddingProvider } from "../src/core/siliconflow-embedding-provider";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteConversationRepository } from "../src/main/persistence/conversation-repository";
import { SqliteDailyBriefRepository } from "../src/main/persistence/daily-brief-repository";
import { SqliteMemoryRepository } from "../src/main/persistence/memory-repository";

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "fake-bge-m3";
  async isConfigured(): Promise<boolean> {
    return true;
  }
  async embed(text: string): Promise<number[]> {
    if (/火星|周中|例会/.test(text)) {
      return [1, 1, 0];
    }
    return [0, 0, 1];
  }
}

class FakeSummaryModel implements ModelProvider {
  readonly modelName = "fake-summary";
  calls = 0;
  async *chat(): AsyncIterable<string> {
    this.calls += 1;
    yield "今日重点：推进火星项目。\n下一步：准备周中例会。";
  }
}

describe("BGE-M3 混合检索与每日总结", () => {
  let database: DatabaseSync;
  let memoryService: MemoryService;
  let conversations: SqliteConversationRepository;

  beforeEach(() => {
    database = openDatabase(":memory:").database;
    conversations = new SqliteConversationRepository(database);
    memoryService = new MemoryService(
      new SqliteMemoryRepository(database),
      new FakeEmbeddingProvider(),
    );
  });

  afterEach(() => {
    database.close();
  });

  it("在关键词无交集时通过向量召回事实记忆", async () => {
    const conversation = conversations.ensureConversation({});
    const message = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "请记住：火星项目每周三复盘",
    });
    memoryService.captureExplicitMessage(message);
    await memoryService.flushIndexing();

    const results = await memoryService.search({
      query: "周中例会安排",
      modelDestination: "cloud",
    });

    expect(results.some((item) => item.content === "火星项目每周三复盘")).toBe(true);
  });

  it("每日总结只使用任务与记忆并标记未连接数据源", async () => {
    const conversation = conversations.ensureConversation({});
    const message = conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "请记住：火星项目需要准备周中例会",
    });
    memoryService.captureExplicitMessage(message);
    const model = new FakeSummaryModel();
    const briefs = new SqliteDailyBriefRepository(database);
    const service = new DailyBriefService(
      memoryService,
      () => [
        {
          id: "task-1",
          title: "准备例会材料",
          description: "整理风险",
          taskType: "user",
          status: "scheduled",
          dueAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
          timezone: "Asia/Shanghai",
          priority: 2,
          idempotencyKey: "brief-test",
          recurrence: "none",
          seriesId: "task-1",
          occurrenceKey: "task-1:today",
          actionType: "notify",
          retryCount: 0,
          maxRetryCount: 3,
          lastErrorCode: null,
          lastErrorMessage: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      briefs,
      model,
    );

    const brief = await service.generate(new Date());

    expect(brief.content).toContain("火星项目");
    expect(brief.sourceStatus).toEqual({
      tasks: "available",
      memories: "available",
      email: "not_connected",
      calendar: "not_connected",
    });
    expect(model.calls).toBe(1);
    expect(service.latest()?.id).toBe(brief.id);
  });

  it("没有本地数据时不调用模型", async () => {
    const model = new FakeSummaryModel();
    const service = new DailyBriefService(
      memoryService,
      () => [],
      new SqliteDailyBriefRepository(database),
      model,
    );

    const brief = await service.generate(new Date());

    expect(brief.model).toBe("local-deterministic");
    expect(model.calls).toBe(0);
  });

  it("按指定时区计算日期", () => {
    expect(
      dateInTimezone(new Date("2026-10-27T16:30:00.000Z"), "Asia/Shanghai"),
    ).toBe("2026-10-28");
  });
});

describe("SiliconFlowEmbeddingProvider", () => {
  it("解析 BGE-M3 向量响应", async () => {
    const provider = new SiliconFlowEmbeddingProvider(
      async () => "sk-test-key",
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(provider.embed("测试")).resolves.toEqual([0.1, 0.2, 0.3]);
  });
});
