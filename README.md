# AI Desktop Pet

Windows 优先的 AI 桌宠项目。桌宠是用户入口，核心能力包括 AI 对话、可审计的长期记忆、持久化任务调度、主动反馈和受权限控制的外部连接器。

## 当前状态

**P1 桌宠基础壳已实现并通过 Electron 烟雾测试。**

已实现：

- Electron + React + TypeScript + pnpm workspace。
- 透明无边框桌宠窗口、拖动区域、窗口位置恢复和系统托盘。
- 隔离 preload、白名单 IPC、严格设置 schema 和原子 JSON 持久化。
- 基础设置页：窗口置顶、任务栏显示、角色大小、主动提醒、免打扰和开机启动偏好。
- 未配置模型时的明确基础可用状态。
- 设置存储单元测试、类型检查、生产构建和 Electron 窗口测试。

尚未实现：

- 模型对话或流式输出
- 长期记忆与向量检索
- SQLite 业务数据库和迁移
- 持久化任务调度
- 邮箱、日历、QQ 或其他连接器
- 签名的 Windows 安装包

![P1 桌宠界面](./docs/assets/p1-pet-shell.png)

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

下一阶段进入 P2/P3：创建 SQLite 迁移与原始消息 / 记忆来源表，定义 ModelProvider、Assistant Core、Memory Service 的进程内接口，并完成一条不依赖真实外部服务的对话流测试。

## 仓库约束

- 需求变化先写 OpenSpec 提案、设计和任务清单。
- 外部输入、模型输出和连接器响应均按不可信数据处理。
- `local_only` 数据不得发送到云端模型。
- 高风险外部动作必须展示目标与影响并取得用户确认。
- 没有测试、构建或运行证据时，不得在文档或提交说明中声明功能“已完成”或“通过”。
