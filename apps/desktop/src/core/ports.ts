import type {
  ConversationRecord,
  DataDestination,
  MemoryRecord,
  MemorySearchResult,
  MessageRecord,
  MessageRole,
  ModelRequest,
  ModelStreamEvent,
  ModelToolRequest,
  ModelToolDefinition,
  ToolCallRecord,
} from "./domain";

export interface ConversationRepository {
  ensureConversation(input: {
    conversationId?: string | undefined;
    projectId?: string | null;
    title?: string;
  }): ConversationRecord;
  appendMessage(input: {
    id?: string;
    conversationId: string;
    role: MessageRole;
    content: string;
    projectId?: string | null;
  }): MessageRecord;
  listRecentMessages(conversationId: string, limit: number): MessageRecord[];
  getMostRecentConversation(): ConversationRecord | null;
}

export interface MemorySearchPort {
  search(input: {
    query: string;
    projectId?: string | null;
    modelDestination: DataDestination;
    limit?: number;
    tokenBudget?: number;
  }): Promise<MemorySearchResult[]>;
}

export interface MemoryCapturePort {
  captureExplicitMessage(message: MessageRecord): MemoryRecord | null;
}

export interface ModelProvider {
  readonly modelName: string;
  chat(request: ModelRequest): AsyncIterable<string>;
  chatWithTools?(request: ModelToolRequest): AsyncIterable<ModelStreamEvent>;
}

export interface AssistantToolPort {
  listModelTools(): ModelToolDefinition[];
  invoke(input: {
    requestId: string;
    toolName: string;
    input: unknown;
    signal?: AbortSignal;
  }): Promise<ToolCallRecord>;
}

export interface EmbeddingProvider {
  readonly modelName: string;
  isConfigured(): Promise<boolean>;
  embed(text: string): Promise<number[]>;
}

export interface ToolCallRepository {
  getByRequestId(requestId: string): ToolCallRecord | null;
  getById(id: string): ToolCallRecord | null;
  create(record: ToolCallRecord, input: unknown): void;
  update(record: ToolCallRecord): void;
  list(limit: number): ToolCallRecord[];
  recordAudit(input: {
    action: string;
    targetId: string;
    outcome: string;
    reason?: string;
    traceId: string;
  }): void;
}
