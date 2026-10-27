# 技术设计

## 数据

migration v11 增加 `calendar_events`：

```text
id, connector_id, external_uid, title, description, location,
starts_at, ends_at, timezone, imported_at
UNIQUE(external_uid, starts_at)
```

Connector ID 使用 `calendar-local`。

## ICS 解析

- 展开 CRLF + 空格续行。
- 提取 BEGIN/END:VEVENT。
- 支持 UTC、本地无时区、全天日期。
- 对文本字段执行 RFC 5545 常用反转义。
- 单文件最大 5 MiB，最多 5,000 个事件。
- 跳过缺少开始时间和标题的事件并报告计数。

## UI 与工具

- 设置页“日历数据源”选择 `.ics` 文件导入。
- 显示 Connector 状态、事件数和最近导入时间。
- Tool `calendar.events.list` 为只读、中风险、modelCallable。
- DailyBriefService 通过查询函数读取当天的真实日程。
