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
});
