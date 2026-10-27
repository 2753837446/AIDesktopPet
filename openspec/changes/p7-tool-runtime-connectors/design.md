# 技术设计

## 数据

migration v5：

- tool_calls：请求、工具、输入摘要、风险、状态、审批、结果和错误。
- connectors：服务商、授权状态、scope 和最近错误。
- audit_logs：工具调用、权限和状态转换。

## 执行

- ToolDefinition 使用 Zod schema。
- PermissionPolicy 检查 scope。
- low：有 scope 时直接执行。
- medium/high：需要确认。
- critical：默认拒绝，除非未来启用显式策略。
- 每次执行有 timeout、AbortSignal 和稳定 trace ID。
- requestId 作为幂等键。

## Connector

- Connector 只通过 Tool Runtime 暴露能力。
- 当前注册 email Connector 记录，provider 为空，状态 disconnected。
- UI 明确提示需要用户选择服务商和授权方式。
