# 技术设计

## 设置

`ProactiveSettings` 增加：

```text
categories: {
  task / email / calendar / dailyBrief / system: boolean
}
dailyLimit: 1-100
```

旧设置通过 schema default 兼容。

## 通知策略

`NotificationPolicy` 接收当前设置与当日已发送数量：

1. 总开关关闭 -> `proactive_disabled`
2. 类别关闭 -> `category_disabled`
3. 位于免打扰时段 -> `quiet_hours`
4. 当日达到上限 -> `daily_limit`
5. 否则允许。

跨午夜免打扰按本地时间判断，开始等于结束时视为全天免打扰。

## 任务引擎

`TaskNotificationSink.notify` 返回：

```text
sent | suppressed(reason)
```

任务通知类别由 TaskRecord/action 决定：

- 普通任务 -> task
- daily_brief executor -> daily_brief

被抑制时通知记录使用 dismissed 状态，任务正常完成，避免无限重试。

## UI

- 主动性设置增加类别开关和每日上限。
- 文案明确“抑制系统通知不取消任务本身”。
