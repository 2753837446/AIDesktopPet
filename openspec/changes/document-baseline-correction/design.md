# 技术设计

## 规范决定

- 任务状态：`pending / scheduled / running / waiting_confirmation / retry_scheduled / completed / failed / cancelled / expired / needs_reconciliation`。
- 记忆类型：`profile / preference / fact / project_decision / event / summary / commitment`。
- 知识来源：`user_explicit / model_inferred / imported / verified`，与渠道类型分离。
- 持久化和 API 时间统一为 UTC RFC 3339；用户时区和 recurrence 规则独立保存。
- 记忆来源以 `memory_sources` 和 `memory_candidate_sources` 为规范关联；关系以 `memory_links` 为唯一来源。
- 项目当前状态和历史版本分表；当前状态不冒充版本历史。
- 任务和事件使用租约、心跳、有限重试恢复；外部动作不确定时进入对账状态。
- 逻辑通知与渠道投递分表；同一逻辑通知可多渠道发送但不能重复投递。
- `local_only` 数据只进入本地处理链路；模型目的地必须在请求契约中显式声明。

## 数据流

1. 用户消息先写入原始记录，再生成候选记忆和来源关联。
2. 记忆写入与索引更新分离；索引失败保留原始事实并进入可重试流程。
3. 调度器领取任务或 recurrence occurrence 的租约，规则层完成权限、免打扰和确认判断。
4. 外部动作结果未知时进入 `needs_reconciliation`，查询真实状态后再决定完成或失败。
5. 删除操作立即阻断读取，FTS、向量、缓存和派生摘要由清理任务完成物理删除。

## 风险

- SQLite 外键、CHECK、JSON 校验和 FTS5 中文检索仍需在选定的 Windows 技术栈中集成测试。
- Connector 的实际能力与授权模型需要按具体服务商验证。
- 视频中的教程配置只能作为产品与架构线索，不能替代官方文档、源码和真实运行验证。
