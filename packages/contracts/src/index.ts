import { z } from "zod";

export const memoryScopeSchema = z.enum([
  "personal",
  "assistant",
  "project",
]);

export const memoryTypeSchema = z.enum([
  "profile",
  "preference",
  "fact",
  "project_decision",
  "event",
  "commitment",
]);

export const appearanceSchema = z
  .object({
    avatarUrl: z.string().url().max(2_000).nullable().default(null),
    form: z.enum(["orb", "anime", "portrait"]).default("orb"),
    outfit: z.string().trim().max(80).default("日常"),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#5F8FFF"),
    secondaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#B9D7FF"),
    scene: z.string().trim().max(80).default("透明桌面"),
  })
  .strict();

export type Appearance = z.infer<typeof appearanceSchema>;

export const personaSchema = z
  .object({
    role: z.string().trim().min(1).max(120),
    tone: z.string().trim().min(1).max(300),
    values: z.string().trim().max(500).default(""),
    boundaries: z.string().trim().max(500).default(""),
  })
  .strict();

export type Persona = z.infer<typeof personaSchema>;

export const bootstrapSchema = z
  .object({
    bootstrapToken: z.string().min(16).max(500),
    email: z.string().email().max(254),
    password: z.string().min(10).max(200),
    displayName: z.string().trim().min(1).max(80),
    workspaceName: z.string().trim().min(1).max(80),
    assistantName: z.string().trim().min(1).max(40),
    deviceName: z.string().trim().min(1).max(80),
    platform: z.string().trim().min(1).max(80),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
    deviceName: z.string().trim().min(1).max(80),
    platform: z.string().trim().min(1).max(80),
    deviceId: z.string().uuid().optional(),
  })
  .strict();

export const createAssistantSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    summary: z.string().trim().max(300).default(""),
    persona: personaSchema,
    appearance: appearanceSchema,
  })
  .strict();

export const updateAppearanceSchema = appearanceSchema;

export const chatRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    conversationId: z.string().uuid().optional(),
  })
  .strict();

export const memoryInputSchema = z
  .object({
    assistantId: z.string().uuid().nullable(),
    scope: memoryScopeSchema,
    type: memoryTypeSchema,
    content: z.string().trim().min(1).max(4_000),
    source: z.string().trim().min(1).max(500),
    importance: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export const taskInputSchema = z
  .object({
    assistantId: z.string().uuid().nullable(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).default(""),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export interface UserView {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceView {
  id: string;
  name: string;
}

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
}

export interface AssistantView {
  id: string;
  name: string;
  summary: string;
  persona: Persona;
  appearance: Appearance;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationView {
  id: string;
  assistantId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface MemoryView {
  id: string;
  assistantId: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: string;
  importance: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskView {
  id: string;
  assistantId: string | null;
  title: string;
  description: string;
  status: "open" | "completed";
  dueAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserView;
  workspace: WorkspaceView;
  device: DeviceView;
}

export interface TimelineItem {
  id: string;
  assistantId: string;
  title: string;
  updatedAt: string;
}
