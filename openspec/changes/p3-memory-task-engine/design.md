# 技术设计

## 记忆中心

- repository 增加 list、update、delete。
- 更新记忆时在同一事务中替换 chunk / FTS 内容。
- 删除采用隐私优先的墓碑：清空 content 和 excerpt，删除 chunks / FTS，status=deleted。
- 搜索和列表默认只返回 active 记录。

## 任务数据

migration v2 新增：

- `tasks`：任务定义、调度时间、状态、租约、幂等键和最大重试次数。
- `task_runs`：每次执行记录和错误。
- `notifications`：逻辑通知与 dedupe key。

## 状态机

- create：`pending -> scheduled`
- scheduler：`scheduled/retry_scheduled -> running`
- 成功：`running -> completed`
- 可重试失败：`running -> retry_scheduled`
- 超过上限：`running -> failed`
- 用户完成：`scheduled -> completed`
- 用户取消：`pending/scheduled/retry_scheduled -> cancelled`
- 崩溃恢复：过期 running 租约转为 retry_scheduled

## 幂等

- task.idempotency_key 唯一。
- 通知 dedupe key 为 `task-due:<taskId>`。
- claim due task 使用事务和条件更新，防止两个 scheduler 同时执行。

## UI

- 设置页提供“记忆中心”和“任务中心”入口。
- 记忆中心支持搜索、编辑、删除确认和来源数量。
- 任务中心支持标题、时间、创建、完成和取消。
- 任务面板定期刷新，scheduler 在主进程每 10 秒检查一次。
