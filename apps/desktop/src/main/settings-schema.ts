import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  type DesktopSettings,
  type DesktopSettingsPatch,
} from "../shared/settings";

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const desktopSettingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    window: z
      .object({
        x: z.number().int().min(-32768).max(32768).optional(),
        y: z.number().int().min(-32768).max(32768).optional(),
        width: z.number().int().min(260).max(1600),
        height: z.number().int().min(320).max(1200),
        alwaysOnTop: z.boolean(),
        showInTaskbar: z.boolean(),
      })
      .strict(),
    proactive: z
      .object({
        enabled: z.boolean(),
        quietHours: z
          .object({
            enabled: z.boolean(),
            start: clockTime,
            end: clockTime,
          })
          .strict(),
        categories: z
          .object({
            task: z.boolean().default(true),
            email: z.boolean().default(true),
            calendar: z.boolean().default(true),
            dailyBrief: z.boolean().default(true),
            system: z.boolean().default(true),
          })
          .strict()
          .default(DEFAULT_SETTINGS.proactive.categories),
        dailyLimit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(DEFAULT_SETTINGS.proactive.dailyLimit),
      })
      .strict(),
    startup: z
      .object({
        launchAtLogin: z.boolean(),
      })
      .strict(),
    dailyBrief: z
      .object({
        enabled: z.boolean(),
        time: clockTime,
      })
      .strict()
      .default(DEFAULT_SETTINGS.dailyBrief),
    persona: z
      .object({
        version: z.literal(1),
        preset: z.enum(["azure", "calm", "lively", "custom"]),
        name: z.string().trim().min(1).max(30),
        selfReference: z.string().trim().min(1).max(20),
        userTitle: z.string().trim().min(1).max(30),
        description: z.string().trim().min(1).max(1_000),
        tone: z.string().trim().min(1).max(500),
        replyLength: z.enum(["concise", "balanced", "detailed"]),
        boundaries: z.string().trim().max(1_000),
        proactiveStyle: z.enum(["quiet", "standard", "active"]),
      })
      .strict()
      .default(DEFAULT_SETTINGS.persona),
    appearance: z
      .object({
        character: z.literal("azure"),
        customCharacterId: z.string().uuid().nullable().default(null),
        customBackgroundId: z.string().uuid().nullable().default(null),
        customPropIds: z
          .array(z.string().uuid())
          .max(3)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "道具 ID 不能重复",
          })
          .default([]),
        scale: z.number().min(0.65).max(1.35),
      })
      .strict(),
  })
  .strict();

export const desktopSettingsPatchSchema = z
  .object({
    window: z
      .object({
        x: z.number().int().min(-32768).max(32768).optional(),
        y: z.number().int().min(-32768).max(32768).optional(),
        width: z.number().int().min(260).max(1600).optional(),
        height: z.number().int().min(320).max(1200).optional(),
        alwaysOnTop: z.boolean().optional(),
        showInTaskbar: z.boolean().optional(),
      })
      .strict()
      .optional(),
    proactive: z
      .object({
        enabled: z.boolean().optional(),
        quietHours: z
          .object({
            enabled: z.boolean().optional(),
            start: clockTime.optional(),
            end: clockTime.optional(),
          })
          .strict()
          .optional(),
        categories: z
          .object({
            task: z.boolean().optional(),
            email: z.boolean().optional(),
            calendar: z.boolean().optional(),
            dailyBrief: z.boolean().optional(),
            system: z.boolean().optional(),
          })
          .strict()
          .optional(),
        dailyLimit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    startup: z
      .object({
        launchAtLogin: z.boolean().optional(),
      })
      .strict()
      .optional(),
    dailyBrief: z
      .object({
        enabled: z.boolean().optional(),
        time: clockTime.optional(),
      })
      .strict()
      .optional(),
    persona: z
      .object({
        version: z.literal(1).optional(),
        preset: z.enum(["azure", "calm", "lively", "custom"]).optional(),
        name: z.string().trim().min(1).max(30).optional(),
        selfReference: z.string().trim().min(1).max(20).optional(),
        userTitle: z.string().trim().min(1).max(30).optional(),
        description: z.string().trim().min(1).max(1_000).optional(),
        tone: z.string().trim().min(1).max(500).optional(),
        replyLength: z.enum(["concise", "balanced", "detailed"]).optional(),
        boundaries: z.string().trim().max(1_000).optional(),
        proactiveStyle: z.enum(["quiet", "standard", "active"]).optional(),
      })
      .strict()
      .optional(),
    appearance: z
      .object({
        character: z.literal("azure").optional(),
        customCharacterId: z.string().uuid().nullable().optional(),
        customBackgroundId: z.string().uuid().nullable().optional(),
        customPropIds: z
          .array(z.string().uuid())
          .max(3)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "道具 ID 不能重复",
          })
          .optional(),
        scale: z.number().min(0.65).max(1.35).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseSettings(value: unknown): DesktopSettings {
  return desktopSettingsSchema.parse(value) as DesktopSettings;
}

export function parseSettingsPatch(value: unknown): DesktopSettingsPatch {
  return desktopSettingsPatchSchema.parse(value) as DesktopSettingsPatch;
}

export function mergeSettings(
  current: DesktopSettings,
  patch: DesktopSettingsPatch,
): DesktopSettings {
  return parseSettings({
    ...current,
    window: {
      ...current.window,
      ...patch.window,
    },
    proactive: {
      ...current.proactive,
      ...patch.proactive,
      quietHours: {
        ...current.proactive.quietHours,
        ...patch.proactive?.quietHours,
      },
      categories: {
        ...current.proactive.categories,
        ...patch.proactive?.categories,
      },
    },
    startup: {
      ...current.startup,
      ...patch.startup,
    },
    dailyBrief: {
      ...current.dailyBrief,
      ...patch.dailyBrief,
    },
    persona: {
      ...current.persona,
      ...patch.persona,
    },
    appearance: {
      ...current.appearance,
      ...patch.appearance,
    },
  });
}

export function createDefaultSettings(): DesktopSettings {
  return desktopSettingsSchema.parse(DEFAULT_SETTINGS) as DesktopSettings;
}
