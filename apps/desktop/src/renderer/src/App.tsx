import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopBootstrap } from "../../shared/desktop-api";
import {
  PERSONA_PRESETS,
  type DesktopSettings,
  type DesktopSettingsPatch,
  type PersonaSettings,
} from "../../shared/settings";
import {
  parsePersonaPackage,
  serializePersonaPackage,
} from "../../shared/persona-package";
import {
  inferCharacterCompositionMode,
  parseCharacterPoseInstruction,
} from "../../shared/character-pose-command";
import type {
  AssistantStreamEvent,
  AuditLogRecord,
  CharacterAsset,
  CharacterAssetCategory,
  CharacterCompositionMode,
  CharacterView,
  ConnectorRecord,
  DailyBriefRecord,
  MemorySearchResult,
  MemoryType,
  MessageRecord,
  RecurrenceKind,
  TaskRecord,
  ToolCallRecord,
  ToolSummary,
} from "../../core/domain";

type LoadState = "loading" | "ready" | "error";
type StageAssetCategory = Exclude<CharacterAssetCategory, "scene">;
type AppView =
  | "pet"
  | "settings"
  | "chat"
  | "memory"
  | "tasks"
  | "daily"
  | "tools";

export function App(): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null);
  const [view, setView] = useState<AppView>("pet");
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
      setView("settings");
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
    setView("settings");
    await window.desktop?.setWindowMode("settings");
  }, []);

  const openChat = useCallback(async (): Promise<void> => {
    setView("chat");
    await window.desktop?.setWindowMode("chat");
  }, []);

  const openMemory = useCallback(async (): Promise<void> => {
    setView("memory");
    await window.desktop?.setWindowMode("memory");
  }, []);

  const openTasks = useCallback(async (): Promise<void> => {
    setView("tasks");
    await window.desktop?.setWindowMode("tasks");
  }, []);

  const openDaily = useCallback(async (): Promise<void> => {
    setView("daily");
    await window.desktop?.setWindowMode("daily");
  }, []);

  const openTools = useCallback(async (): Promise<void> => {
    setView("tools");
    await window.desktop?.setWindowMode("tools");
  }, []);

  const returnToPet = useCallback(async (): Promise<void> => {
    setView("pet");
    await window.desktop?.setWindowMode("pet");
  }, []);

  useEffect(() => {
    if (view === "pet") {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        void returnToPet();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [returnToPet, view]);

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
    <main className={`app-frame ${view}-frame`}>
      {view === "settings" ? (
        <SettingsPanel
          bootstrap={bootstrap}
          onClose={() => void returnToPet()}
          onUpdate={(patch) => void updateSettings(patch)}
          onQuit={() => void window.desktop?.quit()}
          statusMessage={statusMessage}
          onModelConfiguredChange={(modelConfigured) =>
            setBootstrap((current) =>
              current
                ? {
                    ...current,
                    meta: { ...current.meta, modelConfigured },
                  }
                : current,
            )
          }
          onOpenMemory={() => void openMemory()}
          onOpenTasks={() => void openTasks()}
          onOpenDaily={() => void openDaily()}
          onOpenTools={() => void openTools()}
          onEmbeddingConfiguredChange={(embeddingConfigured) =>
            setBootstrap((current) =>
              current
                ? {
                    ...current,
                    meta: {
                      ...current.meta,
                      embeddingConfigured,
                      imageGenerationConfigured: embeddingConfigured,
                    },
                  }
                : current,
            )
          }
        />
      ) : view === "chat" ? (
        <ChatPanel
          bootstrap={bootstrap}
          onClose={() => void returnToPet()}
          onOpenSettings={() => void openSettings()}
          onCharacterSelected={(asset) =>
            void updateSettings({
              appearance: {
                customCharacterId: asset.id,
                ...(asset.category === "scene"
                  ? {
                      customBackgroundId: null,
                      customPropIds: [],
                    }
                  : {}),
              },
            })
          }
        />
      ) : view === "memory" ? (
        <MemoryCenter
          onClose={() => void returnToPet()}
        />
      ) : view === "tasks" ? (
        <TaskCenter
          onClose={() => void returnToPet()}
        />
      ) : view === "daily" ? (
        <DailyBriefPanel
          onClose={() => void returnToPet()}
        />
      ) : view === "tools" ? (
        <ToolCenter onClose={() => void returnToPet()} />
      ) : (
        <PetStage
          settings={settings}
          onOpenSettings={() => void openSettings()}
          onOpenChat={() => void openChat()}
          modelConfigured={bootstrap.meta.modelConfigured}
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
  onOpenChat: () => void;
  modelConfigured: boolean;
}

function PetStage({
  settings,
  onOpenSettings,
  onOpenChat,
  modelConfigured,
}: PetStageProps): React.JSX.Element {
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
        <strong>{modelConfigured ? "我在呢。" : "先配置一下我吧。"}</strong>
        <span>
          {modelConfigured
            ? "DeepSeek Flash 已连接，点下面开始聊天。"
            : "AI 对话尚未配置，基础桌宠可以使用。"}
        </span>
      </div>

      <CharacterVisual
        customCharacterId={settings.appearance.customCharacterId}
        customBackgroundId={settings.appearance.customBackgroundId}
        customPropIds={settings.appearance.customPropIds}
        scale={settings.appearance.scale}
      />

      <div className="pet-footer no-drag">
        <div className="availability">
          <span className="status-dot" />
          {modelConfigured ? "DeepSeek Flash 已连接" : "基础桌宠可用"}
        </div>
        <div className="pet-actions">
          {modelConfigured ? (
            <button className="icon-button" type="button" onClick={onOpenChat}>
              开始聊天
            </button>
          ) : null}
          <button
            className={modelConfigured ? "icon-button secondary" : "icon-button"}
            type="button"
            onClick={onOpenSettings}
          >
            <GearIcon />
            <span>{modelConfigured ? "设置" : "配置 AI"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

interface ChatMessageView {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  pending?: boolean;
}

interface ChatPanelProps {
  bootstrap: DesktopBootstrap;
  onClose: () => void;
  onOpenSettings: () => void;
  onCharacterSelected: (asset: CharacterAsset) => void;
}

function ChatPanel({
  bootstrap,
  onClose,
  onOpenSettings,
  onCharacterSelected,
}: ChatPanelProps): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(
    bootstrap.meta.conversationId,
  );
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState("");
  const [chatError, setChatError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(Boolean(conversationId));
  const [poseProposal, setPoseProposal] = useState<{
    originalText: string;
    instruction: string;
    compositionMode: CharacterCompositionMode;
  } | null>(null);
  const [poseGenerating, setPoseGenerating] = useState(false);
  const [poseRequestId, setPoseRequestId] = useState<string | null>(null);
  const [poseCandidate, setPoseCandidate] = useState<CharacterAsset | null>(null);
  const [poseError, setPoseError] = useState("");
  const activeRequestRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRequestRef.current = activeRequestId;
  }, [activeRequestId]);

  useEffect(() => {
    const api = window.desktop;
    if (!api || !bootstrap.meta.conversationId) {
      setLoadingHistory(false);
      return;
    }

    let active = true;
    void api
      .getChatHistory(bootstrap.meta.conversationId, 50)
      .then((history) => {
        if (!active) {
          return;
        }
        setMessages(
          history
            .filter(
              (message): message is MessageRecord & { role: "user" | "assistant" } =>
                message.role === "user" || message.role === "assistant",
            )
            .map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
            })),
        );
      })
      .catch((error: unknown) => {
        console.error("加载聊天历史失败", error);
        if (active) {
          setChatError("历史消息读取失败，但仍可开始新对话。");
        }
      })
      .finally(() => {
        if (active) {
          setLoadingHistory(false);
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrap.meta.conversationId]);

  useEffect(() => {
    const api = window.desktop;
    if (!api) {
      return undefined;
    }

    return api.onChatEvent(({ requestId, event }) => {
      if (activeRequestRef.current !== requestId) {
        return;
      }
      applyChatEvent(event, {
        setConversationId,
        setMessages,
        setStreamingMessageId,
        setActiveRequestId,
        setMemoryNotice,
        setChatError,
      });
      if (
        event.type === "message.completed" ||
        event.type === "message.failed" ||
        event.type === "message.cancelled"
      ) {
        activeRequestRef.current = null;
        setActiveRequestId(null);
      }
    });
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, streamingMessageId]);

  const generateChatPose = async (): Promise<void> => {
    if (!window.desktop || !poseProposal) {
      return;
    }
    const sourceAssetId =
      bootstrap.settings.appearance.customCharacterId;
    if (!sourceAssetId) {
      setPoseError("还没有选中自定义形象，请先在设置中上传并选择一个角色。");
      return;
    }
    if (!bootstrap.meta.imageGenerationConfigured) {
      setPoseError("请先在设置中配置硅基流动 API Key。");
      return;
    }

    const requestId = crypto.randomUUID();
    setPoseGenerating(true);
    setPoseRequestId(requestId);
    setPoseError("");
    try {
      const asset = await window.desktop.generateCharacterPose({
        requestId,
        sourceAssetId,
        instruction: poseProposal.instruction,
        compositionMode: poseProposal.compositionMode,
      });
      setPoseCandidate(asset);
      setPoseProposal(null);
    } catch (error) {
      console.error("按聊天指令生成角色姿态失败", error);
      setPoseError(characterPoseErrorMessage(error));
    } finally {
      setPoseGenerating(false);
      setPoseRequestId(null);
    }
  };

  const cancelChatPose = async (): Promise<void> => {
    if (!window.desktop || !poseRequestId) {
      return;
    }
    setPoseError("");
    try {
      await window.desktop.cancelCharacterPoseGeneration(poseRequestId);
    } catch (error) {
      console.error("取消聊天姿态生成失败", error);
      setPoseError("取消失败，请等待当前请求结束。");
    }
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (
      !text ||
      activeRequestId ||
      !bootstrap.meta.modelConfigured ||
      !window.desktop
    ) {
      return;
    }

    const poseInstruction = parseCharacterPoseInstruction(text);
    if (poseInstruction) {
      setDraft("");
      setPoseProposal({
        originalText: text,
        instruction: poseInstruction,
        compositionMode: inferCharacterCompositionMode(text),
      });
      setPoseCandidate(null);
      setPoseError("");
      return;
    }

    const requestId = crypto.randomUUID();
    const localUserId = `local-${crypto.randomUUID()}`;
    activeRequestRef.current = requestId;
    setActiveRequestId(requestId);
    setChatError("");
    setMemoryNotice("");
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: localUserId, role: "user", content: text },
    ]);

    try {
      await window.desktop.startChat({
        requestId,
        conversationId: conversationId ?? undefined,
        message: text,
      });
    } catch (error) {
      console.error("启动对话失败", error);
      activeRequestRef.current = null;
      setActiveRequestId(null);
      setChatError("无法启动对话，请确认数据库与模型配置。");
    }
  };

  const stop = async (): Promise<void> => {
    if (!activeRequestId || !window.desktop) {
      return;
    }
    await window.desktop.cancelChat(activeRequestId);
  };

  const close = async (): Promise<void> => {
    if (activeRequestId) {
      await stop();
    }
    onClose();
  };

  return (
    <section className="chat-panel no-drag">
      <header className="chat-header">
        <div>
          <span className="eyebrow">DEEPSEEK FLASH</span>
          <h1>{bootstrap.settings.persona.name} 在听</h1>
          <p>消息保存在本地 SQLite；明确说“请记住”会写入长期记忆。</p>
        </div>
        <button className="close-button" type="button" onClick={() => void close()}>
          返回桌宠
        </button>
      </header>

      {!bootstrap.meta.modelConfigured ? (
        <div className="chat-unconfigured">
          <strong>先连接 DeepSeek</strong>
          <p>在设置中保存 API Key 后即可开始流式对话。</p>
          <button className="primary-button" type="button" onClick={onOpenSettings}>
            打开模型设置
          </button>
        </div>
      ) : (
        <>
          <div className="chat-thread" aria-live="polite">
            {loadingHistory ? (
              <p className="chat-hint">正在读取历史消息…</p>
            ) : messages.length === 0 ? (
              <div className="chat-welcome">
                <span className="chat-orb">AI</span>
                <strong>今天想聊点什么？</strong>
                <p>可以试着说：“请记住：我喜欢简洁回答。”</p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={`chat-message ${message.role}`}
                  key={message.id}
                >
                  <span className="message-role">
                    {message.role === "user"
                      ? bootstrap.settings.persona.userTitle
                      : bootstrap.settings.persona.name}
                  </span>
                  <p>
                    {message.content}
                    {message.pending ? <span className="stream-caret" /> : null}
                  </p>
                </article>
              ))
            )}
            {poseProposal && !poseGenerating ? (
              <article className="chat-pose-card">
                <span className="message-role">角色与场景导演 · 待确认</span>
                <strong>
                  要把这条聊天指令变成
                  {poseProposal.compositionMode === "scene"
                    ? "完整场景"
                    : "新姿态"}
                  吗？
                </strong>
                <p>
                  “{poseProposal.originalText}” → 姿态：
                  {poseProposal.instruction}
                </p>
                <small>
                  将参考当前自定义形象并发送给 {bootstrap.meta.imageGenerationModel}。
                  {poseProposal.compositionMode === "scene"
                    ? "本次会把角色、道具和背景合成为一张新场景图。"
                    : "本次只改变角色姿态。"}
                  可能产生平台费用；结果先预览，不会自动替换形象。
                </small>
                <div className="chat-pose-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setPoseProposal(null)}
                  >
                    继续普通聊天
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!bootstrap.meta.imageGenerationConfigured}
                    onClick={() => void generateChatPose()}
                  >
                    {bootstrap.meta.imageGenerationConfigured
                      ? "确认生成姿态"
                      : "需先配置图像服务"}
                  </button>
                </div>
              </article>
            ) : null}
            {poseGenerating ? (
              <article className="chat-pose-card" role="status">
                <span className="message-role">动作导演</span>
                <strong>正在生成新姿态…</strong>
                <p>原形象不会变化；完成后再由你决定是否切换。</p>
                <div className="chat-pose-actions">
                  <button
                    className="danger-text-button"
                    type="button"
                    onClick={() => void cancelChatPose()}
                  >
                    取消生成
                  </button>
                </div>
              </article>
            ) : null}
            {poseCandidate ? (
              <article className="chat-pose-candidate">
                <CharacterAssetThumbnail asset={poseCandidate} />
                <div>
                  <span className="message-role">
                    角色与场景导演 ·{" "}
                    {poseCandidate.category === "scene" ? "新场景" : "新姿态"}
                  </span>
                  <strong>{poseCandidate.generationPrompt}</strong>
                  <small>{poseCandidate.generationModel}</small>
                </div>
                <div className="chat-pose-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setPoseCandidate(null)}
                  >
                    保留候选
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      onCharacterSelected(poseCandidate);
                      setPoseCandidate(null);
                    }}
                  >
                    设为桌宠
                  </button>
                </div>
              </article>
            ) : null}
            {poseError ? (
              <p className="inline-error" role="alert">
                {poseError}
              </p>
            ) : null}
            {memoryNotice ? <p className="memory-toast">{memoryNotice}</p> : null}
            {chatError ? (
              <p className="inline-error" role="alert">
                {chatError}
              </p>
            ) : null}
            <div ref={messageEndRef} />
          </div>

          <footer className="chat-composer">
            <textarea
              value={draft}
              rows={3}
              maxLength={32_000}
              placeholder={`和${bootstrap.settings.persona.name}说点什么，Enter 发送`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-actions">
              <span>DeepSeek Flash · {bootstrap.meta.database.ready ? "本地记忆已就绪" : "存储异常"}</span>
              {activeRequestId ? (
                <button className="danger-button" type="button" onClick={() => void stop()}>
                  停止生成
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  disabled={!draft.trim()}
                  onClick={() => void send()}
                >
                  发送
                </button>
              )}
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

interface ChatEventSetters {
  setConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessageView[]>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveRequestId: React.Dispatch<React.SetStateAction<string | null>>;
  setMemoryNotice: React.Dispatch<React.SetStateAction<string>>;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
}

function applyChatEvent(
  event: AssistantStreamEvent,
  setters: ChatEventSetters,
): void {
  if (event.type === "message.started") {
    setters.setConversationId(event.conversationId);
    setters.setStreamingMessageId(event.assistantMessageId);
    setters.setMemoryNotice(event.memoryCaptured ? "这段信息已写入长期记忆。" : "");
    setters.setMessages((current) => [
      ...current,
      {
        id: event.assistantMessageId,
        role: "assistant",
        content: "",
        pending: true,
      },
    ]);
    return;
  }

  if (event.type === "content.delta") {
    setters.setMessages((current) =>
      current.map((message) =>
        message.id === event.assistantMessageId
          ? { ...message, content: message.content + event.delta }
          : message,
      ),
    );
    return;
  }

  if (event.type === "message.completed") {
    setters.setMessages((current) =>
      current.map((message) =>
        message.id === event.assistantMessage.id
          ? {
              id: message.id,
              role: "assistant",
              content: event.assistantMessage.content,
            }
          : message,
      ),
    );
    setters.setStreamingMessageId(null);
    return;
  }

  if (event.type === "message.failed") {
    setters.setMessages((current) =>
      current.map((message) =>
        message.id === event.assistantMessageId
          ? {
              ...message,
              content: `${message.content}\n\n[请求失败：${event.message}]`,
              pending: false,
            }
          : message,
      ),
    );
    setters.setStreamingMessageId(null);
    setters.setChatError(`${event.code} · ${event.message}`);
    return;
  }

  setters.setMessages((current) =>
    current.map((message) =>
      message.id === event.assistantMessageId
        ? {
            ...message,
            content: `${message.content}\n\n[已停止生成]`,
            pending: false,
          }
        : message,
    ),
  );
  setters.setStreamingMessageId(null);
}

interface CenterPanelProps {
  onClose: () => void;
}

function MemoryCenter({ onClose }: CenterPanelProps): React.JSX.Element {
  const [memories, setMemories] = useState<MemorySearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async (searchQuery: string): Promise<void> => {
    if (!window.desktop) {
      setError("桌面桥接不可用。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setMemories(await window.desktop.listMemories(searchQuery, 100));
    } catch (loadError) {
      console.error("读取记忆失败", loadError);
      setError("记忆读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(query.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [load, query]);

  const saveEdit = async (id: string): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      await window.desktop.updateMemory(id, { content: editContent });
      setEditingId(null);
      setEditContent("");
      await load(query.trim());
    } catch (saveError) {
      console.error("更新记忆失败", saveError);
      setError("记忆更新失败，请检查内容后重试。");
    }
  };

  const deleteMemory = async (id: string): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      const result = await window.desktop.deleteMemory(id);
      if (!result.deleted) {
        setError("记忆不存在或已经删除。");
      }
      setConfirmDeleteId(null);
      await load(query.trim());
    } catch (deleteError) {
      console.error("删除记忆失败", deleteError);
      setError("记忆删除失败，请稍后重试。");
    }
  };

  return (
    <section className="center-panel">
      <header className="center-header">
        <div>
          <span className="eyebrow">LOCAL MEMORY</span>
          <h1>记忆中心</h1>
          <p>查看来源、纠正内容或彻底删除不再需要的记忆。</p>
        </div>
        <button className="close-button" type="button" onClick={onClose}>
          返回桌宠
        </button>
      </header>

      <div className="center-toolbar">
        <input
          type="search"
          value={query}
          placeholder="搜索记忆内容"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{memories.length} 条记忆</span>
      </div>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="center-list">
        {loading ? (
          <p className="center-empty">正在读取记忆…</p>
        ) : memories.length === 0 ? (
          <div className="center-empty">
            <strong>{query ? "没有匹配的记忆" : "还没有长期记忆"}</strong>
            <p>在聊天中说“请记住：……”即可创建第一条记忆。</p>
          </div>
        ) : (
          memories.map((memory) => (
            <article className="memory-card" key={memory.id}>
              <div className="memory-meta">
                <span className="memory-type">{memoryTypeLabel(memory.type)}</span>
                <span>{memory.origin === "user_explicit" ? "用户明确表达" : memory.origin}</span>
                <span>{formatDateTime(memory.updatedAt)}</span>
                <span>{memory.sourceIds.length} 个来源</span>
              </div>
              {editingId === memory.id ? (
                <div className="memory-edit">
                  <textarea
                    value={editContent}
                    rows={3}
                    onChange={(event) => setEditContent(event.target.value)}
                  />
                  <div>
                    <button className="primary-button" type="button" onClick={() => void saveEdit(memory.id)}>
                      保存
                    </button>
                    <button className="text-button" type="button" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="memory-content">{memory.content}</p>
                  <div className="memory-actions">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setEditingId(memory.id);
                        setEditContent(memory.content);
                        setConfirmDeleteId(null);
                      }}
                    >
                      编辑
                    </button>
                    {confirmDeleteId === memory.id ? (
                      <>
                        <button className="danger-text-button" type="button" onClick={() => void deleteMemory(memory.id)}>
                          确认删除
                        </button>
                        <button className="text-button" type="button" onClick={() => setConfirmDeleteId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button className="danger-text-button" type="button" onClick={() => setConfirmDeleteId(memory.id)}>
                        删除
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function TaskCenter({ onClose }: CenterPanelProps): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueLocal, setDueLocal] = useState(defaultTaskTime());
  const [recurrence, setRecurrence] = useState<RecurrenceKind>("none");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      setError("桌面桥接不可用。");
      return;
    }
    try {
      setTasks(await window.desktop.listTasks(100));
      setError("");
    } catch (loadError) {
      console.error("读取任务失败", loadError);
      setError("任务读取失败，请稍后重试。");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  const create = async (): Promise<void> => {
    if (!window.desktop || !title.trim() || !dueLocal) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await window.desktop.createTask({
        title: title.trim(),
        ...(description.trim()
          ? { description: description.trim() }
          : {}),
        dueAt: new Date(dueLocal).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        idempotencyKey: crypto.randomUUID(),
        recurrence,
      });
      setTitle("");
      setDescription("");
      setDueLocal(defaultTaskTime());
      setRecurrence("none");
      await load();
    } catch (createError) {
      console.error("创建任务失败", createError);
      setError("任务创建失败，请检查标题和时间。");
    } finally {
      setSubmitting(false);
    }
  };

  const complete = async (id: string): Promise<void> => {
    await window.desktop?.completeTask(id);
    await load();
  };

  const cancel = async (id: string): Promise<void> => {
    await window.desktop?.cancelTask(id);
    await load();
  };

  return (
    <section className="center-panel">
      <header className="center-header">
        <div>
          <span className="eyebrow">DURABLE TASKS</span>
          <h1>任务中心</h1>
          <p>任务保存在 SQLite；到期后由主进程调度系统通知。</p>
        </div>
        <button className="close-button" type="button" onClick={onClose}>
          返回桌宠
        </button>
      </header>

      <div className="task-create">
        <input
          value={title}
          maxLength={200}
          placeholder="任务标题"
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={(event) => setDueLocal(event.target.value)}
        />
        <select
          aria-label="重复规则"
          value={recurrence}
          onChange={(event) =>
            setRecurrence(event.target.value as RecurrenceKind)
          }
        >
          <option value="none">不重复</option>
          <option value="daily">每天</option>
          <option value="weekdays">工作日</option>
          <option value="weekly">每周</option>
        </select>
        <textarea
          value={description}
          maxLength={2_000}
          rows={2}
          placeholder="补充说明（可选）"
          onChange={(event) => setDescription(event.target.value)}
        />
        <button className="primary-button" type="button" disabled={submitting || !title.trim()} onClick={() => void create()}>
          {submitting ? "创建中…" : "创建任务"}
        </button>
      </div>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="center-list">
        {tasks.length === 0 ? (
          <div className="center-empty">
            <strong>还没有任务</strong>
            <p>创建一次性提醒，关闭应用后仍会保留。</p>
          </div>
        ) : (
          tasks.map((task) => (
            <article className="task-card" key={task.id}>
              <div>
                <div className="memory-meta">
                  <span className={`task-status ${task.status}`}>
                    {taskStatusLabel(task.status)}
                  </span>
                  <span>{formatDateTime(task.dueAt)}</span>
                </div>
                <strong>{task.title}</strong>
                {task.description ? <p>{task.description}</p> : null}
                {task.lastErrorMessage ? (
                  <small>{task.lastErrorMessage}</small>
                ) : null}
              </div>
              <div className="task-actions">
                {["pending", "scheduled", "retry_scheduled"].includes(task.status) ? (
                  <>
                    <button className="text-button" type="button" onClick={() => void complete(task.id)}>
                      完成
                    </button>
                    <button className="danger-text-button" type="button" onClick={() => void cancel(task.id)}>
                      取消
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function memoryTypeLabel(type: MemoryType): string {
  const labels: Record<MemoryType, string> = {
    profile: "用户档案",
    preference: "偏好",
    fact: "事实",
    project_decision: "项目决定",
    event: "事件",
    summary: "摘要",
    commitment: "承诺",
  };
  return labels[type];
}

function taskStatusLabel(status: TaskRecord["status"]): string {
  const labels: Record<TaskRecord["status"], string> = {
    pending: "待处理",
    scheduled: "已安排",
    running: "执行中",
    waiting_confirmation: "等待确认",
    retry_scheduled: "等待重试",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    expired: "已过期",
    needs_reconciliation: "待对账",
  };
  return labels[status];
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function defaultTaskTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function DailyBriefPanel({ onClose }: CenterPanelProps): React.JSX.Element {
  const [brief, setBrief] = useState<DailyBriefRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = window.desktop;
    if (!api) {
      setError("桌面桥接不可用。");
      setLoading(false);
      return;
    }
    let active = true;
    void api
      .getLatestDailyBrief()
      .then((value) => {
        if (active) {
          setBrief(value);
        }
      })
      .catch((loadError: unknown) => {
        console.error("读取每日总结失败", loadError);
        if (active) {
          setError("每日总结读取失败。");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const generate = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setGenerating(true);
    setError("");
    try {
      setBrief(await window.desktop.generateDailyBrief());
    } catch (generateError) {
      console.error("生成每日总结失败", generateError);
      setError("今日总结生成失败，请检查 DeepSeek 连接。");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="center-panel">
      <header className="center-header">
        <div>
          <span className="eyebrow">DAILY BRIEF</span>
          <h1>今日总结</h1>
          <p>只汇总本地真实任务与非 local_only 记忆。</p>
        </div>
        <div className="center-links">
          <button className="primary-button" type="button" disabled={generating} onClick={() => void generate()}>
            {generating ? "生成中…" : "生成今日总结"}
          </button>
          <button className="close-button" type="button" onClick={onClose}>
            返回桌宠
          </button>
        </div>
      </header>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="center-empty">正在读取今日总结…</p>
      ) : (
        <div className="brief-content">
          {brief ? (
            <>
              <div className="brief-meta">
                <span>{brief.briefDate}</span>
                <span>{brief.timezone}</span>
                <span>{brief.model}</span>
              </div>
              <div className="source-status">
                <SourceBadge label="任务" state={brief.sourceStatus.tasks} />
                <SourceBadge label="记忆" state={brief.sourceStatus.memories} />
                <SourceBadge label="邮件" state={brief.sourceStatus.email} />
                <SourceBadge label="日历" state={brief.sourceStatus.calendar} />
              </div>
              <pre>{brief.content}</pre>
            </>
          ) : (
            <div className="center-empty">
              <strong>还没有今日总结</strong>
              <p>点击“生成今日总结”，只使用当前真实可用的数据。</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ToolCenter({ onClose }: CenterPanelProps): React.JSX.Element {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [calls, setCalls] = useState<ToolCallRecord[]>([]);
  const [audits, setAudits] = useState<AuditLogRecord[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [emailItems, setEmailItems] = useState<
    Array<{
      id: string;
      subject: string;
      from: string[];
      to: string[];
      date: string;
      flags: string[];
      hasAttachment: boolean;
    }>
  >([]);
  const [emailPreview, setEmailPreview] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    callId: string;
    description: string;
    operation: "send" | "delete";
  } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const api = window.desktop;
    if (!api) {
      setError("桌面桥接不可用。");
      setLoading(false);
      return;
    }
    try {
      const [toolList, callList, connectorList, auditList] = await Promise.all([
        api.listTools(),
        api.listToolCalls(30),
        api.listConnectors(),
        api.listAuditLogs(undefined, 100),
      ]);
      setTools(toolList);
      setCalls(callList);
      setConnectors(connectorList);
      setAudits(auditList);
      setError("");
    } catch (loadError) {
      console.error("读取工具状态失败", loadError);
      setError("工具状态读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoke = async (toolName: string): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setRunningTool(toolName);
    setError("");
    try {
      await window.desktop.invokeTool({
        requestId: crypto.randomUUID(),
        toolName,
        input: {},
      });
      await load();
    } catch (invokeError) {
      console.error("工具调用失败", invokeError);
      setError("工具调用失败，请查看审计状态。");
      await load();
    } finally {
      setRunningTool(null);
    }
  };

  const approve = async (callId: string, approved: boolean): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      await window.desktop.approveTool(callId, approved);
      await load();
    } catch (approvalError) {
      console.error("工具确认失败", approvalError);
      setError("工具确认失败或已过期。");
    }
  };

  const loadInbox = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setEmailBusy(true);
    setError("");
    try {
      const call = await window.desktop.invokeTool({
        requestId: crypto.randomUUID(),
        toolName: "email.inbox.list",
        input: { limit: 8 },
      });
      setEmailItems(
        Array.isArray(call.output)
          ? (call.output as typeof emailItems)
          : [],
      );
      await load();
    } catch (inboxError) {
      console.error("读取收件箱失败", inboxError);
      setError("收件箱读取失败，请检查 Himalaya 与 QQ 邮箱授权。");
    } finally {
      setEmailBusy(false);
    }
  };

  const readEmail = async (id: string): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setEmailBusy(true);
    setEmailPreview("");
    try {
      const call = await window.desktop.invokeTool({
        requestId: crypto.randomUUID(),
        toolName: "email.message.read",
        input: { id },
      });
      setEmailPreview(JSON.stringify(call.output, null, 2).slice(0, 30_000));
      await load();
    } catch (readError) {
      console.error("读取邮件失败", readError);
      setError("邮件读取失败。");
    } finally {
      setEmailBusy(false);
    }
  };

  const requestSend = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      const call = await window.desktop.invokeTool({
        requestId: crypto.randomUUID(),
        toolName: "email.send",
        input: {
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          body: emailBody,
        },
      });
      if (call.status === "pending_confirmation") {
        setPendingConfirmation({
          callId: call.id,
          operation: "send",
          description: `收件人：${emailTo.trim()}\n主题：${emailSubject.trim()}\n正文：${emailBody.slice(0, 500)}`,
        });
      } else if (call.status !== "completed") {
        setError(call.errorMessage || "发信请求未执行。");
      }
      await load();
    } catch (sendError) {
      console.error("请求发送邮件失败", sendError);
      setError("无法创建发信确认。");
    }
  };

  const requestDelete = async (email: {
    id: string;
    subject: string;
  }): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      const call = await window.desktop.invokeTool({
        requestId: crypto.randomUUID(),
        toolName: "email.message.delete",
        input: { id: email.id },
      });
      if (call.status === "pending_confirmation") {
        setPendingConfirmation({
          callId: call.id,
          operation: "delete",
          description: `将邮件「${email.subject}」移动到 QQ 邮箱已删除文件夹。`,
        });
      }
      await load();
    } catch (deleteError) {
      console.error("请求删除邮件失败", deleteError);
      setError("无法创建删除确认。");
    }
  };

  const resolveConfirmation = async (approved: boolean): Promise<void> => {
    if (!window.desktop || !pendingConfirmation) {
      return;
    }
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    try {
      const result = await window.desktop.approveTool(
        pending.callId,
        approved,
      );
      if (result.status === "failed") {
        setError(result.errorMessage || "工具执行失败。");
      } else if (result.status === "completed") {
        if (pending.operation === "send") {
          setComposeOpen(false);
          setEmailTo("");
          setEmailSubject("");
          setEmailBody("");
        } else {
          await loadInbox();
        }
      }
      await load();
    } catch (confirmationError) {
      console.error("确认邮箱操作失败", confirmationError);
      setError("确认操作失败或已过期。");
    }
  };

  const searchAudits = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    try {
      setAudits(
        await window.desktop.listAuditLogs(
          auditQuery.trim() || undefined,
          200,
        ),
      );
    } catch (auditError) {
      console.error("读取审计记录失败", auditError);
      setError("审计记录读取失败。");
    }
  };

  return (
    <section className="center-panel">
      <header className="center-header">
        <div>
          <span className="eyebrow">TOOL RUNTIME</span>
          <h1>工具与连接器</h1>
          <p>所有调用经过 schema、权限、风险和审计边界。</p>
        </div>
        <button className="close-button" type="button" onClick={onClose}>
          返回桌宠
        </button>
      </header>

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tool-layout">
        <section>
          <h2>可用工具</h2>
          <div className="tool-grid">
            {loading ? <p className="center-empty">正在读取工具…</p> : null}
            {tools.map((tool) => (
              <article className="tool-card" key={tool.name}>
                <div className="memory-meta">
                  <span className={`risk-badge ${tool.riskLevel}`}>{riskLabel(tool.riskLevel)}</span>
                  <span>{tool.name}</span>
                </div>
                <strong>{tool.description}</strong>
                <small>权限：{tool.requiredScopes.join(", ") || "无"}</small>
                <button
                  className="secondary-panel-button"
                  type="button"
                  disabled={
                    runningTool !== null ||
                    [
                      "email.message.read",
                      "email.send",
                      "email.message.delete",
                    ].includes(tool.name)
                  }
                  onClick={() => void invoke(tool.name)}
                >
                  {runningTool === tool.name
                    ? "执行中…"
                    : [
                          "email.message.read",
                          "email.send",
                          "email.message.delete",
                        ].includes(tool.name)
                      ? "使用邮箱表单"
                      : "运行"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2>连接器</h2>
          <div className="connector-list">
            {connectors.map((connector) => (
              <article className="connector-card" key={connector.id}>
                <div>
                  <strong>{connector.displayName}</strong>
                  <p>
                    {connector.provider === "unselected"
                      ? "等待选择邮箱服务商和授权方式"
                      : connector.provider === "himalaya"
                        ? "Himalaya · QQ IMAP/SMTP"
                        : connector.provider}
                  </p>
                </div>
                <span className={`connector-state ${connector.status}`}>
                  {connector.status === "disconnected" ? "未连接" : connector.status}
                </span>
                {connector.id === "email-primary" ? (
                  <button
                    className="secondary-panel-button"
                    type="button"
                    disabled={emailBusy}
                    onClick={() => void loadInbox()}
                  >
                    {emailBusy ? "读取中…" : "读取最近邮件"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {emailItems.length > 0 ? (
            <div className="email-list">
              {emailItems.map((email) => (
                <article className="email-card" key={email.id}>
                  <div>
                    <strong>{email.subject}</strong>
                    <p>
                      {email.from.join(", ") || "未知发件人"} · {formatDateTime(email.date)}
                    </p>
                  </div>
                  <button className="text-button" type="button" onClick={() => void readEmail(email.id)}>
                    查看
                  </button>
                  <button
                    className="danger-text-button"
                    type="button"
                    onClick={() => void requestDelete(email)}
                  >
                    移到已删除
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {emailPreview ? <pre className="email-preview">{emailPreview}</pre> : null}
          <button
            className="secondary-panel-button"
            type="button"
            onClick={() => setComposeOpen((open) => !open)}
          >
            {composeOpen ? "收起邮件编辑器" : "写邮件"}
          </button>
          {composeOpen ? (
            <div className="compose-form">
              <input
                type="email"
                value={emailTo}
                placeholder="收件人"
                onChange={(event) => setEmailTo(event.target.value)}
              />
              <input
                value={emailSubject}
                maxLength={200}
                placeholder="主题"
                onChange={(event) => setEmailSubject(event.target.value)}
              />
              <textarea
                value={emailBody}
                maxLength={20_000}
                rows={5}
                placeholder="正文"
                onChange={(event) => setEmailBody(event.target.value)}
              />
              <button
                className="primary-button"
                type="button"
                disabled={
                  !emailTo.trim() ||
                  !emailSubject.trim() ||
                  !emailBody.trim()
                }
                onClick={() => void requestSend()}
              >
                请求发送确认
              </button>
            </div>
          ) : null}
        </section>

        <section>
          <h2>最近调用</h2>
          <div className="tool-call-list">
            {calls.length === 0 ? (
              <p className="center-empty">还没有工具调用记录。</p>
            ) : (
              calls.map((call) => (
                <article className="tool-call-card" key={call.id}>
                  <div>
                    <strong>{toolLabel(call.toolName)}</strong>
                    <p>
                      {formatDateTime(call.createdAt)} · {toolCallStatusLabel(call.status)}
                    </p>
                    {call.outputSummary ? <small>{call.outputSummary}</small> : null}
                    {call.errorMessage ? <small>{call.errorMessage}</small> : null}
                  </div>
                  {call.status === "pending_confirmation" ? (
                    <div>
                      <button className="primary-button" type="button" onClick={() => void approve(call.id, true)}>
                        批准
                      </button>
                      <button className="danger-text-button" type="button" onClick={() => void approve(call.id, false)}>
                        拒绝
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section>
          <h2>审计记录</h2>
          <div className="audit-toolbar">
            <input
              value={auditQuery}
              placeholder="按动作、结果或 trace ID 筛选"
              onChange={(event) => setAuditQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void searchAudits();
                }
              }}
            />
            <button className="secondary-panel-button" type="button" onClick={() => void searchAudits()}>
              筛选
            </button>
          </div>
          <div className="audit-list">
            {audits.length === 0 ? (
              <p className="center-empty">没有匹配的审计记录。</p>
            ) : (
              audits.map((audit) => (
                <article className="audit-row" key={audit.id}>
                  <div>
                    <strong>{auditLabel(audit.action)}</strong>
                    <p>
                      {formatDateTime(audit.occurredAt)} · {audit.outcome}
                      {audit.reason ? ` · ${audit.reason}` : ""}
                    </p>
                  </div>
                  <code>{audit.traceId?.slice(0, 8) || "no-trace"}</code>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
      {pendingConfirmation ? (
        <div className="confirmation-overlay">
          <section className="confirmation-dialog" role="dialog" aria-modal="true">
            <span className="eyebrow">HIGH RISK ACTION</span>
            <h2>确认执行邮箱操作</h2>
            <pre>{pendingConfirmation.description}</pre>
            <p>确认后将真实调用 QQ SMTP/IMAP，并写入审计记录。</p>
            <div>
              <button
                className="primary-button"
                type="button"
                onClick={() => void resolveConfirmation(true)}
              >
                确认执行
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void resolveConfirmation(false)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function riskLabel(risk: ToolSummary["riskLevel"]): string {
  return {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
    critical: "关键风险",
  }[risk];
}

function toolLabel(name: string): string {
  return {
    "clock.read": "读取当前时间",
    "connector.email.status": "查看邮箱连接状态",
    "email.inbox.list": "读取最近邮件头",
    "email.message.read": "读取邮件",
    "email.send": "发送邮件",
    "email.message.delete": "移到已删除",
  }[name] ?? name;
}

function toolCallStatusLabel(status: ToolCallRecord["status"]): string {
  return {
    pending_confirmation: "等待确认",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    denied: "已拒绝",
    needs_reconciliation: "待对账",
  }[status];
}

function auditLabel(action: string): string {
  return {
    "tool.started": "工具开始执行",
    "tool.completed": "工具执行完成",
    "tool.failed": "工具执行失败",
    "tool.cancelled": "工具执行取消",
    "tool.denied": "工具调用被拒绝",
    "tool.confirmation_requested": "请求高风险确认",
    "tool.approved": "高风险动作已批准",
    "tool.rejected": "高风险动作被拒绝",
    "tool.confirmation_expired": "高风险确认过期",
  }[action] ?? action;
}

function SourceBadge({
  label,
  state,
}: {
  label: string;
  state: DailyBriefRecord["sourceStatus"]["tasks"];
}): React.JSX.Element {
  const stateLabel = {
    available: "已读取",
    not_connected: "未连接",
    failed: "读取失败",
  }[state];
  return (
    <span className={`source-badge ${state}`}>
      {label} · {stateLabel}
    </span>
  );
}

interface SettingsPanelProps {
  bootstrap: DesktopBootstrap;
  onClose: () => void;
  onUpdate: (patch: DesktopSettingsPatch) => void;
  onQuit: () => void;
  statusMessage: string;
  onModelConfiguredChange: (configured: boolean) => void;
  onOpenMemory: () => void;
  onOpenTasks: () => void;
  onOpenDaily: () => void;
  onOpenTools: () => void;
  onEmbeddingConfiguredChange: (configured: boolean) => void;
}

function SettingsPanel({
  bootstrap,
  onClose,
  onUpdate,
  onQuit,
  statusMessage,
  onModelConfiguredChange,
  onOpenMemory,
  onOpenTasks,
  onOpenDaily,
  onOpenTools,
  onEmbeddingConfiguredChange,
}: SettingsPanelProps): React.JSX.Element {
  const { settings, meta } = bootstrap;
  const [editingKey, setEditingKey] = useState(!meta.modelConfigured);
  const [keyDraft, setKeyDraft] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [editingEmbeddingKey, setEditingEmbeddingKey] = useState(
    !meta.embeddingConfigured,
  );
  const [embeddingKeyDraft, setEmbeddingKeyDraft] = useState("");
  const [embeddingBusy, setEmbeddingBusy] = useState(false);
  const [embeddingMessage, setEmbeddingMessage] = useState("");
  const [personaMessage, setPersonaMessage] = useState("");
  const personaFileInput = useRef<HTMLInputElement | null>(null);
  const [characterAssetList, setCharacterAssetList] = useState<CharacterAsset[]>(
    [],
  );
  const [characterUploadView, setCharacterUploadView] =
    useState<CharacterView>("idle");
  const [characterUploadCategory, setCharacterUploadCategory] =
    useState<StageAssetCategory>("character");
  const [characterMessage, setCharacterMessage] = useState("");
  const [characterBusy, setCharacterBusy] = useState(false);
  const [poseInstruction, setPoseInstruction] = useState("");
  const [poseConfirmationVisible, setPoseConfirmationVisible] = useState(false);
  const [poseGenerating, setPoseGenerating] = useState(false);
  const [poseRequestId, setPoseRequestId] = useState<string | null>(null);
  const [poseCandidateId, setPoseCandidateId] = useState<string | null>(null);
  const [poseMessage, setPoseMessage] = useState("");
  const [poseCompositionMode, setPoseCompositionMode] =
    useState<CharacterCompositionMode>("character");
  const characterFileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!window.desktop) {
      return;
    }
    void window.desktop
      .listCharacterAssets()
      .then(setCharacterAssetList)
      .catch((error: unknown) => {
        console.error("读取角色资产失败", error);
        setCharacterMessage("角色资产读取失败。");
      });
  }, []);

  const selectedCharacterAsset =
    characterAssetList.find(
      (asset) => asset.id === settings.appearance.customCharacterId,
    ) ?? null;
  const poseCandidate =
    characterAssetList.find((asset) => asset.id === poseCandidateId) ?? null;
  const selectedSourceSupportsPose =
    selectedCharacterAsset !== null &&
    selectedCharacterAsset.mimeType !== "image/gif";
  const characterGalleryAssets = characterAssetList.filter(
    (asset) => asset.category === "character" || asset.category === "scene",
  );
  const backgroundAssets = characterAssetList.filter(
    (asset) => asset.category === "background",
  );
  const propAssets = characterAssetList.filter(
    (asset) => asset.category === "prop",
  );

  const saveKey = async (): Promise<void> => {
    if (!window.desktop || !keyDraft.trim()) {
      setProviderMessage("请输入有效的 DeepSeek API Key。");
      return;
    }
    setCredentialBusy(true);
    setProviderMessage("");
    try {
      await window.desktop.saveDeepSeekKey(keyDraft);
      setKeyDraft("");
      setEditingKey(false);
      onModelConfiguredChange(true);
      setProviderMessage("DeepSeek Flash 已安全连接。");
    } catch (error) {
      console.error("保存 DeepSeek Key 失败", error);
      setProviderMessage("Key 保存失败，请检查格式或系统凭据服务。");
    } finally {
      setCredentialBusy(false);
    }
  };

  const clearKey = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setCredentialBusy(true);
    setProviderMessage("");
    try {
      await window.desktop.clearDeepSeekKey();
      setEditingKey(true);
      onModelConfiguredChange(false);
      setProviderMessage("已清除 DeepSeek Key。");
    } catch (error) {
      console.error("清除 DeepSeek Key 失败", error);
      setProviderMessage("Key 清除失败，请稍后重试。");
    } finally {
      setCredentialBusy(false);
    }
  };

  const saveEmbeddingKey = async (): Promise<void> => {
    if (!window.desktop || !embeddingKeyDraft.trim()) {
      setEmbeddingMessage("请输入硅基流动 API Key。");
      return;
    }
    setEmbeddingBusy(true);
    setEmbeddingMessage("");
    try {
      const result = await window.desktop.saveSiliconFlowKey(embeddingKeyDraft);
      setEmbeddingKeyDraft("");
      setEditingEmbeddingKey(false);
      onEmbeddingConfiguredChange(true);
      setEmbeddingMessage(`BGE-M3 已连接，正在建立 ${result.scheduled} 条记忆索引。`);
    } catch (error) {
      console.error("保存 BGE-M3 Key 失败", error);
      setEmbeddingMessage("Embedding Key 保存失败。");
    } finally {
      setEmbeddingBusy(false);
    }
  };

  const clearEmbeddingKey = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setEmbeddingBusy(true);
    try {
      await window.desktop.clearSiliconFlowKey();
      onEmbeddingConfiguredChange(false);
      setEditingEmbeddingKey(true);
      setEmbeddingMessage("已清除 BGE-M3 Key，检索回退到关键词模式。");
    } catch (error) {
      console.error("清除 BGE-M3 Key 失败", error);
      setEmbeddingMessage("Embedding Key 清除失败。");
    } finally {
      setEmbeddingBusy(false);
    }
  };

  const rebuildEmbeddingIndex = async (): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setEmbeddingBusy(true);
    try {
      const result = await window.desktop.reindexMemories();
      setEmbeddingMessage(`已安排重建 ${result.scheduled} 条记忆向量。`);
    } catch (error) {
      console.error("重建记忆向量失败", error);
      setEmbeddingMessage("向量索引重建失败。");
    } finally {
      setEmbeddingBusy(false);
    }
  };

  const updatePersona = (patch: Partial<PersonaSettings>): void => {
    onUpdate({
      persona: {
        ...patch,
        preset: patch.preset ?? "custom",
      },
    });
  };

  const applyPersonaPreset = (
    preset: keyof typeof PERSONA_PRESETS,
  ): void => {
    onUpdate({ persona: { ...PERSONA_PRESETS[preset] } });
    setPersonaMessage(`已应用「${PERSONA_PRESETS[preset].name}」预设。`);
  };

  const exportPersona = (): void => {
    const payload = serializePersonaPackage(settings.persona);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.persona.name || "persona"}.persona.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setPersonaMessage("人格配置已导出。");
  };

  const importPersona = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > 100 * 1024) {
      setPersonaMessage("导入失败：人格配置不能超过 100 KB。");
      return;
    }
    try {
      const persona = parsePersonaPackage(await file.text());
      onUpdate({
        persona,
      });
      setPersonaMessage("人格配置已导入，并将在下一轮对话生效。");
    } catch (error) {
      console.error("导入人格配置失败", error);
      setPersonaMessage("导入失败：文件格式或版本不兼容。");
    }
  };

  const uploadCharacter = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !window.desktop) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCharacterMessage("上传失败：图片不能超过 10 MB。");
      return;
    }
    setCharacterBusy(true);
    setCharacterMessage("");
    try {
      const asset = await window.desktop.uploadCharacterAsset({
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        view:
          characterUploadCategory === "character"
            ? characterUploadView
            : "idle",
        category: characterUploadCategory,
      });
      setCharacterAssetList(await window.desktop.listCharacterAssets());
      if (asset.category === "background") {
        onUpdate({ appearance: { customBackgroundId: asset.id } });
        setCharacterMessage(`已上传背景「${asset.displayName}」。`);
      } else if (asset.category === "prop") {
        onUpdate({
          appearance: {
            customPropIds: [
              ...settings.appearance.customPropIds.slice(0, 2),
              asset.id,
            ],
          },
        });
        setCharacterMessage(`已上传道具「${asset.displayName}」并加入舞台。`);
      } else {
        onUpdate({
          appearance: {
            customCharacterId: asset.id,
            customBackgroundId: null,
            customPropIds: [],
          },
        });
        setCharacterMessage(`已上传并切换到「${asset.displayName}」。`);
      }
    } catch (error) {
      console.error("上传角色图片失败", error);
      setCharacterMessage("上传失败：请使用 PNG、GIF 或 WebP 图片。");
    } finally {
      setCharacterBusy(false);
    }
  };

  const deleteCharacter = async (asset: CharacterAsset): Promise<void> => {
    if (!window.desktop) {
      return;
    }
    setCharacterBusy(true);
    try {
      await window.desktop.deleteCharacterAsset(asset.id);
      setCharacterAssetList(await window.desktop.listCharacterAssets());
      const appearancePatch: {
        customCharacterId?: null;
        customBackgroundId?: null;
        customPropIds?: string[];
      } = {};
      if (settings.appearance.customCharacterId === asset.id) {
        appearancePatch.customCharacterId = null;
      }
      if (settings.appearance.customBackgroundId === asset.id) {
        appearancePatch.customBackgroundId = null;
      }
      if (settings.appearance.customPropIds.includes(asset.id)) {
        appearancePatch.customPropIds =
          settings.appearance.customPropIds.filter((id) => id !== asset.id);
      }
      if (Object.keys(appearancePatch).length > 0) {
        onUpdate({ appearance: appearancePatch });
      }
      if (poseCandidateId === asset.id) {
        setPoseCandidateId(null);
      }
      setCharacterMessage(`已删除「${asset.displayName}」。`);
    } catch (error) {
      console.error("删除角色图片失败", error);
      setCharacterMessage("角色图片删除失败。");
    } finally {
      setCharacterBusy(false);
    }
  };

  const toggleProp = (assetId: string): void => {
    const selected = settings.appearance.customPropIds;
    const customPropIds = selected.includes(assetId)
      ? selected.filter((id) => id !== assetId)
      : selected.length < 3
        ? [...selected, assetId]
        : selected;
    onUpdate({ appearance: { customPropIds } });
  };

  const preparePoseGeneration = (): void => {
    if (!selectedCharacterAsset) {
      setPoseMessage("请先在下方选择一个自定义形象作为 AI 生成参考。");
      return;
    }
    if (!selectedSourceSupportsPose) {
      setPoseMessage("AI 姿态暂不支持 GIF，请改用 PNG、WebP 或 JPEG 形象。");
      return;
    }
    if (poseInstruction.trim().length < 2) {
      setPoseMessage("请描述希望角色做出的姿态或场景。");
      return;
    }
    if (!meta.imageGenerationConfigured) {
      setPoseMessage("请先在上方配置硅基流动 API Key。");
      return;
    }
    setPoseMessage("");
    setPoseConfirmationVisible(true);
  };

  const generatePose = async (): Promise<void> => {
    if (!window.desktop || !selectedCharacterAsset || !selectedSourceSupportsPose) {
      return;
    }
    const requestId = crypto.randomUUID();
    setPoseConfirmationVisible(false);
    setPoseGenerating(true);
    setPoseRequestId(requestId);
    setPoseMessage(
      poseCompositionMode === "scene"
        ? "正在生成角色与场景，原形象不会被覆盖…"
        : "正在生成新姿态，原形象不会被覆盖…",
    );
    try {
      const asset = await window.desktop.generateCharacterPose({
        requestId,
        sourceAssetId: selectedCharacterAsset.id,
        instruction: poseInstruction.trim(),
        compositionMode: poseCompositionMode,
      });
      setCharacterAssetList(await window.desktop.listCharacterAssets());
      setPoseCandidateId(asset.id);
      setPoseMessage(
        asset.category === "scene"
          ? "AI 场景已生成。确认满意后再设为桌宠。"
          : "AI 姿态已生成。确认满意后再设为桌宠。",
      );
    } catch (error) {
      console.error("生成角色姿态失败", error);
      setPoseMessage(characterPoseErrorMessage(error));
    } finally {
      setPoseGenerating(false);
      setPoseRequestId(null);
    }
  };

  const cancelPoseGeneration = async (): Promise<void> => {
    if (!window.desktop || !poseRequestId) {
      return;
    }
    setPoseMessage("正在取消生成…");
    try {
      await window.desktop.cancelCharacterPoseGeneration(poseRequestId);
    } catch (error) {
      console.error("取消角色姿态生成失败", error);
      setPoseMessage("取消失败，请等待当前请求结束。");
    }
  };

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
          <strong>{meta.modelConfigured ? "DeepSeek Flash 已连接" : "模型尚未配置"}</strong>
          <p>
            {meta.modelConfigured
              ? "对话通过主进程流式调用，API Key 不会暴露给界面。"
              : "基础桌宠可用；配置 Key 后即可开始对话。"}
          </p>
        </div>
      </div>

      <div className="provider-card">
        <div className="provider-heading">
          <div>
            <span className="eyebrow">MODEL PROVIDER</span>
            <h2>DeepSeek Flash</h2>
          </div>
          <span className={meta.modelConfigured ? "provider-status connected" : "provider-status"}>
            {meta.modelConfigured ? "已配置" : "未配置"}
          </span>
        </div>
        {editingKey ? (
          <div className="key-entry">
            <input
              type="password"
              value={keyDraft}
              placeholder="粘贴 DeepSeek API Key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <button className="primary-button" type="button" disabled={credentialBusy} onClick={() => void saveKey()}>
              {credentialBusy ? "保存中…" : "保存并启用"}
            </button>
            {meta.modelConfigured ? (
              <button className="text-button" type="button" onClick={() => {
                setEditingKey(false);
                setKeyDraft("");
              }}>
                取消
              </button>
            ) : null}
          </div>
        ) : (
          <div className="provider-actions">
            <span>Key 已加密保存在当前 Windows 用户凭据中。</span>
            <button className="text-button" type="button" onClick={() => setEditingKey(true)}>
              更换 Key
            </button>
            <button className="danger-text-button" type="button" onClick={() => void clearKey()}>
              清除
            </button>
          </div>
        )}
        {providerMessage ? <p className="provider-message">{providerMessage}</p> : null}
      </div>

      <div className="provider-card">
        <div className="provider-heading">
          <div>
            <span className="eyebrow">EMBEDDING PROVIDER</span>
            <h2>BGE-M3 混合检索</h2>
          </div>
          <span className={meta.embeddingConfigured ? "provider-status connected" : "provider-status"}>
            {meta.embeddingConfigured ? "已配置" : "关键词回退"}
          </span>
        </div>
        {editingEmbeddingKey ? (
          <div className="key-entry">
            <input
              type="password"
              value={embeddingKeyDraft}
              placeholder="粘贴硅基流动 API Key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setEmbeddingKeyDraft(event.target.value)}
            />
            <button className="primary-button" type="button" disabled={embeddingBusy} onClick={() => void saveEmbeddingKey()}>
              {embeddingBusy ? "保存中…" : "启用语义检索"}
            </button>
            {meta.embeddingConfigured ? (
              <button className="text-button" type="button" onClick={() => setEditingEmbeddingKey(false)}>
                取消
              </button>
            ) : null}
          </div>
        ) : (
          <div className="provider-actions">
            <span>{meta.embeddingModel} 已加密配置；失败时自动回退关键词。</span>
            <button className="text-button" type="button" disabled={embeddingBusy} onClick={() => void rebuildEmbeddingIndex()}>
              重建索引
            </button>
            <button className="text-button" type="button" onClick={() => setEditingEmbeddingKey(true)}>
              更换
            </button>
            <button className="danger-text-button" type="button" onClick={() => void clearEmbeddingKey()}>
              清除
            </button>
          </div>
        )}
        {embeddingMessage ? <p className="provider-message">{embeddingMessage}</p> : null}
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
          <div className="character-assets">
            <div className="character-assets-heading">
              <div>
                <strong>桌宠形象</strong>
                <p>角色、背景与道具分层组合；单张最大 10 MB。</p>
              </div>
              <div>
                <select
                  aria-label="资产类型"
                  value={characterUploadCategory}
                  onChange={(event) =>
                    setCharacterUploadCategory(
                      event.target.value as StageAssetCategory,
                    )
                  }
                >
                  <option value="character">角色</option>
                  <option value="background">背景</option>
                  <option value="prop">透明道具</option>
                </select>
                {characterUploadCategory === "character" ? (
                  <select
                    aria-label="图片视图"
                    value={characterUploadView}
                    onChange={(event) =>
                      setCharacterUploadView(
                        event.target.value as CharacterView,
                      )
                    }
                  >
                    <option value="idle">待机</option>
                    <option value="talking">说话</option>
                    <option value="thinking">思考</option>
                    <option value="front">正面</option>
                    <option value="left">左侧</option>
                    <option value="right">右侧</option>
                    <option value="back">背面</option>
                    <option value="sleeping">睡眠</option>
                  </select>
                ) : null}
                <button
                  className="secondary-panel-button"
                  type="button"
                  disabled={characterBusy}
                  onClick={() => characterFileInput.current?.click()}
                >
                  {characterBusy ? "处理中…" : "上传图片"}
                </button>
                <input
                  ref={characterFileInput}
                  type="file"
                  accept="image/png,image/gif,image/webp"
                  hidden
                  onChange={(event) => void uploadCharacter(event)}
                />
              </div>
            </div>
            <div className="character-gallery">
              <button
                className={
                  settings.appearance.customCharacterId === null
                    ? "character-option selected"
                    : "character-option"
                }
                type="button"
                onClick={() =>
                  onUpdate({ appearance: { customCharacterId: null } })
                }
              >
                <span className="builtin-character-preview">湛</span>
                <strong>内置阿湛</strong>
              </button>
              {characterGalleryAssets.map((asset) => (
                <article
                  className={
                    settings.appearance.customCharacterId === asset.id
                      ? "character-option selected"
                      : "character-option"
                  }
                  key={asset.id}
                >
                  <button
                    className="character-select"
                    type="button"
                    onClick={() =>
                      onUpdate({
                        appearance: {
                          customCharacterId: asset.id,
                          ...(asset.category === "scene"
                            ? {
                                customBackgroundId: null,
                                customPropIds: [],
                              }
                            : {}),
                        },
                      })
                    }
                  >
                    <CharacterAssetThumbnail asset={asset} />
                    <strong>{asset.displayName}</strong>
                    <small>
                      {characterViewLabel(asset.view)} · {asset.width}×{asset.height}
                    </small>
                    {asset.category === "scene" ? (
                      <span className="character-origin-badge scene">
                        完整场景
                      </span>
                    ) : asset.origin === "ai_generated" ? (
                      <span className="character-origin-badge">AI 姿态</span>
                    ) : null}
                  </button>
                  <button
                    className="character-delete"
                    type="button"
                    aria-label={`删除 ${asset.displayName}`}
                    onClick={() => void deleteCharacter(asset)}
                  >
                    ×
                  </button>
                </article>
              ))}
            </div>
            <div className="stage-layer-heading">
              <div>
                <strong>背景层</strong>
                <small>默认透明；选择图片后才铺满桌宠窗口。</small>
              </div>
              <button
                className={
                  settings.appearance.customBackgroundId === null
                    ? "layer-reset selected"
                    : "layer-reset"
                }
                type="button"
                onClick={() =>
                  onUpdate({ appearance: { customBackgroundId: null } })
                }
              >
                透明背景（默认）
              </button>
            </div>
            <div className="character-gallery stage-layer-gallery">
              {backgroundAssets.length === 0 ? (
                <p className="stage-layer-empty">
                  上传一张房间、窗外或纯色背景图。
                </p>
              ) : (
                backgroundAssets.map((asset) => (
                  <article
                    className={
                      settings.appearance.customBackgroundId === asset.id
                        ? "character-option stage-layer-option selected"
                        : "character-option stage-layer-option"
                    }
                    key={asset.id}
                  >
                    <button
                      className="character-select"
                      type="button"
                      onClick={() =>
                        onUpdate({
                          appearance: { customBackgroundId: asset.id },
                        })
                      }
                    >
                      <CharacterAssetThumbnail asset={asset} />
                      <strong>{asset.displayName}</strong>
                      <small>背景</small>
                    </button>
                    <button
                      className="character-delete"
                      type="button"
                      aria-label={`删除 ${asset.displayName}`}
                      onClick={() => void deleteCharacter(asset)}
                    >
                      ×
                    </button>
                  </article>
                ))
              )}
            </div>

            <div className="stage-layer-heading">
              <div>
                <strong>前景道具</strong>
                <small>
                  最多 3 个，依次放在左下、居中、右下；请上传透明 PNG/WebP。
                </small>
              </div>
              <button
                className={
                  settings.appearance.customPropIds.length === 0
                    ? "layer-reset selected"
                    : "layer-reset"
                }
                type="button"
                onClick={() =>
                  onUpdate({ appearance: { customPropIds: [] } })
                }
              >
                清空道具
              </button>
            </div>
            <div className="character-gallery stage-layer-gallery">
              {propAssets.length === 0 ? (
                <p className="stage-layer-empty">
                  上传椅子、绿植、杯子等透明前景道具。
                </p>
              ) : (
                propAssets.map((asset) => {
                  const selected = settings.appearance.customPropIds.includes(
                    asset.id,
                  );
                  const slot =
                    settings.appearance.customPropIds.indexOf(asset.id) + 1;
                  return (
                    <article
                      className={
                        selected
                          ? "character-option stage-layer-option selected"
                          : "character-option stage-layer-option"
                      }
                      key={asset.id}
                    >
                      <button
                        className="character-select"
                        type="button"
                        disabled={
                          !selected &&
                          settings.appearance.customPropIds.length >= 3
                        }
                        onClick={() => toggleProp(asset.id)}
                      >
                        <CharacterAssetThumbnail asset={asset} />
                        <strong>{asset.displayName}</strong>
                        <small>{selected ? `道具槽 ${slot}` : "点击加入舞台"}</small>
                      </button>
                      <button
                        className="character-delete"
                        type="button"
                        aria-label={`删除 ${asset.displayName}`}
                        onClick={() => void deleteCharacter(asset)}
                      >
                        ×
                      </button>
                    </article>
                  );
                })
              )}
            </div>
            {characterMessage ? (
              <p className="provider-message">{characterMessage}</p>
            ) : null}
            <div className="character-pose-director">
              <div className="character-pose-heading">
                <div>
                  <strong>AI 角色与场景导演</strong>
                  <p>改变姿态，或把角色、道具和背景合成为完整场景。</p>
                </div>
                <span
                  className={
                    meta.imageGenerationConfigured
                      ? "provider-status connected"
                      : "provider-status"
                  }
                >
                  {meta.imageGenerationConfigured ? "图像服务已配置" : "需配置"}
                </span>
              </div>
              <div
                className="segmented-control composition-mode"
                aria-label="AI 生成模式"
              >
                <button
                  className={
                    poseCompositionMode === "character" ? "selected" : ""
                  }
                  type="button"
                  disabled={poseGenerating}
                  onClick={() => {
                    setPoseCompositionMode("character");
                    setPoseConfirmationVisible(false);
                  }}
                >
                  仅角色姿态
                </button>
                <button
                  className={poseCompositionMode === "scene" ? "selected" : ""}
                  type="button"
                  disabled={poseGenerating}
                  onClick={() => {
                    setPoseCompositionMode("scene");
                    setPoseConfirmationVisible(false);
                  }}
                >
                  角色与完整场景
                </button>
              </div>
              <textarea
                aria-label="AI 姿态描述"
                value={poseInstruction}
                maxLength={500}
                rows={3}
                placeholder={
                  poseCompositionMode === "scene"
                    ? "例如：让她坐在咖啡馆的木椅上，旁边有一盆绿植和咖啡杯，保持原衣着和画风。"
                    : "例如：让她自然坐在一张简单的凳子上，正面全身，保持原衣着和画风。"
                }
                disabled={poseGenerating}
                onChange={(event) => {
                  setPoseInstruction(event.target.value);
                  setPoseConfirmationVisible(false);
                }}
              />
              <div className="character-pose-actions">
                <small>
                  {selectedCharacterAsset
                    ? `参考形象：${selectedCharacterAsset.displayName}`
                    : "先从画廊选择一张自定义形象。"}
                </small>
                <button
                  className="secondary-panel-button"
                  type="button"
                  disabled={
                    poseGenerating ||
                    !selectedCharacterAsset ||
                    !selectedSourceSupportsPose ||
                    poseInstruction.trim().length < 2
                  }
                  onClick={preparePoseGeneration}
                >
                  检查并准备生成
                </button>
              </div>

              {poseConfirmationVisible && selectedCharacterAsset ? (
                <div
                  className="character-pose-confirmation"
                  role="group"
                  aria-label="确认 AI 姿态生成"
                >
                  <strong>确认把参考图发送到云端并生成？</strong>
                  <p>
                    模式：
                    {poseCompositionMode === "scene"
                      ? "角色 + 道具 + 背景完整场景"
                      : "仅角色姿态"}
                    · 参考：{selectedCharacterAsset.displayName} · 描述：
                    {poseInstruction.trim()}
                  </p>
                  <p>
                    模型：{meta.imageGenerationModel}。会向硅基流动上传这张角色参考图和姿态描述，
                    可能按平台规则产生费用，实际以账户账单为准。
                  </p>
                  <p>
                    只生成新的{poseCompositionMode === "scene" ? "场景" : "姿态"}
                    候选，不会覆盖原图或自动切换桌宠。
                  </p>
                  <div className="character-pose-confirmation-actions">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setPoseConfirmationVisible(false)}
                    >
                      返回修改
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void generatePose()}
                    >
                      确认生成
                    </button>
                  </div>
                </div>
              ) : null}

              {poseGenerating ? (
                <div className="character-pose-progress" role="status">
                  <span>
                    正在生成
                    {poseCompositionMode === "scene" ? "角色与场景" : "姿态"}
                    ，通常需要数秒到一分钟。
                  </span>
                  <button
                    className="danger-text-button"
                    type="button"
                    onClick={() => void cancelPoseGeneration()}
                  >
                    取消生成
                  </button>
                </div>
              ) : null}

              {poseCandidate ? (
                <div className="character-pose-candidate">
                  <CharacterAssetThumbnail asset={poseCandidate} />
                  <div>
                    <strong>
                      {poseCandidate.category === "scene"
                        ? "完整场景预览"
                        : "新姿态预览"}
                    </strong>
                    <p>{poseCandidate.generationPrompt}</p>
                    <small>
                      {poseCandidate.generationModel} · 原形象仍已保留
                    </small>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      onUpdate({
                        appearance: {
                          customCharacterId: poseCandidate.id,
                          ...(poseCandidate.category === "scene"
                            ? {
                                customBackgroundId: null,
                                customPropIds: [],
                              }
                            : {}),
                        },
                      });
                      setPoseMessage(
                        poseCandidate.category === "scene"
                          ? "已将完整场景设为桌宠；独立背景与道具已让位，可随时切回。"
                          : "已将 AI 姿态设为桌宠，可随时从画廊切回原图。",
                      );
                    }}
                  >
                    设为桌宠
                  </button>
                </div>
              ) : null}

              {poseMessage ? (
                <p className="provider-message">{poseMessage}</p>
              ) : null}
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
          <SettingToggle
            label="自动生成每日总结"
            description="到点后在本地汇总任务与非本地专属记忆。"
            checked={settings.dailyBrief.enabled}
            onChange={(enabled) => onUpdate({ dailyBrief: { enabled } })}
          />
          <div className={settings.dailyBrief.enabled ? "time-row" : "time-row disabled"}>
            <label>
              生成时间
              <input
                type="time"
                value={settings.dailyBrief.time}
                disabled={!settings.dailyBrief.enabled}
                onChange={(event) =>
                  onUpdate({ dailyBrief: { time: event.target.value } })
                }
              />
            </label>
          </div>
        </section>

        <section className="setting-group persona-group">
          <div className="persona-heading">
            <div>
              <h2>角色人格</h2>
              <p>只改变称呼、语气和建议方式，不覆盖安全与权限规则。</p>
            </div>
            <div className="persona-transfer">
              <button className="secondary-panel-button" type="button" onClick={exportPersona}>
                导出
              </button>
              <button
                className="secondary-panel-button"
                type="button"
                onClick={() => personaFileInput.current?.click()}
              >
                导入
              </button>
              <input
                ref={personaFileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importPersona(event)}
              />
            </div>
          </div>

          <div className="persona-presets" aria-label="人格预设">
            {(Object.keys(PERSONA_PRESETS) as Array<keyof typeof PERSONA_PRESETS>).map((preset) => (
              <button
                className={settings.persona.preset === preset ? "persona-preset selected" : "persona-preset"}
                key={preset}
                type="button"
                onClick={() => applyPersonaPreset(preset)}
              >
                <strong>{PERSONA_PRESETS[preset].name}</strong>
                <span>{PERSONA_PRESETS[preset].description}</span>
              </button>
            ))}
          </div>

          <div className="persona-form">
            <label>
              角色名称
              <input
                value={settings.persona.name}
                maxLength={30}
                onChange={(event) => updatePersona({ name: event.target.value })}
              />
            </label>
            <label>
              自称
              <input
                value={settings.persona.selfReference}
                maxLength={20}
                onChange={(event) => updatePersona({ selfReference: event.target.value })}
              />
            </label>
            <label>
              称呼用户
              <input
                value={settings.persona.userTitle}
                maxLength={30}
                onChange={(event) => updatePersona({ userTitle: event.target.value })}
              />
            </label>
            <label>
              回复长度
              <select
                value={settings.persona.replyLength}
                onChange={(event) =>
                  updatePersona({
                    replyLength: event.target.value as PersonaSettings["replyLength"],
                  })
                }
              >
                <option value="concise">简洁</option>
                <option value="balanced">适中</option>
                <option value="detailed">详细</option>
              </select>
            </label>
            <label className="wide">
              人格描述
              <textarea
                value={settings.persona.description}
                rows={3}
                maxLength={1_000}
                onChange={(event) => updatePersona({ description: event.target.value })}
              />
            </label>
            <label className="wide">
              语气和说话风格
              <textarea
                value={settings.persona.tone}
                rows={2}
                maxLength={500}
                onChange={(event) => updatePersona({ tone: event.target.value })}
              />
            </label>
            <label>
              主动性偏好
              <select
                value={settings.persona.proactiveStyle}
                onChange={(event) =>
                  updatePersona({
                    proactiveStyle: event.target.value as PersonaSettings["proactiveStyle"],
                  })
                }
              >
                <option value="quiet">安静</option>
                <option value="standard">标准</option>
                <option value="active">积极</option>
              </select>
            </label>
            <label className="wide">
              补充行为边界
              <textarea
                value={settings.persona.boundaries}
                rows={2}
                maxLength={1_000}
                onChange={(event) => updatePersona({ boundaries: event.target.value })}
              />
            </label>
          </div>

          <details className="persona-preview">
            <summary>查看人格摘要</summary>
            <pre>{[
              `名称：${settings.persona.name}`,
              `自称：${settings.persona.selfReference}`,
              `称呼用户：${settings.persona.userTitle}`,
              `人格：${settings.persona.description}`,
              `语气：${settings.persona.tone}`,
              `回复长度：${settings.persona.replyLength}`,
              `主动性：${settings.persona.proactiveStyle}`,
              `边界：${settings.persona.boundaries || "无额外要求"}`,
              "安全与权限规则始终优先于角色配置。",
            ].join("\n")}</pre>
          </details>
          {personaMessage ? <p className="provider-message">{personaMessage}</p> : null}
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
            <span>
              SQLite {meta.database.ready ? `schema v${meta.database.schemaVersion}` : "不可用"}
            </span>
          </div>
          <div className="center-links">
            <button className="secondary-panel-button" type="button" onClick={onOpenMemory}>
              记忆中心
            </button>
            <button className="secondary-panel-button" type="button" onClick={onOpenTasks}>
              任务中心
            </button>
            <button className="secondary-panel-button" type="button" onClick={onOpenDaily}>
              今日总结
            </button>
            <button className="secondary-panel-button" type="button" onClick={onOpenTools}>
              工具与连接器
            </button>
          </div>
        </section>
      </div>

      {statusMessage ? (
        <p className="inline-error" role="alert">
          {statusMessage}
        </p>
      ) : null}

      <footer className="settings-footer">
        <span>API Key 不会返回界面；对话内容只发送给已配置的模型服务。</span>
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

function characterPoseErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/CHARACTER_[A-Z_]+/)?.[0] ?? "";
  switch (code) {
    case "CHARACTER_POSE_NOT_CONFIGURED":
      return "请先配置硅基流动 API Key。";
    case "CHARACTER_POSE_SOURCE_NOT_FOUND":
      return "参考形象已不存在，请重新选择。";
    case "CHARACTER_POSE_SOURCE_UNSUPPORTED":
      return "该图片格式不能用于 AI 姿态，请改用 PNG、WebP 或 JPEG。";
    case "CHARACTER_POSE_BUSY":
      return "已有一个姿态正在生成，请等待或先取消。";
    case "CHARACTER_POSE_TIMEOUT":
      return "生成超时。结果可能已在云端产生，但本应用没有自动重试。";
    case "CHARACTER_POSE_CANCELLED":
      return "已取消生成，当前桌宠没有变化。";
    case "CHARACTER_POSE_RATE_LIMITED":
      return "图像服务繁忙或额度受限，请稍后重试。";
    case "CHARACTER_POSE_AUTH_FAILED":
      return "硅基流动凭据无效，请重新配置 API Key。";
    case "CHARACTER_POSE_IMAGE_INVALID":
      return "生成结果不是可用的图片，已丢弃且未切换桌宠。";
    case "CHARACTER_POSE_STORAGE_FAILED":
      return "生成图片保存失败，请检查磁盘空间后重试。";
    case "CHARACTER_POSE_RESULT_UNSAFE":
      return "生成图片地址未通过安全检查，已停止下载。";
    case "CHARACTER_POSE_PROVIDER_UNAVAILABLE":
      return "图像生成服务暂时不可用，当前桌宠没有变化。";
    default:
      return "生成失败，当前桌宠没有变化。请检查网络或服务配置后重试。";
  }
}

function CharacterVisual({
  customCharacterId,
  customBackgroundId,
  customPropIds,
  scale,
}: {
  customCharacterId: string | null;
  customBackgroundId: string | null;
  customPropIds: string[];
  scale: number;
}): React.JSX.Element {
  const character = useCharacterAssetImage(customCharacterId);
  const background = useCharacterAssetImage(customBackgroundId);

  if (character.asset?.category === "scene" && character.url) {
    return (
      <div className="character-stage">
        <img
          className="custom-scene-image"
          src={character.url}
          alt="AI 完整桌宠场景"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="character-stage">
      {background.url ? (
        <img
          className="stage-background-image"
          src={background.url}
          alt="桌宠背景"
          draggable={false}
        />
      ) : null}
      <div
        className="character-wrap"
        style={{ transform: `scale(${scale})` }}
      >
        {customPropIds.slice(0, 3).map((id, index) => (
          <StagePropImage
            key={`${id}:${index}`}
            id={id}
            slot={index}
          />
        ))}
        {character.url ? (
          <img
            className="custom-character-image"
            src={character.url}
            alt="自定义桌宠形象"
            draggable={false}
          />
        ) : (
          <AzureCharacter />
        )}
        {character.failed ? (
          <span className="character-load-error">形象读取失败</span>
        ) : null}
      </div>
    </div>
  );
}

function StagePropImage({
  id,
  slot,
}: {
  id: string;
  slot: number;
}): React.JSX.Element | null {
  const prop = useCharacterAssetImage(id);
  if (!prop.url) {
    return null;
  }
  return (
    <img
      className={`stage-prop-image slot-${slot}`}
      src={prop.url}
      alt={`前景道具 ${slot + 1}`}
      draggable={false}
    />
  );
}

function useCharacterAssetImage(id: string | null): {
  asset: CharacterAsset | null;
  url: string | null;
  failed: boolean;
} {
  const [asset, setAsset] = useState<CharacterAsset | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAsset(null);
    setUrl(null);
    setFailed(false);
    if (!id || !window.desktop) {
      return undefined;
    }
    let active = true;
    let objectUrl: string | null = null;
    void window.desktop
      .getCharacterAssetData(id)
      .then(({ asset: loaded, bytes }) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(imageBlob(bytes, loaded.mimeType));
        setAsset(loaded);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        console.error("加载桌宠舞台资产失败", error);
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [id]);

  return { asset, url, failed };
}

function CharacterAssetThumbnail({
  asset,
}: {
  asset: CharacterAsset;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!window.desktop) {
      return undefined;
    }
    let active = true;
    let objectUrl: string | null = null;
    void window.desktop
      .getCharacterAssetData(asset.id)
      .then(({ bytes }) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(imageBlob(bytes, asset.mimeType));
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [asset.id, asset.mimeType]);

  return url ? (
    <img src={url} alt="" draggable={false} />
  ) : (
    <span className="character-thumbnail-loading" />
  );
}

function characterViewLabel(view: CharacterView): string {
  return {
    front: "正面",
    left: "左侧",
    right: "右侧",
    back: "背面",
    idle: "待机",
    talking: "说话",
    thinking: "思考",
    sleeping: "睡眠",
  }[view];
}

function imageBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
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
