import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type DesktopApi,
  type DesktopBootstrap,
} from "../shared/desktop-api";
import type { DesktopSettings, DesktopSettingsPatch } from "../shared/settings";

const desktopApi: DesktopApi = {
  getBootstrap: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getBootstrap) as Promise<DesktopBootstrap>,
  updateSettings: (patch: DesktopSettingsPatch) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateSettings,
      patch,
    ) as Promise<DesktopSettings>,
  setWindowMode: (mode) =>
    ipcRenderer.invoke(IPC_CHANNELS.setWindowMode, mode) as Promise<void>,
  quit: () => ipcRenderer.invoke(IPC_CHANNELS.quit) as Promise<void>,
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: DesktopSettings) => {
      listener(settings);
    };
    ipcRenderer.on(IPC_CHANNELS.settingsChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.settingsChanged, handler);
  },
  onOpenSettings: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.openSettings, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.openSettings, handler);
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
