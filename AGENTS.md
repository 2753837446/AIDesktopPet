# Personal Digital Companion — Contributor Agent Rules

## Product direction

Build a personal digital-companion platform, not a single desktop-pet skin.

- One user owns one private Workspace.
- A Workspace can contain multiple persistent assistants.
- Assistant identity is separate from appearance, clothing and model provider.
- Shared memories, assistant-private memories and device-private context are distinct.
- Desktop, mobile and web clients share cloud state.
- Emotional companionship must respect autonomy and must not manipulate dependency.

## Required reading

Before non-trivial work, read:

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/FEASIBILITY_JARVIS_ARCHETYPE_2026-10-28.md`
- relevant files under `openspec/changes/`

## Architecture boundaries

- `assistant_id` is stable; `appearance` is replaceable.
- Conversations, memories and tasks belong to a Workspace and are scoped to an Assistant where applicable.
- Device-private state must not be uploaded by default.
- Models and Agent runtimes are replaceable providers.
- AstrBot, LangGraph, Dify, n8n, DSH and similar projects may be used as adapters or references; do not couple the domain model to them.
- Smart home is a future mandatory capability through Connector/Capability/Scene abstractions.
- High-risk device or external actions require deterministic policy, confirmation and audit.

## Workflow

- Read-only analysis can be handled directly.
- Small changes: implement, test and verify.
- Multi-file/product/architecture changes: create or update an OpenSpec proposal, design and tasks before implementation.
- Features are not complete without tests or concrete runtime evidence.

## Code rules

- Strict TypeScript; avoid `any`.
- Runtime-validate external input and model output.
- All network operations need timeout, cancellation and stable errors.
- Do not hard-code API keys, passwords, tokens or private data.
- Database changes require versioned migrations and tests.
- Preserve user changes and avoid unrelated refactors.

## Verification

Before claiming completion:

```powershell
pnpm check
pnpm test
pnpm build
```

Also validate Docker/Compose or record why the local daemon prevented it.

Use Chinese in user-facing responses and Chinese code comments.
