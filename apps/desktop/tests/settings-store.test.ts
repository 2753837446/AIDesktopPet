import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings-store";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<{ directory: string; store: SettingsStore }> {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-desktop-pet-settings-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new SettingsStore(directory),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SettingsStore", () => {
  it("在首次启动时写入安全的默认设置", async () => {
    const { directory, store } = await createStore();

    const result = await store.load();

    expect(result.recovered).toBe(false);
    expect(result.settings.window.width).toBe(360);
    expect(result.settings.proactive.quietHours).toEqual({
      enabled: true,
      start: "23:00",
      end: "07:00",
    });
    expect(result.settings.persona.name).toBe("阿湛");
    expect(result.settings.appearance.customBackgroundId).toBeNull();
    expect(result.settings.appearance.customPropIds).toEqual([]);

    const persisted = JSON.parse(
      await readFile(path.join(directory, "settings.json"), "utf8"),
    ) as { version: number };
    expect(persisted.version).toBe(1);
  });

  it("保存合法的嵌套设置补丁", async () => {
    const { store } = await createStore();
    await store.load();

    const updated = await store.update({
      window: { x: 120, y: 80, alwaysOnTop: false },
      proactive: {
        enabled: false,
        quietHours: { start: "22:30" },
      },
      appearance: { scale: 1.15 },
      persona: {
        name: "测试角色",
        replyLength: "detailed",
        preset: "custom",
      },
    });

    expect(updated.window.x).toBe(120);
    expect(updated.window.alwaysOnTop).toBe(false);
    expect(updated.proactive.enabled).toBe(false);
    expect(updated.proactive.quietHours.start).toBe("22:30");
    expect(updated.appearance.scale).toBe(1.15);
    expect(updated.persona.name).toBe("测试角色");
    expect(updated.persona.replyLength).toBe("detailed");
  });

  it("拒绝未知字段、非法时间和越界缩放", async () => {
    const { store } = await createStore();
    await store.load();

    await expect(store.update({ unexpected: true })).rejects.toThrow();
    await expect(
      store.update({ proactive: { quietHours: { start: "25:00" } } }),
    ).rejects.toThrow();
    await expect(store.update({ appearance: { scale: 2 } })).rejects.toThrow();
    await expect(
      store.update({
        appearance: {
          customPropIds: [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004",
          ],
        },
      }),
    ).rejects.toThrow();
    await expect(
      store.update({ persona: { replyLength: "verbose" } }),
    ).rejects.toThrow();
  });

  it("损坏的设置文件会备份并恢复默认值", async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, "settings.json"), "{not-json", "utf8");

    const result = await store.load();
    const files = await readdir(directory);

    expect(result.recovered).toBe(true);
    expect(result.settings.window.width).toBe(360);
    expect(files.some((file) => file.startsWith("settings.json.invalid-"))).toBe(true);
  });
});
