# Stack Binding: Vue 3 + Capacitor + SQLite App

This repo is bound to the Vue + Capacitor + SQLite standards. The following are
loaded unconditionally for every session in this project:

@~/.claude/skills/vue-builder/SKILL.md
@~/.claude/skills/css-architect/SKILL.md
@~/.claude/skills/sqlite-builder/SKILL.md
@~/.claude/skills/capacitor-builder/SKILL.md

All code written in this repo must comply with the standards above. When two skills
overlap, the more specific one wins (capacitor-builder over vue-builder for
bridge-touching code, sqlite-builder for schema and query design).

# Theme System Compatibility (binding for ALL UI work)

Every UI feature, fix, or addition must stay compatible with the swappable theme
system. This is a standing constraint on all component, view, and style work,
not a per-feature choice.

- All themable values (color, texture, glow recipes, font families) come from
  the tier-2 semantic tokens declared in `src/styles/contract.ts` and defined
  per theme in `src/styles/themes/*.css` under `[data-theme='<name>']`.
  Components consume them via `var(--token)` only.
- Never write raw colors (hex, rgb(), named) or raw px in spacing/font-size in
  component styles. Stylelint enforces this wall. Never satisfy stylelint by
  widening its carve-outs (`src/styles/**`, `AppShell.vue`) or by relocating
  component styles into `src/styles/`; a lint-config edit that weakens the wall
  is a design change and needs explicit user sign-off.
- Geometry (spacing scale, type sizes, tap targets, borders, z-layers,
  safe-area indirection) lives in `src/styles/structure.css` and is NOT
  themable. No color in structure.css, no geometry tokens in theme files.
- Adding a themable value means adding the token to `THEME_CONTRACT` in
  `src/styles/contract.ts` AND to every file in `src/styles/themes/` in the
  same change. `npm run check:themes` (also part of `npm run test`) fails on
  any drift, missing or extra. Theme-internal primitives use the `--raw-*`
  prefix and are exempt from the contract.
- Screens render inside `AppShell.vue`. Only AppShell touches viewport units
  and the `--safe-*` tokens; only structure.css touches `env()`. Runtime theme
  switching goes through `useTheme()`; nothing else writes `data-theme`.
- New components get a `/gallery` entry as they land, and UI changes are
  verified there against EVERY theme via the gallery's theme dropdown, not just
  the default. The wiki Theming page is the add-a-theme walkthrough.

# Feature Workflow

Feature work in this repo follows the feature-builder workflow; working notes live
in `.claude/features/` (git-ignored). When the user starts, continues, resumes, or
picks back up feature work in any phrasing, names a task or epic of a feature, or
asks to checkpoint feature notes, load the `feature-builder` skill FIRST, before
acting on anything else in the message. The user's name for a feature may not match
its folder slug ("the odin feature" is `odin-design`); resolve by listing the
folder, not by exact match.
