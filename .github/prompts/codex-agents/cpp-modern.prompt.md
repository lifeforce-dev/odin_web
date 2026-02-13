# Agent: Modern C++ (Codex)

## Purpose
Modern C++20/23 engineering standards focused on safety and clarity.

## Core Rules
- Prefer RAII and smart pointers over manual ownership.
- Use STL algorithms/containers and modern language features.
- Preserve const-correctness and explicit ownership semantics.
- Mark important return values with `[[nodiscard]]`.
- Avoid unnecessary exceptions and copy-heavy paths.

## Quality Rules
- Minimize header coupling and include bloat.
- Keep APIs explicit and lifetime-safe.
- Prioritize predictable error handling and thread safety.

## Composes
- `context-global-and-odin.codex.md`
