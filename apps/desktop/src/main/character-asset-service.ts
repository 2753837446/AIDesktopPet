import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CharacterAsset,
  CharacterAssetOrigin,
  CharacterView,
} from "../core/domain";
import { detectImage } from "./character-image";
import {
  SqliteCharacterAssetRepository,
  type StoredCharacterAsset,
} from "./persistence/character-asset-repository";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4_096;
const VALID_VIEWS = new Set<CharacterView>([
  "front",
  "left",
  "right",
  "back",
  "idle",
  "talking",
  "thinking",
  "sleeping",
]);

export class CharacterAssetService {
  private readonly assetsDirectory: string;

  constructor(
    userDataPath: string,
    private readonly repository: SqliteCharacterAssetRepository,
  ) {
    this.assetsDirectory = path.join(userDataPath, "character-assets");
  }

  list(): CharacterAsset[] {
    return this.repository.list();
  }

  async save(input: {
    fileName: string;
    bytes: Uint8Array;
    view: CharacterView;
    displayName?: string;
  }): Promise<CharacterAsset> {
    return this.persist({
      ...input,
      origin: "upload",
      sourceAssetId: null,
      generationPrompt: null,
      generationModel: null,
      generatedAt: null,
    });
  }

  async saveGenerated(input: {
    sourceAssetId: string;
    bytes: Uint8Array;
    instruction: string;
    model: string;
  }): Promise<CharacterAsset> {
    const source = this.repository.get(input.sourceAssetId);
    if (!source) {
      throw new Error("CHARACTER_ASSET_NOT_FOUND");
    }
    const prompt = input.instruction.trim();
    if (!prompt || prompt.length > 500) {
      throw new Error("INVALID_CHARACTER_GENERATION_PROMPT");
    }
    return this.persist({
      fileName: "ai-pose.png",
      bytes: input.bytes,
      view: "idle",
      displayName: `${source.displayName} · AI 姿态`,
      origin: "ai_generated",
      sourceAssetId: source.id,
      generationPrompt: prompt,
      generationModel: input.model.slice(0, 120),
      generatedAt: new Date().toISOString(),
    });
  }

  private async persist(input: {
    fileName: string;
    bytes: Uint8Array;
    view: CharacterView;
    displayName?: string;
    origin: CharacterAssetOrigin;
    sourceAssetId: string | null;
    generationPrompt: string | null;
    generationModel: string | null;
    generatedAt: string | null;
  }): Promise<CharacterAsset> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("INVALID_CHARACTER_IMAGE_SIZE");
    }
    if (!VALID_VIEWS.has(input.view)) {
      throw new Error("INVALID_CHARACTER_VIEW");
    }
    const detected = detectImage(input.bytes);
    if (
      detected.width <= 0 ||
      detected.height <= 0 ||
      detected.width > MAX_IMAGE_DIMENSION ||
      detected.height > MAX_IMAGE_DIMENSION
    ) {
      throw new Error("INVALID_CHARACTER_IMAGE_DIMENSIONS");
    }

    const id = randomUUID();
    const filePath = path.join(
      this.assetsDirectory,
      `${id}.${detected.extension}`,
    );
    const temporaryPath = `${filePath}.tmp`;
    await mkdir(this.assetsDirectory, { recursive: true });
    await writeFile(temporaryPath, input.bytes, { mode: 0o600 });
    await rename(temporaryPath, filePath);

    const displayName =
      input.displayName?.trim().slice(0, 80) ||
      path.parse(input.fileName).name.slice(0, 80) ||
      "自定义桌宠";
    const asset: StoredCharacterAsset = {
      id,
      displayName,
      view: input.view,
      mimeType: detected.mimeType,
      width: detected.width,
      height: detected.height,
      sizeBytes: input.bytes.byteLength,
      origin: input.origin,
      sourceAssetId: input.sourceAssetId,
      generationPrompt: input.generationPrompt,
      generationModel: input.generationModel,
      generatedAt: input.generatedAt,
      createdAt: new Date().toISOString(),
      filePath,
    };
    try {
      this.repository.create(asset);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return asset;
  }

  async read(id: string): Promise<{ asset: CharacterAsset; bytes: Uint8Array }> {
    const asset = this.repository.get(id);
    if (!asset) {
      throw new Error("CHARACTER_ASSET_NOT_FOUND");
    }
    if (!this.isInsideAssetsDirectory(asset.filePath)) {
      throw new Error("CHARACTER_ASSET_PATH_INVALID");
    }
    return {
      asset: toPublicAsset(asset),
      bytes: new Uint8Array(await readFile(asset.filePath)),
    };
  }

  async delete(id: string): Promise<boolean> {
    const asset = this.repository.get(id);
    if (!asset || !this.repository.delete(id)) {
      return false;
    }
    if (this.isInsideAssetsDirectory(asset.filePath)) {
      await unlink(asset.filePath).catch(() => undefined);
    }
    return true;
  }

  private isInsideAssetsDirectory(filePath: string): boolean {
    const relative = path.relative(this.assetsDirectory, path.resolve(filePath));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }
}

function toPublicAsset(asset: StoredCharacterAsset): CharacterAsset {
  return {
    id: asset.id,
    displayName: asset.displayName,
    view: asset.view,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    origin: asset.origin,
    sourceAssetId: asset.sourceAssetId,
    generationPrompt: asset.generationPrompt,
    generationModel: asset.generationModel,
    generatedAt: asset.generatedAt,
    createdAt: asset.createdAt,
  };
}
