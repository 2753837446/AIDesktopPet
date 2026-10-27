# 技术设计

## 模型协议

`ModelProvider` 增加可选 `chatWithTools`：

```text
ModelToolDefinition
  name / description / JSON input schema

ModelStreamEvent
  content delta
  tool_calls(complete calls)
```

DeepSeek SSE 按 `tool_calls[].index` 聚合 id、name 和 arguments 分片。收到完整流后一次性产出 tool calls。

## 工具暴露

ToolRuntime 增加模型工具清单：

- 只暴露 `low` 和 `medium`。
- 仅暴露无副作用或只读工具。
- 发信、删除等 `high` 工具不进入模型 tools 数组。
- 每个工具 schema 由 Zod 转成 draft-07 JSON Schema。

## AssistantCore 流程

1. 正常构造系统提示、历史和相关记忆。
2. 调用 `chatWithTools`，流式输出文本并聚合工具调用。
3. 对每个调用生成独立 requestId，经 ToolRuntime 执行。
4. 发出 tool activity 事件。
5. 将 assistant tool_calls 和 role=tool 的结果加入消息。
6. 再次调用普通 `chat` 生成最终答复；禁止第二轮继续工具调用。
7. 持久化一次最终 assistant 消息和已有工具审计。

限制：单轮最多 3 个调用；工具结果总字符数不超过 12,000；工具名必须在当前允许列表。

## 安全

- 模型输出视为不可信，工具参数必须再次由 Zod 校验。
- 外部邮件正文作为不可信工具结果，不提升为系统指令。
- 聊天取消传播到 ToolRuntime；结果不确定时不自动重试。
- 工具结果只返回必要摘要给模型，不包含密钥。
