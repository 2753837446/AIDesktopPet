import type { PersonaSettings } from "./settings";

const PACKAGE_SCHEMA = "ai-desktop-pet/persona";
const MAX_PACKAGE_BYTES = 100 * 1024;
const PERSONA_FIELDS = [
  "version",
  "preset",
  "name",
  "selfReference",
  "userTitle",
  "description",
  "tone",
  "replyLength",
  "boundaries",
  "proactiveStyle",
] as const;

export function serializePersonaPackage(persona: PersonaSettings): string {
  return JSON.stringify(
    {
      schema: PACKAGE_SCHEMA,
      packageVersion: 1,
      persona,
    },
    null,
    2,
  );
}

export function parsePersonaPackage(raw: string): PersonaSettings {
  if (new TextEncoder().encode(raw).byteLength > MAX_PACKAGE_BYTES) {
    throw new Error("PERSONA_PACKAGE_TOO_LARGE");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.schema !== PACKAGE_SCHEMA ||
    parsed.packageVersion !== 1 ||
    !isRecord(parsed.persona)
  ) {
    throw new Error("INVALID_PERSONA_PACKAGE");
  }
  const persona = parsed.persona;
  if (!hasOnlyFields(persona, PERSONA_FIELDS)) {
    throw new Error("INVALID_PERSONA_FIELDS");
  }
  if (
    persona.version !== 1 ||
    !["azure", "calm", "lively", "custom"].includes(String(persona.preset)) ||
    !validString(persona.name, 30) ||
    !validString(persona.selfReference, 20) ||
    !validString(persona.userTitle, 30) ||
    !validString(persona.description, 1_000) ||
    !validString(persona.tone, 500) ||
    !["concise", "balanced", "detailed"].includes(String(persona.replyLength)) ||
    typeof persona.boundaries !== "string" ||
    persona.boundaries.length > 1_000 ||
    !["quiet", "standard", "active"].includes(String(persona.proactiveStyle))
  ) {
    throw new Error("INVALID_PERSONA_CONTENT");
  }
  return {
    ...persona,
    preset: "custom",
  } as PersonaSettings;
}

function validString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function hasOnlyFields(
  object: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(object).every((key) => fields.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
