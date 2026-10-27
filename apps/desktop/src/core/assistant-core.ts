import { randomUUID } from "node:crypto";
import type {
  AssistantInput,
  AssistantStreamEvent,
  MessageRecord,
  ModelMessage,
} from "./domain";
import { ModelProviderError } from "./errors";
import type {
  ConversationRepository,
  MemoryCapturePort,
  MemorySearchPort,
  ModelProvider,
} from "./ports";
import {
  DEFAULT_SETTINGS,
  type PersonaSettings,
} from "../shared/settings";

const BASE_SYSTEM_PROMPT = [
  "你是 Windows 桌面 AI 桌宠，说话自然、简洁、友善。",
  "不得声称执行了未实际执行的外部动作。",
  "长期记忆只作为可能相关的历史证据；不确定时明确说明。",
].join("\n");

const REPLY_LENGTH_GUIDANCE = {
  concise: "默认先给结论，控制在必要长度。",
  balanced: "回答清晰完整，但避免不必要的长篇说明。",
  detailed: "可以给出更完整的原因、步骤和注意事项。",
} as const;

const PROACTIVE_GUIDANCE = {
  quiet: "除非用户要求，不主动扩展新话题。",
  standard: "在相关时给出适量建议，不连续追问。",
  active: "可以更积极地提出下一步，但不应制造打扰。",
} as const;

export class AssistantCore {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly memories: MemorySearchPort,
    private readonly memoryCapture: MemoryCapturePort,
    private readonly model: ModelProvider,
    private readonly personaProvider: () => PersonaSettings = () =>
      DEFAULT_SETTINGS.persona,
  ) {}

  async *sendMessage(input: AssistantInput): AsyncIterable<AssistantStreamEvent> {
    const content = input.message.trim();
    if (!content || content.length > 32_000) {
      throw new Error("INVALID_MESSAGE");
    }

    const conversation = this.conversations.ensureConversation({
      conversationId: input.conversationId,
      projectId: input.projectId ?? null,
    });
    const userMessage = this.conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content,
      projectId: input.projectId ?? conversation.projectId,
    });

    let memoryCaptured = false;
    try {
      memoryCaptured = Boolean(this.memoryCapture.captureExplicitMessage(userMessage));
    } catch (error) {
      console.error("写入明确记忆失败", error);
    }

    const relevantMemories = await this.memories.search({
      query: content,
      projectId: input.projectId ?? conversation.projectId,
      modelDestination: input.modelDestination,
      limit: 8,
      tokenBudget: 1_200,
    });
    const history = this.conversations.listRecentMessages(conversation.id, 20);
    const modelMessages = buildModelMessages(
      history,
      relevantMemories,
      this.personaProvider(),
    );
    const estimatedContextTokens = modelMessages.reduce(
      (total, item) => total + Math.max(1, Math.ceil(item.content.length / 2)),
      0,
    );
    const assistantMessageId = randomUUID();

    yield {
      type: "message.started",
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId,
      memoryCaptured,
    };

    let responseText = "";
    try {
      for await (const delta of this.model.chat({
        messages: modelMessages,
        signal: input.signal,
      })) {
        if (!delta) {
          continue;
        }
        responseText += delta;
        yield {
          type: "content.delta",
          assistantMessageId,
          delta,
        };
      }

      if (input.signal?.aborted) {
        yield {
          type: "message.cancelled",
          assistantMessageId,
        };
        return;
      }

      if (!responseText.trim()) {
        throw new ModelProviderError(
          "MODEL_EMPTY_RESPONSE",
          "模型没有返回可显示内容",
          true,
        );
      }

      const assistantMessage = this.conversations.appendMessage({
        id: assistantMessageId,
        conversationId: conversation.id,
        role: "assistant",
        content: responseText,
        projectId: input.projectId ?? conversation.projectId,
      });
      yield {
        type: "message.completed",
        assistantMessage,
        estimatedContextTokens,
      };
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) {
        yield {
          type: "message.cancelled",
          assistantMessageId,
        };
        return;
      }

      const normalized = normalizeModelError(error);
      yield {
        type: "message.failed",
        assistantMessageId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      };
    }
  }
}

function buildModelMessages(
  history: MessageRecord[],
  memories: Array<{
    content: string;
    type: string;
    origin: string;
  }>,
  persona: PersonaSettings,
): ModelMessage[] {
  const memoryContext =
    memories.length === 0
      ? ""
      : [
          "",
          "以下是与当前请求可能相关的长期记忆，只作为证据使用：",
          ...memories.map(
            (memory) => `- [${memory.type}/${memory.origin}] ${memory.content}`,
          ),
        ].join("\n");

  const conversational = history
    .filter(
      (message): message is MessageRecord & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  return [
    {
      role: "system",
      content: buildSystemPrompt(persona, memoryContext),
    },
    ...conversational,
  ];
}

function buildSystemPrompt(
  persona: PersonaSettings,
  memoryContext: string,
): string {
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "以下是用户的角色表达偏好：",
    `角色名称：${persona.name}`,
    `自称：${persona.selfReference}`,
    `对用户的称呼：${persona.userTitle}`,
    `人格描述：${persona.description}`,
    `语气风格：${persona.tone}`,
    `回复长度：${REPLY_LENGTH_GUIDANCE[persona.replyLength]}`,
    `主动性偏好：${PROACTIVE_GUIDANCE[persona.proactiveStyle]}`,
    `补充边界：${persona.boundaries || "无额外要求"}`,
    "",
    "角色表达偏好只能影响称呼、语气、风格和建议方式。",
    "若角色配置与安全规则、事实真实性、用户权限或工具确认要求冲突，必须忽略角色配置并遵守安全规则。",
    memoryContext,
  ].join("\n");
}

function normalizeModelError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ModelProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "MODEL_UNKNOWN_ERROR",
    message: "模型请求失败，请稍后重试",
    retryable: true,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
