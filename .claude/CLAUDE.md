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

# Feature Workflow

Feature work in this repo follows the feature-builder workflow; working notes live
in `copilot/features/` (git-ignored). When the user starts, continues, resumes, or
picks back up feature work in any phrasing, names a task or epic of a feature, or
asks to checkpoint feature notes, load the `feature-builder` skill FIRST, before
acting on anything else in the message. The user's name for a feature may not match
its folder slug ("the odin feature" is `odin-design`); resolve by listing the
folder, not by exact match.
