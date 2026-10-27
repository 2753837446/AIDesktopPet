export const SETTINGS_VERSION = 1 as const;

export interface WindowSettings {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  showInTaskbar: boolean;
}

export interface QuietHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ProactiveSettings {
  enabled: boolean;
  quietHours: QuietHoursSettings;
}

export interface StartupSettings {
  launchAtLogin: boolean;
}

export interface AppearanceSettings {
  character: "azure";
  scale: number;
}

export interface DesktopSettings {
  version: typeof SETTINGS_VERSION;
  window: WindowSettings;
  proactive: ProactiveSettings;
  startup: StartupSettings;
  appearance: AppearanceSettings;
}

export interface DesktopSettingsPatch {
  window?: Partial<WindowSettings>;
  proactive?: {
    enabled?: boolean;
    quietHours?: Partial<QuietHoursSettings>;
  };
  startup?: Partial<StartupSettings>;
  appearance?: Partial<AppearanceSettings>;
}

export type DesktopWindowMode = "pet" | "settings";

export const DEFAULT_SETTINGS: DesktopSettings = {
  version: SETTINGS_VERSION,
  window: {
    width: 360,
    height: 440,
    alwaysOnTop: true,
    showInTaskbar: false,
  },
  proactive: {
    enabled: true,
    quietHours: {
      enabled: true,
      start: "23:00",
      end: "07:00",
    },
  },
  startup: {
    launchAtLogin: false,
  },
  appearance: {
    character: "azure",
    scale: 1,
  },
};
