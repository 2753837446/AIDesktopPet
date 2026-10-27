import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const backupFileSchema = z
  .object({
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const backupManifestSchema = z
  .object({
    schema: z.literal("ai-desktop-pet/backup"),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    appVersion: z.string().min(1).max(50),
    schemaVersion: z.number().int().nonnegative(),
    files: z.array(backupFileSchema).min(2),
  })
  .strict();

export interface BackupResult {
  directory: string;
  fileCount: number;
  databaseBytes: number;
}

export interface RestoreResult {
  restoredFrom: string;
  previousDataDirectory: string;
}

export class BackupService {
  async create(input: {
    database: DatabaseSync;
    userDataPath: string;
    parentDirectory: string;
    appVersion: string;
    schemaVersion: number;
    now?: Date;
  }): Promise<BackupResult> {
    await mkdir(input.parentDirectory, { recursive: true });
    const stamp = formatStamp(input.now ?? new Date());
    const directory = await createUniqueDirectory(
      input.parentDirectory,
      `AIDesktopPet-backup-${stamp}`,
    );

    const databaseTarget = path.join(directory, "ai-desktop-pet.sqlite");
    input.database.prepare("VACUUM INTO ?").run(databaseTarget);
    await copyRequired(
      path.join(input.userDataPath, "settings.json"),
      path.join(directory, "settings.json"),
    );
    const assetsSource = path.join(input.userDataPath, "character-assets");
    if (await exists(assetsSource)) {
      await cp(assetsSource, path.join(directory, "character-assets"), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }

    const files = await collectFiles(directory);
    const manifest = {
      schema: "ai-desktop-pet/backup" as const,
      version: 1 as const,
      createdAt: (input.now ?? new Date()).toISOString(),
      appVersion: input.appVersion,
      schemaVersion: input.schemaVersion,
      files,
    };
    await writeFile(
      path.join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const databaseStat = await stat(databaseTarget);
    return {
      directory,
      fileCount: files.length,
      databaseBytes: databaseStat.size,
    };
  }

  async validate(directory: string): Promise<z.infer<typeof backupManifestSchema>> {
    const manifest = backupManifestSchema.parse(
      JSON.parse(
        await readFile(path.join(directory, "manifest.json"), "utf8"),
      ),
    );
    const filePaths = new Set(manifest.files.map((file) => file.path));
    for (const required of ["ai-desktop-pet.sqlite", "settings.json"]) {
      if (!filePaths.has(required)) {
        throw new Error(`BACKUP_REQUIRED_FILE_MISSING:${required}`);
      }
    }
    for (const file of manifest.files) {
      const target = resolveInside(directory, file.path);
      const info = await stat(target);
      if (!info.isFile() || info.size !== file.size) {
        throw new Error(`BACKUP_FILE_SIZE_MISMATCH:${file.path}`);
      }
      const hash = await hashFile(target);
      if (hash !== file.sha256) {
        throw new Error(`BACKUP_FILE_HASH_MISMATCH:${file.path}`);
      }
    }
    const databasePath = resolveInside(directory, "ai-desktop-pet.sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const migration = database
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get() as { version: number };
      if (migration.version < 1) {
        throw new Error("BACKUP_DATABASE_INVALID");
      }
    } finally {
      database.close();
    }
    return manifest;
  }

  async restore(input: {
    directory: string;
    userDataPath: string;
    now?: Date;
  }): Promise<RestoreResult> {
    await this.validate(input.directory);
    const stamp = formatStamp(input.now ?? new Date());
    const previousDataDirectory = path.join(
      input.userDataPath,
      `pre-restore-${stamp}-${randomUUID().slice(0, 8)}`,
    );
    const stagingDirectory = path.join(
      input.userDataPath,
      `.restore-staging-${randomUUID()}`,
    );
    await mkdir(input.userDataPath, { recursive: true });
    await mkdir(stagingDirectory, { recursive: false });
    await mkdir(previousDataDirectory, { recursive: false });

    try {
      await copyRequired(
        path.join(input.directory, "ai-desktop-pet.sqlite"),
        path.join(stagingDirectory, "ai-desktop-pet.sqlite"),
      );
      await copyRequired(
        path.join(input.directory, "settings.json"),
        path.join(stagingDirectory, "settings.json"),
      );
      const backupAssets = path.join(input.directory, "character-assets");
      if (await exists(backupAssets)) {
        await cp(backupAssets, path.join(stagingDirectory, "character-assets"), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }

      for (const name of [
        "ai-desktop-pet.sqlite",
        "ai-desktop-pet.sqlite-wal",
        "ai-desktop-pet.sqlite-shm",
        "settings.json",
        "character-assets",
      ]) {
        const current = path.join(input.userDataPath, name);
        if (await exists(current)) {
          await rename(current, path.join(previousDataDirectory, name));
        }
      }
      for (const name of [
        "ai-desktop-pet.sqlite",
        "settings.json",
        "character-assets",
      ]) {
        const staged = path.join(stagingDirectory, name);
        if (await exists(staged)) {
          await rename(staged, path.join(input.userDataPath, name));
        }
      }
      await rm(stagingDirectory, { recursive: true, force: true });
      return {
        restoredFrom: input.directory,
        previousDataDirectory,
      };
    } catch (error) {
      await restorePreviousData(input.userDataPath, previousDataDirectory);
      await rm(stagingDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }
}

async function restorePreviousData(
  userDataPath: string,
  previousDataDirectory: string,
): Promise<void> {
  for (const name of [
    "ai-desktop-pet.sqlite",
    "ai-desktop-pet.sqlite-wal",
    "ai-desktop-pet.sqlite-shm",
    "settings.json",
    "character-assets",
  ]) {
    const target = path.join(userDataPath, name);
    const previous = path.join(previousDataDirectory, name);
    if (await exists(previous)) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      await rename(previous, target);
    }
  }
}

async function createUniqueDirectory(
  parent: string,
  baseName: string,
): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    const name = index === 0 ? baseName : `${baseName}-${index}`;
    const directory = path.join(parent, name);
    try {
      await mkdir(directory, { recursive: false });
      return directory;
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
  }
  throw new Error("BACKUP_DIRECTORY_CONFLICT");
}

async function collectFiles(
  directory: string,
): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const result: Array<{ path: string; size: number; sha256: string }> = [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "manifest.json") {
      continue;
    }
    const parentPath =
      "parentPath" in entry && typeof entry.parentPath === "string"
        ? entry.parentPath
        : directory;
    const absolute = path.join(parentPath, entry.name);
    const relative = path.relative(directory, absolute);
    const info = await stat(absolute);
    result.push({
      path: relative.split(path.sep).join("/"),
      size: info.size,
      sha256: await hashFile(absolute),
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function copyRequired(source: string, target: string): Promise<void> {
  await access(source);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { force: false, errorOnExist: true });
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function resolveInside(directory: string, relative: string): string {
  const resolved = path.resolve(directory, relative);
  const relation = path.relative(directory, resolved);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("BACKUP_PATH_INVALID");
  }
  return resolved;
}

function formatStamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}
