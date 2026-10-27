import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CharacterImageEditInput,
  CharacterImageEditProvider,
  CharacterImageEditResult,
} from "../src/core/character-image-edit-provider";
import { CharacterAssetService } from "../src/main/character-asset-service";
import { CharacterPoseDirector } from "../src/main/character-pose-director";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteCharacterAssetRepository } from "../src/main/persistence/character-asset-repository";

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

describe("角色姿态导演", () => {
  it("超时会停止等待并返回稳定错误码", async () => {
    const fixture = await createFixture();
    const director = new CharacterPoseDirector(
      fixture.assets,
      abortableProvider(),
      5,
    );

    await expect(
      director.generate({
        sourceAssetId: fixture.sourceId,
        instruction: "坐在凳子上",
        compositionMode: "character",
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_POSE_TIMEOUT" });
    fixture.database.close();
  });

  it("用户取消后不会自动生成或切换资产", async () => {
    const fixture = await createFixture();
    const director = new CharacterPoseDirector(
      fixture.assets,
      abortableProvider(),
      5_000,
    );
    const controller = new AbortController();
    const pending = director.generate({
      sourceAssetId: fixture.sourceId,
      instruction: "挥手",
      compositionMode: "character",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 1);

    await expect(pending).rejects.toMatchObject({
      code: "CHARACTER_POSE_CANCELLED",
    });
    expect(fixture.assets.list()).toHaveLength(1);
    fixture.database.close();
  });
});

async function createFixture(): Promise<{
  assets: CharacterAssetService;
  sourceId: string;
  database: ReturnType<typeof openDatabase>["database"];
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "pet-pose-"));
  directories.push(directory);
  const opened = openDatabase(":memory:");
  const assets = new CharacterAssetService(
    directory,
    new SqliteCharacterAssetRepository(opened.database),
  );
  const source = await assets.save({
    fileName: "source.png",
    bytes: ONE_PIXEL_PNG,
    view: "front",
    category: "character",
    displayName: "参考角色",
  });
  return { assets, sourceId: source.id, database: opened.database };
}

function abortableProvider(): CharacterImageEditProvider {
  return {
    model: "Qwen/Qwen-Image-Edit-2509",
    edit: (input: CharacterImageEditInput) =>
      new Promise<CharacterImageEditResult>((_resolve, reject) => {
        const fail = (): void =>
          reject(new DOMException("aborted", "AbortError"));
        if (input.signal?.aborted) {
          fail();
          return;
        }
        input.signal?.addEventListener("abort", fail, { once: true });
      }),
  };
}
