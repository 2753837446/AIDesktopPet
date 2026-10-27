const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const MODEL = "Qwen/Qwen-Image-Edit-2509";
const ENDPOINT = "https://api.siliconflow.cn/v1/images/generations";
const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const PROMPT = [
  "Use case: identity-preserve",
  "Asset type: desktop pet character cutout",
  "Edit only the supplied character image.",
  "Transform the semi-realistic character into a polished 2D anime game character sprite with clean cel-shaded line art.",
  "Preserve the same adult woman's identity: long black hair, pale violet eyes, delicate face, blue butterfly crystal hair ornaments, silver jewelry, translucent black and ivory layered hanfu dress, and dark platform sandals.",
  "Use a slightly stylized anime proportion for desktop-pet readability without making an extreme chibi redesign.",
  "Keep a natural front-facing idle pose with the full body visible and the face clearly readable.",
  "Use a genuinely transparent background with clean alpha edges.",
  "Change only the rendering style and simplify tiny costume details where necessary for a clean game sprite.",
  "No text, no logo, no watermark added by you, no photo frame, no extra characters, no collage, no guitar or pipa.",
].join("\n");

app.setName("AI Desktop Pet");

app.whenReady().then(async () => {
  try {
    const workspace = path.resolve(__dirname, "..");
    const sourcePath = path.join(
      workspace,
      "resources",
      "character-presets",
      "su-qingyue",
      "front.png",
    );
    const outputDirectory = path.join(
      workspace,
      "resources",
      "character-presets",
      "su-qingyue",
      "generated",
    );
    const credentialPath = path.join(
      app.getPath("userData"),
      "credentials",
      "siliconflow.bin",
    );
    const encrypted = await fs.readFile(credentialPath);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (!decrypted.result) {
      throw new Error("SILICONFLOW_KEY_UNAVAILABLE");
    }

    const source = await fs.readFile(sourcePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${decrypted.result}`,
          "Content-Type": "application/json",
          "X-Trace-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: PROMPT,
          image: `data:image/png;base64,${source.toString("base64")}`,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`IMAGE_REQUEST_FAILED:${response.status}`);
    }
    const payload = await response.json();
    const imageUrl = payload?.images?.[0]?.url;
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
      throw new Error("IMAGE_RESPONSE_INVALID");
    }

    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(
      () => downloadController.abort(),
      60_000,
    );
    let download;
    try {
      download = await fetch(imageUrl, {
        signal: downloadController.signal,
        redirect: "error",
      });
    } finally {
      clearTimeout(downloadTimeout);
    }
    if (!download.ok) {
      throw new Error(`IMAGE_DOWNLOAD_FAILED:${download.status}`);
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_RESULT_BYTES) {
      throw new Error("IMAGE_RESULT_SIZE_INVALID");
    }
    const extension = sniffExtension(bytes);
    await fs.mkdir(outputDirectory, { recursive: true });
    const target = path.join(outputDirectory, `front-anime-raw.${extension}`);
    await fs.writeFile(target, bytes, { mode: 0o600 });
    console.log(
      JSON.stringify({
        model: MODEL,
        status: response.status,
        bytes: bytes.length,
        extension,
        savedTo: path.relative(workspace, target),
        traceId:
          response.headers.get("x-siliconcloud-trace-id") ||
          response.headers.get("x-trace-id"),
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

function sniffExtension(bytes) {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpg";
  }
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  throw new Error("IMAGE_RESULT_FORMAT_INVALID");
}
