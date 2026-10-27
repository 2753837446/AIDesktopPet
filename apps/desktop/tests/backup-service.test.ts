import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/main/backup-service";
import { openDatabase } from "../src/main/persistence/database";
import { SqliteConversationRepository } from "../src/main/persistence/conversation-repository";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("完整备份与恢复", () => {
  it("备份数据库、设置和角色资产并可恢复", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pet-backup-"));
    directories.push(root);
    const userData = path.join(root, "user-data");
    const backupParent = path.join(root, "backups");
    await mkdir(path.join(userData, "credentials"), { recursive: true });
    await mkdir(path.join(userData, "character-assets"), { recursive: true });
    await writeFile(
      path.join(userData, "settings.json"),
      '{"version":1}',
      "utf8",
    );
    await writeFile(
      path.join(userData, "credentials", "deepseek.bin"),
      "not-backed-up",
    );
    await writeFile(
      path.join(userData, "character-assets", "avatar.png"),
      Buffer.from([1, 2, 3]),
    );
    const opened = openDatabase(
      path.join(userData, "ai-desktop-pet.sqlite"),
    );
    const conversations = new SqliteConversationRepository(opened.database);
    const conversation = conversations.ensureConversation({
      title: "恢复后保留",
    });
    conversations.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: "备份中的消息",
    });

    const service = new BackupService();
    const backup = await service.create({
      database: opened.database,
      userDataPath: userData,
      parentDirectory: backupParent,
      appVersion: "0.1.0",
      schemaVersion: opened.schemaVersion,
      now: new Date("2026-10-28T01:30:00+08:00"),
    });
    opened.database.close();

    expect(await service.validate(backup.directory)).toMatchObject({
      schema: "ai-desktop-pet/backup",
      version: 1,
    });
    await expect(
      access(path.join(backup.directory, "credentials", "deepseek.bin")),
    ).rejects.toThrow();

    const restoredUserData = path.join(root, "restored-user-data");
    await mkdir(restoredUserData, { recursive: true });
    const restored = await service.restore({
      directory: backup.directory,
      userDataPath: restoredUserData,
      now: new Date("2026-10-28T01:31:00+08:00"),
    });
    expect(restored.previousDataDirectory).toContain("pre-restore-");
    const restoredDatabase = openDatabase(
      path.join(restoredUserData, "ai-desktop-pet.sqlite"),
    );
    try {
      const history = new SqliteConversationRepository(
        restoredDatabase.database,
      ).listRecentMessages(conversation.id, 10);
      expect(history[0]?.content).toBe("备份中的消息");
    } finally {
      restoredDatabase.database.close();
    }
    expect(
      await readFile(
        path.join(restoredUserData, "character-assets", "avatar.png"),
      ),
    ).toEqual(Buffer.from([1, 2, 3]));
  });

  it("拒绝被篡改或缺少必需文件的备份", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pet-backup-"));
    directories.push(root);
    const userData = path.join(root, "user-data");
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(userData, "settings.json"), "{}", "utf8");
    const opened = openDatabase(
      path.join(userData, "ai-desktop-pet.sqlite"),
    );
    const service = new BackupService();
    const backup = await service.create({
      database: opened.database,
      userDataPath: userData,
      parentDirectory: path.join(root, "backups"),
      appVersion: "0.1.0",
      schemaVersion: opened.schemaVersion,
    });
    opened.database.close();
    await writeFile(
      path.join(backup.directory, "settings.json"),
      '{"tampered":true}',
      "utf8",
    );
    await expect(service.validate(backup.directory)).rejects.toThrow(
      "BACKUP_FILE_SIZE_MISMATCH",
    );
  });
});
