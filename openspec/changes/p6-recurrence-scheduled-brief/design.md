# 技术设计

## 任务 schema

migration v4 增加：

- recurrence_kind：none / daily / weekdays / weekly。
- series_id：同一重复系列。
- occurrence_key：series_id + due_at，唯一。
- action_type：notify / daily_brief。

## 时间计算

使用 Luxon 和 IANA timezone：

- daily：本地日历日 +1。
- weekly：本地日历日 +7。
- weekdays：+1 天直到周一至周五。
- 转换回 UTC ISO 后持久化。

## 执行

- Task Engine 维护 action executor 注册表。
- notify 动作仅发送系统通知。
- daily_brief 动作先生成每日总结，再发送完成通知。
- 成功完成当前 occurrence 后创建下一次 occurrence；幂等键包含 series 和 due time。

## 每日总结

- DesktopSettings 增加 dailyBrief.enabled / time。
- 启动时确保存在一个待执行 daily_brief occurrence。
- 修改设置时取消旧的待执行 occurrence，并按新时间重建。
