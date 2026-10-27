import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { DesktopApi } from "../../src/shared/desktop-api";

test("桌宠壳可启动并打开设置", async ({}, testInfo) => {
  test.setTimeout(45_000);
  const userDataDirectory = await mkdtemp(
    path.join(tmpdir(), "ai-desktop-pet-e2e-"),
  );
  const appDirectory = path.resolve(__dirname, "../..");
  const electronApp = await electron.launch({
    args: [appDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: appDirectory,
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId("pet-window")).toBeVisible();
    await expect(window.getByText("基础桌宠可用")).toBeVisible();
    await expect(window.getByText("AI 对话尚未配置")).toBeVisible();

    await expect
      .poll(async () =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(true);

    const initialWindowState = await electronApp.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (!target) {
        throw new Error("没有创建桌宠窗口");
      }
      return {
        alwaysOnTop: target.isAlwaysOnTop(),
        resizable: target.isResizable(),
        visible: target.isVisible(),
        width: target.getBounds().width,
      };
    });
    expect(initialWindowState).toEqual({
      alwaysOnTop: true,
      resizable: true,
      visible: true,
      width: 360,
    });

    const preloadBoundary = await window.evaluate(() => {
      const globalObject = globalThis as typeof globalThis & {
        desktop?: { getBootstrap?: () => unknown };
      };
      return {
        hasDesktopApi: typeof globalObject.desktop?.getBootstrap === "function",
        hasRequire: "require" in globalObject,
        hasProcess: "process" in globalObject,
      };
    });
    expect(preloadBoundary).toEqual({
      hasDesktopApi: true,
      hasRequire: false,
      hasProcess: false,
    });

    const petScreenshot = testInfo.outputPath("pet-shell.png");
    await window.screenshot({ path: petScreenshot });
    await testInfo.attach("桌宠界面", {
      path: petScreenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: /配置 AI|设置/ }).click();
    await expect(window.getByRole("heading", { name: "桌宠设置" })).toBeVisible();
    await expect(window.getByText("模型尚未配置")).toBeVisible();

    const expandedWidth = await electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getBounds().width ?? 0;
    });
    expect(expandedWidth).toBeGreaterThanOrEqual(700);

    const alwaysOnTop = window.getByRole("checkbox", { name: /窗口置顶/ });
    await alwaysOnTop.uncheck();
    await expect(alwaysOnTop).not.toBeChecked();
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop(),
      ),
    ).toBe(false);

    await window
      .getByPlaceholder("粘贴 DeepSeek API Key")
      .fill("sk-testabcdefghijklmnopqrstuvwxyz123456");
    await window.getByRole("button", { name: "保存并启用" }).click();
    await expect(window.getByText("DeepSeek Flash 已连接").first()).toBeVisible();
    await window
      .locator('input[accept*="image/png"]')
      .setInputFiles({
        name: "pet.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl8sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await expect(window.getByText(/已上传并切换到/)).toBeVisible();
    await expect(window.getByText("AI 姿态导演")).toBeVisible();
    await expect(
      window.getByRole("button", { name: "检查并准备生成" }),
    ).toBeDisabled();
    await window.getByLabel("角色名称").fill("测试桌宠");
    await window
      .locator('input[accept*="application/json"]')
      .setInputFiles({
      name: "persona.persona.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schema: "ai-desktop-pet/persona",
          packageVersion: 1,
          persona: {
            version: 1,
            preset: "calm",
            name: "导入角色",
            selfReference: "本助手",
            userTitle: "你",
            description: "冷静且可靠的导入角色。",
            tone: "简洁准确",
            replyLength: "concise",
            boundaries: "不得覆盖安全规则。",
            proactiveStyle: "quiet",
          },
        }),
      ),
      });
    await expect(window.getByLabel("角色名称")).toHaveValue("导入角色");

    const settingsScreenshot = testInfo.outputPath("settings-shell.png");
    await window.screenshot({ path: settingsScreenshot });
    await testInfo.attach("设置界面", {
      path: settingsScreenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: "返回桌宠" }).click();
    await expect(window.getByAltText("自定义桌宠形象")).toBeVisible();
    await window.getByRole("button", { name: "开始聊天" }).click();
    await expect(window.getByRole("heading", { name: "导入角色 在听" })).toBeVisible();
    await window
      .getByPlaceholder(/和导入角色说点什么/)
      .fill("让她坐在凳子上");
    await window.getByRole("button", { name: "发送" }).click();
    await expect(window.getByText("要把这条聊天指令变成新姿态吗？")).toBeVisible();
    await expect(
      window.getByRole("button", { name: "需先配置图像服务" }),
    ).toBeDisabled();

    const chatScreenshot = testInfo.outputPath("chat-shell.png");
    await window.screenshot({ path: chatScreenshot });
    await testInfo.attach("聊天界面", {
      path: chatScreenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: "返回桌宠" }).click();
    await window.getByRole("button", { name: "设置" }).click();
    await window.getByRole("button", { name: "记忆中心" }).click();
    await expect(window.getByRole("heading", { name: "记忆中心" })).toBeVisible();
    await expect(window.getByText("还没有长期记忆")).toBeVisible();

    const memoryScreenshot = testInfo.outputPath("memory-center.png");
    await window.screenshot({ path: memoryScreenshot });
    await testInfo.attach("记忆中心", {
      path: memoryScreenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: "返回桌宠" }).click();
    await window.getByRole("button", { name: "设置" }).click();
    await window.getByRole("button", { name: "任务中心" }).click();
    await expect(window.getByRole("heading", { name: "任务中心" })).toBeVisible();
    await window.getByPlaceholder("任务标题").fill("验证持久化任务");
    await window.locator('input[type="datetime-local"]').fill("2026-12-31T09:00");
    await window.getByRole("button", { name: "创建任务" }).click();
    await expect(window.getByText("验证持久化任务")).toBeVisible();

    await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & { desktop?: DesktopApi }
      ).desktop;
      await api?.createTask({
        title: "验证到期调度",
        dueAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "Asia/Shanghai",
        idempotencyKey: crypto.randomUUID(),
      });
    });
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & { desktop?: DesktopApi }
            ).desktop;
            const tasks = await api?.listTasks(100);
            return tasks?.find((task) => task.title === "验证到期调度")?.status;
          }),
        { timeout: 15_000 },
      )
      .toBe("completed");

    const taskScreenshot = testInfo.outputPath("task-center.png");
    await window.screenshot({ path: taskScreenshot });
    await testInfo.attach("任务中心", {
      path: taskScreenshot,
      contentType: "image/png",
    });

    await window.getByRole("button", { name: "返回桌宠" }).click();
    await window.getByRole("button", { name: "设置" }).click();
    await window.getByRole("button", { name: "工具与连接器" }).click();
    await expect(window.getByRole("heading", { name: "工具与连接器" })).toBeVisible();
    await expect(window.getByText("Himalaya · QQ IMAP/SMTP")).toBeVisible();
    await window.getByRole("button", { name: "运行" }).first().click();
    await expect(window.getByText("已完成").first()).toBeVisible();

    const toolsScreenshot = testInfo.outputPath("tool-center.png");
    await window.screenshot({ path: toolsScreenshot });
    await testInfo.attach("工具与连接器", {
      path: toolsScreenshot,
      contentType: "image/png",
    });
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
