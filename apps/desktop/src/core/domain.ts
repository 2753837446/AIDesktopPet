export type MessageRole = "system" | "user" | "assistant" | "tool";

export type MemoryType =
  | "profile"
  | "preference"
  | "fact"
  | "project_decision"
  | "event"
  | "summary"
  | "commitment";

export type MemoryOrigin =
  | "user_explicit"
  | "model_inferred"
  | "imported"
  | "verified";

export type MemoryStatus = "active" | "superseded" | "archived" | "deleted";
export type PrivacyLevel = "normal" | "sensitive" | "local_only";
export type DataDestination = "local" | "cloud";
export type TaskStatus =
  | "pending"
  | "scheduled"
  | "running"
  | "waiting_confirmation"
  | "retry_scheduled"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "needs_reconciliation";
export type TaskType = "user" | "ai_suggestion" | "automation" | "maintenance";
export type RecurrenceKind = "none" | "daily" | "weekdays" | "weekly";
export type TaskActionType = "notify" | "daily_brief";

export interface ConversationRecord {
  id: string;
  title: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  projectId: string | null;
  createdAt: string;
  tokenEstimate: number;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  origin: MemoryOrigin;
  content: string;
  projectId: string | null;
  confidence: number;
  importance: number;
  status: MemoryStatus;
  privacyLevel: PrivacyLevel;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemorySearchResult extends MemoryRecord {
  score: number;
  sourceIds: string[];
}

export interface MemoryCaptureInput {
  message: MessageRecord;
  content: string;
  type: MemoryType;
  projectId: string | null;
  privacyLevel?: PrivacyLevel;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  signal?: AbortSignal | undefined;
}

export interface AssistantInput {
  conversationId?: string | undefined;
  projectId?: string | undefined;
  message: string;
  modelDestination: DataDestination;
  signal?: AbortSignal | undefined;
}

export type AssistantStreamEvent =
  | {
      type: "message.started";
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      memoryCaptured: boolean;
    }
  | {
      type: "content.delta";
      assistantMessageId: string;
      delta: string;
    }
  | {
      type: "message.completed";
      assistantMessage: MessageRecord;
      estimatedContextTokens: number;
    }
  | {
      type: "message.failed";
      assistantMessageId: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: "message.cancelled";
      assistantMessageId: string;
    };

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  taskType: TaskType;
  status: TaskStatus;
  dueAt: string;
  nextRunAt: string;
  timezone: string;
  priority: number;
  idempotencyKey: string;
  recurrence: RecurrenceKind;
  seriesId: string;
  occurrenceKey: string;
  actionType: TaskActionType;
  retryCount: number;
  maxRetryCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt: string;
  timezone: string;
  idempotencyKey: string;
  priority?: number;
  projectId?: string | null;
  recurrence?: RecurrenceKind;
}

export type DataSourceState = "available" | "not_connected" | "failed";

export interface DailyBriefRecord {
  id: string;
  briefDate: string;
  timezone: string;
  content: string;
  sourceStatus: {
    tasks: DataSourceState;
    memories: DataSourceState;
    email: DataSourceState;
    calendar: DataSourceState;
  };
  model: string;
  createdAt: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ToolCallStatus =
  | "pending_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "denied"
  | "needs_reconciliation";

export interface ToolCallRecord {
  id: string;
  requestId: string;
  toolName: string;
  inputSummary: string;
  riskLevel: RiskLevel;
  requiredScopes: string[];
  status: ToolCallStatus;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  approvalId: string | null;
  outputSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  output?: unknown;
}

export interface ConnectorRecord {
  id: string;
  provider: string;
  displayName: string;
  status: "disconnected" | "connected" | "expired" | "error";
  grantedScopes: string[];
  accountLabel: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolSummary {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredScopes: string[];
}

export interface AuditLogRecord {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  reason: string | null;
  traceId: string | null;
}

export type CharacterView =
  | "front"
  | "left"
  | "right"
  | "back"
  | "idle"
  | "talking"
  | "thinking"
  | "sleeping";

export type CharacterImageMimeType =
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/jpeg";

export type CharacterAssetOrigin = "upload" | "ai_generated";

export interface CharacterAsset {
  id: string;
  displayName: string;
  view: CharacterView;
  mimeType: CharacterImageMimeType;
  width: number;
  height: number;
  sizeBytes: number;
  origin: CharacterAssetOrigin;
  sourceAssetId: string | null;
  generationPrompt: string | null;
  generationModel: string | null;
  generatedAt: string | null;
  createdAt: string;
}
