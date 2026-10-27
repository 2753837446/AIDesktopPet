import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  RiskLevel,
  ToolCallRecord,
  ToolCallStatus,
} from "../../core/domain";
import type { ToolCallRepository } from "../../core/ports";

interface ToolCallRow {
  id: string;
  request_id: string;
  tool_name: string;
  input_json: string;
  risk_level: RiskLevel;
  required_scopes_json: string;
  status: ToolCallStatus;
  approval_status: ToolCallRecord["approvalStatus"];
  approval_id: string | null;
  output_summary: string | null;
  error_code: string | null;
  error_message: string | null;
  trace_id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export class SqliteToolCallRepository implements ToolCallRepository {
  constructor(private readonly database: DatabaseSync) {}

  getByRequestId(requestId: string): ToolCallRecord | null {
    const row = this.database
      .prepare("SELECT * FROM tool_calls WHERE request_id = ?")
      .get(requestId) as ToolCallRow | undefined;
    return row ? mapToolCall(row) : null;
  }

  getById(id: string): ToolCallRecord | null {
    const row = this.database
      .prepare("SELECT * FROM tool_calls WHERE id = ?")
      .get(id) as ToolCallRow | undefined;
    return row ? mapToolCall(row) : null;
  }

  create(record: ToolCallRecord, input: unknown): void {
    this.database
      .prepare(
        `INSERT INTO tool_calls
          (id, request_id, tool_name, input_json, risk_level,
           required_scopes_json, status, approval_status, approval_id,
           output_summary, error_code, error_message, trace_id,
           created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.requestId,
        record.toolName,
        redactInput(input),
        record.riskLevel,
        JSON.stringify(record.requiredScopes),
        record.status,
        record.approvalStatus,
        record.approvalId,
        record.outputSummary,
        record.errorCode,
        record.errorMessage,
        record.traceId,
        record.createdAt,
        record.updatedAt,
        record.startedAt,
        record.finishedAt,
      );
  }

  update(record: ToolCallRecord): void {
    this.database
      .prepare(
        `UPDATE tool_calls
         SET status = ?, approval_status = ?, approval_id = ?,
             output_summary = ?, error_code = ?, error_message = ?,
             updated_at = ?, started_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        record.status,
        record.approvalStatus,
        record.approvalId,
        record.outputSummary,
        record.errorCode,
        record.errorMessage,
        record.updatedAt,
        record.startedAt,
        record.finishedAt,
        record.id,
      );
  }

  list(limit: number): ToolCallRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM tool_calls
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 200))) as unknown as ToolCallRow[];
    return rows.map(mapToolCall);
  }

  recordAudit(input: {
    action: string;
    targetId: string;
    outcome: string;
    reason?: string;
    traceId: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO audit_logs
          (id, occurred_at, actor_type, action, target_type, target_id,
           outcome, reason, trace_id)
         VALUES (?, ?, 'user', ?, 'tool_call', ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        input.action,
        input.targetId,
        input.outcome,
        input.reason ?? null,
        input.traceId,
      );
  }
}

function mapToolCall(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    toolName: row.tool_name,
    inputSummary: summarizeStoredInput(row.input_json),
    riskLevel: row.risk_level,
    requiredScopes: JSON.parse(row.required_scopes_json) as string[],
    status: row.status,
    approvalStatus: row.approval_status,
    approvalId: row.approval_id,
    outputSummary: row.output_summary,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    traceId: row.trace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function redactInput(value: unknown): string {
  const redacted = redactValue(value);
  return JSON.stringify(redacted).slice(0, 4_000);
}

function redactValue(value: unknown, key = ""): unknown {
  if (/token|secret|password|authorization|cookie|api.?key/i.test(key)) {
    return "<redacted>";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item));
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactValue(child, childKey),
      ]),
    );
  }
  return value;
}

function summarizeStoredInput(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return `字段：${Object.keys(parsed as Record<string, unknown>).join(", ") || "无"}`;
    }
  } catch {
    // 无效 JSON 仅显示为空摘要。
  }
  return "无可展示字段";
}
