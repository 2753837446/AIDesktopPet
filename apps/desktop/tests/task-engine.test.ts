import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { TaskEngine, type TaskNotificationSink } from "../src/core/task-engine";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteTaskRepository } from "../src/main/persistence/task-repository";

class FakeNotificationSink implements TaskNotificationSink {
  readonly notifications: Array<{ title: string; body: string; dedupeKey: string }> = [];
  shouldFail = false;

  async notify(input: {
    title: string;
    body: string;
    dedupeKey: string;
    taskId: string;
  }): Promise<void> {
    if (this.shouldFail) {
      throw new Error("通知服务不可用");
    }
    this.notifications.push(input);
  }
}

describe("TaskEngine", () => {
  let database: DatabaseSync;
  let repository: SqliteTaskRepository;
  let sink: FakeNotificationSink;
  let engine: TaskEngine;

  beforeEach(() => {
    database = openDatabase(":memory:").database;
    repository = new SqliteTaskRepository(database);
    sink = new FakeNotificationSink();
    engine = new TaskEngine(repository, sink, "test-worker");
  });

  afterEach(() => {
    engine.stop();
    database.close();
  });

  it("创建任务并保证 idempotency key 不重复", () => {
    const dueAt = "2026-10-27T12:00:00.000Z";
    const first = engine.createTask({
      title: "喝水",
      dueAt,
      timezone: "Asia/Shanghai",
      idempotencyKey: "create-water-once",
    });
    const duplicate = engine.createTask({
      title: "不应覆盖",
      dueAt,
      timezone: "Asia/Shanghai",
      idempotencyKey: "create-water-once",
    });

    expect(duplicate.id).toBe(first.id);
    expect(duplicate.title).toBe("喝水");
    expect(first.status).toBe("scheduled");
  });

  it("到期任务只通知一次并转为 completed", async () => {
    const now = new Date("2026-10-27T08:00:00.000Z");
    const task = engine.createTask({
      title: "提交周报",
      dueAt: new Date(now.getTime() - 1_000).toISOString(),
      timezone: "Asia/Shanghai",
      idempotencyKey: "weekly-report-once",
    });

    const firstRun = await engine.runDueTasks(now);
    const secondRun = await engine.runDueTasks(
      new Date(now.getTime() + 60_000),
    );

    expect(firstRun[0]).toMatchObject({ id: task.id, status: "completed" });
    expect(secondRun).toEqual([]);
    expect(sink.notifications).toHaveLength(1);
    expect(sink.notifications[0]?.dedupeKey).toBe(`task-due:${task.id}`);
  });

  it("通知失败会进入有限次数重试", async () => {
    const now = new Date("2026-10-27T08:00:00.000Z");
    sink.shouldFail = true;
    const task = engine.createTask({
      title: "检查备份",
      dueAt: new Date(now.getTime() - 1_000).toISOString(),
      timezone: "Asia/Shanghai",
      idempotencyKey: "backup-check-once",
    });

    const [failed] = await engine.runDueTasks(now);
    expect(failed).toMatchObject({
      id: task.id,
      status: "retry_scheduled",
      retryCount: 1,
      lastErrorCode: "NOTIFICATION_DELIVERY_FAILED",
    });
  });

  it("恢复过期 running 租约", () => {
    const dueAt = "2026-10-27T07:59:00.000Z";
    engine.createTask({
      title: "恢复测试",
      dueAt,
      timezone: "Asia/Shanghai",
      idempotencyKey: "lease-recovery",
    });
    repository.claimDue(
      dueAt,
      "crashed-worker",
      "2026-10-27T08:00:10.000Z",
    );

    const recovered = engine.recover(new Date("2026-10-27T08:01:00.000Z"));

    expect(recovered).toBe(1);
    expect(engine.listTasks()[0]).toMatchObject({
      status: "retry_scheduled",
      lastErrorCode: "WORKER_LEASE_EXPIRED",
    });
  });

  it("重复任务完成后创建下一次发生实例", async () => {
    const now = new Date("2026-10-27T00:59:00.000Z");
    const task = engine.createTask({
      title: "每日站会",
      dueAt: "2026-10-27T01:00:00.000Z",
      timezone: "Asia/Shanghai",
      idempotencyKey: "standup-first",
      recurrence: "daily",
    });

    await engine.runDueTasks(new Date("2026-10-27T01:01:00.000Z"));
    const tasks = engine.listTasks();

    expect(tasks.find((item) => item.id === task.id)?.status).toBe("completed");
    expect(tasks.find((item) => item.status === "scheduled")).toMatchObject({
      title: "每日站会",
      seriesId: task.seriesId,
      dueAt: "2026-10-28T01:00:00.000Z",
      recurrence: "daily",
    });
  });

  it("按设定时间创建并执行持久化每日总结任务", async () => {
    let executions = 0;
    engine.registerExecutor("daily_brief", async () => {
      executions += 1;
    });
    const task = engine.ensureDailyBrief(
      true,
      "09:00",
      "Asia/Shanghai",
      new Date("2026-10-27T00:00:00.000Z"),
    );
    expect(task).toMatchObject({
      actionType: "daily_brief",
      recurrence: "daily",
      dueAt: "2026-10-27T01:00:00.000Z",
    });

    await engine.runDueTasks(new Date("2026-10-27T01:01:00.000Z"));

    expect(executions).toBe(1);
    expect(
      engine.listTasks().some(
        (item) =>
          item.actionType === "daily_brief" &&
          item.status === "scheduled" &&
          item.dueAt === "2026-10-28T01:00:00.000Z",
      ),
    ).toBe(true);
  });
});
