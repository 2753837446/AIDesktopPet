import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CharacterAsset } from "../core/domain";
import type {
  DesktopSettings,
  DesktopSettingsPatch,
} from "../shared/settings";
import { CharacterAssetService } from "./character-asset-service";

const manifestSchema = z
  .object({
    schema: z.literal("ai-desktop-pet/character-preset"),
    version: z.literal(1),
    key: z.string().regex(/^[a-z0-9-]{1,80}$/),
    characterName: z.string().trim().min(1).max(30),
    description: z.string().trim().min(1).max(1_000),
    tone: z.string().trim().min(1).max(500),
    defaultView: z.enum([
      "front",
      "left",
      "right",
      "back",
      "idle",
      "talking",
      "thinking",
      "sleeping",
    ]),
    sourceImage: z.string().min(1).max(200),
    assets: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9-]{1,80}$/),
            file: z.string().min(1).max(200),
            view: z.enum([
              "front",
              "left",
              "right",
              "back",
              "idle",
              "talking",
              "thinking",
              "sleeping",
            ]),
            displayName: z.string().trim().min(1).max(80),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export interface ImportedCharacterPreset {
  manifest: z.infer<typeof manifestSchema>;
  assets: CharacterAsset[];
  defaultAsset: CharacterAsset;
  importedKeys: string[];
}

export function createPresetSettingsPatch(
  current: DesktopSettings,
  preset: ImportedCharacterPreset,
  knownAssetIds: ReadonlySet<string>,
): DesktopSettingsPatch {
  const patch: DesktopSettingsPatch = {};
  if (
    !current.appearance.customCharacterId ||
    !knownAssetIds.has(current.appearance.customCharacterId)
  ) {
    patch.appearance = {
      customCharacterId: preset.defaultAsset.id,
    };
  }
  if (
    current.persona.preset === "azure" &&
    current.persona.name === "阿湛"
  ) {
    patch.persona = {
      preset: "custom",
      name: preset.manifest.characterName,
      description: preset.manifest.description,
      tone: preset.manifest.tone,
    };
  }
  return patch;
}

export class BundledCharacterPresetService {
  constructor(
    private readonly assets: CharacterAssetService,
    private readonly presetsDirectory: string,
  ) {}

  async importAll(): Promise<ImportedCharacterPreset[]> {
    const entries = await readdir(this.presetsDirectory, {
      withFileTypes: true,
    });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const imported: ImportedCharacterPreset[] = [];
    for (const directoryName of directories) {
      imported.push(
        await this.importDirectory(path.join(this.presetsDirectory, directoryName)),
      );
    }
    return imported;
  }

  private async importDirectory(directory: string): Promise<ImportedCharacterPreset> {
    const manifestPath = path.join(directory, "preset.json");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    const assetKeys = new Set<string>();
    const importedKeys: string[] = [];
    const assets: CharacterAsset[] = [];

    for (const item of manifest.assets) {
      if (assetKeys.has(item.key)) {
        throw new Error(`DUPLICATE_CHARACTER_PRESET_ASSET:${item.key}`);
      }
      assetKeys.add(item.key);
      const filePath = resolveInside(directory, item.file);
      const imported = await this.assets.importPreset({
        presetKey: item.key,
        fileName: item.file,
        bytes: new Uint8Array(await readFile(filePath)),
        view: item.view,
        displayName: item.displayName,
      });
      assets.push(imported.asset);
      if (imported.imported) {
        importedKeys.push(item.key);
      }
    }

    const defaultAsset =
      assets.find((asset) => asset.view === manifest.defaultView) ?? assets[0];
    if (!defaultAsset) {
      throw new Error("CHARACTER_PRESET_EMPTY");
    }
    return {
      manifest,
      assets,
      defaultAsset,
      importedKeys,
    };
  }
}

function resolveInside(directory: string, file: string): string {
  const resolved = path.resolve(directory, file);
  const relative = path.relative(directory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("CHARACTER_PRESET_PATH_INVALID");
  }
  return resolved;
}
