import { describe, expect, it } from "vitest";
import {
  assertPublicHttpsUrl,
  SiliconFlowCharacterImageEditProvider,
} from "../src/core/character-image-edit-provider";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl8sAAAAASUVORK5CYII=",
  "base64",
);

describe("硅基流动角色图像编辑", () => {
  it("携带单张参考图和保真提示词，并立即下载结果", async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        input,
        ...(init === undefined ? {} : { init }),
      });
      if (String(input).includes("/images/generations")) {
        return Response.json({
          images: [{ url: "https://images.example.com/result.png" }],
          seed: 42,
        });
      }
      return new Response(ONE_PIXEL_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    };
    const provider = new SiliconFlowCharacterImageEditProvider(
      async () => "sk-test-only-not-a-real-key",
      fetchImpl,
      async () => [{ address: "8.8.8.8", family: 4 }],
    );

    const result = await provider.edit({
      imageBytes: ONE_PIXEL_PNG,
      mimeType: "image/png",
      instruction: "坐在凳子上",
      compositionMode: "character",
    });

    expect(Buffer.from(result.imageBytes)).toEqual(ONE_PIXEL_PNG);
    expect(result.model).toBe("Qwen/Qwen-Image-Edit-2509");
    expect(result.seed).toBe(42);
    expect(requests).toHaveLength(2);
    const generationBody = JSON.parse(
      String(requests[0]?.init?.body),
    ) as Record<string, unknown>;
    expect(generationBody.model).toBe("Qwen/Qwen-Image-Edit-2509");
    expect(generationBody.image).toMatch(/^data:image\/png;base64,/);
    expect(generationBody.prompt).toContain("坐在凳子上");
    expect(generationBody.prompt).toContain("Preserve the exact character identity");
    expect(String(requests[0]?.init?.body)).not.toContain(
      "sk-test-only-not-a-real-key",
    );
    expect(generationBody).not.toHaveProperty("image_size");
  });

  it("拒绝内网结果地址并映射限流错误", async () => {
    await expect(
      assertPublicHttpsUrl("https://127.0.0.1/result.png"),
    ).rejects.toMatchObject({ code: "CHARACTER_POSE_RESULT_UNSAFE" });

    const provider = new SiliconFlowCharacterImageEditProvider(
      async () => "sk-test-only-not-a-real-key",
      async () => new Response("rate limited", { status: 429 }),
      async () => [{ address: "8.8.8.8", family: 4 }],
    );
    await expect(
      provider.edit({
        imageBytes: ONE_PIXEL_PNG,
        mimeType: "image/png",
        instruction: "挥手",
        compositionMode: "character",
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_POSE_RATE_LIMITED" });
  });

  it("完整场景模式会要求保留角色并组合道具与背景", async () => {
    let requestBody = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).includes("/images/generations")) {
        requestBody = String(init?.body);
        return Response.json({
          images: [{ url: "https://images.example.com/scene.png" }],
        });
      }
      return new Response(ONE_PIXEL_PNG, { status: 200 });
    };
    const provider = new SiliconFlowCharacterImageEditProvider(
      async () => "sk-test-only-not-a-real-key",
      fetchImpl,
      async () => [{ address: "8.8.8.8", family: 4 }],
    );

    await provider.edit({
      imageBytes: ONE_PIXEL_PNG,
      mimeType: "image/png",
      instruction: "坐在凳子上，旁边有绿植，背景是咖啡馆",
      compositionMode: "scene",
    });

    expect(requestBody).toContain("Scene description");
    expect(requestBody).toContain("requested props and background");
    expect(requestBody).toContain("旁边有绿植");
  });
});
