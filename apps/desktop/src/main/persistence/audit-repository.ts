import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AuditLogRecord } from "../../core/domain";

interface AuditRow {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  reason: string | null;
  trace_id: string | null;
}

export class SqliteAuditRepository {
  constructor(private readonly database: DatabaseSync) {}

  record(input: {
    occurredAt?: string;
    actorType: string;
    actorId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    outcome: string;
    reason?: string | null;
    traceId?: string | null;
  }): void {
    this.database
      .prepare(
        `INSERT INTO audit_logs
          (id, occurred_at, actor_type, actor_id, action, target_type,
           target_id, outcome, reason, trace_id, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
      )
      .run(
        randomUUID(),
        input.occurredAt ?? new Date().toISOString(),
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.outcome,
        input.reason ?? null,
        input.traceId ?? null,
      );
  }

  list(input: { query?: string; limit?: number } = {}): AuditLogRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
    const query = input.query?.trim();
    if (query) {
      const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const rows = this.database
        .prepare(
          `SELECT id, occurred_at, actor_type, actor_id, action,
                  target_type, target_id, outcome, reason, trace_id
           FROM audit_logs
           WHERE action LIKE ? ESCAPE '\\'
              OR outcome LIKE ? ESCAPE '\\'
              OR reason LIKE ? ESCAPE '\\'
              OR trace_id LIKE ? ESCAPE '\\'
           ORDER BY occurred_at DESC
           LIMIT ?`,
        )
        .all(like, like, like, like, limit) as unknown as AuditRow[];
      return rows.map(mapAudit);
    }

    const rows = this.database
      .prepare(
        `SELECT id, occurred_at, actor_type, actor_id, action,
                target_type, target_id, outcome, reason, trace_id
         FROM audit_logs
         ORDER BY occurred_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as AuditRow[];
    return rows.map(mapAudit);
  }
}

function mapAudit(row: AuditRow): AuditLogRecord {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    reason: row.reason,
    traceId: row.trace_id,
  };
}
