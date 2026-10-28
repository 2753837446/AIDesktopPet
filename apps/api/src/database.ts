import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpenedDatabase {
  database: DatabaseSync;
  schemaVersion: number;
}

export function openDatabase(databasePath: string): OpenedDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  migrate(database);
  const row = database
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  return { database, schemaVersion: row.version };
}

function migrate(database: DatabaseSync): void {
  const version = (
    database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number }
  ).version;
  if (version >= 1) {
    return;
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX idx_devices_workspace ON devices(workspace_id, revoked_at);

      CREATE TABLE assistants (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        persona_json TEXT NOT NULL,
        appearance_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_assistants_workspace ON assistants(workspace_id, deleted_at);

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_conversations_assistant
        ON conversations(assistant_id, updated_at);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_messages_conversation
        ON messages(conversation_id, created_at);

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        assistant_id TEXT REFERENCES assistants(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK(scope IN ('personal','assistant','project')),
        type TEXT NOT NULL CHECK(type IN
          ('profile','preference','fact','project_decision','event','commitment')),
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5
          CHECK(importance >= 0 AND importance <= 1),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_memories_workspace
        ON memories(workspace_id, deleted_at, scope);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        assistant_id TEXT REFERENCES assistants(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open','completed')),
        due_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_tasks_workspace
        ON tasks(workspace_id, status, due_at);

      CREATE TABLE sync_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sync_workspace
        ON sync_events(workspace_id, sequence);
    `);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)",
      )
      .run("personal companion foundation", new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function nextRevision(
  database: DatabaseSync,
  workspaceId: string,
): number {
  database
    .prepare("UPDATE workspaces SET revision = revision + 1 WHERE id = ?")
    .run(workspaceId);
  return (
    database
      .prepare("SELECT revision FROM workspaces WHERE id = ?")
      .get(workspaceId) as { revision: number }
  ).revision;
}

export function recordSyncEvent(
  database: DatabaseSync,
  input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    operation: string;
    revision: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO sync_events
        (workspace_id, entity_type, entity_id, operation, revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.workspaceId,
      input.entityType,
      input.entityId,
      input.operation,
      input.revision,
      new Date().toISOString(),
    );
}

export function createId(): string {
  return randomUUID();
}
