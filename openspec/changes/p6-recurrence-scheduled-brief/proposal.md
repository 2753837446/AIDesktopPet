# P6 重复任务与自动每日总结

## 背景

当前已支持一次性任务和手动每日总结。P6 需要把本地主动性从“单次提醒”扩展为可持久化的每日、工作日和每周重复任务，并按用户设定时间自动生成每日总结。

## 目标

- 任务增加 none/daily/weekdays/weekly recurrence。
- 使用 IANA 时区计算下一次发生时间，正确处理夏令时。
- 每次完成当前 occurrence 后，自动创建 series 的下一次 occurrence。
- 每日总结作为 action_type=daily_brief 的持久化 maintenance task。
- 设置页支持启用/停用与设置自动生成时间。
- 使用 Task Engine executor 扩展任务动作，保持通知与业务执行解耦。

## 成功标准

- 重复任务完成后只创建一次下一次 occurrence。
- 工作日任务跳过周末；每日任务跨 DST 保持本地时间。
- 每日总结任务在设定时间生成一次，并继续排下一次。
- 应用重启后当前 occurrence 和 series 仍可恢复。
- 单元、E2E、打包和真实服务回归通过。

## 不做

- 不实现 RRULE 全语法、任意间隔或复杂日历规则。
- 本轮不接入邮箱或日历 Connector。
