# CODEX_IMPLEMENTATION_PLAN.md｜Codex 开发实施计划

*把技术方案转化为可执行的仓库结构、开发阶段、工程规范与验收标准*

版本：V0.4 · 日期：2026-10-27

# 1. 开发原则

- 先建立可运行的最小闭环，再增加复杂能力。
- 优先可观测、可恢复、可测试，避免只追求演示效果。
- 桌宠 UI、Assistant Core、Memory Service 和 Task Engine 解耦。
- 模型、Agent runtime、embedding 提供商、外部连接器全部通过接口隔离。
- 所有关键决策、任务状态和用户授权必须可追溯。
- 每个阶段完成后都必须有可运行版本、测试和文档更新。

## 当前进度

P1-P12 已完成到本地验证范围。当前可运行 Electron 透明窗口、托盘、设置持久化、隔离 IPC、SQLite migration v9、真实 `deepseek-flash` 流式对话、BGE-M3 语义检索、可纠正/删除记忆、重复任务、自动总结、Windows 通知、工具权限确认 / 审计、QQ 邮箱 Connector、版本化角色人格、审计查询、自定义角色资产、AI 姿态候选，以及默认透明背景、角色/背景/道具分层和完整场景资产。多视图动作库、骨骼 2D 与 3D 已建立 Character Runtime 设计但尚未实现。邮件发送与删除尚未做真实副作用测试；模型 function calling 和日历 Connector 尚未实现。

# 2. 建议仓库结构

```text
desktop-pet/
  apps/
    desktop/                 # Electron 主进程、窗口、托盘、安装包
    renderer/                # React UI、角色、聊天、任务与记忆中心
  packages/
    shared/                  # 类型、事件模型、校验规则
    assistant-core/          # 对话编排、上下文预算、模型路由
    memory-service/          # 记忆写入、检索、冲突、索引
    task-engine/             # 调度、状态机、重试、通知
    model-adapters/          # LLM / embedding provider adapters
    tool-runtime/            # 工具注册、权限、调用、日志
    connectors/
      filesystem/
      calendar/
      email/
      windows-notifications/
    character-config/        # 角色配置 schema、版本、校验
  data/
    migrations/
  docs/
    PRD.md
    ARCHITECTURE.md
    API_CONTRACTS.md
    DATABASE_API_DESIGN.md
    MEMORY_SYSTEM.md
    TASK_ENGINE.md
    CODEX_IMPLEMENTATION_PLAN.md
    SECURITY.md
    ADR/
  openspec/
    specs/
    changes/
  tests/
    fixtures/
    memory/
    task-engine/
    integration/
  scripts/
  README.md
```

以上是逻辑结构示例。若使用单仓库工作区，仍应避免为了形式拆成过多运行时进程；初期可以在同一应用进程内按模块隔离，只有在稳定性或权限边界需要时再拆分独立服务。仓库缺少实现代码时，README 必须明确标注“规范阶段”，不能把计划项描述成已完成能力。

# 3. 阶段划分与验收门槛

| 阶段 | 范围 | 交付物 | 验收门槛 |
| --- | --- | --- | --- |
| P0 技术验证 | 文档契约基线、模型流式输出、一个工具、Electron 桌宠壳、记忆检索 PoC | 技术验证记录、风险清单 | 枚举 / 时间 / 数据契约一致；模型可切换；工具错误可显示；基础 UI 可运行 |
| P1 桌宠基础 | 透明窗口、拖动、托盘、配置、开机自启选项 | 可安装 Windows 包 | 安装、启动、退出和重启恢复正常 |
| P2 Assistant Core | 对话、上下文预算、模型适配、工具注册 | 核心接口与单元测试 | 模型 / 工具错误不会崩溃整个 UI |
| P3 Memory v1 | 原始记录、结构化记忆、FTS5、BGE-M3 检索、记忆中心 | MEMORY_SYSTEM.md、数据库迁移 | 历史检索有来源；可纠正 / 删除；缓存与索引同步 |
| P4 Task Engine v1 | 任务状态机、持久化调度、提醒、重试 | TASK_ENGINE.md、运行日志 | 重启恢复、幂等和重复通知测试通过 |
| P5 每日总结 | 本地任务 / 日程汇总，结构化输出 | 总结页面与数据源状态 | 无数据时不编造，失败时可部分展示 |
| P6 邮箱与 Agent 扩展 | 一个主邮箱连接器、基础工具执行和确认流程 | 连接器、权限说明、端到端测试 | 授权可撤销，高风险动作需确认 |
| P7 体验打磨 | 主动性设置、角色配置、动画与安装优化 | Beta 安装包 | 通知频率可控、卸载 / 备份 / 恢复有说明 |
| P11 AI 姿态导演 | 聊天动作指令、外部图像编辑、候选审核 | Pose Director、v8 资产血缘、确认/取消/审计 | 原图不覆盖；生成先预览；失败不改变形象 |
| P12 角色舞台资产 | 透明默认舞台、背景、道具、完整场景 | v9 分类资产、分层 Renderer、场景生成模式 | 分层正确；scene 不重复叠加；所有图层可回退 |

# 4. Codex 工作方式

1. 先阅读 docs/ 中的 PRD、架构、记忆和任务引擎文档，不自行扩展冻结范围。
2. 一次只实施一个明确阶段或小任务，不同时重构多个核心模块。
3. 每次改动先列出涉及文件、数据迁移、接口变化和风险。
4. 先写类型和接口，再实现逻辑；外部调用必须注入依赖，便于测试。
5. 每个功能同时补单元测试、集成测试和必要的手工验证步骤。
6. 完成后更新 README、配置样例、错误说明和相关设计文档。
7. 不得在代码、日志、测试样例或文档中提交真实 API Key、访问令牌和私人数据。

# 5. 工程规范

## 5.1 TypeScript 与模块边界

- 启用严格类型检查；避免随意使用 any。
- 使用 schema 校验外部输入、配置文件和模型输出。
- 业务逻辑不直接依赖 Electron UI 对象；通过明确接口交互。
- 数据库访问集中在 repository / data access 层，避免 UI 直接写 SQL。
- 工具调用统一经过权限检查、超时、取消、日志和错误映射。

## 5.2 模型输出与工具安全

- 将模型输出视为不可信输入，工具参数必须进行 schema 校验。
- 模型不能直接绕过权限系统调用文件、邮件或系统命令。
- 外部内容（邮件、网页、文件）可能包含提示注入；不得当成系统指令。
- 高风险动作要求用户确认，确认内容应包括动作、目标和影响。
- 模型超时、限流或不可用时，提供明确错误和可重试路径。

## 5.3 数据与迁移

- 所有 schema 变化使用版本化迁移。
- 启动时检查数据库版本与迁移结果；迁移前考虑备份。
- 时间统一使用 UTC RFC 3339；任务调度另行保存用户时区和 recurrence 语义。
- 删除记忆时同步更新派生摘要、全文索引、向量索引和缓存。
- 任务状态与执行日志不得只保存在内存。
- 提供导出、备份、恢复与诊断功能。

# 6. 核心接口草案

```text
interface ModelProvider {
  chat(input: ChatRequest): AsyncIterable<ChatChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

interface MemoryService {
  addCandidate(input: MemoryCandidateInput): Promise<MemoryCandidate[]>;
  commit(candidateId: string, decision: MemoryDecision): Promise<MemoryRecord>;
  search(input: MemorySearchInput): Promise<MemorySearchResult[]>;
  update(id: string, patch: MemoryPatch): Promise<MemoryRecord>;
  delete(id: string): Promise<void>;
}

interface TaskEngine {
  create(input: CreateTaskInput): Promise<TaskRecord>;
  cancel(taskId: string): Promise<void>;
  approve(taskId: string, approval: ApprovalInput): Promise<void>;
  list(query: TaskQuery): Promise<TaskRecord[]>;
}

interface Tool {
  name: string;
  inputSchema: unknown;
  riskLevel: "low" | "medium" | "high" | "critical";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

接口为概念草案。正式编码前应根据选定运行时、数据库和类型校验库完善类型、错误对象、取消信号、超时和权限上下文。

# 7. 配置与密钥

- 配置分为用户偏好、模型提供商、角色配置、连接器授权和任务规则。
- 敏感密钥使用操作系统凭据存储或经过验证的安全存储方案，不以明文写入普通配置文件。
- 配置导入需校验 schema 和版本；角色配置不能携带任意可执行代码。
- 日志默认对 Token、API Key、邮箱正文和敏感路径做脱敏。

# 8. 测试要求

| 测试层 | 范围 | 示例 |
| --- | --- | --- |
| 单元测试 | 纯业务规则 | 记忆排序、预算裁剪、任务状态转换、去重键 |
| 集成测试 | 数据库、索引和调度 | 写入后可检索、删除后索引同步、重启恢复 |
| 端到端测试 | 真实用户闭环 | 创建任务、重启应用、收到提醒、查看总结 |
| 故障测试 | 外部服务不稳定 | 断网、API 限流、模型超时、向量索引失败 |
| 安全测试 | 权限与注入 | 恶意邮件正文、越权工具参数、高风险操作确认 |
| 性能测试 | 延迟与资源占用 | 长历史检索、索引重建、冷启动、持续运行 |

# 9. 发布与安装验收

- 普通用户只需下载一个 Windows 安装包即可在 Windows 10 22H2 x64 或 Windows 11 x64 启动基础桌宠；ARM64 需单独验证后才能加入支持矩阵。
- 首次启动可跳过 AI 配置；未配置模型时清楚说明可用和不可用能力。
- 支持选择开机自启、最小化启动和恢复窗口位置。
- 安装、升级、卸载、数据库备份和恢复路径经过验证。
- 应用重启后角色设置、记忆、任务和调度状态一致。
- Agent / 模型故障不会导致桌宠 UI 失去响应。

# 10. Definition of Done

- 代码通过 lint、类型检查和相关测试。
- 新增数据结构有迁移和回滚 / 备份说明。
- 错误路径有明确日志和用户可理解的提示。
- 权限、隐私和外部数据处理符合设计约束。
- 相关文档、配置样例和手工测试步骤同步更新。
- 没有未解释的 TODO、真实密钥或临时调试代码进入提交。

# 11. 首轮 Codex 任务拆分

1. 建立 `openspec/` 变更提案，固化本文档中的状态、时间、来源、隐私和取消契约。
2. 初始化 Electron + React + TypeScript 项目，打包一个可启动的 Windows 桌宠壳。
3. 实现透明窗口、拖动、托盘和基础设置持久化。
4. 实现 ModelProvider 接口和一个模型提供商的流式对话，包含取消和隐私目的地。
5. 实现 Tool Runtime，先加入一个无副作用的示例工具。
6. 创建 SQLite 数据库和迁移机制，执行 schema 与约束集成测试。
7. 实现原始对话记录、来源关联、memories、候选记忆和清理队列。
8. 接入 FTS5，再接入 embedding provider 和版本化向量索引。
9. 实现混合检索与上下文预算组装。
10. 实现任务状态机、租约、单次提醒、recurrence 实例和重启恢复。
11. 实现每日总结、记忆中心与主动性设置。
12. 实现基于选定角色图和高风险确认的 AI 姿态候选；扩展动作关键帧与多视图资产。
13. 实现默认透明舞台、背景/道具分层与完整场景候选；场景合成不自动覆盖角色资产。
