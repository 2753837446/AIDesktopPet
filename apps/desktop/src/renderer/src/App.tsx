import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopBootstrap } from "../../shared/desktop-api";
import type {
  DesktopSettings,
  DesktopSettingsPatch,
} from "../../shared/settings";

type LoadState = "loading" | "ready" | "error";

export function App(): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const settingsRef = useRef<DesktopSettings | null>(null);

  useEffect(() => {
    const api = window.desktop;
    if (!api) {
      setLoadState("error");
      setStatusMessage("桌面桥接不可用，请从 Electron 启动应用。");
      return;
    }

    let active = true;
    void api
      .getBootstrap()
      .then((value) => {
        if (!active) {
          return;
        }
        settingsRef.current = value.settings;
        setBootstrap(value);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        console.error("加载桌宠状态失败", error);
        if (active) {
          setLoadState("error");
          setStatusMessage("无法读取桌面设置，请重新启动应用。");
        }
      });

    const unsubscribeSettings = api.onSettingsChanged((settings) => {
      settingsRef.current = settings;
      setBootstrap((current) => (current ? { ...current, settings } : current));
    });
    const unsubscribeOpen = api.onOpenSettings(() => {
      setSettingsOpen(true);
    });

    return () => {
      active = false;
      unsubscribeSettings();
      unsubscribeOpen();
    };
  }, []);

  const updateSettings = useCallback(
    async (patch: DesktopSettingsPatch): Promise<void> => {
      const api = window.desktop;
      if (!api) {
        return;
      }
      const previous = settingsRef.current;
      if (previous) {
        const optimistic = mergeLocalSettings(previous, patch);
        settingsRef.current = optimistic;
        setBootstrap((current) =>
          current ? { ...current, settings: optimistic } : current,
        );
      }
      setStatusMessage("");
      try {
        const next = await api.updateSettings(patch);
        settingsRef.current = next;
        setBootstrap((current) => (current ? { ...current, settings: next } : current));
      } catch (error) {
        console.error("保存设置失败", error);
        if (previous) {
          settingsRef.current = previous;
          setBootstrap((current) =>
            current ? { ...current, settings: previous } : current,
          );
        }
        setStatusMessage("设置保存失败，请检查磁盘权限后重试。");
      }
    },
    [],
  );

  const openSettings = useCallback(async (): Promise<void> => {
    setSettingsOpen(true);
    await window.desktop?.setWindowMode("settings");
  }, []);

  const closeSettings = useCallback(async (): Promise<void> => {
    setSettingsOpen(false);
    await window.desktop?.setWindowMode("pet");
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        void closeSettings();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings, settingsOpen]);

  if (loadState === "loading") {
    return (
      <main className="app-frame loading-frame" aria-live="polite">
        <div className="loading-orb" />
        <span>正在唤醒桌宠…</span>
      </main>
    );
  }

  if (loadState === "error" || !bootstrap) {
    return (
      <main className="app-frame error-frame" aria-live="polite">
        <strong>桌宠没有正常启动</strong>
        <span>{statusMessage || "未知错误"}</span>
      </main>
    );
  }

  const settings = bootstrap.settings;

  return (
    <main className={settingsOpen ? "app-frame settings-frame" : "app-frame pet-frame"}>
      {settingsOpen ? (
        <SettingsPanel
          bootstrap={bootstrap}
          onClose={() => void closeSettings()}
          onUpdate={(patch) => void updateSettings(patch)}
          onQuit={() => void window.desktop?.quit()}
          statusMessage={statusMessage}
        />
      ) : (
        <PetStage
          settings={settings}
          onOpenSettings={() => void openSettings()}
        />
      )}
    </main>
  );
}

function mergeLocalSettings(
  current: DesktopSettings,
  patch: DesktopSettingsPatch,
): DesktopSettings {
  return {
    ...current,
    window: {
      ...current.window,
      ...patch.window,
    },
    proactive: {
      ...current.proactive,
      ...patch.proactive,
      quietHours: {
        ...current.proactive.quietHours,
        ...patch.proactive?.quietHours,
      },
    },
    startup: {
      ...current.startup,
      ...patch.startup,
    },
    appearance: {
      ...current.appearance,
      ...patch.appearance,
    },
  };
}

interface PetStageProps {
  settings: DesktopSettings;
  onOpenSettings: () => void;
}

function PetStage({ settings, onOpenSettings }: PetStageProps): React.JSX.Element {
  return (
    <section
      className="pet-stage drag-region"
      data-testid="pet-window"
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenSettings();
      }}
    >
      <div className="ambient-glow" aria-hidden="true" />
      <div className="status-bubble">
        <strong>我在呢。</strong>
        <span>AI 对话尚未配置，基础桌宠可以使用。</span>
      </div>

      <div
        className="character-wrap"
        style={{ transform: `scale(${settings.appearance.scale})` }}
      >
        <AzureCharacter />
      </div>

      <div className="pet-footer no-drag">
        <div className="availability">
          <span className="status-dot" />
          基础桌宠可用
        </div>
        <button className="icon-button" type="button" onClick={onOpenSettings}>
          <GearIcon />
          <span>打开设置</span>
        </button>
      </div>
    </section>
  );
}

interface SettingsPanelProps {
  bootstrap: DesktopBootstrap;
  onClose: () => void;
  onUpdate: (patch: DesktopSettingsPatch) => void;
  onQuit: () => void;
  statusMessage: string;
}

function SettingsPanel({
  bootstrap,
  onClose,
  onUpdate,
  onQuit,
  statusMessage,
}: SettingsPanelProps): React.JSX.Element {
  const { settings, meta } = bootstrap;

  return (
    <section className="settings-panel no-drag" role="dialog" aria-modal="true">
      <header className="settings-header">
        <div>
          <span className="eyebrow">AI DESKTOP PET</span>
          <h1>桌宠设置</h1>
          <p>首版基础壳 · v{meta.appVersion}</p>
        </div>
        <button className="close-button" type="button" onClick={onClose}>
          返回桌宠
        </button>
      </header>

      <div className="model-notice">
        <span className="notice-mark">AI</span>
        <div>
          <strong>模型尚未配置</strong>
          <p>基础桌宠、窗口与设置可用；对话功能将在下一阶段接入。</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="setting-group">
          <h2>桌面体验</h2>
          <SettingToggle
            label="窗口置顶"
            description="让桌宠保持在其他窗口上方。"
            checked={settings.window.alwaysOnTop}
            onChange={(alwaysOnTop) => onUpdate({ window: { alwaysOnTop } })}
          />
          <SettingToggle
            label="在任务栏显示"
            description="关闭时主要通过托盘找到桌宠。"
            checked={settings.window.showInTaskbar}
            onChange={(showInTaskbar) => onUpdate({ window: { showInTaskbar } })}
          />
          <div className="scale-control">
            <div>
              <strong>角色大小</strong>
              <p>调整桌宠在窗口中的显示比例。</p>
            </div>
            <div className="segmented-control" aria-label="角色大小">
              {[0.85, 1, 1.15].map((scale) => (
                <button
                  className={settings.appearance.scale === scale ? "selected" : ""}
                  key={scale}
                  type="button"
                  onClick={() => onUpdate({ appearance: { scale } })}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setting-group">
          <h2>主动提醒</h2>
          <SettingToggle
            label="启用主动反馈"
            description="后续提醒与每日总结将遵循此总开关。"
            checked={settings.proactive.enabled}
            onChange={(enabled) => onUpdate({ proactive: { enabled } })}
          />
          <SettingToggle
            label="启用免打扰时段"
            description="在指定时段内暂停普通通知。"
            checked={settings.proactive.quietHours.enabled}
            onChange={(enabled) => onUpdate({ proactive: { quietHours: { enabled } } })}
          />
          <div className={settings.proactive.quietHours.enabled ? "time-row" : "time-row disabled"}>
            <label>
              开始
              <input
                type="time"
                value={settings.proactive.quietHours.start}
                disabled={!settings.proactive.quietHours.enabled}
                onChange={(event) =>
                  onUpdate({ proactive: { quietHours: { start: event.target.value } } })
                }
              />
            </label>
            <label>
              结束
              <input
                type="time"
                value={settings.proactive.quietHours.end}
                disabled={!settings.proactive.quietHours.enabled}
                onChange={(event) =>
                  onUpdate({ proactive: { quietHours: { end: event.target.value } } })
                }
              />
            </label>
          </div>
        </section>

        <section className="setting-group">
          <h2>系统</h2>
          <SettingToggle
            label="开机自动启动"
            description={
              meta.isPackaged
                ? "登录 Windows 后自动启动桌宠。"
                : "安装包版本中开放；开发模式不会写入系统启动项。"
            }
            checked={settings.startup.launchAtLogin}
            disabled={!meta.isPackaged}
            onChange={(launchAtLogin) => onUpdate({ startup: { launchAtLogin } })}
          />
          <div className="runtime-facts">
            <span>平台 {meta.platform}</span>
            <span>数据保存于系统用户目录</span>
          </div>
        </section>
      </div>

      {statusMessage ? (
        <p className="inline-error" role="alert">
          {statusMessage}
        </p>
      ) : null}

      <footer className="settings-footer">
        <span>当前为本地基础壳，不会发送任何对话或设置内容。</span>
        <button className="danger-button" type="button" onClick={onQuit}>
          退出应用
        </button>
      </footer>
    </section>
  );
}

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: SettingToggleProps): React.JSX.Element {
  return (
    <label className={disabled ? "setting-toggle disabled" : "setting-toggle"}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

function AzureCharacter(): React.JSX.Element {
  return (
    <svg
      className="azure-character"
      viewBox="0 0 320 300"
      role="img"
      aria-label="蓝色桌宠角色"
    >
      <defs>
        <linearGradient id="body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7fe8ff" />
          <stop offset="48%" stopColor="#43bde8" />
          <stop offset="100%" stopColor="#2178be" />
        </linearGradient>
        <linearGradient id="belly" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e9fdff" />
          <stop offset="100%" stopColor="#9eeaff" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="274" rx="82" ry="14" fill="rgba(20, 47, 83, .16)" />
      <path
        d="M78 180c-4-68 31-119 91-119 61 0 97 50 92 118-3 45-35 72-94 72-56 0-86-26-89-71Z"
        fill="url(#body)"
        stroke="#153d6a"
        strokeWidth="7"
      />
      <path
        d="M109 179c13-27 37-39 56-39 19 0 38 13 49 34 13 25 4 49-28 58-42 13-88-13-77-53Z"
        fill="url(#belly)"
        opacity=".94"
      />
      <path
        d="M251 139c25-22 43-19 49-13 6 7-2 24-27 38Z"
        fill="#36a6dc"
        stroke="#153d6a"
        strokeLinejoin="round"
        strokeWidth="7"
      />
      <path
        d="M73 146c-22-18-39-15-44-9-5 7 2 22 25 34Z"
        fill="#36a6dc"
        stroke="#153d6a"
        strokeLinejoin="round"
        strokeWidth="7"
      />
      <ellipse cx="131" cy="139" rx="12" ry="17" fill="#12365e" />
      <ellipse cx="191" cy="139" rx="12" ry="17" fill="#12365e" />
      <circle cx="135" cy="133" r="4" fill="#fff" />
      <circle cx="195" cy="133" r="4" fill="#fff" />
      <ellipse cx="107" cy="168" rx="14" ry="7" fill="#ff9fc9" opacity=".58" />
      <ellipse cx="217" cy="168" rx="14" ry="7" fill="#ff9fc9" opacity=".58" />
      <path
        d="M145 174c8 10 24 10 32 0"
        fill="none"
        stroke="#153d6a"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M158 29c-2-17 9-26 20-27 2 15-4 24-20 27Z"
        fill="#69d9f3"
        stroke="#153d6a"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <circle cx="162" cy="17" r="6" fill="#fff" opacity=".88" />
    </svg>
  );
}

function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.1 5.3v-3l-2.4-.7a7.8 7.8 0 0 0-.8-1.8l1.2-2.2-2.1-2.1-2.2 1.2a7.8 7.8 0 0 0-1.8-.8L11.3 2h-3l-.7 2.4a7.8 7.8 0 0 0-1.8.8L3.6 4l-2.1 2.1 1.2 2.2a7.8 7.8 0 0 0-.8 1.8L0 10.8v3l2.4.7c.2.6.5 1.2.8 1.8l-1.2 2.2 2.1 2.1 2.2-1.2c.6.3 1.2.6 1.8.8L9.8 22h3l.7-2.4c.6-.2 1.2-.5 1.8-.8l2.2 1.2 2.1-2.1-1.2-2.2c.3-.6.6-1.2.8-1.8l2.4-.4Z"
        fill="currentColor"
        transform="translate(1.8 0) scale(.86)"
      />
    </svg>
  );
}
