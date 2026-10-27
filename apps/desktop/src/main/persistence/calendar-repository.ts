import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CalendarEventRecord } from "../../core/domain";

interface CalendarRow {
  id: string;
  external_uid: string;
  source_name: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  imported_at: string;
}

export interface ParsedCalendarEvent {
  externalUid: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export class SqliteCalendarRepository {
  constructor(private readonly database: DatabaseSync) {}

  replaceSource(sourceName: string, events: ParsedCalendarEvent[]): number {
    const importedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM calendar_events WHERE source_name = ?")
        .run(sourceName);
      const insert = this.database.prepare(
        `INSERT OR REPLACE INTO calendar_events
          (id, connector_id, external_uid, source_name, title, description,
           location, starts_at, ends_at, timezone, imported_at)
         VALUES (?, 'calendar-local', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of events) {
        insert.run(
          randomUUID(),
          event.externalUid,
          sourceName,
          event.title,
          event.description,
          event.location,
          event.startsAt,
          event.endsAt,
          event.timezone,
          importedAt,
        );
      }
      this.database.exec("COMMIT");
      return events.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listBetween(start: string, end: string): CalendarEventRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM calendar_events
         WHERE starts_at >= ? AND starts_at < ?
         ORDER BY starts_at ASC`,
      )
      .all(start, end) as unknown as CalendarRow[];
    return rows.map(mapEvent);
  }

  count(): number {
    return (
      this.database
        .prepare("SELECT COUNT(*) AS count FROM calendar_events")
        .get() as { count: number }
    ).count;
  }
}

function mapEvent(row: CalendarRow): CalendarEventRecord {
  return {
    id: row.id,
    externalUid: row.external_uid,
    sourceName: row.source_name,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    importedAt: row.imported_at,
  };
}
