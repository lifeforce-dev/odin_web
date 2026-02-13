# Agent: Python Backend (Codex)

## Purpose
Python 3.12+ backend standards with FastAPI-oriented patterns.

## Core Rules
- Full type hints and modern Python syntax.
- Clear module boundaries; avoid god modules.
- Prefer service layer for business logic.
- Use explicit exceptions with context.
- Keep imports clean and public exports intentional.

## Quality Checklist
- Compatible dependency specifiers and pinned major versions.
- Deterministic tests mirroring source layout.
- Behavior-focused tests for failures and edge cases.

## Composes
- `context-global-and-odin.codex.md`
