import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementResultingChanges } from "node:sqlite";
import type {
  RecurrenceKind,
  CreateTaskInput,
  TaskActionType,
  TaskRecord,
  TaskStatus,
  TaskType,
} from "../../core/domain";
import {
  calculateNextOccurrence,
  nextLocalTime,
} from "../../core/recurrence";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  task_type: TaskType;
  status: TaskStatus;
  due_at: string;
  next_run_at: string;
  timezone: string;
  priority: number;
  idempotency_key: string;
  recurrence_kind: RecurrenceKind;
  series_id: string;
  occurrence_key: string;
  action_type: TaskActionType;
  retry_count: number;
  max_retry_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteTaskRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(
    input: CreateTaskInput & {
      taskType?: TaskType;
      seriesId?: string;
      actionType?: TaskActionType;
    },
  ): TaskRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const seriesId = input.seriesId ?? id;
    const recurrence = input.recurrence ?? "none";
    const occurrenceKey = `${seriesId}:${input.dueAt}`;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO tasks
          (id, title, description, task_type, status, project_id, due_at,
           next_run_at, timezone, priority, idempotency_key, recurrence_kind,
           series_id, occurrence_key, action_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.description ?? "",
        input.taskType ?? "user",
        input.projectId ?? null,
        input.dueAt,
        input.dueAt,
        input.timezone,
        input.priority ?? 3,
        input.idempotencyKey,
        recurrence,
        seriesId,
        occurrenceKey,
        input.actionType ?? "notify",
        now,
        now,
      );
    const task = this.findByIdempotencyKey(input.idempotencyKey);
    if (!task) {
      throw new Error("TASK_CREATE_FAILED");
    }
    return task;
  }

  list(limit = 100): TaskRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM tasks
         ORDER BY
           CASE status
             WHEN 'running' THEN 0
             WHEN 'scheduled' THEN 1
             WHEN 'retry_scheduled' THEN 2
             WHEN 'completed' THEN 3
             ELSE 4
           END,
           next_run_at ASC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 200))) as unknown as TaskRow[];
    return rows.map(mapTask);
  }

  get(id: string): TaskRecord | null {
    const row = this.database
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  claimDue(
    now: string,
    leaseOwner: string,
    leaseExpiresAt: string,
    limit = 10,
  ): TaskRecord[] {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database
        .prepare(
          `SELECT * FROM tasks
           WHERE status IN ('scheduled','retry_scheduled')
             AND next_run_at <= ?
           ORDER BY priority ASC, next_run_at ASC
           LIMIT ?`,
        )
        .all(now, limit) as unknown as TaskRow[];

      const claimed: TaskRecord[] = [];
      for (const row of rows) {
        const result = this.database
          .prepare(
            `UPDATE tasks
             SET status = 'running', lease_owner = ?, lease_expires_at = ?,
                 heartbeat_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('scheduled','retry_scheduled')`,
          )
          .run(leaseOwner, leaseExpiresAt, now, now, row.id) as StatementResultingChanges;
        if (result.changes !== 1) {
          continue;
        }

        const attempt = this.database
          .prepare(
            `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
             FROM task_runs WHERE task_id = ?`,
          )
          .get(row.id) as { attempt_no: number };
        this.database
          .prepare(
            `INSERT INTO task_runs
              (id, task_id, attempt_no, status, started_at, idempotency_key)
             VALUES (?, ?, ?, 'running', ?, ?)`,
          )
          .run(
            randomUUID(),
            row.id,
            attempt.attempt_no,
            now,
            `task-run:${row.id}:${attempt.attempt_no}`,
          );

        const updated = this.get(row.id);
        if (updated) {
          claimed.push(updated);
        }
      }
      this.database.exec("COMMIT");
      return claimed;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  complete(id: string, now: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE tasks
         SET status = 'completed', completed_at = ?, updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?
           AND status IN ('pending','scheduled','retry_scheduled','running')`,
      )
      .run(now, now, id) as StatementResultingChanges;
    if (result.changes === 1) {
      this.database
        .prepare(
          `UPDATE task_runs
           SET status = 'completed', finished_at = ?
           WHERE task_id = ? AND status = 'running'`,
        )
        .run(now, id);
    }
    return result.changes === 1;
  }

  cancel(id: string, now: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE tasks
         SET status = 'cancelled', updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?
           AND status IN ('pending','scheduled','retry_scheduled','waiting_confirmation')`,
      )
      .run(now, id) as StatementResultingChanges;
    return result.changes === 1;
  }

  hasNotification(dedupeKey: string): boolean {
    return Boolean(
      this.database
        .prepare("SELECT id FROM notifications WHERE dedupe_key = ?")
        .get(dedupeKey),
    );
  }

  recordNotification(input: {
    task: TaskRecord;
    dedupeKey: string;
    title: string;
    body: string;
    status: "pending" | "sent" | "failed";
    now: string;
  }): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO notifications
          (id, task_id, category, priority, dedupe_key, title, body, status, created_at)
         VALUES (?, ?, 'task', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.task.id,
        input.task.priority <= 2 ? "high" : "normal",
        input.dedupeKey,
        input.title,
        input.body,
        input.status,
        input.now,
      );
  }

  markFailure(
    task: TaskRecord,
    input: {
      now: string;
      code: string;
      message: string;
      retryable: boolean;
      nextRetryAt: string;
    },
  ): TaskRecord {
    const retryCount = task.retryCount + 1;
    const shouldRetry = input.retryable && retryCount < task.maxRetryCount;
    const status: TaskStatus = shouldRetry ? "retry_scheduled" : "failed";

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE tasks
           SET status = ?, retry_count = ?, next_run_at = ?,
               lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = ?, last_error_message = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          status,
          retryCount,
          input.nextRetryAt,
          input.code,
          input.message,
          input.now,
          task.id,
        );
      this.database
        .prepare(
          `UPDATE task_runs
           SET status = ?, finished_at = ?, error_code = ?, error_message = ?
           WHERE task_id = ? AND status = 'running'`,
        )
        .run(status === "retry_scheduled" ? "retry_scheduled" : "failed", input.now, input.code, input.message, task.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const updated = this.get(task.id);
    if (!updated) {
      throw new Error("TASK_NOT_FOUND");
    }
    return updated;
  }

  recoverExpiredLeases(now: string): number {
    const expired = this.database
      .prepare(
        `SELECT id FROM tasks
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= ?`,
      )
      .all(now) as unknown as Array<{ id: string }>;
    if (expired.length === 0) {
      return 0;
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const task of expired) {
        this.database
          .prepare(
            `UPDATE tasks
             SET status = 'retry_scheduled', next_run_at = ?,
                 lease_owner = NULL, lease_expires_at = NULL,
                 last_error_code = 'WORKER_LEASE_EXPIRED',
                 last_error_message = '任务执行租约已过期，已安排恢复',
                 updated_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .run(now, now, task.id);
        this.database
          .prepare(
            `UPDATE task_runs
             SET status = 'retry_scheduled', finished_at = ?,
                 error_code = 'WORKER_LEASE_EXPIRED',
                 error_message = '任务执行租约已过期'
             WHERE task_id = ? AND status = 'running'`,
          )
          .run(now, task.id);
      }
      this.database.exec("COMMIT");
      return expired.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createNextOccurrence(task: TaskRecord): TaskRecord | null {
    const nextDueAt = calculateNextOccurrence(
      task.dueAt,
      task.timezone,
      task.recurrence,
    );
    if (!nextDueAt) {
      return null;
    }
    return this.create({
      title: task.title,
      description: task.description,
      dueAt: nextDueAt,
      timezone: task.timezone,
      priority: task.priority,
      idempotencyKey: `recurring:${task.seriesId}:${nextDueAt}`,
      recurrence: task.recurrence,
      seriesId: task.seriesId,
      actionType: task.actionType,
      taskType: task.taskType,
    });
  }

  ensureDailyBriefTask(
    time: string,
    timezone: string,
    now = new Date(),
  ): TaskRecord {
    const seriesId = `daily-brief:${timezone}:${time}`;
    const pending = this.database
      .prepare(
        `SELECT * FROM tasks
         WHERE series_id = ?
           AND status IN ('pending','scheduled','retry_scheduled','running')
         ORDER BY next_run_at ASC LIMIT 1`,
      )
      .get(seriesId) as TaskRow | undefined;
    if (pending) {
      return mapTask(pending);
    }

    const dueAt = nextLocalTime(time, timezone, now);
    return this.create({
      title: "每日总结",
      description: "汇总今日真实任务与记忆，并标明数据源状态。",
      dueAt,
      timezone,
      priority: 2,
      idempotencyKey: `daily-brief:${seriesId}:${dueAt}`,
      recurrence: "daily",
      seriesId,
      actionType: "daily_brief",
      taskType: "maintenance",
    });
  }

  cancelPendingDailyBrief(now = new Date()): number {
    const result = this.database
      .prepare(
        `UPDATE tasks
         SET status = 'cancelled', updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE action_type = 'daily_brief'
           AND status IN ('pending','scheduled','retry_scheduled','waiting_confirmation')`,
      )
      .run(now.toISOString()) as StatementResultingChanges;
    return Number(result.changes);
  }

  private findByIdempotencyKey(key: string): TaskRecord | null {
    const row = this.database
      .prepare("SELECT * FROM tasks WHERE idempotency_key = ?")
      .get(key) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    taskType: row.task_type,
    status: row.status,
    dueAt: row.due_at,
    nextRunAt: row.next_run_at,
    timezone: row.timezone,
    priority: row.priority,
    idempotencyKey: row.idempotency_key,
    recurrence: row.recurrence_kind,
    seriesId: row.series_id,
    occurrenceKey: row.occurrence_key,
    actionType: row.action_type,
    retryCount: row.retry_count,
    maxRetryCount: row.max_retry_count,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
