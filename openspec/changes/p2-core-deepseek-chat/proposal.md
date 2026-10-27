# P2 核心持久化与 DeepSeek 对话

## 背景

P1 桌宠壳已经可运行，但消息、对话和记忆尚未持久化，也没有真实模型能力。现有 Gitee 私有仓库已保存基线。当前需要完成最小 Assistant Core 闭环，使基础桌宠从静态界面变成可恢复、可检索的桌面助手。

## 目标

- 使用 Electron 内置 `node:sqlite` 建立版本化数据库迁移。
- 持久化 conversations、messages、memories、memory_sources 和全文索引。
- 使用 Electron `safeStorage` 保存 DeepSeek API Key，不进入源码、普通配置或日志。
- 接入 `deepseek-flash` OpenAI 兼容流式接口。
- 实现 Assistant Core：消息持久化、上下文预算、记忆检索、流式响应和取消。
- 自动识别用户明确说出的“请记住”类信息，写入可追溯记忆。
- 在桌宠 UI 中提供基础聊天面板和 API Key 配置状态。
- 用假模型验证离线核心链路，用真实 DeepSeek 做一次受控烟雾测试。

## 成功标准

- 应用启动时自动迁移 SQLite，并能报告 schema version。
- 对话消息在应用重启后仍可读取。
- 用户发送消息后能收到 `deepseek-flash` 流式文本。
- 明确记忆可写入数据库，并在后续请求中作为上下文检索。
- API Key 只存在于加密凭据文件，仓库和日志中无明文。
- 类型检查、单元测试、Electron 测试和真实模型冒烟测试通过。

## 不做

- 不实现任务调度、工具调用、邮件 Connector 或向量 embedding。
- 不实现完整记忆中心和任务面板。
- 不引入 QQ、NapCat、AstrBot 或自动浏览。
- 不把 API Key 提交到 Git。
