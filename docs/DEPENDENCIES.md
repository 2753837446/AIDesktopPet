# 依赖与许可证说明

版本：V0.1 · 日期：2026-10-27

# 1. 直接依赖

| 依赖 | 版本 | 许可证 | 用途 | Windows 打包考虑 |
| --- | --- | --- | --- | --- |
| Electron | 45.0.0 | MIT | 桌面窗口、托盘、系统通知和隔离 preload | 体积较大，但 Windows x64 支持成熟；首次安装包仍需真机验证 |
| React / React DOM | 19.3.1 | MIT | 设置页与桌宠界面 | 纯渲染层依赖，兼容 Electron Chromium |
| Zod | 4.6.7 | MIT | 配置和 IPC 输入运行时校验 | 无原生模块，打包风险低 |
| electron-vite | 6.0.0 | MIT | main / preload / renderer 三端构建 | 支持 Vite 8；构建输出由 electron-builder 打包 |
| Vite | 8.3.5 | MIT | renderer 开发服务器与生产构建 | 需要 Node 22+ 构建环境，用户运行安装包时不需要 Node |
| TypeScript | 7.0.2 | Apache-2.0 | 严格类型检查 | 仅构建期依赖 |
| Electron Builder | 26.18.0 | MIT | Windows NSIS 安装包配置 | 后续需要签名证书、图标和干净环境安装测试 |
| Vitest | 5.0.5 | MIT | 设置存储单元测试 | 仅开发期依赖 |
| Playwright | 1.64.1 | Apache-2.0 | Electron 启动与窗口烟雾测试 | 复用 Electron 二进制，不随应用分发浏览器 |

# 2. 选择说明

## Electron

选择原因：

- 满足透明窗口、无边框拖动、托盘、开机启动和 Windows 通知需求。
- React 渲染层与 Node 主进程可以通过隔离 preload 明确分离。
- 生态成熟，便于后续接入 SQLite、文件系统和系统凭据存储。

代价：

- 安装包和内存占用高于原生或 Tauri 方案。
- Chromium、Node 和 Electron 需要持续跟进安全更新。

替代方案：

- Tauri：安装包更小，但当前团队需要同时维护 Rust 外壳和 Web UI，首版复杂度更高。
- .NET WPF/WinUI：Windows 集成强，但跨平台扩展与现有 Web 技术栈复用较少。

## TypeScript 7

当前使用最新 TypeScript 进行严格检查。若 Electron 工具链或编辑器插件出现兼容问题，可回退到 TypeScript 6.x，并保持 strict 配置不变。

# 3. 原生模块策略

当前 P1 没有原生运行时模块。SQLite 阶段需要单独评估并验证：

- better-sqlite3 等 binding 的 Electron ABI、Windows x64 构建和升级流程。
- sqlite-vec 等向量扩展的 Windows 兼容性、包体积和许可证。
- 原生模块签名、更新与错误恢复。

在完成集成测试前，不把任何 SQLite 或向量扩展写入生产依赖。

P1 已验证 `dist/win-unpacked` 可以启动。当前构建明确关闭可执行文件编辑和签名，因此它只用于开发验证，不得作为正式发布包；正式发布前必须补应用图标、版本元数据、代码签名、NSIS 安装和干净 Windows 环境测试。

# 4. 许可证策略

- 构建时执行依赖列表检查，新增依赖必须记录版本、许可证、用途和替代方案。
- 不得直接嵌入 AGPL 或其他有分发义务的 Agent runtime / 插件源码，除非完成许可证评估。
- Electron 与第三方库的许可证文本随安装包或产品“关于”页面提供。
