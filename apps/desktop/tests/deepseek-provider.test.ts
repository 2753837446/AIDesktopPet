import { describe, expect, it } from "vitest";
import {
  DeepSeekProvider,
  readSseData,
} from "../src/core/deepseek-provider";

describe("DeepSeekProvider", () => {
  it("解析跨 chunk 的 SSE 数据", async () => {
    const encoder = new TextEncoder();
    const payload = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, 21)));
        controller.enqueue(encoder.encode(payload.slice(21)));
        controller.close();
      },
    });

    const events: string[] = [];
    for await (const data of readSseData(body)) {
      events.push(data);
    }

    expect(events).toHaveLength(3);
    expect(events[2]).toBe("[DONE]");
  });

  it("缺少密钥时返回稳定错误", async () => {
    const provider = new DeepSeekProvider({
      apiKey: async () => "",
    });
    const iterator = provider.chat({ messages: [] })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({
      code: "MODEL_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("聚合流式工具调用并把工具 schema 发给模型", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const encoder = new TextEncoder();
    const payload = [
      'data: {"choices":[{"delta":{"content":"我查一下。"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"clock.read","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    });
    const provider = new DeepSeekProvider({
      apiKey: async () => "sk-testabcdefghijklmnopqrstuvwxyz123456",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const events = [];
    for await (const event of provider.chatWithTools({
      messages: [{ role: "user", content: "现在几点" }],
      tools: [
        {
          name: "clock.read",
          description: "读取本地时间",
          parameters: { type: "object", properties: {} },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", delta: "我查一下。" },
      {
        type: "tool_calls",
        calls: [
          {
            id: "call_1",
            name: "clock.read",
            arguments: "{}",
          },
        ],
      },
    ]);
    expect(requestBody).toMatchObject({
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: { name: "clock_read" },
        },
      ],
    });
  });
});
