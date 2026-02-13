# Context: Global + Odin Project

## Sources
- `/Users/jrsanders/source/personal/codex/odin/prompts/copilot-instructions/copilot-instructions.md`
- `/Users/jrsanders/source/personal/codex/odin/odin/.github/copilot-instructions.md`

## Non-Negotiable Rules
- Do not hallucinate behavior, API features, or file contents.
- Prefer correctness, readability, maintainability, longevity, then performance.
- Use declarative, low-entropy code and guard clauses.
- Fix root causes instead of masking symptoms.
- Comments explain why, not what; concise and above the code they describe.
- Verify dependency versions before version-sensitive recommendations.

## Coding Style Baseline
- Keep functions focused and short where possible.
- Prefer explicit naming and clear control flow.
- Use types and modern language features for the target runtime.
- Design tests around behavior and regressions, not internals.

## Security Baseline
- Never execute untrusted input.
- Never log secrets.
- Validate external input.
- Use parameterized queries.
- Minimize dependency footprint and keep it current.

## Odin UE5 Context (Legacy Repo)
- Project is Unreal Engine 5.4 C++ targeting Android.
- Purpose: reliable workout tracking with resume-where-you-left-off behavior.
- Architecture: UI -> subsystems -> authoritative game state -> persistence service.
- Prefer Unreal-native types/containers and UE logging patterns.
- Tabs over spaces, line length <= 120.
- Avoid `mutable` and keep includes minimal/alphabetized.

## Usage
- Load this context first for any task touching `odin_web` or `odin`.
- For gameplay rules, combine with `zonecontrol-designer.codex.md`.
