const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

app.setName("AI Desktop Pet");

app.whenReady().then(async () => {
  try {
    const credentialPath = path.join(
      app.getPath("userData"),
      "credentials",
      "siliconflow.bin",
    );
    const encrypted = await fs.readFile(credentialPath);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const response = await fetch("https://api.siliconflow.cn/v1/models", {
      headers: { Authorization: `Bearer ${decrypted.result}` },
    });
    const payload = await response.json();
    const ids = Array.isArray(payload?.data)
      ? payload.data.map((model) => String(model.id || ""))
      : [];
    console.log(
      JSON.stringify({
        status: response.status,
        imageCandidates: ids.filter((id) =>
          /flux|kolors|stable|diffusion|image|sdxl|imagen/i.test(id),
        ),
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
