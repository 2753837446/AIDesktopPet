import type { ProactiveSettings } from "../shared/settings";

export type NotificationCategory =
  | "task"
  | "email"
  | "calendar"
  | "daily_brief"
  | "system";

export type NotificationSuppressionReason =
  | "proactive_disabled"
  | "category_disabled"
  | "quiet_hours"
  | "daily_limit";

export type NotificationDecision =
  | { allowed: true }
  | { allowed: false; reason: NotificationSuppressionReason };

export function decideNotification(
  settings: ProactiveSettings,
  category: NotificationCategory,
  sentToday: number,
  now = new Date(),
): NotificationDecision {
  if (!settings.enabled) {
    return { allowed: false, reason: "proactive_disabled" };
  }
  if (!isCategoryEnabled(settings, category)) {
    return { allowed: false, reason: "category_disabled" };
  }
  if (settings.quietHours.enabled && isWithinQuietHours(settings, now)) {
    return { allowed: false, reason: "quiet_hours" };
  }
  if (sentToday >= settings.dailyLimit) {
    return { allowed: false, reason: "daily_limit" };
  }
  return { allowed: true };
}

function isCategoryEnabled(
  settings: ProactiveSettings,
  category: NotificationCategory,
): boolean {
  if (category === "daily_brief") {
    return settings.categories.dailyBrief;
  }
  return settings.categories[category];
}

function isWithinQuietHours(
  settings: ProactiveSettings,
  now: Date,
): boolean {
  const start = minutesSinceMidnight(settings.quietHours.start);
  const end = minutesSinceMidnight(settings.quietHours.end);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) {
    return true;
  }
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function minutesSinceMidnight(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
