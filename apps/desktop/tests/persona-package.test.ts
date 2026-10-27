import { describe, expect, it } from "vitest";
import {
  parsePersonaPackage,
  serializePersonaPackage,
} from "../src/shared/persona-package";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

describe("人格配置包", () => {
  it("序列化后可恢复人格且导入后转为 custom", () => {
    const serialized = serializePersonaPackage(DEFAULT_SETTINGS.persona);
    const parsed = parsePersonaPackage(serialized);

    expect(parsed).toMatchObject({
      ...DEFAULT_SETTINGS.persona,
      preset: "custom",
    });
  });

  it("拒绝未知字段和超大配置包", () => {
    const payload = JSON.parse(
      serializePersonaPackage(DEFAULT_SETTINGS.persona),
    ) as { persona: Record<string, unknown> };
    payload.persona.unknown = true;

    expect(() => parsePersonaPackage(JSON.stringify(payload))).toThrow(
      "INVALID_PERSONA_FIELDS",
    );
    expect(() =>
      parsePersonaPackage(
        JSON.stringify({
          schema: "ai-desktop-pet/persona",
          packageVersion: 1,
          persona: {
            ...DEFAULT_SETTINGS.persona,
            boundaries: "x".repeat(120_000),
          },
        }),
      ),
    ).toThrow();
  });
});
