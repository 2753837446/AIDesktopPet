# 技术设计

## 领域对象

```text
User
  -> Workspace
     -> Device[]
     -> Assistant[]
        -> Appearance
        -> Conversation[]
        -> MemoryScope[]
        -> Task[]
```

核心 ID 分离：

- `assistant_id`：持久身份。
- `appearance_id`：可替换身体/皮肤。
- `conversation_id`：与某伙伴的会话。
- `device_id`：当前设备。
- `workspace_id`：个人数字空间。

## 记忆

```text
MemoryScope =
  | "personal"      # 用户所有伙伴可授权读取
  | "assistant"     # 伙伴私有
  | "project"       # 项目共享
  | "device"        # 设备私有，不上云
```

`personal` 与 `assistant` 云端可同步；`device` 只允许客户端本地保存。`local_only` 数据不允许发送给云端模型。

## 后端

- Fastify + TypeScript。
- 服务端 SQLite 作为单人部署的首版权威存储，使用版本化 migration。
- JWT Bearer 鉴权；初始化需要独立 Bootstrap Token。
- 每个写操作推进 Workspace revision，并写入同步事件。
- 模型调用通过 OpenAI-compatible provider；默认 mock provider 可在无 Key 时体验。

## 客户端

- React + Vite，响应式支持桌面与手机浏览器。
- 本地保存 token、设备 ID、最后同步游标和离线草稿。
- 先实现 Web；Electron 桌面壳复用同一前端。

## 外观

首版外观是结构化 `appearance_json`：头像、主题色、形态、服装标签和展示方式。后续接入图片资产、多视图、骨骼和 3D。换外观只更新 appearance revision，不改变 assistant identity。
