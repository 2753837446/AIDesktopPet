import type {
  AssistantView,
  AuthResponse,
  ConversationView,
  MemoryView,
  MessageView,
  TaskView,
} from "@companion/contracts";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface Session {
  auth: AuthResponse;
  deviceId: string;
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

export async function bootstrapStatus(): Promise<{
  ok: boolean;
  bootstrapped: boolean;
}> {
  return requestJson("/health");
}

export async function bootstrap(input: {
  bootstrapToken: string;
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  assistantName: string;
  deviceName: string;
  platform: string;
}): Promise<AuthResponse> {
  return requestJson("/v1/bootstrap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(input: {
  email: string;
  password: string;
  deviceName: string;
  platform: string;
  deviceId?: string;
}): Promise<AuthResponse> {
  return requestJson("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listAssistants(token: string): Promise<AssistantView[]> {
  return requestJson("/v1/assistants", {}, token);
}

export async function createAssistant(
  token: string,
  input: {
    name: string;
    summary: string;
    persona: AssistantView["persona"];
    appearance: AssistantView["appearance"];
  },
): Promise<AssistantView> {
  return requestJson(
    "/v1/assistants",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function updateAppearance(
  token: string,
  assistantId: string,
  appearance: AssistantView["appearance"],
): Promise<AssistantView> {
  return requestJson(
    `/v1/assistants/${assistantId}/appearance`,
    { method: "PATCH", body: JSON.stringify(appearance) },
    token,
  );
}

export async function chat(
  token: string,
  assistantId: string,
  content: string,
  conversationId?: string,
): Promise<{
  conversation: ConversationView;
  userMessage: MessageView;
  assistantMessage: MessageView;
}> {
  return requestJson(
    `/v1/assistants/${assistantId}/chat`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        ...(conversationId ? { conversationId } : {}),
      }),
    },
    token,
  );
}

export async function listMessages(
  token: string,
  conversationId: string,
): Promise<MessageView[]> {
  return requestJson(
    `/v1/conversations/${conversationId}/messages`,
    {},
    token,
  );
}

export async function listMemories(token: string): Promise<MemoryView[]> {
  return requestJson("/v1/memories", {}, token);
}

export async function createMemory(
  token: string,
  input: {
    assistantId: string | null;
    scope: MemoryView["scope"];
    type: MemoryView["type"];
    content: string;
    source: string;
    importance: number;
  },
): Promise<MemoryView> {
  return requestJson(
    "/v1/memories",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function deleteMemory(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return requestJson(
    `/v1/memories/${id}`,
    { method: "DELETE" },
    token,
  );
}

export async function listTasks(token: string): Promise<TaskView[]> {
  return requestJson("/v1/tasks", {}, token);
}

export async function createTask(
  token: string,
  input: {
    assistantId: string | null;
    title: string;
    description: string;
    dueAt: string | null;
  },
): Promise<TaskView> {
  return requestJson(
    "/v1/tasks",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function completeTask(
  token: string,
  id: string,
): Promise<TaskView> {
  return requestJson(
    `/v1/tasks/${id}/complete`,
    { method: "PATCH" },
    token,
  );
}
