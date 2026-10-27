import { describe, expect, it } from "vitest";
import { decideNotification } from "../src/core/notification-policy";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

describe("主动通知策略", () => {
  it("遵守总开关、类别、免打扰和每日上限", () => {
    const base = structuredClone(DEFAULT_SETTINGS.proactive);
    expect(
      decideNotification(
        { ...base, enabled: false },
        "task",
        0,
        new Date("2026-10-27T12:00:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "proactive_disabled" });
    expect(
      decideNotification(
        {
          ...base,
          categories: { ...base.categories, task: false },
        },
        "task",
        0,
        new Date("2026-10-27T12:00:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "category_disabled" });
    expect(
      decideNotification(
        base,
        "task",
        0,
        new Date("2026-10-27T23:30:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "quiet_hours" });
    expect(
      decideNotification(
        { ...base, dailyLimit: 5 },
        "task",
        5,
        new Date("2026-10-27T12:00:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "daily_limit" });
    expect(
      decideNotification(
        base,
        "task",
        0,
        new Date("2026-10-27T12:00:00+08:00"),
      ),
    ).toEqual({ allowed: true });
  });

  it("跨午夜免打扰和每日总结类别映射正确", () => {
    const settings = structuredClone(DEFAULT_SETTINGS.proactive);
    settings.categories.dailyBrief = false;
    expect(
      decideNotification(
        settings,
        "daily_brief",
        0,
        new Date("2026-10-27T12:00:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "category_disabled" });
    expect(
      decideNotification(
        {
          ...settings,
          categories: { ...settings.categories, dailyBrief: true },
        },
        "task",
        0,
        new Date("2026-10-27T01:00:00+08:00"),
      ),
    ).toEqual({ allowed: false, reason: "quiet_hours" });
  });
});
