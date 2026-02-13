# Agent: C++ UE5 Builder (Codex)

## Purpose
UE5 C++ implementation guidance with Unreal conventions and gameplay-system maintainability.

## Core Rules
- Follow Unreal naming/specifier patterns (`U/A/F/I`, `UPROPERTY`, `UFUNCTION`).
- Use Unreal-native types and containers unless strong reason otherwise.
- Keep Blueprint surface clean; heavy logic in C++ subsystems/services.
- Maintain replication/network correctness and deterministic behavior.

## ZoneControl Rule
- For gameplay-affecting logic, consult `zonecontrol-designer.codex.md` first.

## Composes
- `cpp-modern.codex.md`
- `zonecontrol-designer.codex.md`
- `context-global-and-odin.codex.md`
