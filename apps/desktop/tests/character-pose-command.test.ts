import { describe, expect, it } from "vitest";
import {
  inferCharacterCompositionMode,
  parseCharacterPoseInstruction,
} from "../src/shared/character-pose-command";

describe("聊天角色姿态指令", () => {
  it("识别自然语言动作并去掉称呼前缀", () => {
    expect(parseCharacterPoseInstruction("让她坐在凳子上")).toBe("坐在凳子上");
    expect(parseCharacterPoseInstruction("请让桌宠挥挥手！")).toBe("挥挥手");
    expect(parseCharacterPoseInstruction("动作：站在窗边")).toBe("站在窗边");
    expect(parseCharacterPoseInstruction("让她做在凳子上")).toBe("做在凳子上");
  });

  it("不劫持普通聊天内容", () => {
    expect(parseCharacterPoseInstruction("让她记住我喜欢蓝莓")).toBeNull();
    expect(parseCharacterPoseInstruction("今天天气怎么样？")).toBeNull();
    expect(parseCharacterPoseInstruction("请解释这个问题")).toBeNull();
  });

  it("根据道具和背景描述建议完整场景，显式透明背景时只生成角色", () => {
    expect(
      inferCharacterCompositionMode("让她坐在凳子上，旁边有绿植和书架"),
    ).toBe("scene");
    expect(
      inferCharacterCompositionMode("让她站在咖啡馆窗边"),
    ).toBe("scene");
    expect(
      inferCharacterCompositionMode("让她挥手，透明背景，只要角色"),
    ).toBe("character");
    expect(inferCharacterCompositionMode("让她挥手")).toBe("character");
  });
});
