import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  DataDestination,
  MemoryCaptureInput,
  MemoryRecord,
  MemorySearchResult,
  MemoryType,
} from "../../core/domain";

interface MemoryRow {
  id: string;
  type: MemoryType;
  origin: MemoryRecord["origin"];
  content: string;
  project_id: string | null;
  confidence: number;
  importance: number;
  status: MemoryRecord["status"];
  privacy_level: MemoryRecord["privacyLevel"];
  created_at: string;
  updated_at: string;
  version: number;
}

export class SqliteMemoryRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: MemoryCaptureInput): MemoryRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const privacyLevel = input.privacyLevel ?? "normal";
    const chunkId = randomUUID();
    const contentHash = createHash("sha256").update(input.content).digest("hex");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO memories
            (id, type, origin, content, project_id, confidence, importance,
             status, privacy_level, created_at, updated_at, last_confirmed_at)
           VALUES (?, ?, 'user_explicit', ?, ?, 1.0, ?, 'active', ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.type,
          input.content,
          input.projectId,
          importanceFor(input.type),
          privacyLevel,
          now,
          now,
          now,
        );

      this.database
        .prepare(
          `INSERT INTO memory_sources
            (id, memory_id, source_kind, source_id, excerpt, source_status, created_at)
           VALUES (?, ?, 'message', ?, ?, 'active', ?)`,
        )
        .run(randomUUID(), id, input.message.id, input.content, now);

      this.database
        .prepare(
          `INSERT INTO memory_chunks
            (id, owner_type, owner_id, chunk_index, text_content, content_hash,
             embedding_status, created_at, updated_at)
           VALUES (?, 'memory', ?, 0, ?, ?, 'pending', ?, ?)`,
        )
        .run(chunkId, id, input.content, contentHash, now, now);

      this.database
        .prepare(
          `INSERT INTO memory_chunks_fts
            (chunk_id, owner_type, owner_id, text_content)
           VALUES (?, 'memory', ?, ?)`,
        )
        .run(chunkId, id, input.content);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      id,
      type: input.type,
      origin: "user_explicit",
      content: input.content,
      projectId: input.projectId,
      confidence: 1,
      importance: importanceFor(input.type),
      status: "active",
      privacyLevel,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  searchKeyword(
    query: string,
    input: {
      projectId: string | null;
      modelDestination: DataDestination;
      limit: number;
    },
  ): MemorySearchResult[] {
    const matchQuery = toFtsQuery(query);
    if (!matchQuery) {
      return [];
    }

    const projectClause =
      input.projectId === null
        ? "m.project_id IS NULL"
        : "(m.project_id IS NULL OR m.project_id = ?)";
    const privacyClause =
      input.modelDestination === "cloud" ? "m.privacy_level <> 'local_only'" : "1 = 1";
    const parameters: Array<string | number> = [matchQuery];
    if (input.projectId !== null) {
      parameters.push(input.projectId);
    }
    parameters.push(input.limit);

    const rows = this.database
      .prepare(
        `SELECT m.id, m.type, m.origin, m.content, m.project_id, m.confidence,
                m.importance, m.status, m.privacy_level, m.created_at,
                m.updated_at, m.version,
                bm25(memory_chunks_fts) AS rank
         FROM memory_chunks_fts
         JOIN memory_chunks c ON c.id = memory_chunks_fts.chunk_id
         JOIN memories m ON m.id = c.owner_id
         WHERE memory_chunks_fts MATCH ?
           AND c.owner_type = 'memory'
           AND m.status = 'active'
           AND ${projectClause}
           AND ${privacyClause}
         ORDER BY rank ASC, m.importance DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(...parameters) as unknown as Array<MemoryRow & { rank: number }>;

    return rows.map((row) => ({
      ...mapMemory(row),
      score: Math.max(0.01, -row.rank),
      sourceIds: this.listSourceIds(row.id),
    }));
  }

  listContextMemories(input: {
    projectId: string | null;
    modelDestination: DataDestination;
    limit: number;
  }): MemorySearchResult[] {
    const projectClause =
      input.projectId === null
        ? "project_id IS NULL"
        : "(project_id IS NULL OR project_id = ?)";
    const privacyClause =
      input.modelDestination === "cloud" ? "privacy_level <> 'local_only'" : "1 = 1";
    const parameters: Array<string | number> = [];
    if (input.projectId !== null) {
      parameters.push(input.projectId);
    }
    parameters.push(input.limit);

    const rows = this.database
      .prepare(
        `SELECT id, type, origin, content, project_id, confidence, importance,
                status, privacy_level, created_at, updated_at, version
         FROM memories
         WHERE status = 'active'
           AND type IN ('profile','preference','project_decision','commitment')
           AND ${projectClause}
           AND ${privacyClause}
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(...parameters) as unknown as MemoryRow[];

    return rows.map((row) => ({
      ...mapMemory(row),
      score: 0.5,
      sourceIds: this.listSourceIds(row.id),
    }));
  }

  list(input: {
    query?: string;
    projectId: string | null;
    limit: number;
  }): MemorySearchResult[] {
    const parameters: Array<string | number> = [];
    const projectClause =
      input.projectId === null ? "project_id IS NULL" : "(project_id IS NULL OR project_id = ?)";
    if (input.projectId !== null) {
      parameters.push(input.projectId);
    }

    const query = input.query?.trim();
    const queryClause = query ? "AND content LIKE ? ESCAPE '\\'" : "";
    if (query) {
      parameters.push(`%${escapeLike(query)}%`);
    }
    parameters.push(Math.max(1, Math.min(input.limit, 100)));

    const rows = this.database
      .prepare(
        `SELECT id, type, origin, content, project_id, confidence, importance,
                status, privacy_level, created_at, updated_at, version
         FROM memories
         WHERE status = 'active'
           AND ${projectClause}
           ${queryClause}
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(...parameters) as unknown as MemoryRow[];

    return rows.map((row) => ({
      ...mapMemory(row),
      score: 1,
      sourceIds: this.listSourceIds(row.id),
    }));
  }

  update(
    id: string,
    patch: {
      content?: string;
      type?: MemoryType;
      importance?: number;
    },
  ): MemorySearchResult | null {
    const existing = this.database
      .prepare(
        `SELECT id, type, origin, content, project_id, confidence, importance,
                status, privacy_level, created_at, updated_at, version
         FROM memories
         WHERE id = ? AND status = 'active'`,
      )
      .get(id) as MemoryRow | undefined;
    if (!existing) {
      return null;
    }

    const content = patch.content?.trim() ?? existing.content;
    const type = patch.type ?? existing.type;
    const importance = patch.importance ?? existing.importance;
    const updatedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE memories
           SET content = ?, type = ?, importance = ?, updated_at = ?,
               last_confirmed_at = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(content, type, importance, updatedAt, updatedAt, id);
      this.replaceChunk(id, content);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const updated = this.database
      .prepare(
        `SELECT id, type, origin, content, project_id, confidence, importance,
                status, privacy_level, created_at, updated_at, version
         FROM memories WHERE id = ?`,
      )
      .get(id) as unknown as MemoryRow;
    return {
      ...mapMemory(updated),
      score: 1,
      sourceIds: this.listSourceIds(id),
    };
  }

  delete(id: string): boolean {
    const existing = this.database
      .prepare("SELECT id FROM memories WHERE id = ? AND status <> 'deleted'")
      .get(id) as { id: string } | undefined;
    if (!existing) {
      return false;
    }

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE memories
           SET status = 'deleted', content = '', deleted_at = ?, updated_at = ?,
               version = version + 1
           WHERE id = ?`,
        )
        .run(now, now, id);
      this.database
        .prepare(
          `UPDATE memory_sources
           SET source_status = 'deleted', excerpt = NULL
           WHERE memory_id = ?`,
        )
        .run(id);
      this.deleteChunks(id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  saveEmbedding(input: {
    memoryId: string;
    model: string;
    vector: number[];
    now: string;
  }): void {
    const chunk = this.database
      .prepare(
        `SELECT id FROM memory_chunks
         WHERE owner_type = 'memory' AND owner_id = ?
         ORDER BY chunk_index ASC LIMIT 1`,
      )
      .get(input.memoryId) as { id: string } | undefined;
    if (!chunk) {
      throw new Error("MEMORY_CHUNK_NOT_FOUND");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM memory_embeddings WHERE memory_id = ?")
        .run(input.memoryId);
      this.database
        .prepare(
          `INSERT INTO memory_embeddings
            (id, chunk_id, memory_id, model, dimension, vector_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          chunk.id,
          input.memoryId,
          input.model,
          input.vector.length,
          JSON.stringify(input.vector),
          input.now,
        );
      this.database
        .prepare(
          `UPDATE memory_chunks
           SET embedding_model = ?, embedding_dimension = ?, embedding_version = ?,
               embedding_status = 'indexed', updated_at = ?
           WHERE id = ?`,
        )
        .run(input.model, input.vector.length, input.model, input.now, chunk.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  markEmbeddingFailure(memoryId: string, message: string): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE memory_chunks
         SET embedding_status = 'failed', updated_at = ?, vector_ref = ?
         WHERE owner_type = 'memory' AND owner_id = ?`,
      )
      .run(now, message.slice(0, 300), memoryId);
  }

  listEmbeddingCandidates(input: {
    projectId: string | null;
    modelDestination: DataDestination;
    limit: number;
  }): Array<{ memory: MemoryRecord; vector: number[]; sourceIds: string[] }> {
    const projectClause =
      input.projectId === null
        ? "m.project_id IS NULL"
        : "(m.project_id IS NULL OR m.project_id = ?)";
    const privacyClause =
      input.modelDestination === "cloud" ? "m.privacy_level <> 'local_only'" : "1 = 1";
    const parameters: Array<string | number> = [];
    if (input.projectId !== null) {
      parameters.push(input.projectId);
    }
    parameters.push(input.limit);

    const rows = this.database
      .prepare(
        `SELECT m.id, m.type, m.origin, m.content, m.project_id, m.confidence,
                m.importance, m.status, m.privacy_level, m.created_at,
                m.updated_at, m.version, e.vector_json
         FROM memory_embeddings e
         JOIN memories m ON m.id = e.memory_id
         WHERE m.status = 'active'
           AND ${projectClause}
           AND ${privacyClause}
         ORDER BY m.importance DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(...parameters) as unknown as Array<MemoryRow & { vector_json: string }>;

    const candidates: Array<{
      memory: MemoryRecord;
      vector: number[];
      sourceIds: string[];
    }> = [];
    for (const row of rows) {
      try {
        const vector = JSON.parse(row.vector_json) as unknown;
        if (
          !Array.isArray(vector) ||
          vector.length === 0 ||
          !vector.every((value) => typeof value === "number")
        ) {
          continue;
        }
        candidates.push({
          memory: mapMemory(row),
          vector,
          sourceIds: this.listSourceIds(row.id),
        });
      } catch {
        // 损坏的派生向量不阻断其他记忆检索。
      }
    }
    return candidates;
  }

  private listSourceIds(memoryId: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT source_id FROM memory_sources
         WHERE memory_id = ? AND source_status = 'active'`,
      )
      .all(memoryId) as unknown as Array<{ source_id: string }>;
    return rows.map((row) => row.source_id);
  }

  private replaceChunk(memoryId: string, content: string): void {
    this.deleteChunks(memoryId);
    const now = new Date().toISOString();
    const chunkId = randomUUID();
    const contentHash = createHash("sha256").update(content).digest("hex");
    this.database
      .prepare(
        `INSERT INTO memory_chunks
          (id, owner_type, owner_id, chunk_index, text_content, content_hash,
           embedding_status, created_at, updated_at)
           VALUES (?, 'memory', ?, 0, ?, ?, 'pending', ?, ?)`,
      )
      .run(chunkId, memoryId, content, contentHash, now, now);
    this.database
      .prepare(
        `INSERT INTO memory_chunks_fts
          (chunk_id, owner_type, owner_id, text_content)
         VALUES (?, 'memory', ?, ?)`,
      )
      .run(chunkId, memoryId, content);
  }

  private deleteChunks(memoryId: string): void {
    const chunkRows = this.database
      .prepare(
        `SELECT id FROM memory_chunks
         WHERE owner_type = 'memory' AND owner_id = ?`,
      )
      .all(memoryId) as unknown as Array<{ id: string }>;
    for (const chunk of chunkRows) {
      this.database
        .prepare("DELETE FROM memory_chunks_fts WHERE chunk_id = ?")
        .run(chunk.id);
    }
    this.database
      .prepare(
        "DELETE FROM memory_chunks WHERE owner_type = 'memory' AND owner_id = ?",
      )
      .run(memoryId);
  }
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type,
    origin: row.origin,
    content: row.content,
    projectId: row.project_id,
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    privacyLevel: row.privacy_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function importanceFor(type: MemoryType): number {
  if (type === "project_decision" || type === "commitment") {
    return 0.9;
  }
  if (type === "preference" || type === "profile") {
    return 0.8;
  }
  return 0.65;
}

function toFtsQuery(query: string): string | null {
  const sanitized = query.replace(/["'*:^()\-]/g, " ").replace(/\s+/g, " ").trim();
  if (Array.from(sanitized).length < 3) {
    return null;
  }
  return `"${sanitized}"`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
