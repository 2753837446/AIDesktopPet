# 技术设计

## 仓库结构

```text
apps/desktop/
  src/main/       # Electron 主进程、托盘和设置存储
  src/preload/    # contextBridge 白名单 API
  src/renderer/   # React 桌宠与设置界面
  src/shared/     # 主进程与渲染层共享类型
  tests/          # Vitest 单元测试和 Electron 烟雾测试
```

## 进程边界

- 主进程负责 BrowserWindow、Tray、窗口位置、开机自启和设置文件。
- renderer 启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`。
- preload 只暴露版本、平台、读取设置、更新设置、显示/隐藏窗口和退出等白名单方法。
- 所有 IPC 输入在 main 进程重新校验，不信任 renderer 参数。

## 设置模型

```ts
interface DesktopSettings {
  version: 1;
  window: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    alwaysOnTop: boolean;
    showInTaskbar: boolean;
  };
  proactive: {
    enabled: boolean;
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
    };
  };
  startup: {
    launchAtLogin: boolean;
  };
  appearance: {
    character: "azure";
    scale: number;
  };
}
```

设置文件写入 Electron `userData` 目录。读取时使用 schema 校验；文件缺失、损坏或版本不支持时记录诊断并采用默认值。写入使用临时文件加原子替换，避免半写文件。

## 窗口

- 默认尺寸 360×440，最小尺寸 260×320。
- `transparent=true`、`frame=false`、`alwaysOnTop=true`、`resizable=true`。
- 窗口移动和缩放经节流后写回设置。
- 开发模式加载 Vite dev server；生产模式加载构建后的 HTML。

## 托盘

菜单包含：

- 显示 / 隐藏桌宠。
- 暂停 / 恢复主动提醒。
- 打开设置。
- 退出应用。

托盘图标使用运行时生成的内存图像，不引入二进制资源依赖。

## 安全

- 不启用 `remote`、`webviewTag` 或 `nodeIntegration`。
- 拒绝未登记 IPC channel。
- 外链暂不开放；设置界面不接收任意 URL。
- 本切片不保存模型密钥。
