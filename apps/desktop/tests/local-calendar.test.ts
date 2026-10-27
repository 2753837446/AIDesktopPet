import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/core/local-calendar";
import { LocalCalendarService } from "../src/main/local-calendar-service";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteCalendarRepository } from "../src/main/persistence/calendar-repository";
import { SqliteConnectorRepository } from "../src/main/persistence/connector-repository";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:meeting-1",
  "SUMMARY:产品评审",
  "DESCRIPTION:讨论下一版\\n桌面宠物",
  "LOCATION:三楼会议室",
  "DTSTART:20261028T013000Z",
  "DTEND:20261028T023000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:all-day",
  "SUMMARY:纪念日",
  "DTSTART;VALUE=DATE:20261028",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("本地日历 ICS", () => {
  it("解析 UTC、全天事件、地点和转义文本", () => {
    const result = parseIcs(
      new TextEncoder().encode(ICS),
      "work.ics",
      "Asia/Shanghai",
    );
    expect(result.totalEvents).toBe(2);
    expect(result.skippedEvents).toBe(0);
    expect(result.events[0]).toMatchObject({
      title: "产品评审",
      description: "讨论下一版\n桌面宠物",
      location: "三楼会议室",
      startsAt: "2026-10-28T01:30:00.000Z",
    });
    expect(result.events[1]?.startsAt).toBe("2026-10-27T16:00:00.000Z");
  });

  it("重复导入替换同一来源并更新 Connector 状态", () => {
    const opened = openDatabase(":memory:");
    const connectors = new SqliteConnectorRepository(opened.database);
    const service = new LocalCalendarService(
      new SqliteCalendarRepository(opened.database),
      connectors,
    );
    const bytes = new TextEncoder().encode(ICS);
    const first = service.import({
      fileName: "work.ics",
      bytes,
      timezone: "Asia/Shanghai",
    });
    const second = service.import({
      fileName: "work.ics",
      bytes,
      timezone: "Asia/Shanghai",
    });
    expect(first.imported).toBe(2);
    expect(second.imported).toBe(2);
    expect(service.status().eventCount).toBe(2);
    expect(service.status().connected).toBe(true);
    expect(connectors.list()).toContainEqual(
      expect.objectContaining({
        id: "calendar-local",
        status: "connected",
        lastSyncAt: expect.any(String),
      }),
    );
    opened.database.close();
  });
});
