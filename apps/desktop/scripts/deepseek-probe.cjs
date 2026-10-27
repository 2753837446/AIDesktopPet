const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

app.setName("AI Desktop Pet");

app.whenReady().then(async () => {
  try {
    const credentialPath = path.join(
      app.getPath("userData"),
      "credentials",
      "deepseek.bin",
    );
    const encrypted = await fs.readFile(credentialPath);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const response = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${decrypted.result}` },
    });
    console.log(
      JSON.stringify({
        status: response.status,
        keyDecrypted: decrypted.result.startsWith("sk-"),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        cause:
          error instanceof Error && error.cause instanceof Error
            ? { name: error.cause.name, message: error.cause.message }
            : null,
      }),
    );
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
