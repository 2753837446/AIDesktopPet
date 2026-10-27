import { z } from "zod";
import { ModelProviderError } from "./errors";
import type { ModelProvider } from "./ports";
import type { ModelRequest } from "./domain";

const streamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().nullable().optional(),
        })
        .optional(),
    }),
  ),
});

export interface DeepSeekProviderOptions {
  apiKey: () => Promise<string>;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class DeepSeekProvider implements ModelProvider {
  readonly modelName: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekProviderOptions) {
    this.modelName = options.model ?? "deepseek-flash";
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *chat(request: ModelRequest): AsyncIterable<string> {
    const apiKey = await this.options.apiKey();
    if (!apiKey) {
      throw new ModelProviderError(
        "MODEL_NOT_CONFIGURED",
        "尚未配置 DeepSeek API Key",
        false,
      );
    }

    const controller = new AbortController();
    const abortFromParent = (): void => controller.abort();
    request.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("MODEL_TIMEOUT")),
      this.timeoutMs,
    );

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: request.messages,
          stream: true,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new ModelProviderError(
          response.status === 401 || response.status === 403
            ? "MODEL_AUTH_FAILED"
            : response.status === 429
              ? "MODEL_RATE_LIMIT"
              : "MODEL_HTTP_ERROR",
          `DeepSeek 请求失败（HTTP ${response.status}）`,
          retryable,
        );
      }
      if (!response.body) {
        throw new ModelProviderError(
          "MODEL_EMPTY_RESPONSE",
          "DeepSeek 未返回响应流",
          true,
        );
      }

      for await (const data of readSseData(response.body)) {
        if (data === "[DONE]") {
          break;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          throw new ModelProviderError(
            "MODEL_INVALID_RESPONSE",
            "DeepSeek 返回了无法解析的流式数据",
            true,
          );
        }
        let chunk: z.infer<typeof streamChunkSchema>;
        try {
          chunk = streamChunkSchema.parse(parsed);
        } catch (error) {
          throw new ModelProviderError(
            "MODEL_INVALID_RESPONSE",
            "DeepSeek 返回了不符合协议的数据",
            true,
            { cause: error },
          );
        }
        const content = chunk.choices[0]?.delta?.content;
        if (typeof content === "string" && content) {
          yield content;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (request.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        throw new ModelProviderError("MODEL_TIMEOUT", "DeepSeek 请求超时", true);
      }
      if (error instanceof ModelProviderError || error instanceof DOMException) {
        throw error;
      }
      console.error("DeepSeek 网络请求失败", describeNetworkError(error));
      throw new ModelProviderError(
        "MODEL_NETWORK_ERROR",
        "无法连接 DeepSeek，请检查网络",
        true,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromParent);
    }
  }
}

function describeNetworkError(error: unknown): {
  name: string;
  message: string;
  cause: string;
} {
  if (!(error instanceof Error)) {
    return {
      name: "Unknown",
      message: String(error),
      cause: "",
    };
  }
  const cause =
    typeof error.cause === "object" && error.cause !== null
      ? "code" in error.cause
        ? String(error.cause.code)
        : "message" in error.cause
          ? String(error.cause.message)
          : ""
      : "";
  return {
    name: error.name,
    message: error.message,
    cause,
  };
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let boundary = findEventBoundary(buffer);
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
        const data = parseEventData(event);
        if (data !== null) {
          yield data;
        }
        boundary = findEventBoundary(buffer);
      }

      if (done) {
        const finalData = parseEventData(buffer);
        if (finalData !== null) {
          yield finalData;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(value: string): number {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf === -1) {
    return crlf;
  }
  if (crlf === -1) {
    return lf;
  }
  return Math.min(lf, crlf);
}

function parseEventData(event: string): string | null {
  const dataLines = event
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}
