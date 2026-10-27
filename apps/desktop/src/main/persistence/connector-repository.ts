import type { DatabaseSync } from "node:sqlite";
import type { ConnectorRecord } from "../../core/domain";

interface ConnectorRow {
  id: string;
  provider: string;
  display_name: string;
  status: ConnectorRecord["status"];
  granted_scopes_json: string;
  account_label: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteConnectorRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ConnectorRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM connectors ORDER BY display_name ASC")
      .all() as unknown as ConnectorRow[];
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      displayName: row.display_name,
      status: row.status,
      grantedScopes: JSON.parse(row.granted_scopes_json) as string[],
      accountLabel: row.account_label,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  setStatus(
    id: string,
    input: {
      status: ConnectorRecord["status"];
      accountLabel?: string;
      lastError?: string;
      lastSyncAt?: string;
    },
  ): void {
    this.database
      .prepare(
        `UPDATE connectors
         SET status = ?, account_label = COALESCE(?, account_label),
             last_error = ?, last_sync_at = COALESCE(?, last_sync_at),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.accountLabel ?? null,
        input.lastError ?? null,
        input.lastSyncAt ?? null,
        new Date().toISOString(),
        id,
      );
  }
}
