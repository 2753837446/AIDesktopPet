# API_CONTRACTS.md｜核心接口契约

*Assistant Core、Memory Service、Task Engine、Tool Runtime 与 Connector 的接口草案*

版本 V0.2 · 2026-10-27

# 1. 设计原则

- 本文件定义模块内部接口与可选本地 API 的契约草案；MVP 优先使用进程内接口，避免过早建立 localhost HTTP 服务。
- 所有输入必须校验，所有错误必须有稳定 error_code、用户可读 message 和可追踪 trace_id。
- 接口版本化；破坏性变化更新版本。
- 模型输出、外部文件、邮件正文和连接器数据均为不可信输入。
- 任何工具调用必须经过权限、风险级别、超时、取消与审计。

# 2. 通用类型

```text
type ISODateTime = string; // RFC 3339 / UTC
type UUID = string;
type DataDestination = "local" | "cloud";
type MemoryType =
  | "profile"
  | "preference"
  | "fact"
  | "project_decision"
  | "event"
  | "summary"
  | "commitment";
type MemoryOrigin = "user_explicit" | "model_inferred" | "imported" | "verified";
type TaskStatus =
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
type NotificationChannel = "pet_bubble" | "system_toast" | "task_panel" | "daily_brief";

interface ErrorResult {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    traceId: string;
    details?: Record<string, unknown>;
  };
}

interface SuccessResult<T> {
  ok: true;
  data: T;
  traceId: string;
}

type Result<T> = SuccessResult<T> | ErrorResult;

interface PageRequest {
  limit: number;      // service caps limit, e.g. max 100
  cursor?: string;
}
```

# 3. Assistant Core

## 3.1 sendMessage

```text
interface SendMessageInput {
  requestId: UUID;
  conversationId: UUID;
  message: string;
  projectId?: UUID;
  attachments?: Array<{ id: UUID; kind: "file" | "image"; name: string }>;
  responseMode?: "normal" | "concise" | "deep";
  modelDestination: DataDestination;
}

type AssistantEvent =
  | { type: "message.started"; messageId: UUID }
  | { type: "content.delta"; text: string }
  | { type: "tool.started"; toolCallId: UUID; toolName: string }
  | { type: "tool.waiting_confirmation"; toolCallId: UUID; summary: string }
  | { type: "tool.completed"; toolCallId: UUID; resultSummary: string }
  | { type: "message.completed"; messageId: UUID; usage?: TokenUsage }
  | { type: "message.cancelled"; messageId: UUID; reason: "user" | "timeout" | "shutdown" }
  | { type: "message.failed"; error: ErrorResult["error"] };

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  estimatedContextTokens: number;
}

sendMessage(input: SendMessageInput): AsyncIterable<AssistantEvent>;
cancelAssistantRequest(requestId: UUID): Promise<Result<{ cancelled: boolean }>>;
```

规则：用户停止生成时通过 `requestId` 取消模型请求与尚未执行的低风险步骤；对已提交的外部动作应报告真实状态，不能假定取消成功。`modelDestination=cloud` 时，Context Builder 必须排除 `local_only` 数据；用户未显式改变单条数据处理策略时不得绕过该限制。

# 4. Memory Service

## 4.1 候选提取与提交

```text
interface MemoryCandidateInput {
  sourceKind: "message" | "task" | "file" | "connector" | "event";
  sourceId: string; // opaque source reference; files and connectors need not use UUID
  content: string;
  projectId?: UUID;
}

interface MemoryCandidate {
  id: UUID;
  type: MemoryType;
  origin: MemoryOrigin;
  content: string;
  confidence: number;
  importance: number;
  needsConfirmation: boolean;
  reason: string;
}

interface MemoryDecision {
  action: "approve" | "reject" | "merge" | "edit";
  editedContent?: string;
  mergeIntoMemoryId?: UUID;
}

interface MemoryRecord {
  id: UUID;
  type: MemoryType;
  origin: MemoryOrigin;
  content: string;
  projectId?: UUID;
  confidence: number;
  importance: number;
  status: "active" | "superseded" | "archived" | "deleted";
  privacyLevel: "normal" | "sensitive" | "local_only";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

extractCandidates(input: MemoryCandidateInput): Promise<Result<MemoryCandidate[]>>;
commitCandidate(id: UUID, decision: MemoryDecision): Promise<Result<MemoryRecord>>;
searchMemory(input: MemorySearchInput): Promise<Result<MemorySearchResponse>>;
updateMemory(id: UUID, patch: MemoryPatch): Promise<Result<MemoryRecord>>;
deleteMemory(id: UUID): Promise<Result<{ deleted: true; cleanupStatus: "complete" | "pending" }>>;
```

## 4.2 检索契约

```text
interface MemorySearchInput {
  query: string;
  projectId?: UUID;
  types?: MemoryType[];
  timeFrom?: ISODateTime;
  timeTo?: ISODateTime;
  topK?: number;          // server caps, e.g. 20
  tokenBudget?: number;
  includeSources?: boolean;
  modelDestination: DataDestination;
}

interface MemorySearchResult {
  memoryId: UUID;
  content: string;
  type: MemoryType;
  origin: MemoryOrigin;
  score: number;
  confidence: number;
  importance: number;
  createdAt: ISODateTime;
  sourceRefs?: Array<{ kind: string; id: string; excerpt?: string }>;
}

interface MemorySearchResponse {
  results: MemorySearchResult[];
  queryMode: "hybrid" | "keyword_fallback" | "vector_fallback";
  elapsedMs: number;
  estimatedTokens: number;
}
```

# 5. Task Engine

## 5.1 创建任务

```text
interface CreateTaskInput {
  title: string;
  description?: string;
  type: "user" | "ai_suggestion" | "automation" | "maintenance";
  dueAt?: ISODateTime;
  scheduleRule?: Record<string, unknown>;
  timezone: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  requiresConfirmation?: boolean;
  projectId?: UUID;
  idempotencyKey: string;
}

interface TaskRecord {
  id: UUID;
  title: string;
  status: TaskStatus;
  dueAt?: ISODateTime;
  nextRunAt?: ISODateTime;
  lastErrorCode?: string;
}

createTask(input: CreateTaskInput): Promise<Result<TaskRecord>>;
approveTask(taskId: UUID, approved: boolean, note?: string): Promise<Result<TaskRecord>>;
cancelTask(taskId: UUID): Promise<Result<TaskRecord>>;
retryTask(taskId: UUID): Promise<Result<TaskRecord>>;
```

# 6. Tool Runtime

```text
type RiskLevel = "low" | "medium" | "high" | "critical";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiredScopes: string[];
  timeoutMs: number;
  supportsCancellation: boolean;
}

interface ToolCallRequest {
  toolName: string;
  input: unknown;
  conversationId?: UUID;
  taskId?: UUID;
  userApprovalId?: UUID;
}

interface ToolCallResult {
  callId: UUID;
  status: "completed" | "waiting_confirmation" | "failed" | "cancelled" | "needs_reconciliation";
  outputSummary?: string;
  errorCode?: string;
  auditId: UUID;
}

registerTool(definition: ToolDefinition): void;
invokeTool(request: ToolCallRequest): Promise<Result<ToolCallResult>>;
cancelToolCall(callId: UUID): Promise<Result<{ cancellationRequested: boolean }>>;
```

## 风险策略

| 风险 | 规则 |
| --- | --- |
| low | 可在授权范围内自动执行；仍需输入校验与日志 |
| medium | 必须匹配已有授权范围；可根据数据敏感度要求确认 |
| high | 执行前必须对具体动作、目标和影响进行用户确认 |
| critical | 默认不支持自动执行；如未来支持，需独立安全设计与二次确认 |

# 7. Event / Notification

```text
interface AppEvent {
  eventId: UUID;
  source: string;
  type: string;
  occurredAt: ISODateTime;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

interface NotificationRequest {
  dedupeKey: string;
  channels: NotificationChannel[];
  title: string;
  body: string;
  category: "task" | "email" | "calendar" | "daily_brief" | "system";
  priority: "low" | "normal" | "high";
  sourceEventId?: UUID;
  taskId?: UUID;
}

publishEvent(event: AppEvent): Promise<Result<{ accepted: boolean }>>;
notify(request: NotificationRequest): Promise<Result<{
  notificationId: UUID;
  deliveries: Array<{ channel: NotificationChannel; status: "pending" | "sent" | "failed" }>;
}>>;
```

# 8. Connector

```text
interface ConnectorCapabilities {
  canRead: string[];
  canWrite: string[];
  canSubscribeEvents: boolean;
  requiresOAuth: boolean;
}

interface ConnectorStatus {
  connectorId: UUID;
  provider: string;
  status: "disconnected" | "connected" | "expired" | "error";
  grantedScopes: string[];
  lastSyncAt?: ISODateTime;
  lastError?: string;
}

interface ConnectorAdapter {
  getCapabilities(): ConnectorCapabilities;
  getStatus(): Promise<ConnectorStatus>;
  connect(): Promise<Result<ConnectorStatus>>;
  revoke(): Promise<Result<{ revoked: boolean }>>;
  healthCheck(): Promise<Result<{ healthy: boolean }>>;
  read(request: ConnectorCapabilityRequest): Promise<Result<ConnectorDataPage>>;
  subscribe(request: ConnectorCapabilityRequest): Promise<Result<{ subscriptionId: UUID }>>;
  execute(request: ConnectorCapabilityRequest): Promise<Result<ConnectorActionResult>>;
}

interface ConnectorCapabilityRequest {
  capability: string;
  input: unknown;
  approvalId?: UUID;
  signal?: AbortSignal;
}

interface ConnectorDataPage {
  items: Array<{ id: string; occurredAt: ISODateTime; summary: string; sourceRef: string }>;
  nextCursor?: string;
}

interface ConnectorActionResult {
  status: "completed" | "failed" | "needs_reconciliation";
  externalId?: string;
  summary?: string;
}
```

# 9. 错误码建议

| 错误码 | 含义 | 是否可重试 |
| --- | --- | --- |
| MODEL_TIMEOUT | 模型请求超时 | 是，有限重试 |
| MODEL_RATE_LIMIT | 模型限流 | 是，退避后重试 |
| MODEL_AUTH_FAILED | 模型认证失败 | 否，提示检查配置 |
| MEMORY_INDEX_PENDING | 记忆索引待更新 | 后台重试 |
| MEMORY_NOT_FOUND | 记忆不存在或已删除 | 否 |
| TASK_STATE_CONFLICT | 任务状态不允许当前操作 | 否 |
| TASK_CONFIRMATION_REQUIRED | 任务需要用户确认 | 用户操作后继续 |
| TOOL_PERMISSION_DENIED | 工具权限不足 | 授权后可重试 |
| TOOL_INPUT_INVALID | 工具参数校验失败 | 修正参数后重试 |
| TOOL_OUTCOME_UNKNOWN | 外部工具结果不确定 | 否，先对账 |
| PRIVACY_POLICY_DENIED | 当前处理目的地禁止发送该数据 | 否，切换合规的处理方式 |
| REQUEST_CANCELLED | 请求已取消 | 仅用户主动重试时 |
| CONNECTOR_AUTH_EXPIRED | 连接器授权过期 | 重新授权 |
| CONNECTOR_UNAVAILABLE | 连接器暂不可用 | 视错误而定 |
| IDEMPOTENCY_CONFLICT | 幂等键重复且载荷冲突 | 否，检查调用逻辑 |
| DATABASE_MIGRATION_FAILED | 数据库迁移失败 | 否，先诊断 / 恢复 |

# 10. 取消、超时与重试规范

- 所有网络请求必须设置超时；模型流式调用支持 AbortSignal 或等价取消机制。
- 重试仅用于明确可重试错误，使用指数退避和最大次数。
- 工具执行超时不代表外部动作一定失败；对不确定结果应进入 needs_reconciliation 状态或提示用户核查。
- 取消任务只取消尚可安全取消的步骤；已经发送的外部请求要查询状态而非假定回滚。
- 所有 API 和事件处理必须使用幂等键防止重复操作。

# 11. 输入上限基线

| 字段 | 上限 |
| --- | --- |
| 单条用户消息 | 32,000 字符，超过时由 UI 拒绝并提示拆分 |
| 单个附件引用 | 20 MB 仅表示引用大小；实际读取前再次校验 |
| 每次消息附件数量 | 10 |
| Memory `topK` | 默认 8，最大 20 |
| Page `limit` | 默认 20，最大 100 |
| 工具调用输入 | 由工具 schema 定义并由 Tool Runtime 执行大小上限 |
| 幂等键 | 1–128 字符，系统生成的调用默认为 UUID |

# 12. 接口验收测试

- 无效 UUID、超长输入、未知枚举和错误 schema 均返回稳定错误码。
- 模型输出非法工具参数时，工具不得执行。
- 检索结果遵守项目隔离、隐私级别和 tokenBudget。
- `local_only` 数据使用云端模型目的地时被拒绝或过滤，且不会出现在模型请求中。
- 删除记忆后 search 不再返回该记忆，清理未完成时返回 cleanupStatus=pending。
- 任务在 waiting_confirmation 状态时未经批准不能执行受保护动作。
- 同一 dedupeKey 重复提交不会生成重复通知或任务执行。
- 外部动作超时后进入 `needs_reconciliation`，未对账前不会自动重试。
- 取消模型请求与工具调用都有可追踪结果，外部动作已提交时不会伪报取消成功。
- 所有失败响应包含 traceId，日志中不暴露密钥和敏感正文。
