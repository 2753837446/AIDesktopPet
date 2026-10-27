# TASK_ENGINE.md｜主动任务与事件引擎设计

*面向桌宠每日总结、提醒、自动化执行、失败恢复与主动反馈*

版本：V0.2 · 日期：2026-10-27

# 1. 设计目标

- 将“主动性”建立在可靠、可恢复的任务系统上，而不是依赖模型自己记得定时执行。
- 支持一次性任务、重复任务、事件触发任务和每日总结。
- 应用重启、网络中断或任务失败后可恢复状态，避免重复执行。
- AI 只在需要语义理解、总结或建议时参与；确定性规则优先。
- 对外部有影响的操作必须经过权限校验和用户确认。

# 2. 任务分类

| 类型 | 定义 | 示例 | 创建规则 |
| --- | --- | --- | --- |
| 用户任务 | 用户明确创建的待办 | 明天下午整理项目文档 | 用户直接确认 |
| AI 建议任务 | AI 根据上下文提出的建议 | 建议本周完成邮箱接入验证 | 用户确认后进入正式任务列表 |
| 自动化任务 | 按时间或条件自动执行 | 每天 9:00 生成简报 | 用户明确启用并授权 |
| 系统维护任务 | 后台索引、备份、记忆整理 | 重建向量索引 | 受系统策略控制并可观测 |

# 3. 任务状态机

```text
pending -> scheduled -> running
running -> waiting_confirmation / completed / failed / cancelled / needs_reconciliation
waiting_confirmation -> running / cancelled / expired
failed -> retry_scheduled / cancelled / needs_reconciliation
retry_scheduled -> running / cancelled / expired
needs_reconciliation -> completed / failed / cancelled
pending/scheduled -> cancelled
pending/scheduled -> expired
```

状态转换必须经过统一服务校验，不能由模型任意写入。等待用户确认的任务不应自动绕过确认步骤。

## 状态定义

| 状态 | 含义 | 可执行动作 |
| --- | --- | --- |
| pending | 已创建但尚未到执行条件 | 编辑、安排、取消 |
| scheduled | 已进入调度队列 | 延期、取消 |
| running | 正在执行 | 查看进度、按安全规则取消 |
| waiting_confirmation | 需要用户批准下一步 | 批准、拒绝、修改 |
| completed | 已成功完成 | 查看结果、必要时重新运行 |
| failed | 执行失败 | 查看原因、重试、取消 |
| retry_scheduled | 已安排有限次数重试 | 等待下一次执行、取消 |
| cancelled | 用户或系统取消 | 查看记录 |
| expired | 超过有效期且不再执行 | 重新安排或关闭 |
| needs_reconciliation | 外部动作可能已提交但结果不确定 | 查询外部状态、确认结果、人工处理 |

# 4. 核心组件

- Task Store：持久化任务定义、状态、计划时间和结果。
- Scheduler：计算到期任务并在应用重启后恢复；不要只依赖内存计时器。
- Event Bus：接收邮件到达、任务完成、文件变化、系统启动等事件。
- Rule Engine：判断触发条件、免打扰、优先级、频率限制和确认要求。
- Executor：调用工具或 Agent 执行步骤，并记录输入输出摘要。
- Notifier：桌宠气泡、系统通知、任务面板和每日简报。
- Retry Manager：基于错误类别、重试次数和退避策略安排重试。
- Audit Log：记录每次触发、授权、执行、失败、确认和通知。

# 5. 事件驱动主动反馈

| 事件源 | 触发示例 | 是否需要模型 |
| --- | --- | --- |
| 时间 | 每日 9:00 生成总结 | 汇总数据后可按需调用 |
| 任务状态 | 任务失败、即将到期、完成 | 错误分类可规则化，解释建议可调用模型 |
| 邮件连接器 | 新邮件到达或受控轮询发现新邮件 | 仅对筛选后的重要邮件调用模型 |
| 日历连接器 | 会议变更、即将开始 | 简单提醒不需要模型 |
| 项目状态 | 约定周期内没有进展 | 规则先判断，模型可生成温和建议 |
| 记忆状态 | 发现决定冲突或未完成承诺 | 通常需要检索与模型辅助判断 |

# 6. 防重复与幂等

- 每个逻辑事件生成稳定 event_id 或 idempotency_key。
- 每条通知记录已发送状态，重启或重复事件到达时不得重复通知。
- 任务执行前检查是否已有相同 key 的成功执行记录。
- 外部操作要区分“请求已发送但响应丢失”的不确定状态，不能盲目重试造成重复发送。
- 重试使用有限次数与退避间隔，并根据错误类别区分可重试和不可重试。

# 7. 主动性与免打扰

- 设置全局主动性等级：安静、标准、积极；每种等级映射到明确规则，不让模型自由决定通知频率。
- 支持免打扰时段、每日通知上限、按类别关闭、重要级别阈值。
- 同一主题可合并为一条摘要通知，避免短时间连续弹窗。
- 用户忽略提醒后可按规则降低该类提醒优先级，但不能未经允许永久取消关键安全通知。
- 每条主动反馈要展示“为什么提醒你”或可展开的触发原因。

# 8. 权限与风险分级

| 风险级别 | 示例 | 默认策略 |
| --- | --- | --- |
| 低 | 生成本地摘要、展示待办 | 可自动执行 |
| 中 | 读取用户已授权的邮件、打开文件 | 按授权范围执行并记录 |
| 高 | 发送邮件、删除文件、向外部服务提交内容 | 执行前用户确认 |
| 极高 | 付款、不可逆删除、敏感数据外传 | 默认禁止自动执行，需明确二次确认或不支持 |

# 9. 数据结构建议

- tasks：id、title、description、type、status、schedule_rule、due_at、next_run_at、timezone、priority、project_id、idempotency_key、requires_confirmation、lease_owner、lease_expires_at、heartbeat_at、created_at、updated_at。
- task_runs：id、task_id、started_at、finished_at、status、input_summary、output_summary、error_code、error_message、retry_count、lease_owner、lease_expires_at、heartbeat_at、trace_id。
- task_schedule_occurrences：id、task_id、scheduled_for、occurrence_key、status、created_at、claimed_at、finished_at；`occurrence_key` 唯一，防止重复调度。
- events：id、source、event_type、occurred_at、payload_ref、dedupe_key、status、lease_owner、lease_expires_at、retry_count、next_retry_at、processed_at。
- notifications：id、event_id、task_id、category、priority、title、body、status、dedupe_key、created_at、user_action。
- notification_deliveries：id、notification_id、channel、status、sent_at、last_error；同一逻辑通知可向多个渠道投递，`UNIQUE(notification_id, channel)` 防止重复投递。
- automation_rules：id、trigger_type、conditions、action_template、enabled、permission_scope、quiet_hours、rate_limit。

# 10. 每日总结流程

1. 调度器到达用户设定的时间。
2. 读取已授权的数据源：任务、日历、邮件摘要、本地工作记录和用户允许使用的记忆。
3. 先去重并按优先级整理，不可访问的数据源明确标记未连接。
4. 简单统计由规则处理；需要归纳或建议时调用模型。
5. 生成结构化摘要：今日重点、日程、待办、风险、建议。
6. 保存总结结果与来源时间范围。
7. 通过桌宠展示；允许用户追问、完成任务、延期或关闭某项提醒。

未接入邮箱时不能假装读取邮件；数据源失败时应展示部分总结和失败说明，而不是生成虚构内容。

# 11. 失败恢复与可观测性

- 启动时扫描未完成任务、过期租约和待重试任务。
- 启动时同时扫描处于 `processing` 且租约过期的外部事件，按幂等键恢复处理。
- 运行任务应使用租约或超时机制，防止崩溃后永远停留在 running。
- 外部动作结果不确定时进入 `needs_reconciliation`，先查询真实状态，不盲目重试。
- 记录任务排队时间、执行耗时、模型耗时、工具耗时和错误类别。
- 为重试设置上限；超过上限后通知用户并提供诊断信息。
- 支持导出诊断日志，但日志中应尽量避免明文保存 API Key、邮件正文和敏感内容。

# 12. 验收测试

- 应用运行时创建提醒，关闭并重启后仍按预期执行。
- 断网时任务进入可解释状态，恢复网络后按策略继续。
- 同一事件重复到达不会重复执行或重复通知。
- 免打扰时段不弹普通通知，重要事件遵循用户配置策略。
- 等待确认的任务在用户批准前不执行高风险动作。
- 任务失败显示原因、重试选项和日志关联 ID。
- 每日总结只使用实际可用的数据源，并标明时间范围。
- 重复任务在时区 / 夏令时变化时按已定义规则执行。
- 同一 recurrence 的 `occurrence_key` 重复生成时只保留一个实例。

# 13. 推荐开发顺序

1. 先实现任务表、任务状态机和单次提醒。
2. 加入持久化调度与重启恢复。
3. 加入幂等、执行日志和有限重试。
4. 实现每日总结（先用本地任务数据）。
5. 实现事件总线和统一通知中心。
6. 接入一个外部连接器，例如用户选择的主邮箱。
7. 最后增加 AI 主动建议和项目跟进，逐步通过真实反馈调参。
