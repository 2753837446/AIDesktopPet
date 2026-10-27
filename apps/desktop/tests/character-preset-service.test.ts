import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CharacterAsset } from "../src/core/domain";
import { CharacterAssetService } from "../src/main/character-asset-service";
import {
  BundledCharacterPresetService,
  createPresetSettingsPatch,
  type ImportedCharacterPreset,
} from "../src/main/character-preset-service";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteCharacterAssetRepository } from "../src/main/persistence/character-asset-repository";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl8sAAAAASUVORK5CYII=",
  "base64",
);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("内置角色预设", () => {
  it("导入多视图并保证重复启动幂等", async () => {
    const fixture = await createFixture();
    const first = await fixture.presets.importAll();
    const second = await fixture.presets.importAll();

    expect(first).toHaveLength(1);
    expect(first[0]?.assets).toHaveLength(3);
    expect(first[0]?.defaultAsset.view).toBe("front");
    expect(first[0]?.importedKeys).toHaveLength(3);
    expect(second[0]?.importedKeys).toEqual([]);
    expect(fixture.assets.list()).toHaveLength(3);
    expect(
      fixture.assets.list().every((asset) => asset.presetKey?.startsWith("test-")),
    ).toBe(true);
    const front = first[0]?.defaultAsset;
    expect(front).toBeDefined();
    if (front) {
      expect(await fixture.assets.delete(front.id)).toBe(false);
      expect(fixture.assets.list()).toHaveLength(3);
    }
    fixture.database.close();
  });

  it("只初始化默认形象和默认人格，不覆盖用户配置", () => {
    const preset = fakePreset();
    const defaultPatch = createPresetSettingsPatch(
      structuredClone(DEFAULT_SETTINGS),
      preset,
      new Set(),
    );
    expect(defaultPatch.appearance?.customCharacterId).toBe(
      preset.defaultAsset.id,
    );
    expect(defaultPatch.persona?.name).toBe("苏清月");

    const customized = structuredClone(DEFAULT_SETTINGS);
    customized.appearance.customCharacterId = preset.defaultAsset.id;
    customized.persona = {
      ...customized.persona,
      preset: "custom",
      name: "我的角色",
    };
    expect(
      createPresetSettingsPatch(
        customized,
        preset,
        new Set([preset.defaultAsset.id]),
      ),
    ).toEqual({});
  });
});

async function createFixture(): Promise<{
  assets: CharacterAssetService;
  presets: BundledCharacterPresetService;
  database: ReturnType<typeof openDatabase>["database"];
}> {
  const root = await mkdtemp(path.join(tmpdir(), "pet-preset-"));
  directories.push(root);
  const presetDirectory = path.join(root, "presets", "test-character");
  await mkdir(presetDirectory, { recursive: true });
  await writeFile(path.join(presetDirectory, "front.png"), ONE_PIXEL_PNG);
  await writeFile(path.join(presetDirectory, "side.png"), ONE_PIXEL_PNG);
  await writeFile(path.join(presetDirectory, "back.png"), ONE_PIXEL_PNG);
  await writeFile(
    path.join(presetDirectory, "preset.json"),
    JSON.stringify({
      schema: "ai-desktop-pet/character-preset",
      version: 1,
      key: "test-character",
      characterName: "测试角色",
      description: "测试角色描述",
      tone: "测试语气",
      defaultView: "front",
      sourceImage: "source.jpg",
      assets: [
        {
          key: "test-front",
          file: "front.png",
          view: "front",
          displayName: "测试角色 · 正面",
        },
        {
          key: "test-side",
          file: "side.png",
          view: "right",
          displayName: "测试角色 · 侧面",
        },
        {
          key: "test-back",
          file: "back.png",
          view: "back",
          displayName: "测试角色 · 背面",
        },
      ],
    }),
  );

  const opened = openDatabase(":memory:");
  const assets = new CharacterAssetService(
    path.join(root, "user-data"),
    new SqliteCharacterAssetRepository(opened.database),
  );
  return {
    assets,
    presets: new BundledCharacterPresetService(
      assets,
      path.join(root, "presets"),
    ),
    database: opened.database,
  };
}

function fakePreset(): ImportedCharacterPreset {
  const asset: CharacterAsset = {
    id: "00000000-0000-4000-8000-000000000010",
    displayName: "苏清月 · 正面",
    view: "front",
    mimeType: "image/png",
    width: 1,
    height: 1,
    sizeBytes: 1,
    category: "character",
    presetKey: "su-qingyue-front",
    origin: "upload",
    sourceAssetId: null,
    generationPrompt: null,
    generationModel: null,
    generatedAt: null,
    createdAt: new Date().toISOString(),
  };
  return {
    manifest: {
      schema: "ai-desktop-pet/character-preset",
      version: 1,
      key: "su-qingyue",
      characterName: "苏清月",
      description: "黑发浅紫瞳的国风幻想角色。",
      tone: "温柔而清冷。",
      defaultView: "front",
      sourceImage: "source-profile.jpg",
      assets: [],
    },
    assets: [asset],
    defaultAsset: asset,
    importedKeys: ["su-qingyue-front"],
  };
}
