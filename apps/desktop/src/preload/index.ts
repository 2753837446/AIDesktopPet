import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type ChatStartRequest,
  type ChatStreamEnvelope,
  type DesktopApi,
  type DesktopBootstrap,
} from "../shared/desktop-api";
import type { DesktopSettings, DesktopSettingsPatch } from "../shared/settings";
import type {
  CreateTaskInput,
  AuditLogRecord,
  CharacterAsset,
  CharacterAssetCategory,
  CharacterCompositionMode,
  CharacterView,
  ConnectorRecord,
  DailyBriefRecord,
  MemorySearchResult,
  MemoryType,
  MessageRecord,
  TaskRecord,
  ToolCallRecord,
  ToolSummary,
} from "../core/domain";

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
  getChatHistory: (conversationId: string, limit?: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getChatHistory,
      conversationId,
      limit,
    ) as Promise<MessageRecord[]>,
  startChat: (request: ChatStartRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.startChat, request) as Promise<{
      accepted: true;
    }>,
  cancelChat: (requestId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelChat, requestId) as Promise<{
      cancelled: boolean;
    }>,
  saveDeepSeekKey: (apiKey: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveDeepSeekKey, apiKey) as Promise<{
      configured: true;
    }>,
  clearDeepSeekKey: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearDeepSeekKey) as Promise<{
      configured: false;
    }>,
  saveSiliconFlowKey: (apiKey: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSiliconFlowKey, apiKey) as Promise<{
      configured: true;
      scheduled: number;
    }>,
  clearSiliconFlowKey: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearSiliconFlowKey) as Promise<{
      configured: false;
    }>,
  reindexMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.reindexMemories) as Promise<{
      scheduled: number;
    }>,
  listMemories: (query?: string, limit?: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.listMemories,
      query,
      limit,
    ) as Promise<MemorySearchResult[]>,
  updateMemory: (
    id: string,
    patch: { content?: string; type?: MemoryType; importance?: number },
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateMemory,
      id,
      patch,
    ) as Promise<MemorySearchResult>,
  deleteMemory: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteMemory, id) as Promise<{
      deleted: boolean;
    }>,
  createTask: (input: CreateTaskInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createTask, input) as Promise<TaskRecord>,
  listTasks: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.listTasks, limit) as Promise<TaskRecord[]>,
  completeTask: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.completeTask, id) as Promise<{
      updated: boolean;
    }>,
  cancelTask: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelTask, id) as Promise<{
      updated: boolean;
    }>,
  getLatestDailyBrief: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getLatestDailyBrief) as Promise<
      DailyBriefRecord | null
    >,
  generateDailyBrief: () =>
    ipcRenderer.invoke(IPC_CHANNELS.generateDailyBrief) as Promise<DailyBriefRecord>,
  listTools: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listTools) as Promise<ToolSummary[]>,
  invokeTool: (input: {
    requestId: string;
    toolName: string;
    input: unknown;
  }) =>
    ipcRenderer.invoke(IPC_CHANNELS.invokeTool, input) as Promise<ToolCallRecord>,
  listToolCalls: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.listToolCalls, limit) as Promise<ToolCallRecord[]>,
  approveTool: (callId: string, approved: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.approveTool,
      callId,
      approved,
    ) as Promise<ToolCallRecord>,
  cancelTool: (callId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelTool, callId) as Promise<{
      cancelled: boolean;
    }>,
  listConnectors: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listConnectors) as Promise<ConnectorRecord[]>,
  listAuditLogs: (query?: string, limit?: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.listAuditLogs,
      query,
      limit,
    ) as Promise<AuditLogRecord[]>,
  listCharacterAssets: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listCharacterAssets) as Promise<
      CharacterAsset[]
    >,
  uploadCharacterAsset: (input: {
    fileName: string;
    bytes: Uint8Array;
    view: CharacterView;
    category: Exclude<CharacterAssetCategory, "scene">;
    displayName?: string;
  }) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.uploadCharacterAsset,
      input,
    ) as Promise<CharacterAsset>,
  getCharacterAssetData: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCharacterAssetData, id) as Promise<{
      asset: CharacterAsset;
      bytes: Uint8Array;
    }>,
  deleteCharacterAsset: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteCharacterAsset, id) as Promise<{
      deleted: boolean;
    }>,
  generateCharacterPose: (input: {
    requestId: string;
    sourceAssetId: string;
    instruction: string;
    compositionMode: CharacterCompositionMode;
  }) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.generateCharacterPose,
      input,
    ) as Promise<CharacterAsset>,
  cancelCharacterPoseGeneration: (requestId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cancelCharacterPoseGeneration,
      requestId,
    ) as Promise<{ cancelled: boolean }>,
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
  onChatEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatStreamEnvelope) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.chatEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.chatEvent, handler);
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
