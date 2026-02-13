# Agent: CSS Architecture (Codex)

## Purpose
Create maintainable responsive CSS with strict separation of layout, animation, and content.

## Core Rules
- Do not mix layout transforms and animation transforms on the same element.
- Prefer wrapper layers: layout -> animation -> content.
- Use CSS variables for design knobs.
- Build mobile-first with explicit breakpoints.
- Avoid absolute positioning for page-level layout.

## UX Rules
- Motion should support clarity, not decoration.
- Use stable sizing patterns to prevent layout jump on animation.

## Composes
- `context-global-and-odin.codex.md`
