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
import type {
  AssistantStreamEvent,
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
                    meta: { ...current.meta, embeddingConfigured },
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

      <div
        className="character-wrap"
        style={{ transform: `scale(${settings.appearance.scale})` }}
      >
        <AzureCharacter />
      </div>

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
}

function ChatPanel({
  bootstrap,
  onClose,
  onOpenSettings,
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
      const [toolList, callList, connectorList] = await Promise.all([
        api.listTools(),
        api.listToolCalls(30),
        api.listConnectors(),
      ]);
      setTools(toolList);
      setCalls(callList);
      setConnectors(connectorList);
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
