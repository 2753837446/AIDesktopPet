import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AssistantCore } from "../src/core/assistant-core";
import type {
  AssistantStreamEvent,
  ModelStreamEvent,
  ModelRequest,
  ModelToolRequest,
  ToolCallRecord,
} from "../src/core/domain";
import type { AssistantToolPort, ModelProvider } from "../src/core/ports";
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
  let memories: MemoryService;
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
    memories = new MemoryService(new SqliteMemoryRepository(database));
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

  it("执行模型工具调用并把真实结果回传生成最终答复", async () => {
    const provider = new FakeToolModelProvider();
    const invocations: Array<{
      requestId: string;
      toolName: string;
      input: unknown;
    }> = [];
    const tools: AssistantToolPort = {
      listModelTools: () => [
        {
          name: "clock.read",
          description: "读取本地时间",
          parameters: { type: "object", properties: {} },
        },
      ],
      invoke: async (input) => {
        invocations.push(input);
        return completedToolCall(input.toolName);
      },
    };
    const toolAssistant = new AssistantCore(
      conversations,
      memories,
      memories,
      provider,
      () => persona,
      tools,
    );

    const events = await collectEvents(
      toolAssistant.sendMessage({
        message: "现在几点？",
        modelDestination: "cloud",
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.started",
        toolName: "clock.read",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        status: "completed",
        summary: "2026-10-28 01:30:00",
      }),
    );
    const completed = events.find((event) => event.type === "message.completed");
    expect(completed?.type).toBe("message.completed");
    if (completed?.type !== "message.completed") {
      throw new Error("缺少最终回答");
    }
    expect(completed.assistantMessage.content).toBe(
      "现在是 2026-10-28 01:30:00。",
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.input).toEqual({});
    expect(provider.continuationRequests).toHaveLength(1);
    expect(provider.continuationRequests[0]?.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-clock",
      }),
    );
  });
});

class FakeToolModelProvider implements ModelProvider {
  readonly modelName = "fake-tool-model";
  readonly continuationRequests: ModelRequest[] = [];

  async *chat(request: ModelRequest): AsyncIterable<string> {
    this.continuationRequests.push(request);
    yield "现在是 2026-10-28 01:30:00。";
  }

  async *chatWithTools(
    request: ModelToolRequest,
  ): AsyncIterable<ModelStreamEvent> {
    expect(request.tools.map((tool) => tool.name)).toEqual(["clock.read"]);
    yield {
      type: "tool_calls",
      calls: [
        {
          id: "call-clock",
          name: "clock.read",
          arguments: "{}",
        },
      ],
    };
  }
}

function completedToolCall(toolName: string): ToolCallRecord {
  const now = new Date().toISOString();
  return {
    id: "tool-call-1",
    requestId: "request-1",
    toolName,
    inputSummary: "",
    riskLevel: "low",
    requiredScopes: ["system.read"],
    status: "completed",
    approvalStatus: "not_required",
    approvalId: null,
    outputSummary: "2026-10-28 01:30:00",
    errorCode: null,
    errorMessage: null,
    traceId: "trace-1",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
  };
}

async function collectEvents(
  stream: AsyncIterable<AssistantStreamEvent>,
): Promise<AssistantStreamEvent[]> {
  const events: AssistantStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
