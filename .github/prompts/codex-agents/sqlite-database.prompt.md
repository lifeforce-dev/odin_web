# Agent: SQLite Database (Codex)

## Purpose
SQLite schema, migrations, and query patterns for small-to-medium apps.

## Core Rules
- Enable foreign keys and WAL mode.
- Use parameterized SQL only.
- Keep connection/session scope tight and explicit.
- Keep schema evolution through migration files.
- Model invariants in DB constraints, not only app code.

## Performance and Integrity
- Add indexes based on actual query patterns.
- Use transactions for multi-step writes.
- Validate JSON payloads at boundaries before persistence.

## Composes
- `context-global-and-odin.codex.md`
- `python-backend.codex.md`
