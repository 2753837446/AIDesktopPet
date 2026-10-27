import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterAssetService } from "../src/main/character-asset-service";
import { detectImage } from "../src/main/character-image";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteCharacterAssetRepository } from "../src/main/persistence/character-asset-repository";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl8sAAAAASUVORK5CYII=",
  "base64",
);

const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x20, 0x00, 0x30,
]);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("角色图片资产", () => {
  it("通过文件魔数识别 PNG 尺寸", () => {
    expect(detectImage(ONE_PIXEL_PNG)).toEqual({
      mimeType: "image/png",
      extension: "png",
      width: 1,
      height: 1,
    });
    expect(() =>
      detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toThrow("UNSUPPORTED_CHARACTER_IMAGE");
  });

  it("通过 JPEG 文件头识别生成图片尺寸", () => {
    expect(detectImage(MINIMAL_JPEG)).toEqual({
      mimeType: "image/jpeg",
      extension: "jpg",
      width: 48,
      height: 32,
    });
  });

  it("保存、读取和删除角色资产", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pet-character-"));
    directories.push(directory);
    const opened = openDatabase(":memory:");
    const service = new CharacterAssetService(
      directory,
      new SqliteCharacterAssetRepository(opened.database),
    );

    const asset = await service.save({
      fileName: "avatar.png",
      bytes: ONE_PIXEL_PNG,
      view: "idle",
      category: "character",
      displayName: "测试形象",
    });
    expect(service.list()).toHaveLength(1);
    const loaded = await service.read(asset.id);
    expect(loaded.asset.displayName).toBe("测试形象");
    expect(Buffer.from(loaded.bytes)).toEqual(ONE_PIXEL_PNG);
    expect((await service.delete(asset.id))).toBe(true);
    expect(service.list()).toHaveLength(0);
    opened.database.close();
  });

  it("生成姿态时保留源资产并记录血缘", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pet-character-"));
    directories.push(directory);
    const opened = openDatabase(":memory:");
    const service = new CharacterAssetService(
      directory,
      new SqliteCharacterAssetRepository(opened.database),
    );
    const source = await service.save({
      fileName: "avatar.png",
      bytes: ONE_PIXEL_PNG,
      view: "front",
      category: "character",
      displayName: "原始形象",
    });
    const generated = await service.saveGenerated({
      sourceAssetId: source.id,
      bytes: MINIMAL_JPEG,
      instruction: "坐在凳子上",
      model: "Qwen/Qwen-Image-Edit-2509",
      compositionMode: "character",
    });

    expect(generated).toMatchObject({
      origin: "ai_generated",
      category: "character",
      sourceAssetId: source.id,
      generationPrompt: "坐在凳子上",
      generationModel: "Qwen/Qwen-Image-Edit-2509",
      mimeType: "image/jpeg",
      view: "idle",
    });
    expect(service.list()).toHaveLength(2);
    expect((await service.read(source.id)).asset.origin).toBe("upload");

    expect(await service.delete(source.id)).toBe(true);
    expect(service.list().map((asset) => asset.id)).toEqual([generated.id]);
    opened.database.close();
  });

  it("支持背景、道具与完整场景分类", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pet-character-"));
    directories.push(directory);
    const opened = openDatabase(":memory:");
    const service = new CharacterAssetService(
      directory,
      new SqliteCharacterAssetRepository(opened.database),
    );
    const source = await service.save({
      fileName: "avatar.png",
      bytes: ONE_PIXEL_PNG,
      view: "idle",
      category: "character",
      displayName: "角色",
    });
    const background = await service.save({
      fileName: "room.png",
      bytes: ONE_PIXEL_PNG,
      view: "idle",
      category: "background",
      displayName: "房间",
    });
    const prop = await service.save({
      fileName: "chair.png",
      bytes: ONE_PIXEL_PNG,
      view: "idle",
      category: "prop",
      displayName: "椅子",
    });
    const scene = await service.saveGenerated({
      sourceAssetId: source.id,
      bytes: ONE_PIXEL_PNG,
      instruction: "坐在椅子上，背景是咖啡馆",
      model: "Qwen/Qwen-Image-Edit-2509",
      compositionMode: "scene",
    });

    expect(
      service.list().map(({ category, displayName }) => ({
        category,
        displayName,
      })),
    ).toEqual(
      expect.arrayContaining([
        { category: "background", displayName: background.displayName },
        { category: "prop", displayName: prop.displayName },
        { category: "scene", displayName: scene.displayName },
      ]),
    );
    expect(scene.category).toBe("scene");
    opened.database.close();
  });

  it("拒绝超过 10 MiB 的图片", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pet-character-"));
    directories.push(directory);
    const opened = openDatabase(":memory:");
    const service = new CharacterAssetService(
      directory,
      new SqliteCharacterAssetRepository(opened.database),
    );

    await expect(
      service.save({
        fileName: "large.png",
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
        view: "idle",
        category: "character",
      }),
    ).rejects.toThrow("INVALID_CHARACTER_IMAGE_SIZE");
    opened.database.close();
  });
});
