import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AssistantCore } from "../src/core/assistant-core";
import type {
  AssistantStreamEvent,
  ModelRequest,
} from "../src/core/domain";
import type { ModelProvider } from "../src/core/ports";
import { MemoryService } from "../src/core/memory-service";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteConversationRepository } from "../src/main/persistence/conversation-repository";
import { SqliteMemoryRepository } from "../src/main/persistence/memory-repository";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

class FakeModelProvider implements ModelProvider {
  readonly modelName = "fake-model";
  readonly requests: ModelRequest[] = [];
  private callCount = 0;

  async *chat(request: ModelRequest): AsyncIterable<string> {
    this.requests.push(request);
    this.callCount += 1;
    if (this.callCount === 1) {
      yield "记住了";
      yield "。";
      return;
    }
    const memoryContext = request.messages[0]?.content ?? "";
    expect(memoryContext).toContain("我喜欢简洁回答");
    yield "你偏好";
    yield "简洁回答。";
  }
}

describe("AssistantCore", () => {
  let database: DatabaseSync;
  let assistant: AssistantCore;
  let conversations: SqliteConversationRepository;
  let provider: FakeModelProvider;
  let persona = {
    ...DEFAULT_SETTINGS.persona,
    name: "测试角色",
    description: "冷静但亲切",
  };

  beforeEach(() => {
    const opened = openDatabase(":memory:");
    database = opened.database;
    conversations = new SqliteConversationRepository(database);
    const memories = new MemoryService(new SqliteMemoryRepository(database));
    provider = new FakeModelProvider();
    assistant = new AssistantCore(
      conversations,
      memories,
      memories,
      provider,
      () => persona,
    );
  });

  afterEach(() => {
    database.close();
  });

  it("持久化对话并在下一轮使用明确记忆", async () => {
    const first = await collectEvents(
      assistant.sendMessage({
        message: "请记住：我喜欢简洁回答",
        modelDestination: "cloud",
      }),
    );
    const started = first.find((event) => event.type === "message.started");
    expect(started).toBeDefined();
    if (started?.type !== "message.started") {
      throw new Error("缺少 message.started");
    }
    expect(started.memoryCaptured).toBe(true);

    const completed = first.find((event) => event.type === "message.completed");
    expect(completed?.type).toBe("message.completed");
    if (completed?.type !== "message.completed") {
      throw new Error("缺少 message.completed");
    }
    expect(completed.assistantMessage.content).toBe("记住了。");

    const second = await collectEvents(
      assistant.sendMessage({
        conversationId: started.conversationId,
        message: "我喜欢什么？",
        modelDestination: "cloud",
      }),
    );
    const secondCompleted = second.find(
      (event) => event.type === "message.completed",
    );
    expect(secondCompleted?.type).toBe("message.completed");
    if (secondCompleted?.type !== "message.completed") {
      throw new Error("第二轮缺少 message.completed");
    }
    expect(secondCompleted.assistantMessage.content).toBe("你偏好简洁回答。");
    expect(conversations.listRecentMessages(started.conversationId, 10)).toHaveLength(4);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "角色名称：测试角色",
    );
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "安全规则、事实真实性、用户权限或工具确认要求冲突",
    );
  });
});

async function collectEvents(
  stream: AsyncIterable<AssistantStreamEvent>,
): Promise<AssistantStreamEvent[]> {
  const events: AssistantStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
