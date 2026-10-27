import type { DatabaseSync } from "node:sqlite";
import type {
  CharacterAsset,
  CharacterAssetOrigin,
  CharacterImageMimeType,
  CharacterView,
} from "../../core/domain";

export interface StoredCharacterAsset extends CharacterAsset {
  filePath: string;
}

interface CharacterRow {
  id: string;
  display_name: string;
  view: CharacterView;
  mime_type: CharacterImageMimeType;
  width: number;
  height: number;
  size_bytes: number;
  file_path: string;
  origin: CharacterAssetOrigin;
  source_asset_id: string | null;
  generation_prompt: string | null;
  generation_model: string | null;
  generated_at: string | null;
  created_at: string;
}

export class SqliteCharacterAssetRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(asset: StoredCharacterAsset): void {
    this.database
      .prepare(
        `INSERT INTO character_assets
          (id, display_name, view, mime_type, width, height, size_bytes,
           file_path, origin, source_asset_id, generation_prompt,
           generation_model, generated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        asset.id,
        asset.displayName,
        asset.view,
        asset.mimeType,
        asset.width,
        asset.height,
        asset.sizeBytes,
        asset.filePath,
        asset.origin,
        asset.sourceAssetId,
        asset.generationPrompt,
        asset.generationModel,
        asset.generatedAt,
        asset.createdAt,
      );
  }

  list(): CharacterAsset[] {
    return (
      this.database
        .prepare("SELECT * FROM character_assets ORDER BY created_at DESC")
        .all() as unknown as CharacterRow[]
    ).map(mapAsset);
  }

  get(id: string): StoredCharacterAsset | null {
    const row = this.database
      .prepare("SELECT * FROM character_assets WHERE id = ?")
      .get(id) as CharacterRow | undefined;
    if (!row) {
      return null;
    }
    return { ...mapAsset(row), filePath: row.file_path };
  }

  delete(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM character_assets WHERE id = ?")
      .run(id);
    return Number(result.changes) === 1;
  }
}

function mapAsset(row: CharacterRow): CharacterAsset {
  return {
    id: row.id,
    displayName: row.display_name,
    view: row.view,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    origin: row.origin,
    sourceAssetId: row.source_asset_id,
    generationPrompt: row.generation_prompt,
    generationModel: row.generation_model,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}
