import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("打包目录中的 Windows 应用可以启动", async () => {
  const executablePath = path.resolve(
    __dirname,
    "../../dist/win-unpacked/AI Desktop Pet.exe",
  );

  try {
    await access(executablePath);
  } catch {
    test.skip(true, "尚未先生成 dist/win-unpacked");
  }

  const userDataDirectory = await mkdtemp(
    path.join(tmpdir(), "ai-desktop-pet-packaged-"),
  );
  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`],
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId("pet-window")).toBeVisible();
    await expect(window.getByAltText("自定义桌宠形象")).toBeVisible();
    await expect(window.getByText("基础桌宠可用")).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
