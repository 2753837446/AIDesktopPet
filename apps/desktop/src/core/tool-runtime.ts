import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ModelToolDefinition,
  RiskLevel,
  ToolCallRecord,
  ToolCallStatus,
  ToolSummary,
} from "./domain";
import type { ToolCallRepository } from "./ports";

export interface PermissionPolicy {
  hasScope(scope: string): boolean;
}

export interface ToolExecutionContext {
  callId: string;
  traceId: string;
  signal: AbortSignal;
}

export interface ToolExecutionResult {
  outputSummary: string;
  output?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  riskLevel: RiskLevel;
  requiredScopes: string[];
  timeoutMs: number;
  requiresConfirmation?: boolean;
  modelCallable?: boolean;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

interface ActiveExecution {
  controller: AbortController;
  cancel: () => void;
}

export class StaticPermissionPolicy implements PermissionPolicy {
  constructor(private readonly scopes: Set<string>) {}

  hasScope(scope: string): boolean {
    return this.scopes.has(scope);
  }
}

export class ToolRuntime {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly pendingInputs = new Map<string, { tool: ToolDefinition; input: unknown }>();

  constructor(
    private readonly repository: ToolCallRepository,
    private readonly permissions: PermissionPolicy,
  ) {}

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error("DUPLICATE_TOOL");
    }
    this.tools.set(definition.name, definition);
  }

  listTools(): ToolSummary[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
      requiredScopes: [...tool.requiredScopes],
    }));
  }

  listModelTools(): ModelToolDefinition[] {
    return [...this.tools.values()]
      .filter(
        (tool) =>
          tool.modelCallable === true &&
          (tool.riskLevel === "low" || tool.riskLevel === "medium"),
      )
      .map((tool) => {
        const { $schema: _schema, ...parameters } = z.toJSONSchema(
          tool.inputSchema,
          { target: "draft-7" },
        ) as Record<string, unknown>;
        return {
          name: tool.name,
          description: tool.description,
          parameters,
        };
      });
  }

  listCalls(limit = 100): ToolCallRecord[] {
    return this.repository.list(limit);
  }

  async invoke(input: {
    requestId: string;
    toolName: string;
    input: unknown;
    signal?: AbortSignal;
  }): Promise<ToolCallRecord> {
    const existing = this.repository.getByRequestId(input.requestId);
    if (existing) {
      return existing;
    }
    const tool = this.tools.get(input.toolName);
    if (!tool) {
      throw new Error("TOOL_NOT_FOUND");
    }

    const now = new Date().toISOString();
    const record = createRecord(tool, input.requestId, now);
    const missingScope = tool.requiredScopes.find(
      (scope) => !this.permissions.hasScope(scope),
    );
    if (missingScope) {
      record.status = "denied";
      record.errorCode = "TOOL_PERMISSION_DENIED";
      record.errorMessage = `缺少权限范围：${missingScope}`;
      record.finishedAt = now;
      this.repository.create(record, input.input);
      this.audit(record, "tool.denied", "denied", record.errorMessage);
      return record;
    }

    const parsed = tool.inputSchema.safeParse(input.input);
    if (!parsed.success) {
      record.status = "denied";
      record.errorCode = "TOOL_INPUT_INVALID";
      record.errorMessage = "工具参数校验失败";
      record.finishedAt = now;
      this.repository.create(record, input.input);
      this.audit(record, "tool.denied", "denied", record.errorMessage);
      return record;
    }

    if (tool.riskLevel === "critical") {
      record.status = "denied";
      record.errorCode = "TOOL_CRITICAL_DISABLED";
      record.errorMessage = "关键风险工具默认禁止执行";
      record.finishedAt = now;
      this.repository.create(record, input.input);
      this.audit(record, "tool.denied", "denied", record.errorMessage);
      return record;
    }

    const needsConfirmation =
      tool.requiresConfirmation ||
      tool.riskLevel === "high";
    if (needsConfirmation) {
      record.status = "pending_confirmation";
      record.approvalStatus = "pending";
      record.approvalId = randomUUID();
      this.repository.create(record, input.input);
      this.pendingInputs.set(record.id, {
        tool,
        input: parsed.data,
      });
      this.audit(record, "tool.confirmation_requested", "pending");
      return record;
    }

    this.repository.create(record, input.input);
    return this.execute(record, tool, parsed.data, input.input, input.signal);
  }

  async approve(callId: string, approved: boolean): Promise<ToolCallRecord> {
    const record = this.repository.getById(callId);
    if (!record) {
      throw new Error("TOOL_CALL_NOT_FOUND");
    }
    if (record.status !== "pending_confirmation") {
      throw new Error("TOOL_CONFIRMATION_NOT_PENDING");
    }

    const now = new Date().toISOString();
    if (!approved) {
      this.pendingInputs.delete(record.id);
      record.status = "denied";
      record.approvalStatus = "rejected";
      record.finishedAt = now;
      record.updatedAt = now;
      this.repository.update(record);
      this.audit(record, "tool.rejected", "denied");
      return record;
    }

    record.approvalStatus = "approved";
    record.updatedAt = now;
    this.repository.update(record);
    this.audit(record, "tool.approved", "approved");
    const pending = this.pendingInputs.get(record.id);
    if (!pending) {
      this.pendingInputs.delete(record.id);
      record.status = "denied";
      record.errorCode = "TOOL_CONFIRMATION_EXPIRED";
      record.errorMessage = "确认已过期，请重新发起工具调用";
      record.finishedAt = now;
      record.updatedAt = now;
      this.repository.update(record);
      this.audit(record, "tool.confirmation_expired", "denied");
      return record;
    }
    this.pendingInputs.delete(record.id);
    return this.execute(record, pending.tool, pending.input, pending.input);
  }

  cancel(callId: string): boolean {
    const record = this.repository.getById(callId);
    if (!record) {
      return false;
    }
    if (record.status === "pending_confirmation") {
      this.pendingInputs.delete(record.id);
      record.status = "cancelled";
      record.approvalStatus = "rejected";
      record.finishedAt = new Date().toISOString();
      record.updatedAt = record.finishedAt;
      this.repository.update(record);
      this.audit(record, "tool.cancelled", "cancelled");
      return true;
    }
    const active = this.activeExecutions.get(callId);
    if (active) {
      active.cancel();
      return true;
    }
    return false;
  }

  private async execute(
    record: ToolCallRecord,
    tool: ToolDefinition,
    input: unknown,
    _originalInput: unknown,
    signal?: AbortSignal,
  ): Promise<ToolCallRecord> {
    const startedAt = new Date().toISOString();
    record.status = "running";
    record.startedAt = startedAt;
    record.updatedAt = startedAt;
    this.repository.update(record);
    this.audit(record, "tool.started", "running");

    const controller = new AbortController();
    let rejectCancellation: ((error: Error) => void) | null = null;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectCancellation?.(
        new ToolRuntimeError("TOOL_TIMEOUT", "工具执行超时", true),
      );
    }, tool.timeoutMs);

    this.activeExecutions.set(record.id, {
      controller,
      cancel: () => {
        controller.abort();
        rejectCancellation?.(
          new ToolRuntimeError("TOOL_CANCELLED", "工具执行已取消", false),
        );
      },
    });
    const cancelFromParent = (): void => {
      this.cancel(record.id);
    };
    signal?.addEventListener("abort", cancelFromParent, { once: true });
    if (signal?.aborted) {
      cancelFromParent();
    }

    try {
      const result = await Promise.race([
        tool.execute(input, {
          callId: record.id,
          traceId: record.traceId,
          signal: controller.signal,
        }),
        cancellation,
      ]);
      const now = new Date().toISOString();
      record.status = "completed";
      record.outputSummary = result.outputSummary.slice(0, 1_000);
      if (result.output !== undefined) {
        record.output = result.output;
      }
      record.finishedAt = now;
      record.updatedAt = now;
      this.repository.update(record);
      this.audit(record, "tool.completed", "completed");
      return record;
    } catch (error) {
      const now = new Date().toISOString();
      const normalized =
        error instanceof ToolRuntimeError
          ? error
          : new ToolRuntimeError(
              "TOOL_EXECUTION_FAILED",
              "工具执行失败",
              true,
              { cause: error },
            );
      record.status =
        normalized.code === "TOOL_CANCELLED" ? "cancelled" : "failed";
      record.errorCode = normalized.code;
      record.errorMessage = normalized.message;
      record.finishedAt = now;
      record.updatedAt = now;
      this.repository.update(record);
      this.audit(
        record,
        record.status === "cancelled" ? "tool.cancelled" : "tool.failed",
        record.status,
        normalized.message,
      );
      return record;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelFromParent);
      this.activeExecutions.delete(record.id);
    }
  }

  private audit(
    record: ToolCallRecord,
    action: string,
    outcome: string,
    reason?: string,
  ): void {
    this.repository.recordAudit({
      action,
      targetId: record.id,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      traceId: record.traceId,
    });
  }
}

export class ToolRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolRuntimeError";
  }
}

function createRecord(
  tool: ToolDefinition,
  requestId: string,
  now: string,
): ToolCallRecord {
  return {
    id: randomUUID(),
    requestId,
    toolName: tool.name,
    inputSummary: "",
    riskLevel: tool.riskLevel,
    requiredScopes: [...tool.requiredScopes],
    status: "running" as ToolCallStatus,
    approvalStatus: "not_required",
    approvalId: null,
    outputSummary: null,
    errorCode: null,
    errorMessage: null,
    traceId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
}
