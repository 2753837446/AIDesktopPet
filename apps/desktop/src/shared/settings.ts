export const SETTINGS_VERSION = 1 as const;

export interface WindowSettings {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  showInTaskbar: boolean;
}

export interface QuietHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ProactiveSettings {
  enabled: boolean;
  quietHours: QuietHoursSettings;
  categories: {
    task: boolean;
    email: boolean;
    calendar: boolean;
    dailyBrief: boolean;
    system: boolean;
  };
  dailyLimit: number;
}

export interface StartupSettings {
  launchAtLogin: boolean;
}

export interface DailyBriefSettings {
  enabled: boolean;
  time: string;
}

export type PersonaPreset = "azure" | "calm" | "lively" | "custom";
export type ReplyLength = "concise" | "balanced" | "detailed";
export type ProactiveStyle = "quiet" | "standard" | "active";

export interface PersonaSettings {
  version: 1;
  preset: PersonaPreset;
  name: string;
  selfReference: string;
  userTitle: string;
  description: string;
  tone: string;
  replyLength: ReplyLength;
  boundaries: string;
  proactiveStyle: ProactiveStyle;
}

export interface AppearanceSettings {
  character: "azure";
  customCharacterId: string | null;
  customBackgroundId: string | null;
  customPropIds: string[];
  scale: number;
}

export interface DesktopSettings {
  version: typeof SETTINGS_VERSION;
  window: WindowSettings;
  proactive: ProactiveSettings;
  startup: StartupSettings;
  dailyBrief: DailyBriefSettings;
  persona: PersonaSettings;
  appearance: AppearanceSettings;
}

export interface DesktopSettingsPatch {
  window?: Partial<WindowSettings>;
  proactive?: {
    enabled?: boolean;
    quietHours?: Partial<QuietHoursSettings>;
    categories?: Partial<ProactiveSettings["categories"]>;
    dailyLimit?: number;
  };
  startup?: Partial<StartupSettings>;
  dailyBrief?: Partial<DailyBriefSettings>;
  persona?: Partial<PersonaSettings>;
  appearance?: Partial<AppearanceSettings>;
}

export type DesktopWindowMode =
  | "pet"
  | "settings"
  | "chat"
  | "memory"
  | "tasks"
  | "daily"
  | "tools";

export const DEFAULT_SETTINGS: DesktopSettings = {
  version: SETTINGS_VERSION,
  window: {
    width: 360,
    height: 440,
    alwaysOnTop: true,
    showInTaskbar: false,
  },
  proactive: {
    enabled: true,
    quietHours: {
      enabled: true,
      start: "23:00",
      end: "07:00",
    },
    categories: {
      task: true,
      email: true,
      calendar: true,
      dailyBrief: true,
      system: true,
    },
    dailyLimit: 20,
  },
  startup: {
    launchAtLogin: false,
  },
  dailyBrief: {
    enabled: true,
    time: "09:00",
  },
  persona: {
    version: 1,
    preset: "azure",
    name: "阿湛",
    selfReference: "我",
    userTitle: "你",
    description: "好奇、体贴、带一点俏皮的蓝色桌面伙伴。",
    tone: "自然、温和、不过分正式。",
    replyLength: "balanced",
    boundaries: "不冒充已经执行外部动作；涉及隐私、资金或不可逆操作时先说明风险并确认。",
    proactiveStyle: "standard",
  },
  appearance: {
    character: "azure",
    customCharacterId: null,
    customBackgroundId: null,
    customPropIds: [],
    scale: 1,
  },
};

export const PERSONA_PRESETS: Record<
  Exclude<PersonaPreset, "custom">,
  PersonaSettings
> = {
  azure: DEFAULT_SETTINGS.persona,
  calm: {
    version: 1,
    preset: "calm",
    name: "澄",
    selfReference: "我",
    userTitle: "你",
    description: "冷静、可靠、重视清晰边界的桌面助手。",
    tone: "克制、准确、简洁。",
    replyLength: "concise",
    boundaries: "先给结论，再说明必要依据；不确定时明确指出。",
    proactiveStyle: "quiet",
  },
  lively: {
    version: 1,
    preset: "lively",
    name: "泡泡",
    selfReference: "我",
    userTitle: "你",
    description: "热情、积极、愿意陪用户推进事情的小伙伴。",
    tone: "轻快、有感染力、不过度喧闹。",
    replyLength: "balanced",
    boundaries: "保持积极但不夸大结果；不能自动执行外部动作。",
    proactiveStyle: "active",
  },
};
