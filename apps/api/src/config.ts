import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  bootstrapToken: string;
  jwtSecret: string;
  modelProvider: "mock" | "openai-compatible";
  modelBaseUrl: string;
  modelName: string;
  modelApiKey: string;
  webDistDir: string | null;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const production = process.env.NODE_ENV === "production";
  const config: AppConfig = {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 8787),
    dataDir,
    databasePath:
      process.env.DATABASE_PATH ?? `${dataDir}/companion.sqlite`,
    bootstrapToken:
      process.env.BOOTSTRAP_TOKEN ??
      (production ? "" : "local-bootstrap-token-change-me"),
    jwtSecret:
      process.env.JWT_SECRET ??
      (production ? "" : "local-jwt-secret-change-me-32-characters"),
    modelProvider:
      process.env.MODEL_PROVIDER === "openai-compatible"
        ? "openai-compatible"
        : "mock",
    modelBaseUrl: process.env.MODEL_BASE_URL ?? "https://api.deepseek.com",
    modelName: process.env.MODEL_NAME ?? "deepseek-chat",
    modelApiKey: process.env.MODEL_API_KEY ?? "",
    webDistDir: process.env.WEB_DIST_DIR
      ? path.resolve(process.env.WEB_DIST_DIR)
      : null,
  };
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error("INVALID_PORT");
  }
  if (config.bootstrapToken.length < 16) {
    throw new Error("BOOTSTRAP_TOKEN_REQUIRED");
  }
  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET_TOO_SHORT");
  }
  return { ...config, ...overrides };
}
