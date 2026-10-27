# P5 BGE-M3 混合检索与每日总结

## 背景

当前记忆检索依赖 FTS5 和重要记忆 fallback，任务与记忆已经持久化。下一阶段需要提高语义召回，并把这些本地数据汇总成有来源状态的每日总结。

## 目标

- 增加可配置的 SiliconFlow BGE-M3 embedding Provider。
- 保存记忆向量并在本地执行余弦相似度检索。
- 将向量分数、关键词分数、重要度和时间组合成混合排序。
- embedding 未配置或失败时保持 FTS5 fallback，不阻塞对话。
- 新增每日总结服务，只汇总本地 tasks 和 memories。
- 明确展示 tasks、memories、email、calendar 的数据源状态。
- 增加设置页 embedding 配置、记忆搜索状态和每日总结 UI。

## 成功标准

- 配置 BGE-M3 后可生成、更新和删除记忆向量。
- 语义相近但关键词不同的查询能召回记忆。
- embedding 服务失败时仍可正常聊天和关键词检索。
- 每日总结不虚构邮件或日历数据，缺失来源明确标记。
- 单元测试、Electron 测试、打包和真实 DeepSeek 回归通过。

## 不做

- 不接入第二家 embedding 服务。
- 不实现定时每日总结任务；本轮先提供持久化生成结果和手动生成。
- 不实现邮件或日历 Connector。
