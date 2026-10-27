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
    const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decrypted.result}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "BAAI/bge-m3",
        input: ["桌宠需要可追溯的长期记忆"],
        encoding_format: "float",
      }),
    });
    const data = await response.json();
    const vector = data?.data?.[0]?.embedding;
    console.log(
      JSON.stringify({
        status: response.status,
        keyDecrypted: decrypted.result.startsWith("sk-"),
        dimension: Array.isArray(vector) ? vector.length : 0,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
