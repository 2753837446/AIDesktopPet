import { app, BrowserWindow, ipcMain, Menu, screen, Tray, type Rectangle } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "../shared/desktop-api";
import type { DesktopSettingsPatch, DesktopWindowMode } from "../shared/settings";
import { createTrayIcon } from "./icon";
import { SettingsStore } from "./settings-store";

const APP_ID = "com.aidesktoppet.desktop";
const WINDOW_BOUNDS_DEBOUNCE_MS = 250;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStore;
let quitting = false;
let windowMode: DesktopWindowMode = "pet";
let petBounds: Rectangle | null = null;
let windowSaveTimer: NodeJS.Timeout | undefined;
let ipcRegistered = false;

app.setAppUserModelId(APP_ID);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(app.getPath("userData"));
  const loaded = await settingsStore.load();
  if (loaded.recovered) {
    console.warn("设置文件无效，已恢复安全默认值");
  }

  createMainWindow(loaded.settings);
  createTray();
  registerIpcHandlers();
  applyDesktopSettings();
});

app.on("activate", () => {
  showMainWindow();
});

app.on("window-all-closed", () => {
  // 桌宠通过托盘常驻，关闭窗口只隐藏。
});

app.on("before-quit", () => {
  quitting = true;
});

function createMainWindow(settings: ReturnType<SettingsStore["get"]>): void {
  const bounds = resolveInitialBounds(settings);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 260,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.window.alwaysOnTop,
    skipTaskbar: !settings.window.showInTaskbar,
    show: false,
    title: "AI Desktop Pet",
    icon: createTrayIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("move", scheduleWindowBoundsSave);
  mainWindow.on("resize", scheduleWindowBoundsSave);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function resolveInitialBounds(settings: ReturnType<SettingsStore["get"]>): Rectangle {
  const saved = settings.window;
  const fallbackArea = screen.getPrimaryDisplay().workArea;
  const candidate: Rectangle = {
    width: saved.width,
    height: saved.height,
    x: saved.x ?? fallbackArea.x + fallbackArea.width - saved.width - 32,
    y: saved.y ?? fallbackArea.y + fallbackArea.height - saved.height - 32,
  };
  return isVisibleOnSomeDisplay(candidate) ? candidate : centerInPrimaryDisplay(candidate);
}

function centerInPrimaryDisplay(bounds: Rectangle): Rectangle {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: bounds.width,
    height: bounds.height,
    x: area.x + Math.round((area.width - bounds.width) / 2),
    y: area.y + Math.round((area.height - bounds.height) / 2),
  };
}

function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) -
        Math.max(bounds.x, area.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) -
        Math.max(bounds.y, area.y),
    );
    return overlapWidth >= 80 && overlapHeight >= 80;
  });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AI Desktop Pet");
  tray.on("click", showMainWindow);
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  if (!tray || !settingsStore) {
    return;
  }

  const settings = settingsStore.get();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? "隐藏桌宠" : "显示桌宠",
        click: () => {
          if (mainWindow?.isVisible()) {
            mainWindow.hide();
          } else {
            showMainWindow();
          }
          refreshTrayMenu();
        },
      },
      {
        label: settings.proactive.enabled ? "暂停主动提醒" : "恢复主动提醒",
        click: () => {
          void settingsStore
            .update({ proactive: { enabled: !settings.proactive.enabled } })
            .then(applyDesktopSettings)
            .catch((error: unknown) => console.error("切换主动提醒失败", error));
        },
      },
      { type: "separator" },
      {
        label: "设置",
        click: () => {
          void openSettingsWindow();
        },
      },
      {
        label: "退出",
        click: () => {
          void quitApplication();
        },
      },
    ]),
  );
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  refreshTrayMenu();
}

async function openSettingsWindow(): Promise<void> {
  await setWindowMode("settings");
  showMainWindow();
  mainWindow?.webContents.send(IPC_CHANNELS.openSettings);
}

async function setWindowMode(mode: DesktopWindowMode): Promise<void> {
  if (!mainWindow || mode === windowMode) {
    return;
  }

  if (mode === "settings") {
    petBounds = mainWindow.getBounds();
    mainWindow.setMinimumSize(700, 560);
    mainWindow.setSize(820, 680, true);
    mainWindow.center();
    windowMode = "settings";
    return;
  }

  mainWindow.setMinimumSize(260, 320);
  if (petBounds) {
    mainWindow.setBounds(petBounds, true);
  }
  petBounds = null;
  windowMode = "pet";
}

function scheduleWindowBoundsSave(): void {
  if (windowMode !== "pet") {
    return;
  }
  if (windowSaveTimer) {
    clearTimeout(windowSaveTimer);
  }
  windowSaveTimer = setTimeout(() => {
    windowSaveTimer = undefined;
    void saveWindowBounds();
  }, WINDOW_BOUNDS_DEBOUNCE_MS);
}

async function saveWindowBounds(): Promise<void> {
  if (!mainWindow || windowMode !== "pet" || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  try {
    await settingsStore.update({ window: bounds });
  } catch (error) {
    console.error("保存窗口位置失败", error);
  }
}

function applyDesktopSettings(): void {
  if (!mainWindow || !settingsStore) {
    return;
  }

  const settings = settingsStore.get();
  mainWindow.setAlwaysOnTop(settings.window.alwaysOnTop);
  mainWindow.setSkipTaskbar(!settings.window.showInTaskbar);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.startup.launchAtLogin });
  }
  refreshTrayMenu();
  mainWindow.webContents.send(IPC_CHANNELS.settingsChanged, settings);
}

function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle(IPC_CHANNELS.getBootstrap, (event) => {
    assertTrustedSender(event.sender.id);
    return {
      settings: settingsStore.get(),
      meta: {
        appVersion: app.getVersion(),
        platform: process.platform,
        isPackaged: app.isPackaged,
        modelConfigured: false,
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.updateSettings, async (event, patch: unknown) => {
    assertTrustedSender(event.sender.id);
    await settingsStore.update(patch as DesktopSettingsPatch);
    applyDesktopSettings();
    return settingsStore.get();
  });

  ipcMain.handle(IPC_CHANNELS.setWindowMode, async (event, mode: unknown) => {
    assertTrustedSender(event.sender.id);
    if (mode !== "pet" && mode !== "settings") {
      throw new Error("INVALID_WINDOW_MODE");
    }
    await setWindowMode(mode);
  });

  ipcMain.handle(IPC_CHANNELS.quit, async (event) => {
    assertTrustedSender(event.sender.id);
    await quitApplication();
  });
}

function assertTrustedSender(senderId: number): void {
  if (!mainWindow || mainWindow.webContents.id !== senderId) {
    throw new Error("UNTRUSTED_IPC_SENDER");
  }
}

async function quitApplication(): Promise<void> {
  await saveWindowBounds();
  quitting = true;
  app.quit();
}
