# Codex Agent Ports

This folder ports the prompts in `/Users/jrsanders/source/personal/codex/odin/prompts/agents` and `/Users/jrsanders/source/personal/codex/odin/prompts/copilot-instructions/copilot-instructions.md` into a Codex-native format.

## Primary Entry Point
- `fullstack-vue-main.codex.md` is the main agent profile for active work on `odin_web`.

## Required Shared Context
- `context-global-and-odin.codex.md` merges:
  - universal engineering instructions from `prompts/copilot-instructions/copilot-instructions.md`
  - project context from `odin/.github/copilot-instructions.md`

## Port Map
- `agent-auth-sec.agent.md` -> `auth-security.codex.md`
- `agent-code-review.agent.md` -> `code-review-general.codex.md`
- `agent-code-review-cpp.agent.md` -> `code-review-cpp.codex.md`
- `agent-code-review-fullstack-vue.agent.md` -> `code-review-fullstack-vue.codex.md`
- `agent-cpp-modern.agent.md` -> `cpp-modern.codex.md`
- `agent-cpp-ue5.agent.md` -> `cpp-ue5.codex.md`
- `agent-css.agent.md` -> `css-architecture.codex.md`
- `agent-fastapi.agent.md` -> `fastapi-builder.codex.md`
- `agent-frontend-base.agent.md` -> `frontend-base.codex.md`
- `agent-fullstack-vue.agent.md` -> `fullstack-vue-main.codex.md`
- `agent-gameplay-ui-ux.agent.md` -> `gameplay-ui-ux.codex.md`
- `agent-python.agent.md` -> `python-backend.codex.md`
- `agent-sqlite.agent.md` -> `sqlite-database.codex.md`
- `agent-vue.agent.md` -> `vue-builder.codex.md`
- `agent-zone_control-designer.agent.md` -> `zonecontrol-designer.codex.md`
- `system-test-review.agent.md` -> `system-test-review.codex.md`
- `skills(copy_github_dir)/.github/skills/frontend-design/SKILL.md` -> `frontend-design.codex.md`
