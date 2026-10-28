import { useEffect, useMemo, useState } from "react";
import type {
  AssistantView,
  AuthResponse,
  MemoryView,
  MessageView,
  TaskView,
} from "@companion/contracts";
import {
  bootstrap,
  bootstrapStatus,
  chat,
  completeTask,
  createAssistant,
  createMemory,
  createTask,
  deleteMemory,
  listAssistants,
  listMemories,
  listTasks,
  login,
  updateAppearance,
} from "./api";

type Screen = "loading" | "setup" | "login" | "app";
type Tab = "chat" | "memory" | "tasks" | "appearance";

const AUTH_KEY = "personal-companion-auth-v1";

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("loading");
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    const boot = bootstrapStatus();
    void boot
      .then((status) => {
        if (!status.bootstrapped) {
          setScreen("setup");
          return;
        }
        if (stored) {
          try {
            setAuth(JSON.parse(stored) as AuthResponse);
            setScreen("app");
            return;
          } catch {
            localStorage.removeItem(AUTH_KEY);
          }
        }
        setScreen("login");
      })
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error ? loadError.message : "无法连接后端",
        );
        setScreen("login");
      });
  }, []);

  const finishAuth = (value: AuthResponse): void => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(value));
    setAuth(value);
    setScreen("app");
    setError("");
  };

  if (screen === "loading") {
    return <CenteredMessage title="正在连接你的数字空间…" />;
  }

  if (screen === "setup") {
    return (
      <SetupScreen
        error={error}
        onError={setError}
        onComplete={finishAuth}
      />
    );
  }

  if (screen === "login" || !auth) {
    return (
      <LoginScreen
        error={error}
        onError={setError}
        onComplete={finishAuth}
      />
    );
  }

  return (
    <CompanionWorkspace
      auth={auth}
      onLogout={() => {
        localStorage.removeItem(AUTH_KEY);
        setAuth(null);
        setScreen("login");
      }}
    />
  );
}

function SetupScreen({
  error,
  onError,
  onComplete,
}: {
  error: string;
  onError: (message: string) => void;
  onComplete: (auth: AuthResponse) => void;
}): React.JSX.Element {
  const [form, setForm] = useState({
    bootstrapToken: "",
    email: "",
    password: "",
    displayName: "",
    workspaceName: "我的数字空间",
    assistantName: "小栖",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    onError("");
    try {
      const auth = await bootstrap({
        ...form,
        deviceName: deviceName(),
        platform: platformName(),
      });
      onComplete(auth);
    } catch (submitError) {
      onError(errorText(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="首次初始化"
      title="建立你的私人数字空间"
      description="一个账号、一个空间、多个数字伙伴。服务和记忆由你掌控。"
    >
      <label>
        初始化令牌
        <input
          type="password"
          value={form.bootstrapToken}
          onChange={(event) =>
            setForm({ ...form, bootstrapToken: event.target.value })
          }
          placeholder="来自服务器环境变量 BOOTSTRAP_TOKEN"
        />
      </label>
      <div className="auth-grid">
        <label>
          昵称
          <input
            value={form.displayName}
            onChange={(event) =>
              setForm({ ...form, displayName: event.target.value })
            }
          />
        </label>
        <label>
          邮箱
          <input
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
        </label>
      </div>
      <label>
        密码
        <input
          type="password"
          value={form.password}
          onChange={(event) =>
            setForm({ ...form, password: event.target.value })
          }
          placeholder="至少 10 位"
        />
      </label>
      <div className="auth-grid">
        <label>
          空间名称
          <input
            value={form.workspaceName}
            onChange={(event) =>
              setForm({ ...form, workspaceName: event.target.value })
            }
          />
        </label>
        <label>
          第一位伙伴
          <input
            value={form.assistantName}
            onChange={(event) =>
              setForm({ ...form, assistantName: event.target.value })
            }
          />
        </label>
      </div>
      {error ? <p className="form-error">{friendlyError(error)}</p> : null}
      <button
        className="primary-action"
        type="button"
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "正在创建…" : "创建数字空间"}
      </button>
    </AuthLayout>
  );
}

function LoginScreen({
  error,
  onError,
  onComplete,
}: {
  error: string;
  onError: (message: string) => void;
  onComplete: (auth: AuthResponse) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const previousDevice = useMemo(
    () => localStorage.getItem("personal-companion-device-id") ?? undefined,
    [],
  );

  const submit = async (): Promise<void> => {
    setBusy(true);
    onError("");
    try {
      const auth = await login({
        email,
        password,
        deviceName: deviceName(),
        platform: platformName(),
        ...(previousDevice ? { deviceId: previousDevice } : {}),
      });
      localStorage.setItem("personal-companion-device-id", auth.device.id);
      onComplete(auth);
    } catch (submitError) {
      onError(errorText(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="多设备连接"
      title="回到你的数字空间"
      description={`当前设备：${deviceName()}`}
    >
      <label>
        邮箱
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        密码
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submit();
            }
          }}
        />
      </label>
      {error ? <p className="form-error">{friendlyError(error)}</p> : null}
      <button
        className="primary-action"
        type="button"
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "连接中…" : "连接"}
      </button>
    </AuthLayout>
  );
}

function AuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-orb large">P</div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="auth-description">{description}</p>
        <div className="auth-form">{children}</div>
      </section>
      <aside className="auth-aside">
        <p className="eyebrow">PERSONAL COMPANION</p>
        <h2>不是另一个聊天窗口。</h2>
        <p>
          一个有连续身份的数字伙伴，能在电脑和手机之间记住关系、任务与承诺。
        </p>
        <ul>
          <li>身份与外观分离，换装不失忆</li>
          <li>共享记忆与伙伴私有记忆隔离</li>
          <li>任务、对话和关系跨设备延续</li>
        </ul>
      </aside>
    </main>
  );
}

function CompanionWorkspace({
  auth,
  onLogout,
}: {
  auth: AuthResponse;
  onLogout: () => void;
}): React.JSX.Element {
  const [assistants, setAssistants] = useState<AssistantView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected =
    assistants.find((assistant) => assistant.id === selectedId) ??
    assistants[0] ??
    null;

  const reload = async (): Promise<void> => {
    const [assistantList, memoryList, taskList] = await Promise.all([
      listAssistants(auth.token),
      listMemories(auth.token),
      listTasks(auth.token),
    ]);
    setAssistants(assistantList);
    setMemories(memoryList);
    setTasks(taskList);
    setSelectedId((current) =>
      assistantList.some((assistant) => assistant.id === current)
        ? current
        : assistantList[0]?.id ?? null,
    );
  };

  useEffect(() => {
    void reload().catch((loadError: unknown) =>
      setError(errorText(loadError)),
    );
  }, [auth.token]);

  const send = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || !selected || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setDraft("");
    const optimistic: MessageView = {
      id: `local-${crypto.randomUUID()}`,
      conversationId: conversationId ?? "pending",
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await chat(
        auth.token,
        selected.id,
        content,
        conversationId ?? undefined,
      );
      setConversationId(result.conversation.id);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        result.userMessage,
        result.assistantMessage,
      ]);
    } catch (sendError) {
      setError(friendlyError(errorText(sendError)));
    } finally {
      setBusy(false);
    }
  };

  const selectAssistant = (assistant: AssistantView): void => {
    setSelectedId(assistant.id);
    setConversationId(null);
    setMessages([]);
    setError("");
    setTab("chat");
  };

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-orb">P</div>
          <div>
            <strong>{auth.workspace.name}</strong>
            <small>{auth.user.displayName}</small>
          </div>
        </div>
        <div className="sidebar-label">数字伙伴</div>
        <div className="assistant-list">
          {assistants.map((assistant) => (
            <button
              className={
                selected?.id === assistant.id
                  ? "assistant-item selected"
                  : "assistant-item"
              }
              key={assistant.id}
              type="button"
              onClick={() => selectAssistant(assistant)}
            >
              <span
                className="assistant-dot"
                style={{
                  background: `linear-gradient(135deg, ${assistant.appearance.primaryColor}, ${assistant.appearance.secondaryColor})`,
                }}
              />
              <span>
                <strong>{assistant.name}</strong>
                <small>{assistant.summary || assistant.persona.role}</small>
              </span>
            </button>
          ))}
        </div>
        <CreateAssistant onCreated={async (created) => {
          await reload();
          setSelectedId(created.id);
          setTab("chat");
        }} token={auth.token} />
        <div className="sidebar-footer">
          <span>{auth.device.name}</span>
          <button type="button" onClick={onLogout}>
            断开
          </button>
        </div>
      </aside>

      <section className="main-stage">
        {selected ? (
          <>
            <header className="stage-header">
              <div>
                <p className="eyebrow">DIGITAL COMPANION</p>
                <h1>{selected.name}</h1>
                <p>{selected.persona.role}</p>
              </div>
              <nav className="tabs" aria-label="伙伴功能">
                {(
                  [
                    ["chat", "对话"],
                    ["memory", "记忆"],
                    ["tasks", "任务"],
                    ["appearance", "形象"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    className={tab === key ? "active" : ""}
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </header>
            {error ? <div className="banner error">{error}</div> : null}
            {tab === "chat" ? (
              <ChatPanel
                assistant={selected}
                busy={busy}
                draft={draft}
                messages={messages}
                onDraft={setDraft}
                onSend={() => void send()}
              />
            ) : tab === "memory" ? (
              <MemoryPanel
                assistant={selected}
                memories={memories}
                onChanged={reload}
                token={auth.token}
              />
            ) : tab === "tasks" ? (
              <TaskPanel
                assistant={selected}
                onChanged={reload}
                tasks={tasks}
                token={auth.token}
              />
            ) : (
              <AppearancePanel
                assistant={selected}
                onChanged={reload}
                onSaved={(updated) =>
                  setAssistants((current) =>
                    current.map((assistant) =>
                      assistant.id === updated.id ? updated : assistant,
                    ),
                  )
                }
                token={auth.token}
              />
            )}
          </>
        ) : (
          <CenteredMessage title="还没有数字伙伴" />
        )}
      </section>
      <aside className="presence-panel">
        <p className="eyebrow">CURRENT PRESENCE</p>
        {selected ? (
          <>
            <div
              className={`companion-orb ${selected.appearance.form}`}
              style={{
                background: `radial-gradient(circle at 32% 24%, ${selected.appearance.secondaryColor}, ${selected.appearance.primaryColor})`,
              }}
            >
              {selected.appearance.avatarUrl ? (
                <img src={selected.appearance.avatarUrl} alt="" />
              ) : (
                selected.name.slice(0, 1)
              )}
            </div>
            <h2>{selected.name}</h2>
            <p className="presence-outfit">
              {selected.appearance.outfit} · {selected.appearance.scene}
            </p>
            <div className="presence-card">
              <span>关系</span>
              <strong>持续存在</strong>
            </div>
            <div className="presence-card">
              <span>记忆</span>
              <strong>
                {memories.filter(
                  (memory) =>
                    memory.scope !== "assistant" ||
                    memory.assistantId === selected.id,
                ).length}{" "}
                条可见
              </strong>
            </div>
            <div className="presence-card">
              <span>开放任务</span>
              <strong>
                {
                  tasks.filter(
                    (task) =>
                      task.status === "open" &&
                      (task.assistantId === null ||
                        task.assistantId === selected.id),
                  ).length
                }
              </strong>
            </div>
          </>
        ) : null}
      </aside>
    </main>
  );
}

function ChatPanel({
  assistant,
  messages,
  draft,
  busy,
  onDraft,
  onSend,
}: {
  assistant: AssistantView;
  messages: MessageView[];
  draft: string;
  busy: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
}): React.JSX.Element {
  return (
    <section className="content-panel chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="brand-orb">✦</div>
            <h3>和 {assistant.name} 继续你们的故事</h3>
            <p>
              你可以聊事情、委托任务，或分享此刻的心情。共享记忆会跨设备保留。
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`message ${message.role}`}
              key={message.id}
            >
              <span>
                {message.role === "user" ? "你" : assistant.name}
              </span>
              <p>{message.content}</p>
            </article>
          ))
        )}
      </div>
      <div className="composer">
        <textarea
          value={draft}
          rows={3}
          maxLength={20_000}
          placeholder={`和${assistant.name}说点什么…`}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button
          className="primary-action"
          type="button"
          disabled={!draft.trim() || busy}
          onClick={onSend}
        >
          {busy ? "回应中…" : "发送"}
        </button>
      </div>
    </section>
  );
}

function MemoryPanel({
  assistant,
  memories,
  token,
  onChanged,
}: {
  assistant: AssistantView;
  memories: MemoryView[];
  token: string;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [scope, setScope] = useState<MemoryView["scope"]>("assistant");
  const [type, setType] = useState<MemoryView["type"]>("fact");
  const [content, setContent] = useState("");

  const submit = async (): Promise<void> => {
    if (!content.trim()) {
      return;
    }
    await createMemory(token, {
      assistantId: scope === "assistant" ? assistant.id : null,
      scope,
      type,
      content: content.trim(),
      source: "manual",
      importance: 0.7,
    });
    setContent("");
    await onChanged();
  };

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <h2>记忆空间</h2>
          <p>共享记忆所有伙伴可见；伙伴私有记忆不会进入其他伙伴。</p>
        </div>
      </div>
      <div className="inline-form">
        <select
          value={scope}
          onChange={(event) =>
            setScope(event.target.value as MemoryView["scope"])
          }
        >
          <option value="personal">个人共享</option>
          <option value="assistant">伙伴私有</option>
          <option value="project">项目共享</option>
        </select>
        <select
          value={type}
          onChange={(event) =>
            setType(event.target.value as MemoryView["type"])
          }
        >
          <option value="profile">档案</option>
          <option value="preference">偏好</option>
          <option value="fact">事实</option>
          <option value="project_decision">项目决定</option>
          <option value="event">事件</option>
          <option value="commitment">承诺</option>
        </select>
        <input
          value={content}
          placeholder="写入一条可追溯记忆"
          onChange={(event) => setContent(event.target.value)}
        />
        <button type="button" onClick={() => void submit()}>
          添加
        </button>
      </div>
      <div className="card-list">
        {memories
          .filter(
            (memory) =>
              memory.scope !== "assistant" ||
              memory.assistantId === assistant.id,
          )
          .map((memory) => (
            <article className="data-card" key={memory.id}>
              <div>
                <span className="pill">{memory.scope}</span>
                <span className="pill muted">{memory.type}</span>
              </div>
              <p>{memory.content}</p>
              <small>
                来源 {memory.source} · 重要度{" "}
                {Math.round(memory.importance * 100)}%
              </small>
              <button
                className="danger-link"
                type="button"
                onClick={() => {
                  void deleteMemory(token, memory.id).then(onChanged);
                }}
              >
                删除
              </button>
            </article>
          ))}
      </div>
    </section>
  );
}

function TaskPanel({
  assistant,
  tasks,
  token,
  onChanged,
}: {
  assistant: AssistantView;
  tasks: TaskView[];
  token: string;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      return;
    }
    await createTask(token, {
      assistantId: assistant.id,
      title: title.trim(),
      description: description.trim(),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
    setTitle("");
    setDescription("");
    setDueAt("");
    await onChanged();
  };

  return (
    <section className="content-panel">
      <div className="panel-heading">
        <div>
          <h2>任务与承诺</h2>
          <p>任务属于 Workspace，可以指定给伙伴，跨设备共享。</p>
        </div>
      </div>
      <div className="task-form">
        <input
          value={title}
          placeholder="需要完成什么？"
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          value={description}
          rows={2}
          placeholder="补充说明"
          onChange={(event) => setDescription(event.target.value)}
        />
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
        <button type="button" onClick={() => void submit()}>
          创建任务
        </button>
      </div>
      <div className="card-list">
        {tasks.map((task) => (
          <article
            className={`data-card task ${task.status}`}
            key={task.id}
          >
            <div>
              <span className="pill">
                {task.status === "open" ? "进行中" : "已完成"}
              </span>
              {task.assistantId === assistant.id ? (
                <span className="pill muted">{assistant.name}</span>
              ) : null}
            </div>
            <h3>{task.title}</h3>
            {task.description ? <p>{task.description}</p> : null}
            <small>
              {task.dueAt
                ? `截止 ${new Date(task.dueAt).toLocaleString("zh-CN")}`
                : "无截止时间"}
            </small>
            {task.status === "open" ? (
              <button
                type="button"
                onClick={() => {
                  void completeTask(token, task.id).then(onChanged);
                }}
              >
                标记完成
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AppearancePanel({
  assistant,
  token,
  onChanged,
  onSaved,
}: {
  assistant: AssistantView;
  token: string;
  onChanged: () => Promise<void>;
  onSaved: (assistant: AssistantView) => void;
}): React.JSX.Element {
  const [appearance, setAppearance] = useState(assistant.appearance);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAppearance(assistant.appearance);
  }, [assistant]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const updated = await updateAppearance(
        token,
        assistant.id,
        appearance,
      );
      onSaved(updated);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="content-panel appearance-panel">
      <div className="panel-heading">
        <div>
          <h2>外观与身体</h2>
          <p>换装、换形象不会改变伙伴身份、记忆和关系。</p>
        </div>
      </div>
      <div className="appearance-preview">
        <div
          className={`companion-orb ${appearance.form} large`}
          style={{
            background: `radial-gradient(circle at 32% 24%, ${appearance.secondaryColor}, ${appearance.primaryColor})`,
          }}
        >
          {appearance.avatarUrl ? (
            <img src={appearance.avatarUrl} alt="" />
          ) : (
            assistant.name.slice(0, 1)
          )}
        </div>
        <div>
          <h3>{assistant.name}</h3>
          <p>
            {appearance.outfit} · {appearance.scene}
          </p>
          <small>外观版本 {assistant.revision}</small>
        </div>
      </div>
      <div className="appearance-form">
        <label>
          形态
          <select
            value={appearance.form}
            onChange={(event) =>
              setAppearance({
                ...appearance,
                form: event.target.value as AssistantView["appearance"]["form"],
              })
            }
          >
            <option value="orb">光球形态</option>
            <option value="anime">动漫形象</option>
            <option value="portrait">肖像形态</option>
          </select>
        </label>
        <label>
          服装
          <input
            value={appearance.outfit}
            onChange={(event) =>
              setAppearance({ ...appearance, outfit: event.target.value })
            }
          />
        </label>
        <label>
          场景
          <input
            value={appearance.scene}
            onChange={(event) =>
              setAppearance({ ...appearance, scene: event.target.value })
            }
          />
        </label>
        <label>
          图片 URL
          <input
            value={appearance.avatarUrl ?? ""}
            placeholder="https://…"
            onChange={(event) =>
              setAppearance({
                ...appearance,
                avatarUrl: event.target.value || null,
              })
            }
          />
        </label>
        <label>
          主色
          <input
            type="color"
            value={appearance.primaryColor}
            onChange={(event) =>
              setAppearance({
                ...appearance,
                primaryColor: event.target.value,
              })
            }
          />
        </label>
        <label>
          辅色
          <input
            type="color"
            value={appearance.secondaryColor}
            onChange={(event) =>
              setAppearance({
                ...appearance,
                secondaryColor: event.target.value,
              })
            }
          />
        </label>
      </div>
      <button
        className="primary-action"
        type="button"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "保存中…" : "保存外观"}
      </button>
    </section>
  );
}

function CreateAssistant({
  token,
  onCreated,
}: {
  token: string;
  onCreated: (assistant: AssistantView) => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("生活与工作伙伴");

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      return;
    }
    const created = await createAssistant(token, {
      name: name.trim(),
      summary: role.trim(),
      persona: {
        role: role.trim(),
        tone: "自然、可靠、有温度",
        values: "尊重用户自主性",
        boundaries: "不冒充真人，高风险操作先确认",
      },
      appearance: {
        avatarUrl: null,
        form: "orb",
        outfit: "日常",
        primaryColor: "#5F8FFF",
        secondaryColor: "#B9D7FF",
        scene: "透明桌面",
      },
    });
    setName("");
    setOpen(false);
    await onCreated(created);
  };

  if (!open) {
    return (
      <button
        className="new-assistant"
        type="button"
        onClick={() => setOpen(true)}
      >
        + 新建数字伙伴
      </button>
    );
  }

  return (
    <div className="new-assistant-form">
      <input
        autoFocus
        value={name}
        maxLength={40}
        placeholder="伙伴名字"
        onChange={(event) => setName(event.target.value)}
      />
      <input
        value={role}
        maxLength={120}
        placeholder="关系或职责"
        onChange={(event) => setRole(event.target.value)}
      />
      <div>
        <button type="button" onClick={() => void submit()}>
          创建
        </button>
        <button type="button" className="muted" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}

function CenteredMessage({ title }: { title: string }): React.JSX.Element {
  return (
    <main className="loading-page">
      <div className="brand-orb large">P</div>
      <h1>{title}</h1>
    </main>
  );
}

function deviceName(): string {
  const platform = platformName();
  return `${platform === "windows" ? "Windows" : platform} · ${navigator.platform || "设备"}`;
}

function platformName(): string {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(value)) return "ios";
  if (value.includes("windows")) return "windows";
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return "web";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function friendlyError(code: string): string {
  return (
    {
      INVALID_CREDENTIALS: "邮箱或密码不正确",
      INVALID_BOOTSTRAP_TOKEN: "初始化令牌不正确",
      ALREADY_BOOTSTRAPPED: "这个服务器已经完成初始化",
      UNAUTHORIZED: "登录已失效，请重新连接",
      DEVICE_REVOKED: "当前设备已被撤销授权",
      ASSISTANT_NOT_FOUND: "数字伙伴不存在",
    }[code] ?? `请求失败：${code}`
  );
}
