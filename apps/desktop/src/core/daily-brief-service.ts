import type {
  CalendarEventRecord,
  DailyBriefRecord,
  MemorySearchResult,
  TaskRecord,
} from "./domain";
import type { ModelProvider } from "./ports";
import type { MemoryService } from "./memory-service";
import type { SqliteDailyBriefRepository } from "../main/persistence/daily-brief-repository";

export class DailyBriefService {
  constructor(
    private readonly memories: MemoryService,
    private readonly listTasks: () => TaskRecord[],
    private readonly repository: SqliteDailyBriefRepository,
    private readonly model: ModelProvider,
    private readonly listCalendarEvents: (
      date: string,
      timezone: string,
    ) => { connected: boolean; events: CalendarEventRecord[] } = () => ({
      connected: false,
      events: [],
    }),
  ) {}

  latest(): DailyBriefRecord | null {
    return this.repository.latest();
  }

  async generate(now = new Date()): Promise<DailyBriefRecord> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const briefDate = dateInTimezone(now, timezone);
    const tasks = this.listTasks().filter((task) => {
      const dueDate = dateInTimezone(new Date(task.dueAt), timezone);
      const completedDate = task.completedAt
        ? dateInTimezone(new Date(task.completedAt), timezone)
        : "";
      return dueDate === briefDate || completedDate === briefDate;
    });
    const memories = this.memories
      .list({ limit: 200 })
      .filter(
        (memory) =>
          memory.privacyLevel !== "local_only" &&
          dateInTimezone(new Date(memory.updatedAt), timezone) === briefDate,
      );
    const calendar = this.listCalendarEvents(briefDate, timezone);

    const sourceStatus: DailyBriefRecord["sourceStatus"] = {
      tasks: "available",
      memories: "available",
      email: "not_connected",
      calendar: calendar.connected ? "available" : "not_connected",
    };

    if (
      tasks.length === 0 &&
      memories.length === 0 &&
      calendar.events.length === 0
    ) {
      return this.repository.save({
        briefDate,
        timezone,
        content: calendar.connected
          ? "今天目前没有已到期的任务、新的长期记忆或日程。邮件尚未连接。"
          : "今天目前没有已到期的任务，也没有新的长期记忆。邮件和日历尚未连接。",
        sourceStatus,
        model: "local-deterministic",
      });
    }

    const prompt = [
      `日期：${briefDate}`,
      `任务：\n${formatTasks(tasks)}`,
      `长期记忆：\n${formatMemories(memories)}`,
      `今日日程：\n${formatCalendarEvents(calendar.events, timezone)}`,
      "请用中文生成简洁的今日总结，包含：今日重点、待办与风险、简短的下一步建议。",
      "只能使用上面给出的数据；不要编造邮件、日历或已完成动作。",
    ].join("\n\n");
    let content = "";
    for await (const delta of this.model.chat({
      messages: [
        {
          role: "system",
          content:
            "你是本地桌宠的每日总结助手。输出纯文本，不得虚构数据源或执行结果。",
        },
        { role: "user", content: prompt },
      ],
    })) {
      content += delta;
    }
    if (!content.trim()) {
      throw new Error("DAILY_BRIEF_EMPTY_RESPONSE");
    }

    return this.repository.save({
      briefDate,
      timezone,
      content: content.trim(),
      sourceStatus,
      model: this.model.modelName,
    });
  }
}

function formatCalendarEvents(
  events: CalendarEventRecord[],
  timezone: string,
): string {
  if (events.length === 0) {
    return "无";
  }
  return events
    .map((event) => {
      const start = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(event.startsAt));
      const end = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(event.endsAt));
      return `- ${start}-${end} ${event.title}${
        event.location ? ` @ ${event.location}` : ""
      }`;
    })
    .join("\n");
}

function formatTasks(tasks: TaskRecord[]): string {
  if (tasks.length === 0) {
    return "无";
  }
  return tasks
    .map(
      (task) =>
        `- [${task.status}] ${task.title}；截止 ${task.dueAt}${task.description ? `；${task.description}` : ""}`,
    )
    .join("\n");
}

function formatMemories(memories: MemorySearchResult[]): string {
  if (memories.length === 0) {
    return "无";
  }
  return memories
    .map((memory) => `- [${memory.type}/${memory.origin}] ${memory.content}`)
    .join("\n");
}

export function dateInTimezone(date: Date, timezone: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
