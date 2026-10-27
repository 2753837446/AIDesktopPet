export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial core schema",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active','paused','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX idx_conversations_updated ON conversations(updated_at);

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
      CREATE INDEX idx_messages_conversation_time
        ON messages(conversation_id, created_at);

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN
          ('profile','preference','fact','project_decision','event','summary','commitment')),
        origin TEXT NOT NULL
          CHECK(origin IN ('user_explicit','model_inferred','imported','verified')),
        content TEXT NOT NULL,
        normalized_key TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        confidence REAL NOT NULL DEFAULT 0.5
          CHECK(confidence >= 0 AND confidence <= 1),
        importance REAL NOT NULL DEFAULT 0.5
          CHECK(importance >= 0 AND importance <= 1),
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
      CREATE INDEX idx_memories_status_type ON memories(status,type,importance);
      CREATE INDEX idx_memories_project ON memories(project_id,status);

      CREATE TABLE memory_sources (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('message','task','file','connector','user_edit','event')),
        source_id TEXT NOT NULL,
        excerpt TEXT,
        source_status TEXT NOT NULL DEFAULT 'active'
          CHECK(source_status IN ('active','orphaned','deleted')),
        created_at TEXT NOT NULL,
        UNIQUE(memory_id,source_kind,source_id)
      );
      CREATE INDEX idx_memory_sources_source
        ON memory_sources(source_kind,source_id);

      CREATE TABLE memory_candidates (
        id TEXT PRIMARY KEY,
        candidate_type TEXT NOT NULL CHECK(candidate_type IN
          ('profile','preference','fact','project_decision','event','summary','commitment')),
        origin TEXT NOT NULL
          CHECK(origin IN ('user_explicit','model_inferred','imported','verified')),
        content TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        confidence REAL NOT NULL DEFAULT 0.5
          CHECK(confidence >= 0 AND confidence <= 1),
        importance REAL NOT NULL DEFAULT 0.5
          CHECK(importance >= 0 AND importance <= 1),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected','merged','expired')),
        review_reason TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        result_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_memory_candidates_status
        ON memory_candidates(status,created_at);

      CREATE TABLE memory_candidate_sources (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('message','task','file','connector','user_edit','event')),
        source_id TEXT NOT NULL,
        excerpt TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(candidate_id,source_kind,source_id)
      );

      CREATE TABLE memory_chunks (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL
          CHECK(owner_type IN ('memory','message','document')),
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
      CREATE INDEX idx_memory_chunks_status
        ON memory_chunks(embedding_status);

      CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        owner_type UNINDEXED,
        owner_id UNINDEXED,
        text_content,
        tokenize = 'trigram'
      );
    `,
  },
  {
    version: 2,
    name: "persistent tasks and notifications",
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        task_type TEXT NOT NULL
          CHECK(task_type IN ('user','ai_suggestion','automation','maintenance')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN
            ('pending','scheduled','running','waiting_confirmation',
             'retry_scheduled','completed','failed','cancelled','expired',
             'needs_reconciliation')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        due_at TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
        idempotency_key TEXT NOT NULL UNIQUE,
        requires_confirmation INTEGER NOT NULL DEFAULT 0
          CHECK(requires_confirmation IN (0,1)),
        max_retry_count INTEGER NOT NULL DEFAULT 3 CHECK(max_retry_count >= 0),
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
        lease_owner TEXT,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_due
        ON tasks(status, next_run_at);
      CREATE INDEX idx_tasks_lease
        ON tasks(status, lease_expires_at);

      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN
            ('running','retry_scheduled','completed','failed','cancelled')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT,
        trace_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        UNIQUE(task_id,attempt_no)
      );
      CREATE INDEX idx_task_runs_task
        ON task_runs(task_id,started_at);

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        category TEXT NOT NULL
          CHECK(category IN ('task','email','calendar','daily_brief','system')),
        priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
        dedupe_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','partially_sent','sent','failed','dismissed')),
        created_at TEXT NOT NULL,
        user_action TEXT
      );
      CREATE INDEX idx_notifications_status_time
        ON notifications(status,created_at);
    `,
  },
  {
    version: 3,
    name: "memory embeddings and daily briefs",
    sql: `
      CREATE TABLE memory_embeddings (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL UNIQUE REFERENCES memory_chunks(id) ON DELETE CASCADE,
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL CHECK(dimension > 0),
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_memory_embeddings_memory
        ON memory_embeddings(memory_id);

      CREATE TABLE daily_briefs (
        id TEXT PRIMARY KEY,
        brief_date TEXT NOT NULL,
        timezone TEXT NOT NULL,
        content TEXT NOT NULL,
        source_status_json TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(brief_date,timezone)
      );
      CREATE INDEX idx_daily_briefs_created
        ON daily_briefs(created_at);
    `,
  },
  {
    version: 4,
    name: "task recurrence and scheduled daily brief",
    sql: `
      ALTER TABLE tasks ADD COLUMN recurrence_kind TEXT NOT NULL DEFAULT 'none'
        CHECK(recurrence_kind IN ('none','daily','weekdays','weekly'));
      ALTER TABLE tasks ADD COLUMN series_id TEXT;
      ALTER TABLE tasks ADD COLUMN occurrence_key TEXT;
      ALTER TABLE tasks ADD COLUMN action_type TEXT NOT NULL DEFAULT 'notify'
        CHECK(action_type IN ('notify','daily_brief'));
      UPDATE tasks
      SET series_id = id, occurrence_key = id || ':' || due_at
      WHERE series_id IS NULL;
      CREATE UNIQUE INDEX idx_tasks_occurrence_key
        ON tasks(occurrence_key);
      CREATE INDEX idx_tasks_series
        ON tasks(series_id, status);
    `,
  },
  {
    version: 5,
    name: "tool runtime connectors and audit",
    sql: `
      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        risk_level TEXT NOT NULL
          CHECK(risk_level IN ('low','medium','high','critical')),
        required_scopes_json TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN
            ('pending_confirmation','running','completed','failed','cancelled',
             'denied','needs_reconciliation')),
        approval_status TEXT NOT NULL DEFAULT 'not_required'
          CHECK(approval_status IN ('not_required','pending','approved','rejected')),
        approval_id TEXT,
        output_summary TEXT,
        error_code TEXT,
        error_message TEXT,
        trace_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX idx_tool_calls_status_time
        ON tool_calls(status,created_at);

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

      INSERT INTO connectors
        (id, provider, display_name, status, created_at, updated_at)
      VALUES
        ('email-primary', 'unselected', '主邮箱', 'disconnected', datetime('now'), datetime('now'));

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
    `,
  },
  {
    version: 6,
    name: "configure himalaya email connector",
    sql: `
      UPDATE connectors
      SET provider = 'himalaya',
          display_name = 'QQ 邮箱',
          updated_at = datetime('now')
      WHERE id = 'email-primary';
    `,
  },
  {
    version: 7,
    name: "character image assets",
    sql: `
      CREATE TABLE character_assets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        view TEXT NOT NULL DEFAULT 'idle'
          CHECK(view IN
            ('front','left','right','back','idle','talking','thinking','sleeping')),
        mime_type TEXT NOT NULL
          CHECK(mime_type IN ('image/png','image/gif','image/webp')),
        width INTEGER NOT NULL CHECK(width > 0),
        height INTEGER NOT NULL CHECK(height > 0),
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_character_assets_created
        ON character_assets(created_at);
    `,
  },
  {
    version: 8,
    name: "character asset generation lineage",
    sql: `
      CREATE TABLE character_assets_v8 (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        view TEXT NOT NULL DEFAULT 'idle'
          CHECK(view IN
            ('front','left','right','back','idle','talking','thinking','sleeping')),
        mime_type TEXT NOT NULL
          CHECK(mime_type IN
            ('image/png','image/gif','image/webp','image/jpeg')),
        width INTEGER NOT NULL CHECK(width > 0),
        height INTEGER NOT NULL CHECK(height > 0),
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
        file_path TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'upload'
          CHECK(origin IN ('upload','ai_generated')),
        source_asset_id TEXT,
        generation_prompt TEXT,
        generation_model TEXT,
        generated_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (origin = 'upload'
            AND source_asset_id IS NULL
            AND generation_prompt IS NULL
            AND generation_model IS NULL
            AND generated_at IS NULL)
          OR
          (origin = 'ai_generated'
            AND source_asset_id IS NOT NULL
            AND generation_prompt IS NOT NULL
            AND generation_model IS NOT NULL
            AND generated_at IS NOT NULL)
        )
      );

      INSERT INTO character_assets_v8
        (id, display_name, view, mime_type, width, height, size_bytes,
         file_path, origin, source_asset_id, generation_prompt,
         generation_model, generated_at, created_at)
      SELECT
        id, display_name, view, mime_type, width, height, size_bytes,
        file_path, 'upload', NULL, NULL, NULL, NULL, created_at
      FROM character_assets;

      DROP TABLE character_assets;
      ALTER TABLE character_assets_v8 RENAME TO character_assets;

      CREATE INDEX idx_character_assets_created
        ON character_assets(created_at);
      CREATE INDEX idx_character_assets_source
        ON character_assets(source_asset_id);
    `,
  },
];
