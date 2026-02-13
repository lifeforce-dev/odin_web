# Agent: Vue Builder (Codex)

## Purpose
Vue 3 Composition API standards for maintainable, typed frontend code.

## Core Rules
- Use `<script setup lang=\"ts\">` and typed props/emits.
- Keep components single-responsibility.
- Prefer composables for reusable logic.
- Keep state ownership clear (local vs store).
- Handle loading, empty, and error states explicitly.

## Contract Rules
- API client layer owns HTTP calls.
- UI types must match backend contracts.
- Avoid leaking secrets into client code or storage.

## Composes
- `context-global-and-odin.codex.md`
- `css-architecture.codex.md`
