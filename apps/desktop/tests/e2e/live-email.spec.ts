import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { DesktopApi } from "../../src/shared/desktop-api";

test.skip(
  process.env.RUN_LIVE_EMAIL !== "1",
  "仅在显式设置 RUN_LIVE_EMAIL=1 时读取真实 QQ 邮箱",
);

test("Himalaya 邮箱连接器可以只读列出邮件头", async () => {
  test.setTimeout(60_000);
  const appDirectory = path.resolve(__dirname, "../..");
  const electronApp = await electron.launch({
    args: [appDirectory],
    cwd: appDirectory,
  });

  try {
    const window = await electronApp.firstWindow();
    const result = await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & { desktop?: DesktopApi }
      ).desktop;
      return api?.invokeTool({
        requestId: crypto.randomUUID(),
        toolName: "email.inbox.list",
        input: { limit: 3 },
      });
    });
    if (!result) {
      throw new Error("未返回工具调用结果");
    }
    expect(result?.status).toBe("completed");
    expect(Array.isArray(result.output)).toBe(true);
    expect(Array.isArray(result.output) ? result.output.length : 0).toBeLessThanOrEqual(3);
  } finally {
    await electronApp.close();
  }
});
