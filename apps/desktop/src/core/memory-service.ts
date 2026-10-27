import type {
  MemoryCaptureInput,
  MemoryRecord,
  MemorySearchResult,
  MemoryType,
  MessageRecord,
} from "./domain";
import type {
  EmbeddingProvider,
  MemoryCapturePort,
  MemorySearchPort,
} from "./ports";
import { SqliteMemoryRepository } from "../main/persistence/memory-repository";

const MAX_MEMORY_CHARACTERS = 2_000;
const DEFAULT_TOKEN_BUDGET = 1_200;

export class MemoryService implements MemorySearchPort, MemoryCapturePort {
  private readonly indexQueue = new Map<string, MemoryRecord>();
  private indexingPromise: Promise<void> | null = null;

  constructor(
    private readonly repository: SqliteMemoryRepository,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  captureExplicitMessage(message: MessageRecord): MemoryRecord | null {
    if (message.role !== "user") {
      return null;
    }

    const match = message.content
      .trim()
      .match(/^(?:请|帮我)?记住(?:一下)?[：:，,\s]*(.+)$/s);
    if (!match?.[1]) {
      return null;
    }

    const content = match[1].trim();
    if (content.length < 2 || content.length > MAX_MEMORY_CHARACTERS) {
      return null;
    }

    const input: MemoryCaptureInput = {
      message,
      content,
      type: classifyMemory(content),
      projectId: message.projectId,
      privacyLevel: /私密|仅本地|不要上传/.test(content) ? "local_only" : "normal",
    };
    const memory = this.repository.insert(input);
    this.scheduleEmbedding(memory);
    return memory;
  }

  async search(input: {
    query: string;
    projectId?: string | null;
    modelDestination: "local" | "cloud";
    limit?: number;
    tokenBudget?: number;
  }): Promise<MemorySearchResult[]> {
    const projectId = input.projectId ?? null;
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const tokenBudget = Math.max(100, input.tokenBudget ?? DEFAULT_TOKEN_BUDGET);

    const keywordResults = this.repository.searchKeyword(input.query, {
      projectId,
      modelDestination: input.modelDestination,
      limit,
    });
    const contextResults = this.repository.listContextMemories({
      projectId,
      modelDestination: input.modelDestination,
      limit,
    });

    const keywordScores = new Map<string, number>();
    const semanticScores = new Map<string, number>();
    const records = new Map<string, MemorySearchResult>();
    for (const result of keywordResults) {
      records.set(result.id, result);
      keywordScores.set(result.id, normalizeKeywordScore(result.score));
    }
    for (const result of contextResults) {
      if (!records.has(result.id)) {
        records.set(result.id, result);
      }
    }

    if (this.embeddingProvider) {
      try {
        if (await this.embeddingProvider.isConfigured()) {
          const queryVector = await this.embeddingProvider.embed(input.query);
          const candidates = this.repository.listEmbeddingCandidates({
            projectId,
            modelDestination: input.modelDestination,
            limit: 200,
          });
          for (const candidate of candidates) {
            if (candidate.vector.length !== queryVector.length) {
              continue;
            }
            const similarity = cosineSimilarity(queryVector, candidate.vector);
            if (similarity < 0.2) {
              continue;
            }
            semanticScores.set(candidate.memory.id, Math.max(0, similarity));
            records.set(candidate.memory.id, {
              ...candidate.memory,
              score: similarity,
              sourceIds: candidate.sourceIds,
            });
          }
        }
      } catch (error) {
        console.warn("语义检索不可用，回退关键词检索", error);
      }
    }

    const now = Date.now();
    const ranked = [...records.values()]
      .map((record) => {
        const keyword = keywordScores.get(record.id) ?? 0;
        const semantic = semanticScores.get(record.id) ?? 0;
        const ageDays = Math.max(
          0,
          (now - new Date(record.updatedAt).getTime()) / 86_400_000,
        );
        const freshness = Math.max(0, 1 - Math.min(ageDays, 365) / 365);
        return {
          ...record,
          score:
            0.55 * semantic +
            0.25 * keyword +
            0.15 * record.importance +
            0.05 * freshness,
        };
      })

      .sort(
      (left, right) =>
        right.score - left.score ||
        right.importance - left.importance ||
        right.updatedAt.localeCompare(left.updatedAt),
      );

    const selected: MemorySearchResult[] = [];
    let usedTokens = 0;
    for (const result of ranked) {
      const estimatedTokens = Math.max(1, Math.ceil(result.content.length / 2));
      if (selected.length >= limit) {
        break;
      }
      if (selected.length > 0 && usedTokens + estimatedTokens > tokenBudget) {
        continue;
      }
      selected.push(result);
      usedTokens += estimatedTokens;
    }
    return selected;
  }

  list(input: {
    query?: string;
    projectId?: string | null;
    limit?: number;
  }): MemorySearchResult[] {
    return this.repository.list({
      ...(input.query === undefined ? {} : { query: input.query }),
      projectId: input.projectId ?? null,
      limit: input.limit ?? 100,
    });
  }

  update(
    id: string,
    patch: {
      content?: string;
      type?: MemoryType;
      importance?: number;
    },
  ): MemorySearchResult | null {
    const content = patch.content?.trim();
    if (content !== undefined && (content.length < 2 || content.length > 2_000)) {
      throw new Error("INVALID_MEMORY_CONTENT");
    }
    if (
      patch.importance !== undefined &&
      (patch.importance < 0 || patch.importance > 1)
    ) {
      throw new Error("INVALID_MEMORY_IMPORTANCE");
    }
    const updated = this.repository.update(id, {
      ...(content === undefined ? {} : { content }),
      ...(patch.type === undefined ? {} : { type: patch.type }),
      ...(patch.importance === undefined
        ? {}
        : { importance: patch.importance }),
    });
    if (updated) {
      this.scheduleEmbedding(updated);
    }
    return updated;
  }

  delete(id: string): boolean {
    this.indexQueue.delete(id);
    return this.repository.delete(id);
  }

  reindexAll(): number {
    if (!this.embeddingProvider) {
      return 0;
    }
    const all = this.repository.list({ projectId: null, limit: 100 });
    for (const memory of all) {
      this.scheduleEmbedding(memory);
    }
    void this.flushIndexing();
    return all.length;
  }

  async flushIndexing(): Promise<void> {
    if (this.indexingPromise) {
      return this.indexingPromise;
    }
    this.indexingPromise = this.flushIndexQueue().finally(() => {
      this.indexingPromise = null;
    });
    return this.indexingPromise;
  }

  private scheduleEmbedding(memory: MemoryRecord): void {
    if (
      !this.embeddingProvider ||
      memory.privacyLevel === "local_only"
    ) {
      return;
    }
    this.indexQueue.set(memory.id, memory);
    void this.flushIndexing();
  }

  private async flushIndexQueue(): Promise<void> {
    if (!this.embeddingProvider) {
      return;
    }
    if (!(await this.embeddingProvider.isConfigured())) {
      this.indexQueue.clear();
      return;
    }

    while (this.indexQueue.size > 0) {
      const entry = this.indexQueue.entries().next().value as
        | [string, MemoryRecord]
        | undefined;
      if (!entry) {
        break;
      }
      const [id, memory] = entry;
      this.indexQueue.delete(id);
      try {
        const vector = await this.embeddingProvider.embed(memory.content);
        this.repository.saveEmbedding({
          memoryId: id,
          model: this.embeddingProvider.modelName,
          vector,
          now: new Date().toISOString(),
        });
      } catch (error) {
        console.warn("记忆向量索引失败，保留关键词检索", error);
        this.repository.markEmbeddingFailure(
          id,
          error instanceof Error ? error.message : "向量索引失败",
        );
      }
    }
  }
}

function classifyMemory(content: string): MemoryType {
  if (/偏好|喜欢|习惯|希望|不喜欢/.test(content)) {
    return "preference";
  }
  if (/决定|采用|改用|不再使用|范围冻结/.test(content)) {
    return "project_decision";
  }
  if (/提醒我|承诺|答应|截止/.test(content)) {
    return "commitment";
  }
  return "fact";
}

function normalizeKeywordScore(score: number): number {
  return Math.min(1, Math.max(0, score / (score + 1)));
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}
