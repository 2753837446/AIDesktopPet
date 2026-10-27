# 技术设计

## Embedding

- Provider：SiliconFlow OpenAI-compatible embeddings API。
- model：`BAAI/bge-m3`。
- API Key 使用 Electron safeStorage，单独保存为 `siliconflow.bin`。
- migration v3 增加 `memory_embeddings`，保存 chunk_id、model、dimension、vector_json 和时间。
- 向量在本地 SQLite 中保存并检索；首版使用余弦相似度。

## 混合检索

- FTS5 trigram 提供关键词召回。
- Embedding 提供语义召回。
- 两路结果去重后按 0.55 语义分 + 0.25 关键词分 + 0.15 重要度 + 0.05 时间 freshness 组合。
- embedding 不可用时 queryMode 返回 `keyword_fallback`，用户界面明确显示。

## 异步索引

- 记忆写入或修改后进入内存队列，后台分批生成 embedding。
- 索引失败保留原始记忆，并记录 pending/failed 状态，不阻塞对话。
- 删除记忆时同步删除向量，避免残留召回。

## 每日总结

- 汇总当天 due/completed 任务与更新过的记忆。
- email/calendar 固定标记为 `not_connected`，不构造虚构数据。
- 通过 DeepSeek 生成结构化短摘要并保存到 `daily_briefs`。
- 没有任务和记忆时使用确定性本地文本，不调用模型。
