# AI Desktop Pet

Windows 优先的 AI 桌宠项目。桌宠是用户入口，核心能力包括 AI 对话、可审计的长期记忆、持久化任务调度、主动反馈和受权限控制的外部连接器。

## 当前状态

**P8 角色人格配置已实现并通过真实 DeepSeek 回归。**

已实现：

- Electron + React + TypeScript + pnpm workspace。
- 透明无边框桌宠窗口、拖动区域、窗口位置恢复和系统托盘。
- 隔离 preload、白名单 IPC、严格设置 schema 和原子 JSON 持久化。
- 基础设置页：窗口置顶、任务栏显示、角色大小、主动提醒、免打扰和开机启动偏好。
- SQLite 版本化迁移、对话历史与消息持久化。
- Electron `safeStorage` 加密保存 DeepSeek API Key。
- `deepseek-flash` 流式对话、停止生成和错误状态。
- 明确“请记住”消息写入长期记忆，并参与后续上下文检索。
- 记忆中心支持搜索、编辑、删除和来源数量查看。
- 一次性任务支持持久化创建、完成、取消、租约恢复和幂等通知。
- 到期任务由主进程调度并调用 Windows 系统通知。
- SiliconFlow BGE-M3 语义检索、1024 维本地向量和关键词混合排序。
- Embedding 不可用时自动回退 FTS5，不阻塞对话。
- 今日总结只使用本地任务和非 `local_only` 记忆，并明确标记未连接数据源。
- 支持每天、工作日和每周重复任务，按 IANA 时区计算下一次发生时间。
- 每日总结按设置时间作为持久化 maintenance task 自动执行。
- 工具调用统一经过 schema、scope、风险、超时、取消和审计。
- 高风险邮件发送和移至已删除必须经过用户确认。
- Himalaya v2.1.0 已接入 QQ IMAP/SMTP；收件箱只读列表经过真实账号验证。
- QQ 授权码已迁移到 Windows Credential Locker，Himalaya 通过 `password.command` 读取。
- Connector 状态持久化；邮件正文不会未经用户操作自动读取。
- 人格支持预设和自定义，可配置名称、自称、称呼、性格、语气、长度、边界和主动性。
- 人格设置支持 JSON 导入导出，下一轮对话立即生效。
- 固定安全底座不可被人格配置覆盖。
- 未配置模型时的明确基础可用状态。
- 设置、数据库、记忆、Assistant Core、SSE、任务调度和 Electron 端到端测试。

尚未实现：

- 日历 Connector
- 模型 function calling
- 邮件发送和删除的真实副作用验收
- 签名的 Windows 安装包

![P1 桌宠界面](./docs/assets/p1-pet-shell.png)

![人格设置](./docs/assets/p1-settings.png)

![DeepSeek 聊天界面](./docs/assets/p2-chat-shell.png)

![记忆中心](./docs/assets/p3-memory-center.png)

![任务中心](./docs/assets/p4-task-center.png)

![今日总结](./docs/assets/p5-live-daily-brief.png)

![工具与连接器](./docs/assets/p7-tool-center.png)

## 文档入口

- [产品需求](./docs/PRD.md)
- [系统架构](./docs/ARCHITECTURE.md)
- [长期记忆](./docs/MEMORY_SYSTEM.md)
- [任务引擎](./docs/TASK_ENGINE.md)
- [数据库设计](./docs/DATABASE_API_DESIGN.md)
- [API 契约](./docs/API_CONTRACTS.md)
- [实施计划](./docs/CODEX_IMPLEMENTATION_PLAN.md)
- [安全基线](./docs/SECURITY.md)
- [视频技术借鉴](./docs/Windows_AI桌宠_视频技术借鉴与长期记忆架构方案.md)
- [视频读取结果](./docs/VIDEO_FINDINGS.md)
- [依赖与许可证](./docs/DEPENDENCIES.md)

## 本地运行

```powershell
pnpm install
pnpm dev
```

验证：

```powershell
pnpm check
pnpm test
pnpm test:e2e
pnpm build
```

## 里程碑

首版目标是 Windows 10 22H2 x64 与 Windows 11 x64 上的 2D 桌宠，基础桌宠不依赖模型、Agent runtime 或 QQ/NapCat/AstrBot 才能启动。ARM64 只有在真实安装包和运行验证完成后才能纳入支持矩阵。

下一阶段进入 P9：补全邮件发送/删除的真实副作用验收，接入模型 function calling、日历 Connector 和完整审计查看。DeepSeek 与 BGE-M3 的 API Key 都只能通过设置页写入 Windows DPAPI 加密文件；QQ 授权码由 Windows Credential Locker 提供。

## 仓库约束

- 需求变化先写 OpenSpec 提案、设计和任务清单。
- 外部输入、模型输出和连接器响应均按不可信数据处理。
- `local_only` 数据不得发送到云端模型。
- 高风险外部动作必须展示目标与影响并取得用户确认。
- 没有测试、构建或运行证据时，不得在文档或提交说明中声明功能“已完成”或“通过”。
