import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DailyBriefRecord } from "../../core/domain";

interface DailyBriefRow {
  id: string;
  brief_date: string;
  timezone: string;
  content: string;
  source_status_json: string;
  model: string;
  created_at: string;
}

export class SqliteDailyBriefRepository {
  constructor(private readonly database: DatabaseSync) {}

  save(input: Omit<DailyBriefRecord, "id" | "createdAt">): DailyBriefRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO daily_briefs
          (id, brief_date, timezone, content, source_status_json, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(brief_date, timezone) DO UPDATE SET
           content = excluded.content,
           source_status_json = excluded.source_status_json,
           model = excluded.model,
           created_at = excluded.created_at`,
      )
      .run(
        id,
        input.briefDate,
        input.timezone,
        input.content,
        JSON.stringify(input.sourceStatus),
        input.model,
        createdAt,
      );

    const row = this.database
      .prepare(
        `SELECT id, brief_date, timezone, content, source_status_json, model,
                created_at
         FROM daily_briefs
         WHERE brief_date = ? AND timezone = ?`,
      )
      .get(input.briefDate, input.timezone) as DailyBriefRow | undefined;
    if (!row) {
      throw new Error("DAILY_BRIEF_SAVE_FAILED");
    }
    return mapBrief(row);
  }

  latest(): DailyBriefRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, brief_date, timezone, content, source_status_json, model,
                created_at
         FROM daily_briefs ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as DailyBriefRow | undefined;
    return row ? mapBrief(row) : null;
  }
}

function mapBrief(row: DailyBriefRow): DailyBriefRecord {
  return {
    id: row.id,
    briefDate: row.brief_date,
    timezone: row.timezone,
    content: row.content,
    sourceStatus: JSON.parse(row.source_status_json) as DailyBriefRecord["sourceStatus"],
    model: row.model,
    createdAt: row.created_at,
  };
}
