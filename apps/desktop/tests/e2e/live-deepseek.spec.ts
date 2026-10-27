import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { DesktopApi } from "../../src/shared/desktop-api";

test.skip(
  process.env.RUN_LIVE_DEEPSEEK !== "1",
  "仅在显式设置 RUN_LIVE_DEEPSEEK=1 时调用真实模型",
);

test("真实 DeepSeek Flash 流式对话与长期记忆", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const appDirectory = path.resolve(__dirname, "../..");
  const electronApp = await electron.launch({
    args: [appDirectory],
    cwd: appDirectory,
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(
      window.getByText("DeepSeek Flash 已连接", { exact: true }),
    ).toBeVisible();
    await window.getByRole("button", { name: "开始聊天" }).click();
    await expect(window.getByRole("heading", { name: "阿湛 在听" })).toBeVisible();

    await window
      .getByPlaceholder(/说点什么/)
      .fill("请只输出四个字：连接成功");
    await window.getByRole("button", { name: "发送" }).click();

    const assistantMessage = window.locator(".chat-message.assistant").last();
    await expect(assistantMessage).toContainText("连接成功", { timeout: 60_000 });
    await expect(window.getByRole("button", { name: "发送" })).toBeVisible();

    const assistantCount = await window.locator(".chat-message.assistant").count();
    await window
      .getByPlaceholder(/说点什么/)
      .fill("请记住：我喜欢简洁回答");
    await window.getByRole("button", { name: "发送" }).click();
    await expect
      .poll(() => window.locator(".chat-message.assistant").count())
      .toBe(assistantCount + 1);
    await expect(window.getByRole("button", { name: "发送" })).toBeVisible();

    await window
      .getByPlaceholder(/说点什么/)
      .fill("我喜欢什么？只回答偏好内容。");
    await window.getByRole("button", { name: "发送" }).click();
    await expect(
      window.locator(".chat-message.assistant").last(),
    ).toContainText("简洁", { timeout: 60_000 });

    await window
      .getByPlaceholder(/说点什么/)
      .fill("请记住：火星项目每周三复盘");
    await window.getByRole("button", { name: "发送" }).click();
    await expect(window.getByRole("button", { name: "发送" })).toBeVisible();
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & { desktop?: DesktopApi }
            ).desktop;
            const memories = await api?.listMemories("周中例会安排", 20);
            return memories?.some(
              (memory) => memory.content === "火星项目每周三复盘",
            );
          }),
        { timeout: 30_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(true);

    const brief = await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & { desktop?: DesktopApi }
      ).desktop;
      return api?.generateDailyBrief();
    });
    expect(brief?.sourceStatus.memories).toBe("available");
    expect(brief?.sourceStatus.email).toBe("not_connected");
    expect(brief?.content.length).toBeGreaterThan(10);

    const screenshot = testInfo.outputPath("live-deepseek-chat.png");
    await window.screenshot({ path: screenshot });
    await testInfo.attach("真实 DeepSeek 对话", {
      path: screenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: "返回桌宠" }).click();
    await window.getByRole("button", { name: "设置" }).click();
    await window.getByRole("button", { name: "今日总结" }).click();
    await expect(window.getByRole("heading", { name: "今日总结" })).toBeVisible();
    await expect(window.getByText("任务 · 已读取")).toBeVisible();
    await expect(window.getByText("邮件 · 未连接")).toBeVisible();

    const briefScreenshot = testInfo.outputPath("live-daily-brief.png");
    await window.screenshot({ path: briefScreenshot });
    await testInfo.attach("真实每日总结", {
      path: briefScreenshot,
      contentType: "image/png",
    });

  } finally {
    await electronApp.close();
  }
});
