import type {
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopWindowMode,
} from "./settings";

export interface DesktopBootstrap {
  settings: DesktopSettings;
  meta: {
    appVersion: string;
    platform: string;
    isPackaged: boolean;
    modelConfigured: false;
  };
}

export interface DesktopApi {
  getBootstrap(): Promise<DesktopBootstrap>;
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  setWindowMode(mode: DesktopWindowMode): Promise<void>;
  quit(): Promise<void>;
  onSettingsChanged(listener: (settings: DesktopSettings) => void): () => void;
  onOpenSettings(listener: () => void): () => void;
}

export const IPC_CHANNELS = {
  getBootstrap: "desktop:get-bootstrap",
  updateSettings: "desktop:update-settings",
  setWindowMode: "desktop:set-window-mode",
  quit: "desktop:quit",
  settingsChanged: "desktop:settings-changed",
  openSettings: "desktop:open-settings",
} as const;
