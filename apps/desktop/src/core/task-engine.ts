import { randomUUID } from "node:crypto";
import type { CreateTaskInput, TaskRecord } from "./domain";
import type { NotificationCategory } from "./notification-policy";
import type { SqliteTaskRepository } from "../main/persistence/task-repository";

export type NotificationDeliveryResult =
  | { status: "sent" }
  | { status: "suppressed"; reason: string };

export interface TaskNotificationSink {
  notify(input: {
    title: string;
    body: string;
    dedupeKey: string;
    taskId: string;
    category: NotificationCategory;
  }): Promise<NotificationDeliveryResult>;
}

export type TaskExecutor = (task: TaskRecord) => Promise<void>;

export class TaskEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly executors = new Map<string, TaskExecutor>();

  constructor(
    private readonly repository: SqliteTaskRepository,
    private readonly notifications: TaskNotificationSink,
    private readonly workerId = `desktop-${randomUUID()}`,
  ) {}

  createTask(input: CreateTaskInput): TaskRecord {
    return this.repository.create(input);
  }

  listTasks(limit?: number): TaskRecord[] {
    return this.repository.list(limit);
  }

  completeTask(id: string, now = new Date()): boolean {
    const task = this.repository.get(id);
    const completed = this.repository.complete(id, now.toISOString());
    if (completed && task) {
      this.repository.createNextOccurrence(task);
    }
    return completed;
  }

  cancelTask(id: string, now = new Date()): boolean {
    return this.repository.cancel(id, now.toISOString());
  }

  recover(now = new Date()): number {
    return this.repository.recoverExpiredLeases(now.toISOString());
  }

  registerExecutor(actionType: string, executor: TaskExecutor): void {
    this.executors.set(actionType, executor);
  }

  ensureDailyBrief(
    enabled: boolean,
    time: string,
    timezone: string,
    now = new Date(),
  ): TaskRecord | null {
    if (!enabled) {
      this.repository.cancelPendingDailyBrief(now);
      return null;
    }
    return this.repository.ensureDailyBriefTask(time, timezone, now);
  }

  reconfigureDailyBrief(
    enabled: boolean,
    time: string,
    timezone: string,
    now = new Date(),
  ): TaskRecord | null {
    this.repository.cancelPendingDailyBrief(now);
    return enabled
      ? this.repository.ensureDailyBriefTask(time, timezone, now)
      : null;
  }

  async runDueTasks(now = new Date()): Promise<TaskRecord[]> {
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + 30_000).toISOString();
    const tasks = this.repository.claimDue(
      nowIso,
      this.workerId,
      leaseExpiresAt,
    );
    const settled: TaskRecord[] = [];

    for (const task of tasks) {
      const dedupeKey = `task-due:${task.id}`;
      try {
        if (task.actionType !== "notify") {
          const executor = this.executors.get(task.actionType);
          if (!executor) {
            throw new Error(`TASK_EXECUTOR_NOT_FOUND:${task.actionType}`);
          }
          await executor(task);
        }
        if (!this.repository.hasNotification(dedupeKey)) {
          const body = task.description || `任务「${task.title}」已到期。`;
          const category: NotificationCategory =
            task.actionType === "daily_brief" ? "daily_brief" : "task";
          const delivery = await this.notifications.notify({
            title: "桌宠任务提醒",
            body,
            dedupeKey,
            taskId: task.id,
            category,
          });
          const suppressed =
            delivery.status === "suppressed"
              ? `suppressed:${delivery.reason}`
              : null;
          this.repository.recordNotification({
            task,
            category,
            dedupeKey,
            title: "桌宠任务提醒",
            body,
            status:
              delivery.status === "sent" ? "sent" : "dismissed",
            userAction: suppressed,
            now: nowIso,
          });
        }
        this.repository.complete(task.id, nowIso);
        this.repository.createNextOccurrence(task);
        const updated = this.repository.get(task.id);
        if (updated) {
          settled.push(updated);
        }
      } catch (error) {
        const updated = this.repository.markFailure(task, {
          now: nowIso,
          code: "NOTIFICATION_DELIVERY_FAILED",
          message: error instanceof Error ? error.message : "通知投递失败",
          retryable: true,
          nextRetryAt: new Date(now.getTime() + 60_000).toISOString(),
        });
        settled.push(updated);
      }
    }
    return settled;
  }

  start(intervalMs = 10_000): void {
    if (this.timer) {
      return;
    }
    const tick = async (): Promise<void> => {
      if (this.running) {
        return;
      }
      this.running = true;
      try {
        this.recover();
        await this.runDueTasks();
      } catch (error) {
        console.error("任务调度失败", error);
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
