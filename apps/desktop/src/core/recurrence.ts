import { DateTime } from "luxon";
import type { RecurrenceKind } from "./domain";

export function calculateNextOccurrence(
  currentIso: string,
  timezone: string,
  recurrence: RecurrenceKind,
): string | null {
  if (recurrence === "none") {
    return null;
  }
  const current = DateTime.fromISO(currentIso, { setZone: true }).setZone(timezone);
  if (!current.isValid) {
    throw new Error("INVALID_RECURRENCE_DATE");
  }

  let next = current;
  if (recurrence === "weekly") {
    next = next.plus({ days: 7 });
  } else if (recurrence === "weekdays") {
    do {
      next = next.plus({ days: 1 });
    } while (next.weekday > 5);
  } else {
    next = next.plus({ days: 1 });
  }
  return next.toUTC().toISO();
}

export function nextLocalTime(
  localTime: string,
  timezone: string,
  now = new Date(),
): string {
  const [hourText, minuteText] = localTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("INVALID_DAILY_BRIEF_TIME");
  }

  const current = DateTime.fromJSDate(now, { zone: timezone });
  let candidate = current.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  if (candidate <= current) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate.toUTC().toISO() ?? "";
}
