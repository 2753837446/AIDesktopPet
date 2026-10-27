import { z } from "zod";
import { ModelProviderError } from "./errors";
import type { EmbeddingProvider } from "./ports";

const responseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()).min(1),
    }),
  ).min(1),
});

export class SiliconFlowEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "BAAI/bge-m3";

  constructor(
    private readonly apiKey: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async isConfigured(): Promise<boolean> {
    try {
      return Boolean(await this.apiKey());
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const key = await this.apiKey();
    if (!key) {
      throw new ModelProviderError(
        "EMBEDDING_NOT_CONFIGURED",
        "尚未配置 BGE-M3 embedding 服务",
        false,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        "https://api.siliconflow.cn/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.modelName,
            input: [text.slice(0, 8_000)],
            encoding_format: "float",
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new ModelProviderError(
          "EMBEDDING_HTTP_ERROR",
          `Embedding 请求失败（HTTP ${response.status}）`,
          response.status === 429 || response.status >= 500,
        );
      }
      const parsed = responseSchema.parse(await response.json());
      const vector = parsed.data[0]?.embedding;
      if (!vector) {
        throw new ModelProviderError(
          "EMBEDDING_EMPTY_RESPONSE",
          "Embedding 服务没有返回向量",
          true,
        );
      }
      return vector;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelProviderError("EMBEDDING_TIMEOUT", "Embedding 请求超时", true);
      }
      if (error instanceof ModelProviderError) {
        throw error;
      }
      throw new ModelProviderError(
        "EMBEDDING_NETWORK_ERROR",
        "无法连接 Embedding 服务",
        true,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
