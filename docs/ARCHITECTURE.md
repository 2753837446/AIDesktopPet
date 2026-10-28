# Architecture

版本：V0.1 · 2026-10-28

## 云边边界

云端负责账户、设备、数字伙伴身份、外观版本、会话、共享记忆、任务和同步事件。设备负责渲染、输入、通知、本地能力和离线缓存。

## Monorepo

```text
apps/api       Fastify 服务与 SQLite 持久化
apps/web       React Web/PWA 客户端
apps/desktop   Electron 壳
packages/contracts  Zod API 契约
```

## 数据边界

- Workspace 是所有同步数据的安全边界。
- Assistant 是持久身份；Appearance 是可替换外观。
- Conversation 属于 Assistant。
- Memory 明确 scope、visibility 和 version。
- Task 可分配给 Assistant，也属于 Workspace。

## 智能家居边界

智能家居作为独立 Connector 域，不直接耦合到聊天或数字伙伴身份：

```text
Home Connector
  ├─ Device Inventory
  ├─ Capability / State
  ├─ Scene Definition
  ├─ Scene Executor
  ├─ Approval Policy
  └─ Audit
```

第一版只预留接口，不实现设备控制。后续优先接入 Home Assistant 作为聚合层，再根据实际设备覆盖情况评估 Matter、MQTT 和厂商 API。设备状态和场景执行由确定性状态机负责；模型只能提出计划和请求工具，不能直接绕过权限或安全联锁。
