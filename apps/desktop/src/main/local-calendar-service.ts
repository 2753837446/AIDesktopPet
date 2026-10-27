import { DateTime } from "luxon";
import type { CalendarEventRecord } from "../core/domain";
import { parseIcs } from "../core/local-calendar";
import { SqliteCalendarRepository } from "./persistence/calendar-repository";
import { SqliteConnectorRepository } from "./persistence/connector-repository";

export interface CalendarImportResult {
  sourceName: string;
  imported: number;
  skipped: number;
  total: number;
  importedAt: string;
}

export class LocalCalendarService {
  constructor(
    private readonly repository: SqliteCalendarRepository,
    private readonly connectors: SqliteConnectorRepository,
  ) {}

  import(input: {
    fileName: string;
    bytes: Uint8Array;
    timezone: string;
  }): CalendarImportResult {
    const sourceName = input.fileName.trim().slice(0, 255) || "calendar.ics";
    let parsed;
    try {
      parsed = parseIcs(input.bytes, sourceName, input.timezone);
    } catch (error) {
      this.connectors.setStatus("calendar-local", {
        status: "error",
        lastError: error instanceof Error ? error.message : "日历解析失败",
      });
      throw error;
    }
    const imported = this.repository.replaceSource(sourceName, parsed.events);
    const importedAt = new Date().toISOString();
    this.connectors.setStatus("calendar-local", {
      status: "connected",
      accountLabel: `${sourceName} · ${this.repository.count()} 项`,
      lastSyncAt: importedAt,
    });
    return {
      sourceName,
      imported,
      skipped: parsed.skippedEvents,
      total: parsed.totalEvents,
      importedAt,
    };
  }

  listForDate(date: string, timezone: string): {
    connected: boolean;
    events: CalendarEventRecord[];
  } {
    const start = DateTime.fromISO(date, { zone: timezone }).startOf("day");
    if (!start.isValid) {
      throw new Error("CALENDAR_DATE_INVALID");
    }
    const end = start.plus({ days: 1 });
    const connected = this.connectors
      .list()
      .some(
        (connector) =>
          connector.id === "calendar-local" &&
          connector.status === "connected",
      );
    return {
      connected,
      events: this.repository.listBetween(
        start.toUTC().toISO()!,
        end.toUTC().toISO()!,
      ),
    };
  }

  status(): { connected: boolean; eventCount: number; lastSyncAt: string | null } {
    const connector = this.connectors
      .list()
      .find((item) => item.id === "calendar-local");
    return {
      connected: connector?.status === "connected",
      eventCount: this.repository.count(),
      lastSyncAt: connector?.lastSyncAt ?? null,
    };
  }
}
