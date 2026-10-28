import type { AppConfig } from "./config.js";

export interface ModelContext {
  assistantName: string;
  persona: {
    role: string;
    tone: string;
    values: string;
    boundaries: string;
  };
  memories: Array<{
    scope: string;
    type: string;
    content: string;
  }>;
  history: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export async function generateReply(
  config: AppConfig,
  context: ModelContext,
): Promise<string> {
  if (config.modelProvider === "mock" || !config.modelApiKey) {
    return mockReply(context);
  }

  const memoryText =
    context.memories.length === 0
      ? "无"
      : context.memories
          .map(
            (memory) =>
              `- [${memory.scope}/${memory.type}] ${memory.content}`,
          )
          .join("\n");
  const response = await fetch(
    `${config.modelBaseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.modelApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.modelName,
        stream: false,
        temperature: 0.75,
        messages: [
          {
            role: "system",
            content: [
              `你是${context.assistantName}，用户的长期数字伙伴。`,
              `角色：${context.persona.role}`,
              `语气：${context.persona.tone}`,
              `重视：${context.persona.values || "自然、可靠"}`,
              `边界：${context.persona.boundaries || "不冒充真实人类，不声称未执行的动作"}`,
              "你有情绪表达能力，但情绪必须服务于理解和陪伴，不能操纵依赖。",
              "高风险动作必须先获得用户确认。",
              "以下是可能相关的记忆，只作为证据：",
              memoryText,
            ].join("\n"),
          },
          ...context.history,
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    throw new Error(`MODEL_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("MODEL_EMPTY_RESPONSE");
  }
  return content.trim();
}

function mockReply(context: ModelContext): string {
  const lastUser = [...context.history]
    .reverse()
    .find((item) => item.role === "user")?.content;
  return `${context.assistantName}听见了。${lastUser ? `你刚才说：“${lastUser.slice(0, 160)}”。` : ""}当前使用本地模拟模型；配置模型 Key 后，我会结合共享记忆继续回答。`;
}
