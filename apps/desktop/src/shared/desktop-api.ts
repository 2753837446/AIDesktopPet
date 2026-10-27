import type {
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopWindowMode,
} from "./settings";
import type {
  AssistantStreamEvent,
  AuditLogRecord,
  ConnectorRecord,
  CreateTaskInput,
  DailyBriefRecord,
  MemorySearchResult,
  MessageRecord,
  MemoryType,
  TaskRecord,
  ToolCallRecord,
  ToolSummary,
} from "../core/domain";

export interface DesktopBootstrap {
  settings: DesktopSettings;
  meta: {
    appVersion: string;
    platform: string;
    isPackaged: boolean;
    modelConfigured: boolean;
    modelName: string;
    embeddingConfigured: boolean;
    embeddingModel: string;
    conversationId: string | null;
    database: {
      ready: boolean;
      schemaVersion: number | null;
    };
  };
}

export interface ChatStartRequest {
  requestId: string;
  conversationId?: string | undefined;
  message: string;
}

export interface ChatStreamEnvelope {
  requestId: string;
  event: AssistantStreamEvent;
}

export interface DesktopApi {
  getBootstrap(): Promise<DesktopBootstrap>;
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  setWindowMode(mode: DesktopWindowMode): Promise<void>;
  getChatHistory(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  startChat(request: ChatStartRequest): Promise<{ accepted: true }>;
  cancelChat(requestId: string): Promise<{ cancelled: boolean }>;
  saveDeepSeekKey(apiKey: string): Promise<{ configured: true }>;
  clearDeepSeekKey(): Promise<{ configured: false }>;
  saveSiliconFlowKey(apiKey: string): Promise<{
    configured: true;
    scheduled: number;
  }>;
  clearSiliconFlowKey(): Promise<{ configured: false }>;
  reindexMemories(): Promise<{ scheduled: number }>;
  listMemories(query?: string, limit?: number): Promise<MemorySearchResult[]>;
  updateMemory(
    id: string,
    patch: { content?: string; type?: MemoryType; importance?: number },
  ): Promise<MemorySearchResult>;
  deleteMemory(id: string): Promise<{ deleted: boolean }>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  listTasks(limit?: number): Promise<TaskRecord[]>;
  completeTask(id: string): Promise<{ updated: boolean }>;
  cancelTask(id: string): Promise<{ updated: boolean }>;
  getLatestDailyBrief(): Promise<DailyBriefRecord | null>;
  generateDailyBrief(): Promise<DailyBriefRecord>;
  listTools(): Promise<ToolSummary[]>;
  invokeTool(input: {
    requestId: string;
    toolName: string;
    input: unknown;
  }): Promise<ToolCallRecord>;
  listToolCalls(limit?: number): Promise<ToolCallRecord[]>;
  approveTool(callId: string, approved: boolean): Promise<ToolCallRecord>;
  cancelTool(callId: string): Promise<{ cancelled: boolean }>;
  listConnectors(): Promise<ConnectorRecord[]>;
  listAuditLogs(query?: string, limit?: number): Promise<AuditLogRecord[]>;
  quit(): Promise<void>;
  onSettingsChanged(listener: (settings: DesktopSettings) => void): () => void;
  onOpenSettings(listener: () => void): () => void;
  onChatEvent(listener: (event: ChatStreamEnvelope) => void): () => void;
}

export const IPC_CHANNELS = {
  getBootstrap: "desktop:get-bootstrap",
  updateSettings: "desktop:update-settings",
  setWindowMode: "desktop:set-window-mode",
  getChatHistory: "chat:get-history",
  startChat: "chat:start",
  cancelChat: "chat:cancel",
  chatEvent: "chat:event",
  saveDeepSeekKey: "credentials:save-deepseek",
  clearDeepSeekKey: "credentials:clear-deepseek",
  saveSiliconFlowKey: "credentials:save-siliconflow",
  clearSiliconFlowKey: "credentials:clear-siliconflow",
  reindexMemories: "memory:reindex",
  listMemories: "memory:list",
  updateMemory: "memory:update",
  deleteMemory: "memory:delete",
  createTask: "tasks:create",
  listTasks: "tasks:list",
  completeTask: "tasks:complete",
  cancelTask: "tasks:cancel",
  getLatestDailyBrief: "daily-brief:get-latest",
  generateDailyBrief: "daily-brief:generate",
  listTools: "tools:list",
  invokeTool: "tools:invoke",
  listToolCalls: "tools:calls",
  approveTool: "tools:approve",
  cancelTool: "tools:cancel",
  listConnectors: "connectors:list",
  listAuditLogs: "audit:list",
  quit: "desktop:quit",
  settingsChanged: "desktop:settings-changed",
  openSettings: "desktop:open-settings",
} as const;
