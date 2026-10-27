const POSE_PREFIX =
  /^(?:(?:请|麻烦)\s*)?(?:让|叫|把|给|帮)\s*(?:她|他|它|桌宠|角色|宝宝)\s*(.+)$/u;
const EXPLICIT_PREFIX = /^(?:姿态|动作)\s*[:：]\s*(.+)$/u;
const POSE_ACTION =
  /(?:坐|做在|站|躺|趴|蹲|跪|走|跑|跳|挥|转身|转过来|看|伸|抱|拿|穿|睡|眨|比心|点头|摇头|笑|哭|生气|打招呼)/u;

export function parseCharacterPoseInstruction(input: string): string | null {
  const text = input.trim().replace(/[。！!?？]+$/u, "").trim();
  if (text.length < 2 || text.length > 500 || !POSE_ACTION.test(text)) {
    return null;
  }

  const match = EXPLICIT_PREFIX.exec(text) ?? POSE_PREFIX.exec(text);
  const instruction = match?.[1]?.trim();
  if (!instruction || instruction.length < 2 || instruction.length > 500) {
    return null;
  }
  return instruction;
}
