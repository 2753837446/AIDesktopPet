# 技术设计

## SQLite

- 使用 Electron 45 / Node 24 内置 `node:sqlite`。
- 启动时打开 `userData/ai-desktop-pet.sqlite`，启用外键、WAL 和 busy timeout。
- migration 记录写入 `schema_migrations`，每个 migration 在单一事务中执行。
- 初始 migration 覆盖 conversations、messages、memories、候选记忆、来源、chunks 和 FTS5。
- FTS 使用 trigram tokenizer，优先服务中英文短语和中文连续文本检索；仍保留重量级关键词 fallback。

## 密钥

- 使用 Electron `safeStorage` 加密 DeepSeek API Key，写入 `userData/credentials/deepseek.bin`。
- renderer 只能提交新 Key 和读取“是否已配置”，不能读取 Key 明文。
- DeepSeek Provider 通过 getter 在请求时取 Key；错误和日志不包含 Authorization。

## DeepSeek Provider

- endpoint：`https://api.deepseek.com`。
- model：`deepseek-flash`。
- 使用 OpenAI 兼容 `/chat/completions` 和 `stream=true`。
- 解析 SSE `data:` 事件，忽略空事件与 `[DONE]`。
- 实现超时、AbortSignal、非 2xx 错误映射和响应结构校验。

## Assistant Core

1. 获取或创建 conversation。
2. 写入 user message。
3. 检索相关记忆并构建有界上下文。
4. 调用 ModelProvider 并逐块产生事件。
5. 完整响应完成后写入 assistant message。
6. 用户明确要求记住的信息写入 memory 和 source 关联。

## 记忆基线

- 支持 `preference`、`project_decision` 和 `fact`。
- 仅把用户明确表达的内容以 `origin=user_explicit` 写入。
- cloud 模型请求排除 `local_only` 记忆。
- 记忆检索按相关性、重要度和时间排序，并限制 token 预算。

## UI

- 主窗口新增 chat 模式，显示历史、流式回复、发送、停止和错误。
- 设置页显示 DeepSeek 配置状态，允许替换或清除 Key。
- 所有模型文本按纯文本渲染，不执行 HTML。

## 风险

- trigram FTS 对短于 3 个字符的查询需要 fallback。
- DeepSeek 可用性、限额和模型别名可能变化，需要清晰错误提示。
- 真实模型测试只发送最小测试消息，不在日志输出 Key。
