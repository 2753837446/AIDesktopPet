# ARCHITECTURE.md｜Windows AI 桌宠系统架构

*逻辑分层、数据流、存储、适配器、安全、恢复和演进路线*

版本：V0.4 · 日期：2026-10-27

# 1. 架构目标

- 桌宠 UI 与 Agent runtime 解耦。
- 长期记忆与任务状态由产品自己的服务和数据库掌握。
- 模型、embedding、Agent 框架、外部连接器均可替换。
- 任务调度具备持久化、幂等、恢复和可观测性。
- 默认本地优先，外部数据访问通过明确授权。

# 2. 逻辑架构

```text
Windows Desktop App
  ├─ Pet UI / Chat / Daily Brief / Tasks / Memory Center
  ├─ Desktop Shell: transparent window, tray, startup, notifications
  └─ Application Facade
       ├─ Assistant Core
       │    ├─ Intent Router
       │    ├─ Context Builder + Token Budget
       │    ├─ Model Router
       │    └─ Conversation State
       ├─ Tool Runtime
       │    ├─ Tool Registry + Capability Schema
       │    ├─ Permission / Risk Gate
       │    ├─ Timeout / Cancellation / Reconciliation
       │    └─ Execution Audit
       ├─ Character Runtime
       │    ├─ Image / GIF Adapter
       │    ├─ Layered Stage Adapter
       │    ├─ AI Pose Director
       │    ├─ Sprite Sheet Adapter
       │    ├─ Rigged 2D Adapter
       │    └─ Optional GLB 3D Adapter
       ├─ Memory Service
       │    ├─ Candidate Extractor
       │    ├─ Conflict / Dedup / Versioning
       │    ├─ Hybrid Retrieval
       │    └─ Index Manager
       ├─ Task Engine
       │    ├─ Persistent Scheduler
       │    ├─ Event Bus + Rule Engine
       │    ├─ Executor + Retry Manager
       │    └─ Notification Center
       ├─ Connectors
       │    ├─ Filesystem
       │    ├─ Email
       │    ├─ Calendar
       │    └─ Windows Notifications
       └─ Persistence
            ├─ SQLite structured data
            ├─ SQLite FTS5
            ├─ Vector index / embedding cache
            ├─ Raw conversation and event records
            └─ Audit / execution logs
```

# 3. 运行时部署建议

首版可以在单个桌面应用内使用清晰模块边界，不必一开始拆成多个本地微服务。将长期记忆、任务调度、模型调用和连接器定义为独立模块，通过接口通信。若后续需要更强隔离、后台常驻或独立升级，再将 Task Engine 或工具执行层拆成独立进程。

## 3.1 为什么不把 Agent runtime 当作产品核心

- 现成 Agent 框架适合加速验证工具调用、插件和上下文治理。
- 产品需要自己控制桌宠 UI、长期记忆数据模型、任务状态、权限和主动性规则。
- Agent 框架可以被替换，不应导致记忆数据丢失或任务系统重写。
- 桌宠基础功能不能依赖外部机器人通道或 Agent 服务完全正常。

# 4. 核心模块职责

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| Desktop Shell | 窗口、托盘、开机启动、系统通知 | 推理策略和记忆排序 |
| Assistant Core | 意图、上下文组装、模型路由、对话状态 | 永久存储全部历史的唯一副本 |
| Memory Service | 候选记忆、版本、冲突、混合检索、索引 | 定时提醒与任务执行 |
| Task Engine | 调度、事件、状态机、重试、通知 | 自由决定用户目标 |
| Tool Runtime | 工具注册、参数校验、权限、执行日志 | 绕过权限直接执行高风险操作 |
| Model Adapter | LLM / embedding / image-edit 请求与响应转换 | 业务规则和用户授权 |
| Connector | 对外部系统进行授权访问 | 擅自扩大访问范围 |
| Character Runtime | 角色状态、形象切换、多视图与动作适配 | 记忆、任务和外部权限 |
| Persistence | 结构化数据、全文 / 向量索引、审计 | 在索引失败时丢弃原始数据 |

# 5. 核心数据流

## 5.1 用户对话

1. UI 将用户消息提交给 Assistant Core。
2. Intent Router 识别意图、项目和是否需要工具。
3. Context Builder 读取固定上下文，并请求 Memory Service 检索相关记忆。
4. Token Budgeter 裁剪上下文，保留来源和关键事实。
5. Model Adapter 调用模型并流式返回内容。
6. 若模型请求工具，Tool Runtime 校验 schema、权限和风险等级。
7. 执行结果返回模型继续生成，或呈现给用户。
8. 原始消息持久化；记忆提炼在后台执行，任务状态写入 Task Engine。

## 5.2 长期记忆写入

1. 对话 / 任务事件进入原始事件存储。
2. 候选提取器识别事实、偏好、项目决定和承诺。
3. 冲突与去重模块判断自动写入、等待确认或忽略。
4. 结构化记录写入 SQLite。
5. 索引管理器更新 FTS5 与向量索引。
6. 索引失败时标记 pending / failed，后台重试；不影响原始记录保存。

## 5.3 主动任务

1. 用户或规则创建任务，Task Engine 持久化。
2. Scheduler 根据计划时间或事件触发任务。
3. Rule Engine 检查去重、免打扰、权限和确认条件。
4. Executor 执行确定性动作；需要理解和总结时调用 Assistant Core。
5. 记录结果、错误、重试与审计日志。
6. Notifier 向桌宠 UI 和系统通知呈现结果。

## 5.4 AI 角色姿态

1. 聊天确定性识别或设置页输入生成姿态描述；不在识别阶段调用外部服务。
2. UI 展示当前参考资产、姿态描述、图像模型、云端上传、可能费用和“只生成候选”说明。
3. 用户确认后，主进程读取受控角色资产，通过独立 `CharacterImageEditProvider` 发送单张参考图和固定保真模板。
4. Provider 运行时校验返回结构；结果 URL 必须为公网 HTTPS，并立即下载，不依赖临时链接。
5. 图片重新校验魔数、尺寸和 10 MiB 上限后保存为 `origin=ai_generated` 的新资产。
6. 生成结果不修改 `appearance.customCharacterId`；用户预览并点击“设为桌宠”后才切换。
7. 原图与历史候选保留，派生资产记录 `source_asset_id`、提示词、模型和生成时间；生成操作写入审计。

## 5.5 分层舞台

1. 背景、道具和角色使用同一受控资产存储，但通过 `category` 区分。
2. 默认舞台不绘制背景，窗口透明区域直接显示桌面。
3. 用户选择背景后按 `background -> props -> character` 渲染，道具最多 3 个并使用固定槽位。
4. 完整 `scene` 资产是已合成的单张图；选择时只显示 scene，并清空独立背景与道具选择，避免重复背景。
5. 背景和道具失败或删除时只降级对应图层，不阻塞聊天、记忆和任务。

# 6. 存储方案

| 存储类型 | 首版建议 | 理由 |
| --- | --- | --- |
| 结构化数据 | SQLite | 本地优先、部署简单、支持事务 |
| 全文搜索 | SQLite FTS5 | 准确词项、文件名和实体检索 |
| 向量索引 | 评估 sqlite-vec 等方案 | 避免首版引入独立向量数据库服务；需做兼容性测试 |
| 原始对话 / 事件 | SQLite 分表或按策略分文件 | 保留可追溯证据，避免摘要成为唯一来源 |
| 执行日志 | SQLite，必要时滚动归档 | 支持故障诊断和任务恢复 |
| 密钥 | 操作系统凭据存储或经验证的安全方案 | 避免明文配置 |

# 7. 接口边界

## 7.1 模型适配

定义统一的 chat streaming、embedding、模型能力描述、错误类型、超时、取消和重试策略。上层不应依赖某家模型的私有响应结构。

## 7.2 Agent 适配

定义 AgentAdapter 接口，用于发送会话上下文、注册 / 调用工具、获取运行状态和取消任务。若自研 Tool Runtime 已足够，则不强制引入外部 Agent runtime。

## 7.3 Connector 接口

连接器应统一暴露授权状态、能力清单、事件订阅 / 轮询、数据读取、动作执行、错误和撤销授权。每个 connector 声明权限范围与风险等级。Connector 不直接暴露给 UI 或模型；所有读取与动作经 Tool Runtime 执行。

## 7.4 契约基线

- 任务状态唯一枚举为 `pending / scheduled / running / waiting_confirmation / retry_scheduled / completed / failed / cancelled / expired / needs_reconciliation`。
- 时间在持久化和接口层统一使用 UTC RFC 3339 文本；用户时区只用于输入、展示和本地调度计算。
- 记忆来源以 `memory_sources` 为规范关联；`origin` 单独标记 `user_explicit / model_inferred / imported / verified`，不得用渠道类型代替知识来源性质。
- `local_only` 数据只能进入本地处理链路；Context Builder 必须知道本次模型目标是本地还是云端，并在组装前完成过滤。
- 删除记忆后立即从所有读取路径和缓存中阻断，索引和派生摘要的物理清理可以进入异步清理队列。

## 7.5 角色展现边界

- UI 只依赖统一的 Character Runtime 状态接口：`idle / talking / thinking / dragging / happy / sleepy`。
- 当前支持静态图片、GIF 和单张 AI 姿态候选；后续可增加 Sprite Sheet、分层骨骼 2D 和 GLB 3D 适配器。
- 角色、背景、透明道具和完整场景使用分类资产；默认未选择背景时保持透明舞台。
- 分层舞台顺序固定为背景、道具、角色和桌面 UI；完整场景不与其他图层叠加。
- `CharacterImageEditProvider` 与聊天模型隔离，只接收参考图、姿态描述和固定模板，不读取会话、记忆、密钥或其他私人数据。
- AI 姿态是有来源的单帧资产，不是自动绑定骨骼或可自由驱动的 3D 模型。连续动作需要动作关键帧、Sprite Sheet 或真正的 GLB 骨架与动画 Clip。
- 多视图图片可作为 2D 转向和 3D 制作参考，但不能直接被视为自动绑定、自动动画的 3D 模型。
- 角色资产必须校验类型、大小、尺寸、版本和允许字段，不执行包内代码。
- 角色渲染失败时回退内置角色，不阻塞聊天和任务。

# 8. 安全架构

- 所有工具调用通过 Tool Runtime，不能由模型直接访问任意系统资源。
- 使用 schema 验证模型参数和外部数据。
- 邮件、网页、文件内容视为不可信数据，和系统指令分离。
- 发送邮件、删除文件、付款或外部提交必须确认。
- 密钥不进入提示词、普通日志或记忆索引。
- 连接器使用最小权限，并支持撤销授权。
- 模型适配层必须接收明确的数据处理目的地；`local_only` 内容不能发送到云端模型。
- 用户删除记忆时同步处理索引、缓存和派生摘要。

# 9. 错误处理与恢复

| 故障 | 预期行为 |
| --- | --- |
| 模型超时 / 限流 | 停止或退避重试，保留对话草稿并显示错误 |
| Embedding API 不可用 | 保存原始记忆，标记索引待处理；必要时退化为全文搜索 |
| 向量索引损坏 | 从有效记忆记录重建，不丢弃原始记录 |
| 任务执行中应用崩溃 | 启动时检查任务租约和状态，按幂等策略恢复 |
| 连接器失效 | 显示授权 / 网络状态，不虚构外部数据 |
| 图像编辑超时 / 取消 | 停止等待，保留当前形象；已提交的云端请求不自动重试 |
| 图像结果非法或地址不安全 | 丢弃结果并记录错误；不写入资产目录、不切换形象 |
| Agent runtime 不可用 | 保留桌宠 UI、本地记忆与任务面板的基本可用性 |
| 数据库迁移失败 | 停止破坏性写入，提示恢复 / 备份路径 |

# 10. 可观测性

- 每个对话、工具调用、任务运行和外部事件都有 trace / correlation ID。
- 分别记录检索耗时、上下文组装耗时、模型首字延迟、完整生成耗时和工具耗时。
- 记忆检索记录候选数量、最终选中数量、来源类型和预算裁剪原因。
- 任务日志记录触发原因、幂等键、状态转换、重试和用户确认。
- 默认脱敏敏感数据，提供用户可导出的诊断包。

# 11. 架构演进路线

1. 单进程模块化桌面应用，验证产品闭环。
2. 按性能和可靠性指标优化 SQLite、FTS5、向量检索和任务调度。
3. 必要时将后台调度 / 工具执行拆为独立进程。
4. 有明确用户需求后再增加云端同步、多设备记忆和协作能力。
5. 有充分评测证据后再加入更复杂的多 Agent 协作、重排序和高级记忆策略。
