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
