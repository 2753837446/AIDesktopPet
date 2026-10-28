# Security Policy

## 报告漏洞

请优先使用 GitHub 的 **Private Vulnerability Reporting**，不要公开提交包含以下内容的 Issue：

- API Key、密码、OAuth Token 或授权码
- 可复现的远程代码执行、越权或数据泄漏步骤
- 完整的私人邮件、记忆、文件或屏幕截图
- 可利用的依赖漏洞细节

## 安全边界

- 密码必须强哈希；JWT Secret 和初始化令牌只从环境变量读取。
- 所有 Workspace 查询必须绑定认证用户和 Workspace。
- 模型、邮件、网页、文件和 Connector 响应都是不可信输入。
- 高风险外部动作必须经过权限、确认、超时和审计。
- `local_only` 与设备私有数据不得发送给云端模型。
- 智能家居安全联锁不得由 LLM 临时决定。

## 支持版本

项目处于早期阶段，默认只维护 `main` 分支的最新代码。
