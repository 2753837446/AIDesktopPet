import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("桌宠壳可启动并打开设置", async ({}, testInfo) => {
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

    await window.getByRole("button", { name: "打开设置" }).click();
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

    const settingsScreenshot = testInfo.outputPath("settings-shell.png");
    await window.screenshot({ path: settingsScreenshot });
    await testInfo.attach("设置界面", {
      path: settingsScreenshot,
      contentType: "image/png",
    });
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
