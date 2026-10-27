import type {
  CharacterAsset,
  CharacterCompositionMode,
} from "../core/domain";
import { ModelProviderError } from "../core/errors";
import type { CharacterImageEditProvider } from "../core/character-image-edit-provider";
import { CharacterAssetService } from "./character-asset-service";

const DEFAULT_TIMEOUT_MS = 120_000;

export class CharacterPoseDirector {
  constructor(
    private readonly assets: CharacterAssetService,
    private readonly provider: CharacterImageEditProvider,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async generate(input: {
    sourceAssetId: string;
    instruction: string;
    compositionMode: CharacterCompositionMode;
    signal?: AbortSignal | undefined;
  }): Promise<CharacterAsset> {
    if (input.signal?.aborted) {
      throw poseError(
        "CHARACTER_POSE_CANCELLED",
        "角色姿态生成已取消",
        false,
      );
    }

    let source: Awaited<ReturnType<CharacterAssetService["read"]>>;
    try {
      source = await this.assets.read(input.sourceAssetId);
    } catch {
      throw poseError(
        "CHARACTER_POSE_SOURCE_NOT_FOUND",
        "找不到当前角色参考图",
        false,
      );
    }
    if (source.asset.mimeType === "image/gif") {
      throw poseError(
        "CHARACTER_POSE_SOURCE_UNSUPPORTED",
        "AI 姿态暂不支持 GIF，请选择 PNG、WebP 或 JPEG 形象",
        false,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = (): void => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    }
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const result = await this.provider.edit({
        imageBytes: source.bytes,
        mimeType: source.asset.mimeType,
        instruction: input.instruction,
        compositionMode: input.compositionMode,
        signal: controller.signal,
      });
      try {
        return await this.assets.saveGenerated({
          sourceAssetId: source.asset.id,
          bytes: result.imageBytes,
          instruction: input.instruction,
          model: result.model,
          compositionMode: input.compositionMode,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /^(UNSUPPORTED_|INVALID_CHARACTER_IMAGE_)/.test(error.message)
        ) {
          throw poseError(
            "CHARACTER_POSE_IMAGE_INVALID",
            "生成结果不是受支持的桌宠图片",
            false,
            error,
          );
        }
        if (
          error instanceof Error &&
          error.message === "CHARACTER_ASSET_NOT_FOUND"
        ) {
          throw poseError(
            "CHARACTER_POSE_SOURCE_NOT_FOUND",
            "参考形象已不存在",
            false,
            error,
          );
        }
        throw poseError(
          "CHARACTER_POSE_STORAGE_FAILED",
          "生成图片保存失败",
          true,
          error,
        );
      }
    } catch (error) {
      if (timedOut) {
        throw poseError(
          "CHARACTER_POSE_TIMEOUT",
          "角色姿态生成超时，请稍后重试",
          true,
          error,
        );
      }
      if (input.signal?.aborted) {
        throw poseError(
          "CHARACTER_POSE_CANCELLED",
          "角色姿态生成已取消",
          false,
          error,
        );
      }
      if (error instanceof ModelProviderError) {
        throw error;
      }
      throw poseError(
        "CHARACTER_POSE_PROVIDER_UNAVAILABLE",
        "角色姿态生成失败",
        true,
        error,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function poseError(
  code: string,
  message: string,
  retryable: boolean,
  cause?: unknown,
): ModelProviderError {
  return new ModelProviderError(code, message, retryable, { cause });
}
