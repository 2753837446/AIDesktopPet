const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

app.setName("AI Desktop Pet");

app.whenReady().then(async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey || !/^sk-[A-Za-z0-9]{20,}$/.test(apiKey)) {
    console.error("DEEPSEEK_API_KEY 缺失或格式不正确");
    app.exit(1);
    return;
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    console.error("当前系统不支持安全存储");
    app.exit(1);
    return;
  }

  const credentialDirectory = path.join(app.getPath("userData"), "credentials");
  const credentialPath = path.join(credentialDirectory, "deepseek.bin");
  await fs.mkdir(credentialDirectory, { recursive: true });
  const encrypted = await safeStorage.encryptStringAsync(apiKey);
  const temporaryPath = `${credentialPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, encrypted, { mode: 0o600 });
  await fs.rename(temporaryPath, credentialPath);

  console.log(
    JSON.stringify({
      stored: true,
      encrypted: true,
      userData: app.getPath("userData"),
    }),
  );
  app.quit();
});
