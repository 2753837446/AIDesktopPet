import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations";

export interface OpenedDatabase {
  database: DatabaseSync;
  schemaVersion: number;
  path: string;
}

export function openDatabase(databasePath: string): OpenedDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");
  if (databasePath !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const schemaVersion = migrate(database);
  return { database, schemaVersion, path: databasePath };
}

function migrate(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  let version = row.version;

  for (const migration of migrations) {
    if (migration.version <= version) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
      version = migration.version;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return version;
}
