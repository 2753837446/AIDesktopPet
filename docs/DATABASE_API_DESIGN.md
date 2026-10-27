# DATABASE_API_DESIGN.md｜数据库与接口详细设计

*SQLite 数据模型、SQL 草案、索引策略、一致性、隐私与迁移规范*

版本 V0.2 · 2026-10-27

# 1. 设计约束

- 本设计为可执行的 V0.2 数据模型基线；具体 SQL 方言、向量扩展和加密实现需在选定依赖后通过集成测试确认。
- SQLite 为首选本地数据库。持久化和接口层统一使用 UTC RFC 3339 文本，例如 `2026-10-27T12:00:00.000Z`；用户时区只用于输入、展示和本地调度计算。
- 数据库记录是事实来源；全文索引、向量索引、摘要缓存都是可重建派生数据。
- 删除、冲突更新、索引同步必须可追踪；高风险动作与权限决策进入审计记录。

# 2. 表清单与职责

| 表 | 职责 | 关键关系 |
| --- | --- | --- |
| schema_migrations | 数据库版本与迁移记录 | 版本递增 |
| conversations | 会话元数据 | 1:N messages |
| messages | 原始对话记录 | 可被 memory_sources 引用 |
| projects | 项目 / 工作空间 | 1:N project_state_current、project_state_versions、memories、tasks |
| project_state_current | 项目当前摘要与状态 | 与 projects 一对一 |
| project_state_versions | 项目状态历史版本 | 每次变化追加版本 |
| memories | 确认后的记忆事实 / 偏好 / 决策 / 事件 | 可 supersede |
| memory_candidates | 待审核或待提交记忆 | 候选到正式记忆 |
| memory_candidate_sources | 候选记忆来源关联 | candidate ↔ source |
| memory_sources | 记忆来源关联 | memory ↔ source |
| memory_links | 记忆关系 | 支持、冲突、替代、派生 |
| memory_chunks | 向量检索文本片段 | 指向 memory / message / document |
| tasks | 任务定义与当前状态 | 1:N task_runs |
| task_runs | 每次任务执行记录 | 可重试、可审计 |
| task_schedule_occurrences | 重复任务的具体调度实例 | 防重复调度 |
| events | 外部或内部事件队列 | 去重处理 |
| notifications | 逻辑通知记录 | 分类、优先级和幂等 |
| notification_deliveries | 各渠道通知投递记录 | 同一通知多渠道投递 |
| automation_rules | 主动任务规则 | 关联权限与触发器 |
| connectors | 外部连接器授权元数据 | 不保存明文密钥 |
| audit_logs | 权限、记忆修改、工具执行等审计 | 可按 trace_id 检索 |
| settings | 非敏感用户配置 | 敏感密钥单独存储 |
| cleanup_jobs | 异步清理索引、缓存和派生数据 | 可重试、可观测 |

# 3. 核心 SQL 草案

以下 SQL 以 SQLite 为目标。实际执行前应在迁移测试中验证 CHECK、外键、JSON 字段约束与索引兼容性。建议启动时启用 foreign_keys，并使用事务执行迁移。

```text
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'chat',
  retention_status TEXT NOT NULL DEFAULT 'active'
    CHECK(retention_status IN ('active','archived','deleted')),
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_project_time ON messages(project_id, created_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','paused','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_state_current (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL DEFAULT '{}',
  summary_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE project_state_versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, version)
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN
    ('profile','preference','fact','project_decision','event','summary','commitment')),
  origin TEXT NOT NULL
    CHECK(origin IN ('user_explicit','model_inferred','imported','verified')),
  content TEXT NOT NULL,
  normalized_key TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','superseded','archived','deleted')),
  privacy_level TEXT NOT NULL DEFAULT 'normal'
    CHECK(privacy_level IN ('normal','sensitive','local_only')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_confirmed_at TEXT,
  expires_at TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK(origin <> 'model_inferred' OR confidence < 1.0)
);

CREATE INDEX idx_memories_origin_status ON memories(origin,status);
CREATE INDEX idx_memories_project_type_status ON memories(project_id,type,status);
CREATE INDEX idx_memories_updated_at ON memories(updated_at);
CREATE INDEX idx_memories_normalized_key ON memories(normalized_key);

CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,
  candidate_type TEXT NOT NULL CHECK(candidate_type IN
    ('profile','preference','fact','project_decision','event','summary','commitment')),
  origin TEXT NOT NULL
    CHECK(origin IN ('user_explicit','model_inferred','imported','verified')),
  content TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','merged','expired')),
  review_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  result_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_memory_candidates_status_time ON memory_candidates(status,created_at);

CREATE TABLE memory_candidate_sources (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('message','task','file','connector','user_edit','event')),
  source_id TEXT NOT NULL,
  excerpt TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(candidate_id, source_kind, source_id)
);

CREATE TABLE memory_sources (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('message','task','file','connector','user_edit','event')),
  source_id TEXT NOT NULL,
  excerpt TEXT,
  source_status TEXT NOT NULL DEFAULT 'active'
    CHECK(source_status IN ('active','orphaned','deleted')),
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, source_kind, source_id)
);
CREATE INDEX idx_memory_sources_source ON memory_sources(source_kind,source_id);

CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('related_to','supports','contradicts','supersedes','derived_from')),
  created_at TEXT NOT NULL,
  CHECK(from_memory_id <> to_memory_id),
  UNIQUE(from_memory_id,to_memory_id,relation)
);

CREATE TABLE memory_chunks (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('memory','message','document')),
  owner_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  text_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  embedding_version TEXT,
  vector_ref TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(embedding_status IN ('pending','indexed','failed','excluded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_type,owner_id,chunk_index,content_hash)
);
CREATE INDEX idx_memory_chunks_status ON memory_chunks(embedding_status);

CREATE TABLE cleanup_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','completed','failed')),
  attempt_no INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cleanup_jobs_status_time ON cleanup_jobs(status,next_attempt_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL CHECK(task_type IN ('user','ai_suggestion','automation','maintenance')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','scheduled','running','waiting_confirmation','retry_scheduled','completed','failed','cancelled','expired','needs_reconciliation')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  due_at TEXT,
  next_run_at TEXT,
  schedule_rule_json TEXT,
  timezone TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  idempotency_key TEXT UNIQUE,
  requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK(requires_confirmation IN (0,1)),
  permission_scope_json TEXT NOT NULL DEFAULT '[]',
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_tasks_status_due ON tasks(status,next_run_at);
CREATE INDEX idx_tasks_lease ON tasks(status,lease_expires_at);
CREATE INDEX idx_tasks_project_status ON tasks(project_id,status);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('running','waiting_confirmation','retry_scheduled','completed','failed','cancelled','needs_reconciliation')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  input_summary TEXT,
  output_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  trace_id TEXT,
  idempotency_key TEXT UNIQUE,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(task_id,attempt_no)
);
CREATE INDEX idx_task_runs_task_time ON task_runs(task_id,started_at);

CREATE TABLE task_schedule_occurrences (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  occurrence_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','claimed','completed','skipped','failed','cancelled')),
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_task_occurrences_due ON task_schedule_occurrences(status,scheduled_for);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','processed','failed','ignored')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  next_retry_at TEXT,
  processed_at TEXT,
  error_message TEXT
);
CREATE INDEX idx_events_status_time ON events(status,received_at);
CREATE INDEX idx_events_lease ON events(status,lease_expires_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK(category IN ('task','email','calendar','daily_brief','system')),
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','partially_sent','sent','failed','dismissed')),
  created_at TEXT NOT NULL,
  user_action TEXT
);
CREATE INDEX idx_notifications_status_time ON notifications(status,created_at);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('pet_bubble','system_toast','task_panel','daily_brief')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sent','failed','dismissed')),
  sent_at TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(notification_id,channel)
);
CREATE INDEX idx_notification_deliveries_status ON notification_deliveries(status,created_at);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  action_template_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  permission_scope_json TEXT NOT NULL DEFAULT '[]',
  quiet_hours_json TEXT NOT NULL DEFAULT '{}',
  rate_limit_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK(status IN ('disconnected','connected','expired','error')),
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  account_label TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  reason TEXT,
  trace_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_time_action ON audit_logs(occurred_at,action);
CREATE INDEX idx_audit_trace ON audit_logs(trace_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

# 4. 全文搜索与向量索引

## 4.1 FTS5

```text
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  owner_type UNINDEXED,
  owner_id UNINDEXED,
  text_content,
  tokenize = 'unicode61'
);
```

FTS 索引通过应用层事务或可靠的索引任务与 `memory_chunks` 同步，统一覆盖结构化记忆、原始消息和授权文件片段。需要测试中文切词效果；SQLite FTS5 默认 tokenizer 对中文连续文本的词项检索能力有限，可能需要 n-gram 分词预处理或另外的中文全文索引策略。FTS5 是准确词项补充，不应假定其天然具备高质量中文分词。

## 4.2 向量索引

- BGE-M3 生成 embedding，应用保存 embedding_model、维度、版本和文本 hash。
- `memory_chunks` 保存向量模型、维度、版本和可重建的 `vector_ref`；原始文本仍是权威数据。
- 向量索引仅存储可重建向量；原始记忆与片段仍是权威数据。
- 确认所用向量扩展对目标 Windows、CPU 架构、打包方式和 SQLite 版本的支持。
- embedding 模型升级后使用版本化索引，分批重建，不要覆盖旧索引后才发现不兼容。

# 5. 事务与一致性规则

- 创建 / 更新记忆时：先写结构化事实和来源，再安排索引更新；索引失败不得回滚掉原始事实。
- 删除记忆时：在一个事务中标记删除、写入 `deleted_at` 和审计记录；所有读取接口必须立即过滤该记录。随后删除 FTS / 向量条目、缓存与派生摘要，若某步骤失败进入 `cleanup_jobs`，但 `cleanup_jobs` 未完成不得重新暴露该记录。
- 删除原始消息时：移除对应 `memory_sources.excerpt` 并把来源标为 `deleted`；若派生记忆只依赖该来源，则把记忆标为不可检索并加入复核 / 清理队列。
- 任务执行时：先创建 task_run 并取得执行租约，再调用外部工具；结束时更新 task_run 和 tasks 状态。
- 任务或事件租约过期后由启动恢复流程重新领取；外部动作结果未知时进入 `needs_reconciliation`，不得直接重试。
- 重复事件由 events.dedupe_key 唯一约束兜底，业务层仍需检查执行幂等。
- 重复任务通过 `task_schedule_occurrences.occurrence_key` 唯一约束防止同一计划时间重复生成。
- 不要把外部 API 调用放在长时间数据库事务中。

# 6. 数据保留与隐私

- 提供记忆导出、备份、恢复和用户触发的删除。
- 支持 local_only 记忆不发送到云端模型；上下文组装必须接收明确的模型处理目的地，并在发请求前按隐私级别过滤。
- API Key / OAuth refresh token 不存入 settings.value_json；存入操作系统凭据库或经过验证的安全方案。
- 日志只记录必要摘要，避免持久化完整邮件正文、访问令牌或敏感文件内容。
- 对话保留期限和自动清理规则应可配置，并在 UI 说明。

# 7. 数据迁移与验收

1. 每次迁移使用单一事务并记录版本号；SQL 草案执行前先验证所有前向引用和建表顺序。
2. 迁移前检测磁盘空间并备份数据库；失败后不继续启动写入流程。
3. 提供 schema version 检查和诊断命令。
4. 对外键、唯一键、重复事件、任务恢复和删除传播建立集成测试。
5. 验证数据库在应用升级、异常退出、断电后能正常打开和恢复。

# 8. 需要在实现前确认的工程选择

| 决策 | 推荐默认 | 验证方式 |
| --- | --- | --- |
| SQLite binding | 选用成熟且与 Electron 打包兼容的 binding | Windows clean install + rebuild test |
| 向量索引 | 先验证可嵌入本地的向量扩展；不合适则用独立本地索引模块 | 召回、延迟、安装体积、升级兼容性 |
| Embedding 推理 | 先支持 API provider；本地模型作为后续选项 | 隐私、费用、速度和离线需求对比 |
| 中文全文检索 | FTS5 + 中文预处理 / n-gram 方案 | 中英文混合检索基准集 |
| 密钥存储 | Windows Credential Manager / OS credential store 封装 | 安装包、用户权限、卸载和备份测试 |
