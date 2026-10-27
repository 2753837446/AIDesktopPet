import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  StaticPermissionPolicy,
  ToolRuntime,
  ToolRuntimeError,
} from "../src/core/tool-runtime";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteConnectorRepository } from "../src/main/persistence/connector-repository";
import { SqliteToolCallRepository } from "../src/main/persistence/tool-call-repository";

describe("ToolRuntime", () => {
  let database: DatabaseSync;
  let runtime: ToolRuntime;
  let highRiskExecutions = 0;

  beforeEach(() => {
    database = openDatabase(":memory:").database;
    runtime = new ToolRuntime(
      new SqliteToolCallRepository(database),
      new StaticPermissionPolicy(new Set(["test.read", "test.write"])),
    );
    highRiskExecutions = 0;
  });

  afterEach(() => {
    database.close();
  });

  it("低风险工具执行并写入审计", async () => {
    runtime.register({
      name: "test.low",
      description: "低风险测试工具",
      inputSchema: z.object({ value: z.string() }).strict(),
      riskLevel: "low",
      requiredScopes: ["test.read"],
      timeoutMs: 1_000,
      execute: async (input) => ({
        outputSummary: `收到 ${(input as { value: string }).value}`,
      }),
    });

    const call = await runtime.invoke({
      requestId: randomUUID(),
      toolName: "test.low",
      input: { value: "hello", password: "should-redact" },
    });

    expect(call.status).toBe("denied");
    const valid = await runtime.invoke({
      requestId: randomUUID(),
      toolName: "test.low",
      input: { value: "hello" },
    });
    expect(valid.status).toBe("completed");
    expect(valid.outputSummary).toBe("收到 hello");
    const audits = database
      .prepare("SELECT COUNT(*) AS count FROM audit_logs")
      .get() as { count: number };
    expect(audits.count).toBeGreaterThanOrEqual(3);
  });

  it("高风险工具在批准前不执行", async () => {
    runtime.register({
      name: "test.high",
      description: "高风险测试工具",
      inputSchema: z.object({ target: z.string() }).strict(),
      riskLevel: "high",
      requiredScopes: ["test.write"],
      timeoutMs: 1_000,
      execute: async () => {
        highRiskExecutions += 1;
        return { outputSummary: "approved" };
      },
    });

    const pending = await runtime.invoke({
      requestId: randomUUID(),
      toolName: "test.high",
      input: { target: "demo" },
    });
    expect(pending.status).toBe("pending_confirmation");
    expect(highRiskExecutions).toBe(0);

    const completed = await runtime.approve(pending.id, true);
    expect(completed.status).toBe("completed");
    expect(highRiskExecutions).toBe(1);
  });

  it("缺少 scope 和 critical 工具均被拒绝", async () => {
    runtime.register({
      name: "test.denied",
      description: "无权限工具",
      inputSchema: z.object({}).strict(),
      riskLevel: "low",
      requiredScopes: ["missing.scope"],
      timeoutMs: 1_000,
      execute: async () => ({ outputSummary: "不应该执行" }),
    });
    runtime.register({
      name: "test.critical",
      description: "关键工具",
      inputSchema: z.object({}).strict(),
      riskLevel: "critical",
      requiredScopes: ["test.write"],
      timeoutMs: 1_000,
      execute: async () => ({ outputSummary: "不应该执行" }),
    });

    expect(
      (
        await runtime.invoke({
          requestId: randomUUID(),
          toolName: "test.denied",
          input: {},
        })
      ).errorCode,
    ).toBe("TOOL_PERMISSION_DENIED");
    expect(
      (
        await runtime.invoke({
          requestId: randomUUID(),
          toolName: "test.critical",
          input: {},
        })
      ).errorCode,
    ).toBe("TOOL_CRITICAL_DISABLED");
  });

  it("工具超时和取消都有稳定状态", async () => {
    runtime.register({
      name: "test.timeout",
      description: "超时工具",
      inputSchema: z.object({}).strict(),
      riskLevel: "low",
      requiredScopes: ["test.read"],
      timeoutMs: 20,
      execute: async (_input, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            reject(new ToolRuntimeError("ABORTED", "aborted", false));
          });
        }),
    });

    const timedOut = await runtime.invoke({
      requestId: randomUUID(),
      toolName: "test.timeout",
      input: {},
    });
    expect(timedOut.status).toBe("failed");
    expect(timedOut.errorCode).toBe("TOOL_TIMEOUT");

    runtime.register({
      name: "test.cancel",
      description: "取消工具",
      inputSchema: z.object({}).strict(),
      riskLevel: "low",
      requiredScopes: ["test.read"],
      timeoutMs: 5_000,
      execute: async (_input, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            reject(new ToolRuntimeError("ABORTED", "aborted", false));
          });
        }),
    });
    const running = runtime.invoke({
      requestId: randomUUID(),
      toolName: "test.cancel",
      input: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const activeCall = runtime
      .listCalls(10)
      .find((call) => call.toolName === "test.cancel");
    if (!activeCall) {
      throw new Error("未找到运行中的工具调用");
    }
    expect(activeCall?.status).toBe("running");
    expect(runtime.cancel(activeCall.id)).toBe(true);
    expect((await running).status).toBe("cancelled");
  });

  it("Himalaya 邮箱 Connector 初始为未连接", () => {
    const connectors = new SqliteConnectorRepository(database).list();
    expect(connectors).toContainEqual(
      expect.objectContaining({
        id: "email-primary",
        provider: "himalaya",
        status: "disconnected",
      }),
    );
  });
});
