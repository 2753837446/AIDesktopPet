# 技术设计

## 格式

```text
AIDesktopPet-backup-YYYYMMDD-HHmmss/
  manifest.json
  ai-desktop-pet.sqlite
  settings.json
  character-assets/
```

`manifest.json`：

```text
schema: ai-desktop-pet/backup
version: 1
createdAt
appVersion
schemaVersion
files[]
```

## 创建

- 使用 SQLite `VACUUM INTO` 生成一致性数据库快照。
- 复制 character-assets 与 settings.json。
- 不复制 credentials、Cache、日志。
- 目录写完后最后写 manifest，避免把半成品误认为完整备份。

## 恢复

1. 只读解析并校验 manifest。
2. 用 `DatabaseSync` 只读打开数据库，检查 schema_migrations。
3. 创建 `userData/pre-restore-时间` 保护当前数据库、设置和角色目录。
4. 停止策略/数据库后替换文件。
5. 任何替换失败时回滚保护副本。
6. 成功后 `app.relaunch()` 并退出当前进程。

恢复操作由设置页明确按钮触发，UI 展示会覆盖当前本地数据和密钥需重配。
