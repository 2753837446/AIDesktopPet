import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification as ElectronNotification,
  screen,
  Tray,
  type Rectangle,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { AssistantCore } from "../core/assistant-core";
import {
  CHARACTER_IMAGE_EDIT_MODEL,
  SiliconFlowCharacterImageEditProvider,
} from "../core/character-image-edit-provider";
import { DailyBriefService } from "../core/daily-brief-service";
import { DeepSeekProvider } from "../core/deepseek-provider";
import { HimalayaEmailConnector } from "../core/email-connector";
import { MemoryService } from "../core/memory-service";
import { decideNotification } from "../core/notification-policy";
import { SiliconFlowEmbeddingProvider } from "../core/siliconflow-embedding-provider";
import {
  TaskEngine,
  type NotificationDeliveryResult,
} from "../core/task-engine";
import {
  StaticPermissionPolicy,
  ToolRuntime,
} from "../core/tool-runtime";
import { IPC_CHANNELS } from "../shared/desktop-api";
import type { CreateTaskInput } from "../core/domain";
import type { DesktopSettingsPatch, DesktopWindowMode } from "../shared/settings";
import { CredentialStore } from "./credential-store";
import { CharacterAssetService } from "./character-asset-service";
import { CharacterPoseDirector } from "./character-pose-director";
import { BackupService } from "./backup-service";
import {
  BundledCharacterPresetService,
  createPresetSettingsPatch,
} from "./character-preset-service";
import { createTrayIcon } from "./icon";
import { openDatabase, type OpenedDatabase } from "./persistence/database";
import { SqliteAuditRepository } from "./persistence/audit-repository";
import { SqliteCalendarRepository } from "./persistence/calendar-repository";
import { SqliteCharacterAssetRepository } from "./persistence/character-asset-repository";
import { SqliteConversationRepository } from "./persistence/conversation-repository";
import { SqliteConnectorRepository } from "./persistence/connector-repository";
import { SqliteDailyBriefRepository } from "./persistence/daily-brief-repository";
import { SqliteMemoryRepository } from "./persistence/memory-repository";
import { SqliteTaskRepository } from "./persistence/task-repository";
import { SqliteToolCallRepository } from "./persistence/tool-call-repository";
import { SettingsStore } from "./settings-store";
import { LocalCalendarService } from "./local-calendar-service";

const APP_ID = "com.aidesktoppet.desktop";
const WINDOW_BOUNDS_DEBOUNCE_MS = 250;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStore;
let credentialStore: CredentialStore;
let databaseHandle: OpenedDatabase | null = null;
let conversations: SqliteConversationRepository | null = null;
let memoryService: MemoryService | null = null;
let assistantCore: AssistantCore | null = null;
let taskEngine: TaskEngine | null = null;
let dailyBriefService: DailyBriefService | null = null;
let toolRuntime: ToolRuntime | null = null;
let connectorRepository: SqliteConnectorRepository | null = null;
let calendarService: LocalCalendarService | null = null;
let characterAssets: CharacterAssetService | null = null;
let characterPoseDirector: CharacterPoseDirector | null = null;
let auditRepository: SqliteAuditRepository | null = null;
let quitting = false;
let windowMode: DesktopWindowMode = "pet";
let petBounds: Rectangle | null = null;
let windowSaveTimer: NodeJS.Timeout | undefined;
let ipcRegistered = false;
const activeChatRequests = new Map<string, AbortController>();
const activePoseRequests = new Map<string, AbortController>();

app.setAppUserModelId(APP_ID);
app.setName("AI Desktop Pet");

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

  credentialStore = new CredentialStore(app.getPath("userData"));
  try {
    databaseHandle = openDatabase(
      path.join(app.getPath("userData"), "ai-desktop-pet.sqlite"),
    );
    conversations = new SqliteConversationRepository(databaseHandle.database);
    characterAssets = new CharacterAssetService(
      app.getPath("userData"),
      new SqliteCharacterAssetRepository(databaseHandle.database),
    );
    characterPoseDirector = new CharacterPoseDirector(
      characterAssets,
      new SiliconFlowCharacterImageEditProvider(() =>
        credentialStore.getProviderKey("siliconflow"),
      ),
    );
    try {
      const presets = await new BundledCharacterPresetService(
        characterAssets,
        app.isPackaged
          ? path.join(process.resourcesPath, "character-presets")
          : path.join(app.getAppPath(), "resources", "character-presets"),
      ).importAll();
      const suQingyue = presets.find(
        (preset) => preset.manifest.key === "su-qingyue",
      );
      if (suQingyue && suQingyue.importedKeys.length > 0) {
        const knownAssetIds = new Set(
          characterAssets.list().map((asset) => asset.id),
        );
        const patch = createPresetSettingsPatch(
          settingsStore.get(),
          suQingyue,
          knownAssetIds,
        );
        if (Object.keys(patch).length > 0) {
          await settingsStore.update(patch);
        }
      }
    } catch (error) {
      console.error("导入内置角色预设失败", error);
    }
    auditRepository = new SqliteAuditRepository(databaseHandle.database);
    const memoryRepository = new SqliteMemoryRepository(databaseHandle.database);
    const embeddingProvider = new SiliconFlowEmbeddingProvider(() =>
      credentialStore.getProviderKey("siliconflow"),
    );
    memoryService = new MemoryService(memoryRepository, embeddingProvider);
    const provider = new DeepSeekProvider({
      apiKey: () => credentialStore.getDeepSeekKey(),
      model: "deepseek-flash",
    });
    taskEngine = new TaskEngine(
      new SqliteTaskRepository(databaseHandle.database),
      {
        notify: async ({
          title,
          body,
          category,
        }): Promise<NotificationDeliveryResult> => {
          const now = new Date();
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          const sent = databaseHandle?.database
            .prepare(
              `SELECT COUNT(*) AS count FROM notifications
               WHERE status = 'sent' AND created_at >= ? AND created_at < ?`,
            )
            .get(start.toISOString(), end.toISOString()) as
            | { count: number }
            | undefined;
          const decision = decideNotification(
            settingsStore.get().proactive,
            category,
            sent?.count ?? 0,
            now,
          );
          if (!decision.allowed) {
            return { status: "suppressed", reason: decision.reason };
          }
          if (!ElectronNotification.isSupported()) {
            throw new Error("SYSTEM_NOTIFICATION_UNAVAILABLE");
          }
          new ElectronNotification({ title, body }).show();
          return { status: "sent" };
        },
      },
    );
    taskEngine.recover();
    const connectors = new SqliteConnectorRepository(
      databaseHandle.database,
    );
    connectorRepository = connectors;
    calendarService = new LocalCalendarService(
      new SqliteCalendarRepository(databaseHandle.database),
      connectors,
    );
    dailyBriefService = new DailyBriefService(
      memoryService,
      () => taskEngine?.listTasks(200) ?? [],
      new SqliteDailyBriefRepository(databaseHandle.database),
      provider,
      (date, timezone) => calendarService?.listForDate(date, timezone) ?? {
        connected: false,
        events: [],
      },
    );
    taskEngine.registerExecutor("daily_brief", async () => {
      await dailyBriefService?.generate();
    });
    toolRuntime = new ToolRuntime(
      new SqliteToolCallRepository(databaseHandle.database),
      new StaticPermissionPolicy(
        new Set([
          "system.read",
          "connector.read",
          "email.read",
          "email.send",
          "email.write",
        ]),
      ),
    );
    toolRuntime.register({
      name: "clock.read",
      description: "读取当前本地时间；只读、无外部副作用。",
      inputSchema: z.object({}).strict(),
      riskLevel: "low",
      requiredScopes: ["system.read"],
      timeoutMs: 2_000,
      modelCallable: true,
      execute: async () => ({
        outputSummary: new Date().toLocaleString("zh-CN"),
      }),
    });
    toolRuntime.register({
      name: "calendar.events.list",
      description: "读取指定日期 00:00-24:00 的本地导入日历日程；只读。",
      inputSchema: z
        .object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .strict(),
      riskLevel: "medium",
      requiredScopes: ["connector.read"],
      timeoutMs: 5_000,
      modelCallable: true,
      execute: async (input) => {
        const date =
          (input as { date?: string }).date ??
          new Intl.DateTimeFormat("en-CA", {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
        const result = calendarService?.listForDate(
          date,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        if (!result?.connected) {
          throw new Error("CALENDAR_NOT_CONNECTED");
        }
        return {
          outputSummary: `${date} 共 ${result.events.length} 项日程`,
          output: result.events,
        };
      },
    });
    toolRuntime.register({
      name: "connector.email.status",
      description: "查看主邮箱连接器状态；不会读取邮件内容。",
      inputSchema: z.object({}).strict(),
      riskLevel: "low",
      requiredScopes: ["connector.read"],
      timeoutMs: 2_000,
      modelCallable: true,
      execute: async () => {
        const email = connectors
          .list()
          .find((connector) => connector.id === "email-primary");
        return {
          outputSummary: email
            ? `${email.displayName}：${email.status}；provider=${email.provider}`
            : "主邮箱连接器尚未注册",
        };
      },
    });
    const emailConnector = new HimalayaEmailConnector({
      account: "qq",
      inbox: "Inbox",
    });
    toolRuntime.register({
      name: "email.inbox.list",
      description: "通过 Himalaya 读取 QQ 主邮箱最近邮件头；不标记已读。",
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(20).default(8),
        })
        .strict(),
      riskLevel: "medium",
      requiredScopes: ["email.read"],
      timeoutMs: 35_000,
      modelCallable: true,
      execute: async (input, context) => {
        try {
          const envelopes = await emailConnector.listRecent(
            (input as { limit: number }).limit,
            context.signal,
          );
          connectors.setStatus("email-primary", {
            status: "connected",
            accountLabel: "QQ 邮箱",
          });
          return {
            outputSummary: `已读取 ${envelopes.length} 封邮件头`,
            output: envelopes,
          };
        } catch (error) {
          connectors.setStatus("email-primary", {
            status: "error",
            lastError:
              error instanceof Error ? error.message : "邮箱连接失败",
          });
          throw error;
        }
      },
    });
    toolRuntime.register({
      name: "email.message.read",
      description: "通过 Himalaya 读取指定邮件；不会标记已读。",
      inputSchema: z
        .object({
          id: z.string().min(1).max(200),
        })
        .strict(),
      riskLevel: "medium",
      requiredScopes: ["email.read"],
      timeoutMs: 35_000,
      modelCallable: true,
      execute: async (input, context) => {
        const message = await emailConnector.readMessage(
          (input as { id: string }).id,
          context.signal,
        );
        connectors.setStatus("email-primary", {
          status: "connected",
          accountLabel: "QQ 邮箱",
        });
        return {
          outputSummary: `已读取邮件 ${message.id}`,
          output: message,
        };
      },
    });
    toolRuntime.register({
      name: "email.send",
      description: "发送新邮件并保存到已发送；必须由用户确认。",
      inputSchema: z
        .object({
          to: z.string().email().max(254),
          subject: z.string().trim().min(1).max(200),
          body: z.string().min(1).max(20_000),
        })
        .strict(),
      riskLevel: "high",
      requiredScopes: ["email.send"],
      timeoutMs: 35_000,
      execute: async (input, context) => {
        const message = input as { to: string; subject: string; body: string };
        try {
          await emailConnector.sendMessage({
            to: message.to,
            subject: message.subject,
            body: message.body,
          }, context.signal);
          connectors.setStatus("email-primary", {
            status: "connected",
            accountLabel: "QQ 邮箱",
          });
          return {
            outputSummary: `邮件已发送给 ${message.to}`,
            output: { sent: true, to: message.to, subject: message.subject },
          };
        } catch (error) {
          connectors.setStatus("email-primary", {
            status: "error",
            lastError: error instanceof Error ? error.message : "发信失败",
          });
          throw error;
        }
      },
    });
    toolRuntime.register({
      name: "email.message.delete",
      description: "把邮件移动到 QQ 已删除文件夹；必须由用户确认。",
      inputSchema: z
        .object({
          id: z.string().min(1).max(200),
        })
        .strict(),
      riskLevel: "high",
      requiredScopes: ["email.write"],
      timeoutMs: 35_000,
      execute: async (input, context) => {
        const id = (input as { id: string }).id;
        await emailConnector.moveToDeleted(id, context.signal);
        return {
          outputSummary: `邮件 ${id} 已移动到已删除`,
          output: { movedToDeleted: true, id },
        };
      },
    });
    assistantCore = new AssistantCore(
      conversations,
      memoryService,
      memoryService,
      provider,
      () => settingsStore.get().persona,
      toolRuntime,
    );
    taskEngine.ensureDailyBrief(
      loaded.settings.dailyBrief.enabled,
      loaded.settings.dailyBrief.time,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    taskEngine.start();
  } catch (error) {
    console.error("初始化数据库失败", error);
    databaseHandle = null;
    conversations = null;
    memoryService = null;
    assistantCore = null;
    taskEngine = null;
    dailyBriefService = null;
    toolRuntime = null;
    connectorRepository = null;
    calendarService = null;
    characterAssets = null;
    characterPoseDirector = null;
    auditRepository = null;
  }

  createMainWindow(settingsStore.get());
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
  for (const controller of activeChatRequests.values()) {
    controller.abort();
  }
  activeChatRequests.clear();
  for (const controller of activePoseRequests.values()) {
    controller.abort();
  }
  activePoseRequests.clear();
  taskEngine?.stop();
  taskEngine = null;
  dailyBriefService = null;
  toolRuntime = null;
  databaseHandle?.database.close();
  databaseHandle = null;
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

  if (
    mode === "settings" ||
    mode === "chat" ||
    mode === "memory" ||
    mode === "tasks" ||
    mode === "daily" ||
    mode === "tools"
  ) {
    if (windowMode === "pet") {
      petBounds = mainWindow.getBounds();
    }
    if (mode === "settings") {
      mainWindow.setMinimumSize(700, 560);
      mainWindow.setSize(820, 680, true);
    } else if (mode === "chat") {
      mainWindow.setMinimumSize(520, 560);
      mainWindow.setSize(620, 720, true);
    } else {
      mainWindow.setMinimumSize(680, 560);
      mainWindow.setSize(860, 700, true);
    }
    mainWindow.center();
    windowMode = mode;
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

  ipcMain.handle(IPC_CHANNELS.getBootstrap, async (event) => {
    assertTrustedSender(event.sender.id);
    const siliconFlowConfigured =
      await credentialStore.isProviderConfigured("siliconflow");
    const calendarStatus = calendarService?.status() ?? {
      connected: false,
      eventCount: 0,
      lastSyncAt: null,
    };
    return {
      settings: settingsStore.get(),
      meta: {
        appVersion: app.getVersion(),
        platform: process.platform,
        isPackaged: app.isPackaged,
        modelConfigured: await credentialStore.isConfigured(),
        modelName: "deepseek-flash",
        embeddingConfigured: siliconFlowConfigured,
        embeddingModel: "BAAI/bge-m3",
        imageGenerationConfigured: siliconFlowConfigured,
        imageGenerationModel: CHARACTER_IMAGE_EDIT_MODEL,
        calendarConnected: calendarStatus.connected,
        calendarEventCount: calendarStatus.eventCount,
        conversationId: conversations?.getMostRecentConversation()?.id ?? null,
        database: {
          ready: databaseHandle !== null,
          schemaVersion: databaseHandle?.schemaVersion ?? null,
        },
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.updateSettings, async (event, patch: unknown) => {
    assertTrustedSender(event.sender.id);
    const previous = settingsStore.get();
    await settingsStore.update(patch as DesktopSettingsPatch);
    const updated = settingsStore.get();
    if (
      JSON.stringify(previous.dailyBrief) !==
      JSON.stringify(updated.dailyBrief)
    ) {
      taskEngine?.reconfigureDailyBrief(
        updated.dailyBrief.enabled,
        updated.dailyBrief.time,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }
    applyDesktopSettings();
    return settingsStore.get();
  });

  ipcMain.handle(IPC_CHANNELS.setWindowMode, async (event, mode: unknown) => {
    assertTrustedSender(event.sender.id);
    if (
      mode !== "pet" &&
      mode !== "settings" &&
      mode !== "chat" &&
      mode !== "memory" &&
      mode !== "tasks" &&
      mode !== "daily" &&
      mode !== "tools"
    ) {
      throw new Error("INVALID_WINDOW_MODE");
    }
    await setWindowMode(mode);
  });

  ipcMain.handle(
    IPC_CHANNELS.getChatHistory,
    (event, conversationId: unknown, limit: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!conversations) {
        throw new Error("DATABASE_UNAVAILABLE");
      }
      const parsedConversationId = z.string().uuid().parse(conversationId);
      const parsedLimit =
        limit === undefined ? 50 : z.number().int().min(1).max(100).parse(limit);
      return conversations.listRecentMessages(parsedConversationId, parsedLimit);
    },
  );

  ipcMain.handle(IPC_CHANNELS.startChat, (event, input: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!assistantCore) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    const request = chatStartSchema.parse(input);
    if (activeChatRequests.has(request.requestId)) {
      throw new Error("DUPLICATE_CHAT_REQUEST");
    }

    const controller = new AbortController();
    activeChatRequests.set(request.requestId, controller);
    setImmediate(() => {
      void runChat(request, controller);
    });
    return { accepted: true as const };
  });

  ipcMain.handle(
    IPC_CHANNELS.cancelChat,
    (event, requestId: unknown): { cancelled: boolean } => {
      assertTrustedSender(event.sender.id);
      const parsedRequestId = z.string().uuid().parse(requestId);
      const controller = activeChatRequests.get(parsedRequestId);
      if (!controller) {
        return { cancelled: false };
      }
      controller.abort();
      return { cancelled: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.saveDeepSeekKey, async (event, apiKey: unknown) => {
    assertTrustedSender(event.sender.id);
    const parsedKey = z.string().min(24).max(256).parse(apiKey);
    await credentialStore.setDeepSeekKey(parsedKey);
    return { configured: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.clearDeepSeekKey, async (event) => {
    assertTrustedSender(event.sender.id);
    await credentialStore.clearDeepSeekKey();
    return { configured: false as const };
  });

  ipcMain.handle(
    IPC_CHANNELS.saveSiliconFlowKey,
    async (event, apiKey: unknown) => {
      assertTrustedSender(event.sender.id);
      const parsedKey = z.string().min(24).max(256).parse(apiKey);
      await credentialStore.setProviderKey("siliconflow", parsedKey);
      const scheduled = memoryService?.reindexAll() ?? 0;
      return { configured: true as const, scheduled };
    },
  );

  ipcMain.handle(IPC_CHANNELS.clearSiliconFlowKey, async (event) => {
    assertTrustedSender(event.sender.id);
    await credentialStore.clearProviderKey("siliconflow");
    return { configured: false as const };
  });

  ipcMain.handle(IPC_CHANNELS.reindexMemories, (event) => {
    assertTrustedSender(event.sender.id);
    return { scheduled: memoryService?.reindexAll() ?? 0 };
  });

  ipcMain.handle(
    IPC_CHANNELS.listMemories,
    (event, query: unknown, limit: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!memoryService) {
        throw new Error("DATABASE_UNAVAILABLE");
      }
      const parsedQuery =
        query === undefined
          ? undefined
          : z.string().max(500).parse(query);
      const parsedLimit =
        limit === undefined ? 100 : z.number().int().min(1).max(200).parse(limit);
      if (parsedQuery?.trim()) {
        return memoryService.search({
          query: parsedQuery,
          modelDestination: "cloud",
          limit: parsedLimit,
        });
      }
      return memoryService.list({ limit: parsedLimit });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.updateMemory,
    (event, id: unknown, patch: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!memoryService) {
        throw new Error("DATABASE_UNAVAILABLE");
      }
      const parsedId = z.string().uuid().parse(id);
      const parsedPatch = memoryUpdateSchema.parse(patch);
      const updated = memoryService.update(parsedId, {
        ...(parsedPatch.content === undefined
          ? {}
          : { content: parsedPatch.content }),
        ...(parsedPatch.type === undefined ? {} : { type: parsedPatch.type }),
        ...(parsedPatch.importance === undefined
          ? {}
          : { importance: parsedPatch.importance }),
      });
      if (!updated) {
        throw new Error("MEMORY_NOT_FOUND");
      }
      return updated;
    },
  );

  ipcMain.handle(IPC_CHANNELS.deleteMemory, (event, id: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!memoryService) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    return { deleted: memoryService.delete(z.string().uuid().parse(id)) };
  });

  ipcMain.handle(IPC_CHANNELS.createTask, (event, input: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!taskEngine) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    const parsed = taskCreateSchema.parse(input);
    return taskEngine.createTask(parsed as CreateTaskInput);
  });

  ipcMain.handle(IPC_CHANNELS.listTasks, (event, limit: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!taskEngine) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    return taskEngine.listTasks(
      limit === undefined ? 100 : z.number().int().min(1).max(200).parse(limit),
    );
  });

  ipcMain.handle(IPC_CHANNELS.completeTask, (event, id: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!taskEngine) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    return { updated: taskEngine.completeTask(z.string().uuid().parse(id)) };
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, (event, id: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!taskEngine) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    return { updated: taskEngine.cancelTask(z.string().uuid().parse(id)) };
  });

  ipcMain.handle(IPC_CHANNELS.getLatestDailyBrief, (event) => {
    assertTrustedSender(event.sender.id);
    return dailyBriefService?.latest() ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.generateDailyBrief, async (event) => {
    assertTrustedSender(event.sender.id);
    if (!dailyBriefService) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    return dailyBriefService.generate();
  });

  ipcMain.handle(IPC_CHANNELS.listTools, (event) => {
    assertTrustedSender(event.sender.id);
    return toolRuntime?.listTools() ?? [];
  });

  ipcMain.handle(IPC_CHANNELS.invokeTool, async (event, input: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!toolRuntime) {
      throw new Error("TOOL_RUNTIME_UNAVAILABLE");
    }
    const parsed = toolInvokeSchema.parse(input);
    return toolRuntime.invoke(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.listToolCalls, (event, limit: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!toolRuntime) {
      return [];
    }
    return toolRuntime.listCalls(
      limit === undefined ? 100 : z.number().int().min(1).max(200).parse(limit),
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.approveTool,
    async (event, callId: unknown, approved: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!toolRuntime) {
        throw new Error("TOOL_RUNTIME_UNAVAILABLE");
      }
      return toolRuntime.approve(
        z.string().uuid().parse(callId),
        z.boolean().parse(approved),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.cancelTool, (event, callId: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!toolRuntime) {
      return { cancelled: false };
    }
    return {
      cancelled: toolRuntime.cancel(z.string().uuid().parse(callId)),
    };
  });

  ipcMain.handle(IPC_CHANNELS.listConnectors, (event) => {
    assertTrustedSender(event.sender.id);
    if (!databaseHandle) {
      return [];
    }
    return new SqliteConnectorRepository(databaseHandle.database).list();
  });

  ipcMain.handle(
    IPC_CHANNELS.listAuditLogs,
    (event, query: unknown, limit: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!databaseHandle) {
        return [];
      }
      const parsedQuery =
        query === undefined
          ? undefined
          : z.string().max(300).parse(query);
      const parsedLimit =
        limit === undefined ? 200 : z.number().int().min(1).max(500).parse(limit);
      return new SqliteAuditRepository(databaseHandle.database).list({
        ...(parsedQuery === undefined ? {} : { query: parsedQuery }),
        limit: parsedLimit,
      });
    },
  );

  ipcMain.handle(IPC_CHANNELS.listCharacterAssets, (event) => {
    assertTrustedSender(event.sender.id);
    return characterAssets?.list() ?? [];
  });

  ipcMain.handle(
    IPC_CHANNELS.uploadCharacterAsset,
    async (event, input: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!characterAssets) {
        throw new Error("CHARACTER_ASSET_SERVICE_UNAVAILABLE");
      }
      const parsed = characterUploadSchema.parse(input);
      return characterAssets.save({
        fileName: parsed.fileName,
        bytes: parsed.bytes,
        view: parsed.view,
        category: parsed.category,
        ...(parsed.displayName === undefined
          ? {}
          : { displayName: parsed.displayName }),
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getCharacterAssetData,
    async (event, id: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!characterAssets) {
        throw new Error("CHARACTER_ASSET_SERVICE_UNAVAILABLE");
      }
      return characterAssets.read(z.string().uuid().parse(id));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteCharacterAsset,
    async (event, id: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!characterAssets) {
        throw new Error("CHARACTER_ASSET_SERVICE_UNAVAILABLE");
      }
      const assetId = z.string().uuid().parse(id);
      const deleted = await characterAssets.delete(assetId);
      if (
        deleted &&
        settingsStore.get().appearance.customCharacterId === assetId
      ) {
        await settingsStore.update({
          appearance: { customCharacterId: null },
        });
        applyDesktopSettings();
      }
      return { deleted };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.generateCharacterPose,
    async (event, input: unknown) => {
      assertTrustedSender(event.sender.id);
      if (!characterPoseDirector) {
        throw new Error("CHARACTER_POSE_UNAVAILABLE");
      }
      const parsed = characterPoseGenerationSchema.parse(input);
      if (activePoseRequests.size > 0) {
        throw new Error("CHARACTER_POSE_BUSY");
      }
      if (activePoseRequests.has(parsed.requestId)) {
        throw new Error("DUPLICATE_CHARACTER_POSE_REQUEST");
      }

      const controller = new AbortController();
      activePoseRequests.set(parsed.requestId, controller);
      try {
        const asset = await characterPoseDirector.generate({
          sourceAssetId: parsed.sourceAssetId,
          instruction: parsed.instruction,
          compositionMode: parsed.compositionMode,
          signal: controller.signal,
        });
        recordPoseAudit({
          outcome: "completed",
          targetId: parsed.sourceAssetId,
          traceId: parsed.requestId,
          reason: asset.generationModel ?? null,
        });
        return asset;
      } catch (error) {
        recordPoseAudit({
          outcome: controller.signal.aborted ? "cancelled" : "failed",
          targetId: parsed.sourceAssetId,
          traceId: parsed.requestId,
          reason: stableErrorCode(error),
        });
        throw error;
      } finally {
        activePoseRequests.delete(parsed.requestId);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cancelCharacterPoseGeneration,
    (event, requestId: unknown): { cancelled: boolean } => {
      assertTrustedSender(event.sender.id);
      const parsedId = z.string().uuid().parse(requestId);
      const controller = activePoseRequests.get(parsedId);
      if (!controller) {
        return { cancelled: false };
      }
      controller.abort();
      return { cancelled: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.createBackup, async (event) => {
    assertTrustedSender(event.sender.id);
    if (!databaseHandle || !mainWindow) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择完整备份保存位置",
      buttonLabel: "在此创建备份",
      properties: ["openDirectory", "createDirectory"],
    });
    const parentDirectory = selected.filePaths[0];
    if (selected.canceled || !parentDirectory) {
      return { cancelled: true };
    }
    const result = await new BackupService().create({
      database: databaseHandle.database,
      userDataPath: app.getPath("userData"),
      parentDirectory,
      appVersion: app.getVersion(),
      schemaVersion: databaseHandle.schemaVersion,
    });
    return {
      cancelled: false,
      directory: result.directory,
      fileCount: result.fileCount,
    };
  });

  ipcMain.handle(IPC_CHANNELS.restoreBackup, async (event) => {
    assertTrustedSender(event.sender.id);
    if (!databaseHandle || !mainWindow) {
      throw new Error("DATABASE_UNAVAILABLE");
    }
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择 AIDesktopPet 完整备份目录",
      buttonLabel: "选择备份",
      properties: ["openDirectory"],
    });
    const directory = selected.filePaths[0];
    if (selected.canceled || !directory) {
      return { cancelled: true };
    }
    const backupService = new BackupService();
    await backupService.validate(directory);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "恢复完整备份",
      message: "将覆盖当前数据库、设置和角色资产，并重启应用。",
      detail:
        "恢复前会自动保留当前数据副本。API Key 和 QQ 授权码不包含在备份中；换机恢复后需要重新配置。",
      buttons: ["取消", "恢复并重启"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) {
      return { cancelled: true };
    }

    taskEngine?.stop();
    for (const controller of activeChatRequests.values()) {
      controller.abort();
    }
    for (const controller of activePoseRequests.values()) {
      controller.abort();
    }
    activeChatRequests.clear();
    activePoseRequests.clear();
    databaseHandle.database.close();
    databaseHandle = null;
    try {
      await backupService.restore({
        directory,
        userDataPath: app.getPath("userData"),
      });
    } catch (error) {
      console.error("恢复备份失败", error);
      quitting = true;
      app.relaunch();
      app.exit(1);
      throw error;
    }
    quitting = true;
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return { cancelled: false, restarting: true };
  });

  ipcMain.handle(IPC_CHANNELS.importCalendarIcs, (event, input: unknown) => {
    assertTrustedSender(event.sender.id);
    if (!calendarService) {
      throw new Error("CALENDAR_SERVICE_UNAVAILABLE");
    }
    const parsed = calendarImportSchema.parse(input);
    const result = calendarService.import({
      fileName: parsed.fileName,
      bytes: parsed.bytes,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return {
      ...result,
      eventCount: calendarService.status().eventCount,
    };
  });

  ipcMain.handle(IPC_CHANNELS.quit, async (event) => {
    assertTrustedSender(event.sender.id);
    await quitApplication();
  });
}

const chatStartSchema = z
  .object({
    requestId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(32_000),
  })
  .strict();

const memoryUpdateSchema = z
  .object({
    content: z.string().trim().min(2).max(2_000).optional(),
    type: z
      .enum([
        "profile",
        "preference",
        "fact",
        "project_decision",
        "event",
        "summary",
        "commitment",
      ])
      .optional(),
    importance: z.number().min(0).max(1).optional(),
  })
  .strict();

const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).optional(),
    dueAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "dueAt 必须是 ISO 时间",
    }),
    timezone: z.string().trim().min(1).max(100),
    idempotencyKey: z.string().uuid(),
    priority: z.number().int().min(1).max(5).optional(),
    projectId: z.string().uuid().nullable().optional(),
    recurrence: z.enum(["none", "daily", "weekdays", "weekly"]).optional(),
  })
  .strict();

const toolInvokeSchema = z
  .object({
    requestId: z.string().uuid(),
    toolName: z.string().min(1).max(100),
    input: z.unknown(),
  })
  .strict();

const characterUploadSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    bytes: z.instanceof(Uint8Array),
    view: z.enum([
      "front",
      "left",
      "right",
      "back",
      "idle",
      "talking",
      "thinking",
      "sleeping",
    ]),
    category: z.enum(["character", "prop", "background"]),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const characterPoseGenerationSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    instruction: z.string().trim().min(2).max(500),
    compositionMode: z.enum(["character", "scene"]),
  })
  .strict();

const calendarImportSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    bytes: z.instanceof(Uint8Array),
  })
  .strict();

type ChatStart = z.infer<typeof chatStartSchema>;

async function runChat(
  request: ChatStart,
  controller: AbortController,
): Promise<void> {
  if (!assistantCore || !mainWindow) {
    return;
  }

  try {
    for await (const event of assistantCore.sendMessage({
      conversationId: request.conversationId,
      message: request.message,
      modelDestination: "cloud",
      signal: controller.signal,
    })) {
      if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send(IPC_CHANNELS.chatEvent, {
          requestId: request.requestId,
          event,
        });
      }
    }
  } catch (error) {
    console.error("聊天处理失败", error);
    if (!mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send(IPC_CHANNELS.chatEvent, {
        requestId: request.requestId,
        event: {
          type: "message.failed",
          assistantMessageId: randomUUID(),
          code: "ASSISTANT_UNAVAILABLE",
          message: "对话服务暂时不可用",
          retryable: true,
        },
      });
    }
  } finally {
    activeChatRequests.delete(request.requestId);
  }
}

function assertTrustedSender(senderId: number): void {
  if (!mainWindow || mainWindow.webContents.id !== senderId) {
    throw new Error("UNTRUSTED_IPC_SENDER");
  }
}

function recordPoseAudit(input: {
  outcome: string;
  targetId: string;
  traceId: string;
  reason: string | null;
}): void {
  try {
    auditRepository?.record({
      actorType: "user",
      action: "character.pose.generate",
      targetType: "character_asset",
      targetId: input.targetId,
      outcome: input.outcome,
      reason: input.reason,
      traceId: input.traceId,
    });
  } catch (error) {
    console.error("记录角色姿态审计失败", error);
  }
}

function stableErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/CHARACTER_[A-Z_]+/);
    if (match?.[0]) {
      return match[0];
    }
  }
  return "CHARACTER_POSE_UNKNOWN_ERROR";
}

async function quitApplication(): Promise<void> {
  await saveWindowBounds();
  quitting = true;
  app.quit();
}
