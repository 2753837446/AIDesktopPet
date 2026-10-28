# Contributing

感谢参与 Personal Digital Companion。这个项目探索的是“多个跨设备持续存在的数字伙伴”，而不是单个聊天窗口或单一桌宠皮肤。

## 开始之前

请先阅读：

- [产品需求](docs/PRD.md)
- [系统架构](docs/ARCHITECTURE.md)
- [安全边界](docs/SECURITY.md)
- [路线图](ROADMAP.md)
- [OpenSpec 当前变更](openspec/changes/p1-personal-companion-foundation/proposal.md)

## 本地开发

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
pnpm dev
```

- API：<http://127.0.0.1:8787>
- Web：<http://127.0.0.1:5173>

初始化令牌来自 `.env` 的 `BOOTSTRAP_TOKEN`。默认 `MODEL_PROVIDER=mock`，没有模型 Key 也能完成基础流程。

## 质量标准

提交前至少执行：

```powershell
pnpm check
pnpm test
pnpm build
```

新增行为必须有测试。涉及数据库时必须有 migration；涉及外部请求时必须有超时、取消和稳定错误码；涉及高风险动作时必须经过确认和审计。

## 领域约束

- `assistant_id` 是持久身份，`appearance` 只是可替换外观。
- 换装、换 Avatar 不得改变会话、记忆和关系。
- 记忆必须区分 `personal / assistant / project`，设备私有数据不得上传。
- 不同数字伙伴的私有记忆和工具权限必须隔离。
- 模型可以生成计划，但不能绕过权限、安全联锁或用户确认。
- 智能家居是后续必需能力，设备状态、场景和授权必须通过独立 Connector。

## 提交方式

1. 功能或架构变化先提出 Issue 或 OpenSpec 提案。
2. 从 `main` 创建短生命周期分支。
3. 保持提交聚焦，避免顺手重构无关模块。
4. PR 描述包含：问题、方案、风险、验证证据和截图（涉及 UI 时）。
5. 不提交密钥、个人数据、构建产物或大体积模型/视频。

## 优先贡献方向

- 多设备增量同步与冲突解决。
- 记忆提取、纠错、版本和删除传播。
- 数字伙伴外观/服装/动作包。
- AstrBot、LangGraph、MCP 和 Home Assistant Adapter。
- Web、桌面和移动端体验。
- 安全、可观测性、备份恢复和部署。

## 许可证

提交代码即表示你同意以仓库的 MIT License 发布贡献。请只提交你有权使用的代码、图片、声音和角色资产。
