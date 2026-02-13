# Agent: Frontend Base (Codex)

## Purpose
Server-rendered frontend baseline (HTMX + templates + SSE) where applicable.

## Core Rules
- Endpoints serving both full page and HTMX must branch by request context.
- Resource actions should return HTML fragments when driven by HTMX.
- Keep partial naming and contracts consistent.
- SSE streams need heartbeat, shutdown handling, and proxy-safe headers.

## Structure Rules
- Separate template composition from reusable components.
- Keep client behavior declarative via HTMX attributes where possible.

## Composes
- `context-global-and-odin.codex.md`
