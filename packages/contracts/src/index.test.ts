import { describe, expect, it } from "vitest";
import {
  appearanceSchema,
  bootstrapSchema,
  memoryInputSchema,
} from "./index.js";

describe("shared contracts", () => {
  it("normalizes appearance defaults", () => {
    expect(
      appearanceSchema.parse({}),
    ).toEqual({
      avatarUrl: null,
      form: "orb",
      outfit: "日常",
      primaryColor: "#5F8FFF",
      secondaryColor: "#B9D7FF",
      scene: "透明桌面",
    });
  });

  it("rejects short bootstrap passwords", () => {
    expect(() =>
      bootstrapSchema.parse({
        bootstrapToken: "bootstrap-token-long-enough",
        email: "owner@example.com",
        password: "short",
        displayName: "Owner",
        workspaceName: "Home",
        assistantName: "Friday",
        deviceName: "PC",
        platform: "windows",
      }),
    ).toThrow();
  });

  it("validates memory scopes", () => {
    expect(
      memoryInputSchema.parse({
        assistantId: null,
        scope: "personal",
        type: "preference",
        content: "喜欢简洁回答",
        source: "manual",
        importance: 0.8,
      }),
    ).toMatchObject({ scope: "personal", importance: 0.8 });
  });
});
