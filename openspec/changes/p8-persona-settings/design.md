# 技术设计

## 数据

`DesktopSettings.persona`：

- version
- preset
- name
- selfReference
- userTitle
- description
- tone
- replyLength
- boundaries
- proactiveStyle

旧设置文件通过 Zod default 补齐默认 persona，不重置其他设置。

## 提示词

固定安全底座负责系统规则、事实边界和权限约束。persona 只负责称呼、性格、语气、长度和主动性表达。组装顺序：

1. 固定安全规则。
2. 角色表达偏好。
3. 明确要求：安全与权限规则优先，冲突时忽略角色配置。
4. 长期记忆证据。

## UI

- 预设：阿湛、冷静助手、活力伙伴。
- 编辑字段后 preset 转为 custom。
- 提供人格 Prompt 预览。
- JSON 导入大小上限 100 KB，未知字段由设置校验拒绝。
- 导出只包含 persona 包，不包含 API Key、记忆或任务。
