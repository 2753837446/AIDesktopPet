import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { ParsedCalendarEvent } from "../main/persistence/calendar-repository";

const MAX_EVENTS = 5_000;

export interface CalendarParseResult {
  events: ParsedCalendarEvent[];
  totalEvents: number;
  skippedEvents: number;
}

export function parseIcs(
  bytes: Uint8Array,
  sourceName: string,
  defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): CalendarParseResult {
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error("CALENDAR_FILE_SIZE_INVALID");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) {
    throw new Error("CALENDAR_FILE_INVALID");
  }
  const lines = unfoldLines(text.replace(/\r\n/g, "\n").split("\n"));
  const events: ParsedCalendarEvent[] = [];
  let totalEvents = 0;
  let current: Map<string, string[]> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      totalEvents += 1;
      if (totalEvents > MAX_EVENTS) {
        throw new Error("CALENDAR_EVENT_LIMIT_EXCEEDED");
      }
      current = new Map();
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const parsed = parseEvent(current, sourceName, defaultTimezone);
        if (parsed) {
          events.push(parsed);
        }
      }
      current = null;
      continue;
    }
    if (!current) {
      continue;
    }
    const property = parseProperty(line);
    if (!property) {
      continue;
    }
    const values = current.get(property.name) ?? [];
    values.push(property.value);
    current.set(property.name, values);
    if (property.timezone) {
      current.set(`${property.name}:TZID`, [property.timezone]);
    }
    if (property.valueType) {
      current.set(`${property.name}:VALUE`, [property.valueType]);
    }
  }

  return {
    events,
    totalEvents,
    skippedEvents: totalEvents - events.length,
  };
}

function parseEvent(
  properties: Map<string, string[]>,
  sourceName: string,
  defaultTimezone: string,
): ParsedCalendarEvent | null {
  const title = unescapeText(first(properties, "SUMMARY")).trim();
  const startValue = first(properties, "DTSTART");
  if (!title || !startValue) {
    return null;
  }
  const startsAt = parseDateValue(
    startValue,
    first(properties, "DTSTART:TZID"),
    first(properties, "DTSTART:VALUE"),
    defaultTimezone,
  );
  if (!startsAt) {
    return null;
  }
  const endValue = first(properties, "DTEND");
  const endsAt =
    (endValue
      ? parseDateValue(
          endValue,
          first(properties, "DTEND:TZID"),
          first(properties, "DTEND:VALUE"),
          defaultTimezone,
        )
      : null) ?? startsAt.plus({ hours: 1 });
  const normalizedEnd = endsAt > startsAt ? endsAt : startsAt.plus({ hours: 1 });
  const uid =
    first(properties, "UID").trim() ||
    createHash("sha1")
      .update(`${sourceName}|${title}|${startsAt.toISO()}`)
      .digest("hex");
  return {
    externalUid: `${sourceName}:${uid}`.slice(0, 500),
    title: title.slice(0, 500),
    description: unescapeText(first(properties, "DESCRIPTION")).slice(0, 5_000),
    location: unescapeText(first(properties, "LOCATION")).slice(0, 500),
    startsAt: startsAt.toUTC().toISO({ suppressMilliseconds: false })!,
    endsAt: normalizedEnd.toUTC().toISO({ suppressMilliseconds: false })!,
    timezone: startsAt.zoneName ?? defaultTimezone,
  };
}

function parseDateValue(
  value: string,
  timezone: string,
  valueType: string,
  defaultTimezone: string,
): DateTime | null {
  const normalized = value.trim();
  if (valueType === "DATE" || /^\d{8}$/.test(normalized)) {
    const parsed = DateTime.fromFormat(normalized, "yyyyMMdd", {
      zone: validZone(timezone) ?? defaultTimezone,
    });
    return parsed.isValid ? parsed.startOf("day") : null;
  }
  const utc = normalized.endsWith("Z");
  const raw = utc ? normalized.slice(0, -1) : normalized;
  const parsed = DateTime.fromFormat(raw, "yyyyMMdd'T'HHmmss", {
    zone: utc ? "utc" : (validZone(timezone) ?? defaultTimezone),
  });
  return parsed.isValid ? parsed : null;
}

function parseProperty(
  line: string,
): { name: string; value: string; timezone: string | null; valueType: string | null } | null {
  const separator = findValueSeparator(line);
  if (separator <= 0) {
    return null;
  }
  const key = line.slice(0, separator);
  const parts = key.split(";");
  const name = parts[0]?.toUpperCase();
  if (!name) {
    return null;
  }
  const params = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const [paramName, ...valueParts] = part.split("=");
    if (paramName && valueParts.length > 0) {
      params.set(paramName.toUpperCase(), valueParts.join("=").replace(/^"|"$/g, ""));
    }
  }
  return {
    name,
    value: line.slice(separator + 1),
    timezone: params.get("TZID") ?? null,
    valueType: params.get("VALUE")?.toUpperCase() ?? null,
  };
}

function findValueSeparator(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ":" && !quoted) {
      return index;
    }
  }
  return -1;
}

function unfoldLines(lines: string[]): string[] {
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function first(properties: Map<string, string[]>, name: string): string {
  return properties.get(name)?.[0] ?? "";
}

function validZone(zone: string): string | null {
  return zone && DateTime.local().setZone(zone).isValid ? zone : null;
}
