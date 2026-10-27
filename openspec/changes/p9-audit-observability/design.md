# 技术设计

- 新增 `SqliteAuditRepository.list`，只读查询 `audit_logs`。
- 返回稳定 `AuditLogRecord`：id、时间、actor、action、target、outcome、reason、traceId。
- IPC 支持最多 500 条和关键字过滤。
- Tool Center 增加“审计记录”区，不显示工具完整输入或敏感正文。
- 审计只允许本应用可信 renderer 访问。
