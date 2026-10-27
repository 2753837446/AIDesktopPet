import { rename, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { DesktopSettings, DesktopSettingsPatch } from "../shared/settings";
import {
  createDefaultSettings,
  mergeSettings,
  parseSettings,
  parseSettingsPatch,
} from "./settings-schema";

export interface SettingsLoadResult {
  settings: DesktopSettings;
  recovered: boolean;
}

export class SettingsStore {
  private current: DesktopSettings;
  private recovered = false;

  constructor(private readonly userDataPath: string) {
    this.current = createDefaultSettings();
  }

  get settingsPath(): string {
    return path.join(this.userDataPath, "settings.json");
  }

  async load(): Promise<SettingsLoadResult> {
    try {
      const raw = await readFile(this.settingsPath, "utf8");
      this.current = parseSettings(JSON.parse(raw));
    } catch (error) {
      if (isMissingFile(error)) {
        this.current = createDefaultSettings();
        await this.persist(this.current);
      } else {
        this.recovered = true;
        await this.preserveInvalidFile();
        this.current = createDefaultSettings();
        await this.persist(this.current);
      }
    }

    return {
      settings: structuredClone(this.current),
      recovered: this.recovered,
    };
  }

  get(): DesktopSettings {
    return structuredClone(this.current);
  }

  async update(patchValue: unknown): Promise<DesktopSettings> {
    const patch = parseSettingsPatch(patchValue);
    const next = mergeSettings(this.current, patch);
    await this.persist(next);
    this.current = next;
    return this.get();
  }

  private async persist(settings: DesktopSettings): Promise<void> {
    const temporaryPath = `${this.settingsPath}.tmp-${process.pid}-${Date.now()}`;
    const contents = `${JSON.stringify(settings, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.settingsPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async preserveInvalidFile(): Promise<void> {
    const backupPath = `${this.settingsPath}.invalid-${Date.now()}`;
    await rename(this.settingsPath, backupPath).catch(() => undefined);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
