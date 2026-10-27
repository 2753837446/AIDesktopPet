import { spawn } from "node:child_process";

export interface EmailEnvelope {
  id: string;
  subject: string;
  from: string[];
  to: string[];
  date: string;
  flags: string[];
  hasAttachment: boolean;
}

export interface EmailMessage {
  id: string;
  data: unknown;
}

export interface HimalayaCommandRunner {
  (
    args: string[],
    options?: { input?: string; signal?: AbortSignal },
  ): Promise<string>;
}

export class HimalayaEmailConnector {
  constructor(
    private readonly options: {
      account?: string;
      inbox?: string;
      binary?: string;
      runCommand?: HimalayaCommandRunner;
    } = {},
  ) {}

  async checkAccount(signal?: AbortSignal): Promise<boolean> {
    const output = await this.run(["account", "list", "--json"], undefined, signal);
    const parsed = JSON.parse(output) as {
      accounts?: Array<{ name?: string; backends?: string[] }>;
    };
    const account = this.options.account ?? "qq";
    return Boolean(
      parsed.accounts?.some(
        (candidate) =>
          candidate.name === account &&
          candidate.backends?.includes("imap") &&
          candidate.backends.includes("smtp"),
      ),
    );
  }

  async listRecent(limit: number, signal?: AbortSignal): Promise<EmailEnvelope[]> {
    const output = await this.run(
      [
        "envelope",
        "list",
        "-a",
        this.options.account ?? "qq",
        "-m",
        this.options.inbox ?? "Inbox",
        "-s",
        String(Math.max(1, Math.min(limit, 30))),
        "--json",
      ],
      undefined,
      signal,
    );
    const parsed = JSON.parse(output) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.envelopes)
        ? parsed.envelopes
        : [];
    return list.map(normalizeEnvelope);
  }

  async readMessage(id: string, signal?: AbortSignal): Promise<EmailMessage> {
    const output = await this.run(
      [
        "message",
        "read",
        "-a",
        this.options.account ?? "qq",
        "-m",
        this.options.inbox ?? "Inbox",
        "--json",
        id,
      ],
      undefined,
      signal,
    );
    return { id, data: JSON.parse(output) as unknown };
  }

  async sendMessage(
    input: { to: string; subject: string; body: string },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run(
      [
        "message",
        "compose",
        "-a",
        this.options.account ?? "qq",
        "--to",
        input.to,
        "--subject",
        input.subject,
        "--body",
        input.body,
        "--send",
        "--save",
        "Sent Messages",
      ],
      undefined,
      signal,
    );
  }

  async moveToDeleted(id: string, signal?: AbortSignal): Promise<void> {
    await this.run(
      [
        "message",
        "delete",
        "-a",
        this.options.account ?? "qq",
        "-m",
        this.options.inbox ?? "Inbox",
        id,
      ],
      undefined,
      signal,
    );
  }

  private run(
    args: string[],
    input?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.options.runCommand) {
      return this.options.runCommand(args, {
        ...(input === undefined ? {} : { input }),
        ...(signal === undefined ? {} : { signal }),
      });
    }
    return runHimalaya(
      this.options.binary ?? "himalaya",
      [...args, "--log-level", "off"],
      input,
      signal,
    );
  }
}

function runHimalaya(
  binary: string,
  args: string[],
  input: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    };
    const abort = (): void => {
      child.kill();
      finish(new Error("EMAIL_CONNECTOR_CANCELLED"));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("EMAIL_CONNECTOR_TIMEOUT"));
    }, 30_000);

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 4_000_000) {
        child.kill();
        finish(new Error("EMAIL_CONNECTOR_OUTPUT_TOO_LARGE"));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8").slice(0, 4_000);
    });
    child.on("error", () => finish(new Error("EMAIL_CONNECTOR_UNAVAILABLE")));
    child.on("close", (code) => {
      if (code === 0) {
        finish();
      } else {
        finish(
          new Error(
            stderr.includes("auth")
              ? "EMAIL_CONNECTOR_AUTH_FAILED"
              : "EMAIL_CONNECTOR_FAILED",
          ),
        );
      }
    });
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function normalizeEnvelope(value: unknown): EmailEnvelope {
  const record = isRecord(value) ? value : {};
  return {
    id: String(record.id ?? ""),
    subject: typeof record.subject === "string" ? record.subject : "(无主题)",
    from: addressList(record.from),
    to: addressList(record.to),
    date: typeof record.date === "string" ? record.date : "",
    flags: Array.isArray(record.flags)
      ? record.flags.filter((flag): flag is string => typeof flag === "string")
      : [],
    hasAttachment: Boolean(record["has-attachment"]),
  };
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return typeof value === "string" ? [value] : [];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    if (isRecord(item)) {
      return String(item.name || item.addr || item.email || "");
    }
    return "";
  }).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
