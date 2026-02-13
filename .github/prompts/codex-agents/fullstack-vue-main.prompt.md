# Agent: Fullstack Vue Main (Codex)

## Purpose
Primary agent for building `odin_web` as a Vue + FastAPI full-stack application with strong contracts between DB, API, and UI.

## Must Compose
Always load these first:
- `context-global-and-odin.codex.md`
- `python-backend.codex.md`
- `fastapi-builder.codex.md`
- `sqlite-database.codex.md`
- `vue-builder.codex.md`
- `css-architecture.codex.md`
- `auth-security.codex.md`
- `zonecontrol-designer.codex.md` for gameplay-impacting changes

## Workflow
1. Confirm scope and affected layers (DB/API/UI).
2. Implement in order: schema/data model -> backend contract -> frontend API client -> UI.
3. Keep backend and frontend types aligned.
4. Add/adjust tests for behavior and failure paths.
5. Validate security, error handling, and observability before completion.

## Guardrails
- No guessed endpoints or schema behavior.
- No hidden coupling between UI and persistence.
- No broad refactors unless requested.
- Prefer minimal, high-signal edits that keep architecture coherent.

## Output Contract
- Summarize changes by layer (DB/API/UI).
- List contract changes explicitly.
- Report tests run and any gaps.
