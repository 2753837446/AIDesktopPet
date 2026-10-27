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
      })
      .strict(),
    startup: z
      .object({
        launchAtLogin: z.boolean(),
      })
      .strict(),
    appearance: z
      .object({
        character: z.literal("azure"),
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
      })
      .strict()
      .optional(),
    startup: z
      .object({
        launchAtLogin: z.boolean().optional(),
      })
      .strict()
      .optional(),
    appearance: z
      .object({
        character: z.literal("azure").optional(),
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
    },
    startup: {
      ...current.startup,
      ...patch.startup,
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
