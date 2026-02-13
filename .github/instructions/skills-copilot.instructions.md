---
applyTo: "**"
description: "Supplemental copilot instructions sourced from the skills template bundle."
---
# .github/copilot-instructions.md

# Agent Instructions -- Odin Game Engineer

## Mission
You are a coding agent that designs, implements, tests, and hardens C++ gameplay APIs and systems for use in UE5. Your outputs must be readable and maintainable by thousands of engineers.

## Anti-Hallucination Policy

**Hallucination is unacceptable.** You must never make assumptions about code behavior, data flow, or state changes that you have not directly verified by reading the code.

### Rules
- When asked how something works (a flag, variable, state, function, etc.), you **must trace the concrete thing in question**:
  - Where it's set/modified.
  - Where it's read/checked.
  - What functions/callers touch it.
  - What conditions control its behavior.

- You **do not** need to understand every line of unrelated code in the same function. Focus on the **data flow of the specific concern**.

- If you cannot see all code paths that touch the thing in question, **stop and state**:
  - What you understand so far (what you've traced).
  - What information you still need (specific files, functions, or call sites).
  - Ask the user to provide the missing pieces.

- **Never fill gaps with assumptions.** If you don't know, say "I don't have enough context to answer this fully. I need to see [X]."

- Prefer reading large sections of code in parallel over making educated guesses.

### Example

**Bad** [X]:
> "This flag is probably set when the player wins."

**Good** [OK]:
> "I can see `bIsGameOver` is checked in `OnTurnEnd()`, but I haven't found where it's set yet. Let me search for assignments."
>
> *(Searches for `bIsGameOver =`)*
>
> "Found it: `bIsGameOver` is set to true in `Authority_CheckWinCondition()` when zone control count exceeds threshold."

**Good** [OK] (when context is missing):
> "I can see `bIsReady` is checked here, but I need to see where it's modified. Can you show me the PlayerState implementation or point me to the setter?"

## Debugging Philosophy

**Always fix root causes, not just symptoms.**

When encountering bugs (especially crashes, nullptrs, invalid state), your job is to:
1. **Identify the root cause** - trace back to where the invariant was violated
2. **Fix the root cause** - correct initialization, validation, or flow control
3. **Mitigate the symptom** - add defensive checks that aid diagnosis

### Principle
- Symptom: "Crash on nullptr access"
- Bad Fix [X]: Just add `if (Ptr == nullptr) return;`
- Good Fix [OK]: 
  - **Root cause**: Initialization order bug, asset not loaded before use
  - **Real fix**: Ensure asset loads before dependent systems initialize
  - **Mitigation**: Add null check + logging that exposes WHY it's null
    ```cpp
    if (Ptr == nullptr)
    {
        UE_LOGFMT(LogSystem, Error, 
            "Ptr is null - AssetLoadStatus={0}, InitializationPhase={1}, FrameNumber={2}",
            AssetLoadStatusToString(CurrentLoadStatus),
            *GetCurrentPhase().ToString(),
            GFrameNumber);
        return;
    }
    ```

### Diagnostic Context
Any mitigation (null checks, early returns, fallback values) must log enough state to diagnose the root cause:
- What was expected vs actual
- What phase/state the system is in
- Relevant timestamps, frame numbers, or sequence counters
- Asset IDs, object names, indices that identify the failure

### Examples

**Bad** [X]:
```cpp
// Symptom fixed, root cause hidden
if (!PlayerState)
    return;
```

**Good** [OK]:
```cpp
// Root cause: Players not assigned in PostLogin
// Real fix: Implement player assignment logic in AZGameMode::PostLogin()
// Mitigation: Defensive check with diagnostic context
if (!PlayerState)
{
    UE_LOGFMT(LogGameState, Error,
        "PlayerState is null - PlayerArray.Num()={0}, bIsInitialized={1}, CalledFrom={2}",
        PlayerArray.Num(),
        bIsGameStateInitialized,
        *FString(__FUNCTION__));
    return;
}
```

**Bad** [X]:
```cpp
// Crashes on null asset reference
AssetManager->GetPrimaryAssetObject(AssetId);
```

**Good** [OK]:
```cpp
// Root cause: Asset not configured in Developer Settings
// Real fix: Add asset reference to UZGameplayDeveloperSettings in editor
// Mitigation: Check for null soft object ptr before loading
TSoftObjectPtr<UDataAsset> AssetPtr = Settings->GetAsset();
if (AssetPtr.IsNull())
{
    UE_LOGFMT(LogAssetLoader, Error,
        "Asset not configured in Developer Settings - SettingsClass={0}, PropertyName={1}",
        *Settings->GetClass()->GetName(),
        TEXT("AssetPropertyName"));
    co_return EGameAssetLoadStatus::Failure;
}
```

# Project Overview
ZoneControl is a competitive 1v1 turn-based strategy game built in Unreal Engine 5.4. Players place numbered Blocks (4-sided cards with values 0-5 totaling 10) onto Tiles within Zones on a grid-based board. Blocks flip adjacent opponent Blocks when their facing number is higher, creating chain reactions. Players compete to control more Zones than their opponent by game end. The architecture separates data (asset loading, game state) from presentation (3D blocks, UI), uses an async coroutine-based asset loading system, and supports networked multiplayer with replication.

For detailed game mechanics, rules, and abilities, see [Game Design Document](.github/game-design.md).

## Default Deliverables
- **Code**: idiomatic, modern, C++20, Unreal Engine 5.
- **Tests**: focused, deterministic unit tests (only when explicitly requested).
- **Docs**: minimal but high-value inline docstrings (brief "what," emphasize "why" without writing the words "what" or "why" explicitly).
- **Ops**: logging, error handling, exit codes, and observability hooks.
- **Changes**: propose patches as unified diffs; include a rationale and a test plan.

## How to Explain Code

- Default to feature-level summaries: When asked "What does this class/module/system do?", identify and explain only the high-level responsibilities (the external verbs/features someone rewriting it would need to support).

- Treat implementation details (e.g., helper methods, connection setup, data parsing) as internal noise unless specifically requested.

- Assume that if the question is about a class or system, I want to know the sequence of major operations or lifecycle stages it supports.

- Only explain implementation details if the question explicitly targets a specific method, algorithm, or technical mechanism.

- Use a top-down style: start with the big-picture lifecycle/features first, then drill into details only if asked.

- Explanations should be concise but clear, focused on what matters for understanding or rewriting functionality.

## Workspace
- Project root: `e:\source\ZoneControl\`
- Source code: `Source/ZoneControl/Public` and `Source/ZoneControl/Private`
- Content: `Content/ZoneControl/` for UMG, data assets, blueprints
- Build scripts: `launch-server.bat` for dedicated server testing


## Engineering Principles (order matters)
1. **Correctness**
2. **Conciseness**
3. **Readability**
4. **Maintainability**
5. **Longevity**
6. **Performance**
---

## C++ / Blueprint Split

This project follows AAA industry-standard separation between C++ and Blueprint:

### C++ Responsibilities (Systems Layer)
- **Core gameplay logic**: Flipping, scoring, turn management, gameplay ability logic, win conditions.
- **Networking**: Replication, RPCs, authority validation, client prediction.
- **State management**: Game state, player state, block state, board state.
- **Data structures**: Structs, enums, data assets, serialization.
- **Subsystems**: Asset loading, managers, services, utilities.
- **APIs for Blueprint**: UFUNCTION(BlueprintCallable) endpoints that Blueprint can invoke.
- **Events for Blueprint**: Delegates, dynamic multicast delegates for Blueprint to bind to.
- **Performance-critical code**: Hot paths, algorithms, large loops.

### Blueprint Responsibilities (Orchestration Layer)
- **Player input**: Enhanced Input bindings, input actions, input context switching.
- **UI logic**: Widget interactions, button clicks, animations, transitions.
- **Event routing**: Connecting input events to C++ API calls.
- **Visual scripting**: Sequencing actions, timelines, UI state machines.
- **Designer iteration**: Tunable values, ability visuals, UI layout.
- **Prototyping**: Quick experiments before hardening in C++.

### Design Philosophy
- **C++ = "What" and "How"**: Implement the rules and systems.
- **Blueprint = "When" and "Where"**: Orchestrate when systems are invoked and where results are displayed.
- **Blueprint should be thin**: If Blueprint logic exceeds 10-15 nodes, consider moving it to C++.
- **C++ APIs should be Blueprint-friendly**: Clear names, simple parameters, no complex return types (use structs if needed).

### Example Patterns

**Good** [OK]:
```cpp
// C++: Exposes simple API
UFUNCTION(BlueprintCallable, Category = "Gameplay")
bool TryPlaceBlock(int32 TileId, const FBlockData& BlockData);

UFUNCTION(BlueprintCallable, Category = "Abilities")
bool TryUseFireAbility(int32 TargetBlockId);

// Blueprint: Calls API on input event
OnLeftClick -> TryPlaceBlock(SelectedTile, CurrentBlock)
OnAbilityButton -> TryUseFireAbility(TargetBlock)
```

**Bad** [X]:
```cpp
// Blueprint implementing game rules
OnLeftClick -> Check if tile valid -> Check if player's turn -> Check cooldowns -> Update state -> Notify UI
```

### Workflow
1. **Define requirements** (what needs to happen).
2. **C++ implements APIs** (functions, events, data).
3. **Blueprint wires up orchestration** (input -> API -> UI response).
4. **Iterate**: If Blueprint becomes complex, refactor logic into C++.

---

## Coding Standards

### Language & Types
- Target Unreal Engine 5.4 flavored **C++20**.
- Use `TObjectPtr<T>` for UPROPERTY references to UObjects (e.g., `TObjectPtr<UZGameAssetLoader>`).
- Use `TWeakObjectPtr<T>` for non-owning references that need null-safety checks (e.g., callbacks, delegates).
- Use `TSubclassOf<T>` for Blueprint class references (e.g., `TSubclassOf<AZBlock>`).
- Use `TSharedRef<T>` and `TSharedPtr<T>` for non-UObject shared ownership patterns.
- Use `TUniquePtr<T>` or `TUniqueFunction<void()>` for move-only ownership.
- Use `TArray<T>`, `TMap<K,V>`, `TSet<T>` instead of STL containers.
- Use `FString` for strings, `FName` for identifiers, `FText` for localized UI strings.
- Use `int32`, `uint32`, `int64` instead of `int`, `unsigned`, `long`.
- Use Unreal's `float` and `double` explicitly; avoid `auto` for numeric types unless context is obvious.
- Use `FGameplayTag` and `FGameplayTagContainer` from `GameplayTags` module for type-safe identifiers.
- Use `FSoftObjectPath` for asset references that need to be loaded asynchronously.
- Use `FPrimaryAssetId` for referencing data assets via the Asset Manager.
- Prefer `const` correctness everywhere; mark member functions `const` if they don't mutate state.
- **Never use `mutable`**. Const correctness is critical; `mutable` obfuscates true constness.
- Use `ensure()` and `ensureMsgf()` for runtime validation that logs and continues.
- Use `check()` and `checkf()` only for fatal contract violations that should crash in development.
- Avoid single-letter variable names except `i`, `j`, `k` for tight loop indices.
- **No hardcoded values**: Avoid magic numbers, hardcoded strings, or hardcoded tag lookups. Use named constants, `constexpr`, config values, or data stored in appropriate owning objects.
- **Data Ownership Principle**: If a value is used, something must own it. Tags describe identity; the entity with that identity should own the tag reference, not the code querying it.
- **NEVER EVER USE NON ASCII CHARACTERS UNLESS EXPLICITLY ASKED TO** This means no fancy quotes, em dashes, accented letters, or any other non-standard characters. No Checkmarks in logs, no Xs in comments, etc. 

### Naming Conventions
- **Classes/Structs:**
    - `A` prefix for `AActor` subclasses (e.g., `AZGameMode`, `AZPlayerController`, `AZBlock`).
    - `U` prefix for `UObject` subclasses (e.g., `UZGameAssetLoader`, `UZBlockDisplayData`, `UZGameBoardManager`).
    - `F` prefix for plain C++ structs/classes (e.g., `FAssetLoadBatch`).
    - `I` prefix for interfaces (e.g., `IZAssetProvider`).
    - `E` prefix for enums (e.g., `EGameAssetLoadStatus`).
    - `T` prefix for template types (e.g., `TCoroutine<T>`).
    
- **Project-Specific Prefix:**
    - All custom gameplay classes use `Z` as the project prefix after the UE type prefix (e.g., `UZGameAssetLoader`, `AZGameState`).
    
- **Member Variables:**
    - Non-replicated members: camelCase starting with lowercase (e.g., `bIsElementalDataReady`, `NumAssetsLoaded`).
    - Boolean members: prefix with `b` (e.g., `bIsGameBoardDataReady`, `bAreAllIdsValid`).
    - UPROPERTY members: may use `TObjectPtr` wrapper but still follow camelCase (e.g., `TObjectPtr<UAssetManager> AssetManager`).
    - Private members: no special prefix/suffix; rely on access specifiers for clarity.
    
- **Functions:**
    - PascalCase for all functions (e.g., `InitGame`, `LoadRandomGameBoard`, `GetActiveGameBoardData`).
    - UFUNCTION RPCs: `Server_`, `Client_`, `Multicast_` prefixes (e.g., `Server_RequestCaptureBlock`, `Client_InitializeInput`).
    - Getters: `GetX()` (e.g., `GetGameState()`, `GetElementalDisplayDataByTag()`).
    - Boolean queries: `IsX()` or `AreX()` (e.g., `AreAllPlayersReady()`, `IsValid()`).
    - Callbacks: suffix with `CB` or prefix with `On` (e.g., `OnCompleteCB`, `OnAssetLoadedCB`).
    - Async coroutines: suffix with `Async` (e.g., `LoadAllGameBoardDataAsync`, `LoadElementalByTagAsync`).
    
- **Constants:**
    - Namespace-scoped or static: PascalCase prefixed with `K` (e.g., `KRandomDevice`, `KGenerator`).
    - `constexpr` or `const` globals: same `K` prefix convention.
    
- **Delegates:**
    - Declare: `DECLARE_MULTICAST_DELEGATE(FOnGameBoardDependenciesReady);`
    - Member: `FOnGameBoardDependenciesReady OnGameBoardDependenciesReadyDelegate;`
    - Always suffix delegate members with `Delegate`.
    
- **Parameters:**
    - Input parameters: PascalCase with `In` prefix if ambiguous (e.g., `InGameState`, `InAssetManager`).
    - Output parameters: prefix with `Out` (e.g., `OutErrorMessage`).
    - Use descriptive names; avoid abbreviations unless universally understood (e.g., `CB` for callback).

### Refactoring
- If code is formatted in a non-standard way but is functionally correct, and you need to move it, **do not reformat it** unless the explicit goal of the refactor is to reformat that code.
- Don't change coding styles or formatting arbitrarily if the formatting looked intentional.

### Style & Lint
- Use **tabs** for indentation, UTF-8 encoding, Unix line endings (LF). Follow `.editorconfig` if present.
- Max line length: **120 characters**. Always wrap before exceeding.
- Prefer function length **less than 60 lines of code** (comments and docstrings don't count).
- **Never exceed 80 lines of code** in a single function (comments and docstrings don't count).
- Private APIs and members must always be defined **after** public APIs in their own section within the class declaration.
- Use blank lines for readability:
    - Before control flow statements (`if`, `for`, `while`).
    - After the body of control flow blocks.
    - To separate logical sections within a function.
- **Never put an entire if statement and its body on the same line.**
- Unless the body is an early function exit (e.g., `return`, `continue`, `break`), **always use braces** for if statements:
    ```cpp
    // OK - early return without braces
    if (thing)
        return;

    int x = 0;

    // NOT OKAY - missing blank line after early return
    if (thing)
        return;
    int x = 0;

    // NOT OK - non-early-exit without braces
    int x = 10;
    if (thing)
        x = 10;

    // OK - braced body
    int x = 10;
    if (thing)
    {
        x = 10;
    }

    // NOT OKAY - statement and body on same line
    if (thing) return;
    ```
- Header file includes:
    - First include: the corresponding `.h` file for a `.cpp` (e.g., `#include "ZGameMode.h"` first in `ZGameMode.cpp`).
    - Then alphabetical order for remaining includes.
    - Group standard library, then engine, then project headers with blank lines between groups.
    - Use forward declarations in headers wherever possible to minimize compile dependencies.

### Comments
- Comments should only be used when the code is not self-explanatory.
- Explain **why** something is done, or provide insight into non-obvious side effects, bugs, or design decisions.
- Comments always start with a **capital letter** and end with a **period**.
- Comments always go **above** the code they describe, never beside it.
- For UPROPERTY and UFUNCTION, place comments **above** the macro, not above the variable/function itself:
    ```cpp
    // This block type is used for player 1's capture attempts.
    UPROPERTY(EditDefaultsOnly, Category = "Gameplay")
    FGameplayTag Player1BlockTypeTag;
    ```
- **Do not** prefix comments with labels like "Why:", "Reason:", "Note:". Write the explanation directly.
- Prefer descriptive names over comments. If you need a comment to explain what code does, consider renaming variables/functions.

### Algorithm Style
- Prefer **declarative code** over imperative loops.
- **Avoid raw loops.** Use Unreal's `Algo` library instead of `std::algorithm`:
    - `Algo::AllOf` instead of `std::all_of`
    - `Algo::AnyOf` instead of `std::any_of`
    - `Algo::NoneOf` instead of `std::none_of`
    - `Algo::Find` instead of `std::find`
    - `Algo::FindBy` for searching by member/predicate
    - `Algo::Transform` instead of `std::transform`
    - `Algo::Copy`, `Algo::CopyIf` instead of `std::copy`
    - `Algo::Sort`, `Algo::StableSort` instead of `std::sort`
    - `Algo::Reverse` instead of `std::reverse`
    - Example from codebase:
        ```cpp
        return Algo::AllOf(PlayerStates, [](const APlayerState* PlayerState)
        {
            const AZPlayerState* ZPlayerState = Cast<AZPlayerState>(PlayerState);
            return ZPlayerState && ZPlayerState->IsReadyForPlay();
        });
        ```
- Use range-based for loops when simple iteration is needed:
    ```cpp
    for (const FPrimaryAssetId& AssetId : AssetIdsToLoad)
    {
        LoadingTasks.Add(LoadAsset(AssetId));
    }
    ```
- By default, **use existing patterns** from the surrounding codebase to solve problems. Don't invent new patterns unless necessary.
  
- Inventing a new pattern is okay if there is no applicable existing one.

### Code Volume & Maintainability

**Less code is always better.** Every line you write is a line someone must read, debug, and maintain.

#### Core Principle
Minimize lines of code changed while achieving the goal. This is not about code golf - it's about using the right abstractions and avoiding unnecessary verbosity.

#### Strategies (in order of preference)

1. **Use existing library functions first.**
   - Check if Unreal, STL, or project utilities already solve the problem.
   - One library call beats 15 lines of manual implementation.
   - Example: Use `Algo::FindByPredicate` instead of writing a search loop.

2. **Extract reusable helpers.**
   - If you write the same 3+ lines twice, extract a function.
   - Name the function after what it does, not how it does it.
   - Small functions compose; large functions calcify.

3. **Prefer declarative over imperative.**
   - Declarative: "Filter items where X is true" (`Algo::CopyIf`)
   - Imperative: "Loop through items, check X, push to new array"
   - Declarative code states intent; imperative code describes mechanism.

4. **Avoid mixing concerns in loops.**
   - Bad: One loop that filters, transforms, validates, and formats.
   - Good: Chain of focused operations (`Filter | Transform | Validate`).

5. **Use structured bindings and modern syntax.**
   - `auto [Key, Value] = Pair;` instead of `Pair.first`, `Pair.second`.
   - `if (auto* Ptr = TryGet(); Ptr)` instead of separate declaration and check.

#### Anti-Patterns to Avoid

**Monolithic functions**: If a function exceeds 40 lines, it's likely doing too much. Split it.

**Copy-paste with variations**: If you're copying code and tweaking it, extract the common part and parameterize the difference.

**Manual iteration when algorithms exist**:
```cpp
// BAD [X] - 8 lines for a simple search
UZBlockState* Found = nullptr;
for (UZBlockState* Block : Blocks)
{
    if (Block && Block->GetTileIndex() == TargetIndex)
    {
        Found = Block;
        break;
    }
}

// GOOD [OK] - 1 line, same behavior
UZBlockState** Found = Algo::FindByPredicate(Blocks, [&](UZBlockState* B) { return B && B->GetTileIndex() == TargetIndex; });
```

**Inline string formatting in presentation code**:
```cpp
// BAD [X] - Logic mixed with presentation
if (Tags.HasTag(FGameplayTag::RequestGameplayTag("Player.Owner.P1")))
{
    DrawText("P1", Blue);
}
else if (Tags.HasTag(FGameplayTag::RequestGameplayTag("Player.Owner.P2")))
{
    DrawText("P2", Red);
}

// GOOD [OK] - Data-driven, extensible
struct FPlayerDisplayInfo { FGameplayTag Tag; FString Label; FColor Color; };
static const TArray<FPlayerDisplayInfo> PlayerDisplayData = { /* ... */ };
for (const auto& Info : PlayerDisplayData)
{
    if (Tags.HasTag(Info.Tag)) { DrawText(Info.Label, Info.Color); break; }
}
```

**Repeated null-checks with the same recovery**:
```cpp
// BAD [X] - Repetitive guard clauses
if (!GameState) { return DefaultValue; }
if (!GameState->GetBoardData()) { return DefaultValue; }
if (!GameState->GetBoardData()->IsValid()) { return DefaultValue; }

// GOOD [OK] - Single guard with chained access
const auto* BoardData = GameState ? GameState->GetBoardData() : nullptr;
if (!BoardData || !BoardData->IsValid())
    return DefaultValue;
```

#### Code Review Lens
When reviewing your own output, ask:
- Could a library function replace this loop?
- Is this function doing more than one thing?
- Would a new reader understand the intent in 5 seconds?
- If I deleted this code, what's the minimal replacement?

### UE5 Idioms & Best Practices
- **Asynchronous Operations:**
    - Use `UE5Coro` library for coroutine-based async workflows (e.g., `co_await UE5Coro::Latent::AsyncLoadPrimaryAsset(AssetId)`).
    - Use `FAsyncCoroutine` return type for async functions that should be awaited.
    - Store lambda captures carefully; use `TWeakObjectPtr<T>` to avoid dangling references:
        ```cpp
        TWeakObjectPtr<UZGameAssetLoader> WeakSelf(this);
        TUniqueFunction<void(UObject*)> OnAssetLoadedCB = [WeakSelf](UObject* LoadedAsset)
        {
            UZGameAssetLoader* Self = WeakSelf.Get();
            if (!IsValid(Self))
            {
                return;
            }
            // Safe to use Self here
        };
        ```
    - Always validate `IsValid(Ptr)` after dereferencing `TWeakObjectPtr` or `TObjectPtr` from async contexts.

- **Asset Management:**
    - Use `UAssetManager` for loading primary data assets via `FPrimaryAssetId`.
    - Use `AsyncLoadPrimaryAsset` for async loads; avoid blocking `LoadSynchronous` on game thread.
    - Cache loaded assets in subsystems (e.g., `UZGameAssetLoader::CachedElementalData`).
    - Use `FSoftObjectPath` and `TSoftObjectPtr<T>` for Blueprint/asset references in config/data assets.

- **Replication & Networking:**
    - Mark properties with `UPROPERTY(Replicated)` and implement `GetLifetimeReplicatedProps()`.
    - Use RPCs: `UFUNCTION(Server, Reliable)` for client->server, `UFUNCTION(Client, Reliable)` for server->client.
    - Authority checks: `HasAuthority()` on actors, `GetLocalRole() == ROLE_Authority` for components.
    - Prefer replicating minimal state; derive display state on clients when possible.
    - **Server/Client Code Clarity**:
        - Server-only classes (AGameMode, etc.): No guards needed, add comment for clarity.
        - Replicated classes (AGameState, APlayerState): Prefix server functions with `Authority_`, add `HasAuthority()` guard.
        - Mixed-authority subsystems: Comment which functions are server/client/both, guard appropriately.
        - Use visual comment sections to separate server-only, client-only, and shared code (Lyra style):
            ```cpp
            // ====================================
            // SERVER ONLY - Authority Required
            // ====================================
            private:
                void Authority_PlaceBlock(int32 TileId, const FBlockData& BlockData);
                void Authority_ExecuteFlipChain(int32 SourceBlockId);
            
            // ====================================
            // CLIENT + SERVER - Read-Only
            // ====================================
            public:
                UFUNCTION(BlueprintCallable)
                const TArray<UZBlockState*>& GetGameBoard() const;
            
            // ====================================
            // REPLICATED STATE
            // ====================================
            private:
                UPROPERTY(Replicated)
                TArray<TObjectPtr<UZBlockState>> GameBoardState;
            ```
        - Always guard server-only functions in implementation:
            ```cpp
            void AZGameState::Authority_PlaceBlock(int32 TileId, const FBlockData& BlockData)
            {
                if (!HasAuthority())
                {
                    UE_LOG(LogZGameState, Warning, TEXT("Authority_PlaceBlock called without authority"));
                    return;
                }
                // Server logic here
            }
            ```

- **Local Reference Docs (authoritative for UE networking)**
    A local copy of Cedric Neukirchen's Unreal Multiplayer Network Compendium is checked into this repo at:
    - `.github/networking-docs/`

    Rules:
    - When answering UE networking questions (Replication, RPCs, Ownership, relevancy, roles, dedicated vs listen), search these docs first.
    - Use ripgrep and cite the exact file path(s) you used.

    Search workflow:
    1) `rg -n "Replication|RPC|Remote Procedure Calls|Ownership|Relevancy|Role|RemoteRole|NetMulticast|Server_|Client_" .github/networking-docs`
    2) Open the most relevant markdown/html page(s)
    3) Answer with citations in the form: `(.github/networking-docs/<path>#<heading>)`

    If the local docs conflict with assumptions, the local docs win.


- **Logging:**
    - Always use `UE_LOGFMT` when formatting arguments:
        ```cpp
        UE_LOGFMT(LogZGameMode, Display, "Loading all assets of type: {0}", *AssetTypeName.ToString());
        ```
    - Use `UE_LOG` for simple messages without args:
        ```cpp
        UE_LOG(LogZGameMode, Log, TEXT("Initializing GameBoardStateManager"));
        ```
    - Declare log categories in `.cpp` files:
        ```cpp
        DEFINE_LOG_CATEGORY(LogZGameMode);
        ```
    - Use verbosity levels: `Display` (important), `Log` (routine), `Warning` (suspicious), `Error` (failure).

- **Casting:**
    - Use `Cast<T>()` for dynamic casting UObjects; returns `nullptr` on failure.
    - Use `CastChecked<T>()` when you're certain the cast will succeed (crashes on failure).
    - Always null-check after `Cast<T>()` unless using `ensure` or `check`:
        ```cpp
        if (UZBlockDisplayData* ElementalData = Cast<UZBlockDisplayData>(LoadedAsset))
        {
            // Use ElementalData
        }
        ```

- **Delegates & Events:**
    - Use multicast delegates for broadcasting events (e.g., `OnGameBoardDependenciesReadyDelegate.Broadcast()`).
    - Bind with `AddUObject`, `AddWeakLambda`, `AddDynamic` as appropriate.
    - Always unbind in `BeginDestroy()` or when object is no longer valid.

- **Subsystems:**
    - Use `UGameInstanceSubsystem` for persistent services (e.g., `UZGameAssetLoader`).
    - Use `UWorldSubsystem` for per-world logic (e.g., `UZGameBoardManager`).
    - Initialize in `Initialize()`, clean up in `Deinitialize()`.
    - Access via `GetGameInstance()->GetSubsystem<T>()` or `GetWorld()->GetSubsystem<T>()`.

- **Developer Settings:**
    - Use `UDeveloperSettings` subclasses for project config (e.g., `UZGameplayDeveloperSettings`).
    - Access via `GetMutableDefault<T>()` or `GetDefault<T>()`.
    - Mark settings `UPROPERTY(Config, EditDefaultsOnly)` to expose in Project Settings.

- **Data Assets:**
    - Subclass `UPrimaryDataAsset` for game content (e.g., `UZGameBoardData`, `UZBlockDisplayData`).
    - Override `GetPrimaryAssetId()` to return type and name.
    - Use `FAssetData::GetTagValue()` to query asset metadata without loading the asset.

- **Gameplay Tags:**
    - **Prefer Gameplay Tags over enums** for game state, abilities, ownership, and status effects.
    - Use `FGameplayTag` for single tags, `FGameplayTagContainer` for multiple tags.
    - Define tags in `Config/DefaultGameplayTags.ini` or via `UGameplayTagsManager`.
    - **Common Use Cases**:
        - **Ownership**: `Player.Owner.P1`, `Player.Owner.P2` (who owns a Block/Tile).
        - **Abilities**: `Ability.Fire`, `Ability.Forest`, `Ability.Water` (ability identification).
        - **Status Effects**: `Status.Frozen`, `Status.Charged`, `Status.Invisible` (Block state modifiers).
        - **Turn State**: `GameState.Turn.Active`, `GameState.Turn.Waiting` (turn management).
        - **Block State**: `Block.State.Placed`, `Block.State.Flipping` (Block lifecycle).
    - **Avoid Hardcoded Tag Strings**: Never inline tag lookups. Store tags in the appropriate owning object (Player State, Game State, Block State, etc.).
        ```cpp
        // BAD [X] - Hardcoded tag strings scattered throughout code
        if (BlockState->GameplayTags.HasTag(FGameplayTag::RequestGameplayTag("Player.Owner.P1")))
        {
            // What if tag name changes? Have to update everywhere.
        }

        // GOOD [OK] - Tags owned by relevant entities
        // In AZPlayerState.h
        UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Gameplay")
        FGameplayTag OwnerTag; // Set in editor or Initialize(): "Player.Owner.P1"

        // In game logic
        if (BlockState->GameplayTags.HasTag(PlayerState->OwnerTag))
        {
            // Single source of truth; change tag in one place.
        }
        ```
    - **Querying Tags**:
        ```cpp
        // Check single tag (using owned tag reference)
        if (BlockState->GameplayTags.HasTag(OwningPlayerState->OwnerTag))
        {
            // Block is owned by this player
        }

        // Check any match (using container from owning object)
        if (BlockState->GameplayTags.HasAny(GameState->GetAllPlayerOwnerTags()))
        {
            // Block is owned by any player
        }

        // Check exact match
        if (BlockState->GameplayTags.HasTagExact(PlayerState->OwnerTag))
        {
            // Exact ownership match
        }
        ```
    - **Modifying Tags**:
        ```cpp
        // Add a tag (using reference from owning object)
        BlockState->GameplayTags.AddTag(AbilityData->FrozenStatusTag);

        // Remove a tag (using reference)
        BlockState->GameplayTags.RemoveTag(OldPlayerState->OwnerTag);

        // Replace ownership tags
        BlockState->GameplayTags.RemoveTag(OldPlayerState->OwnerTag);
        BlockState->GameplayTags.AddTag(NewPlayerState->OwnerTag);
        ```
    - **Tag Hierarchy**: Use parent.child notation for logical grouping (e.g., `Player.Owner.P1` inherits from `Player.Owner`).
    - **Blueprint Exposure**: Mark `FGameplayTagContainer` members as `UPROPERTY(BlueprintReadWrite)` for designer access.
    - **Replication**: Mark tag containers as `UPROPERTY(Replicated)` when they represent networked state.
    - **Avoid String Comparisons**: Never use string matching for game logic; always use `FGameplayTag::RequestGameplayTag()` or cached tags.
    - **Example Pattern**:
        ```cpp
        // In UZBlockState.h
        UPROPERTY(Replicated, BlueprintReadWrite, Category = "Gameplay")
        FGameplayTagContainer GameplayTags;

        // In game logic
        bool IsOwnedByPlayer(const FGameplayTag& PlayerOwnerTag) const
        {
            return GameplayTags.HasTag(PlayerOwnerTag);
        }

        void SetOwner(const FGameplayTag& NewOwnerTag)
        {
            // Remove all existing owner tags
            FGameplayTagContainer OwnerTags = FGameplayTagContainer(
                FGameplayTag::RequestGameplayTag("Player.Owner"));
            GameplayTags.RemoveTags(OwnerTags);

            // Add new owner tag
            GameplayTags.AddTag(NewOwnerTag);
        }
        ```
    - **Do NOT** pull in heavy systems like Lyra's Gameplay Ability System unless explicitly needed. Simple tag-based logic is sufficient for this project.

---

## Logging & Errors
- Always use `UE_LOGFMT` when arguments are needed.
- Follow established patterns for logging:
    - `Display` for user-facing or important lifecycle events.
    - `Log` for routine debug information.
    - `Warning` for recoverable issues.
    - `Error` for failures that impact functionality.
- Use `ensure()` and `ensureMsgf()` for contract violations that should log and continue:
    ```cpp
    ensureMsgf(AssetManager, TEXT("AssetManager not ready!"));
    ```
- Use `check()` and `checkf()` only for fatal errors that should crash in development builds.

---

## Security & Safety
- Never execute untrusted input.
- Sanitize paths, pin minimal dependencies, redact secrets.

---

## Performance
- Optimize **after** correctness & readability.
- Profile before optimizing.
- Prefer cache-friendly data layouts (e.g., `TArray` over `TMap` when appropriate).
- Avoid unnecessary allocations; use move semantics (`MoveTemp`) for containers and callbacks.
- Use `Reserve()` on `TArray` when final size is known.

---

## Testing
- **Don't write tests unless explicitly asked.**
- 80%+ coverage for core logic per module; avoid gaming tests.
- Mock I/O at edges.
- Tests go in a `Tests/` directory. Each module with tests should have its own subdirectory.
- Tests should model how the target code is used in practice, including all relevant interactions and edge cases.
- Use fixtures to set up and tear down test environments if necessary.
- **Never leak test code into real code.** Real code should not know about or care at all about tests.

### Public API & Testability Policy
- Never change, complicate, or obfuscate public APIs solely for testing (no added hook methods, flags, hidden seams, or conditional code paths).
- Production code must have zero knowledge of tests. No test-only branches, environment checks, or pragma hacks as behavior gates.
- Do not introduce artificial indirection (wrapper classes, base classes, fake "entrypoint" layers) just to enable injection. Favor clarity over test convenience.
- If something is hard to test, improve its internal design (smaller pure functions, clearer separation of I/O) rather than adding testing seams.
- No persistent global mutable state in modules for the sake of test toggles.
- If a future proposal requires adding a hook for tests, reject it and redesign the test to work with current public surfaces.

---

## Agent Workflow
1. Clarify constraints only if blocking.
2. Propose: brief design covering data flow.
3. Scaffold: create/modify files with small diffs.
4. Implement: core logic first.
5. Test: add/adjust tests (only when requested).
6. Polish: docs, logging, errors.
7. Deliver: unified diff + runbook.

---

## Review Checklist
- [ ] Docstrings explain why.
- [ ] Side effects isolated.
- [ ] Errors surfaced with messages and exit codes.
- [ ] Logs structured; no secrets.
- [ ] Large inputs streamed.
- [ ] Dependencies minimal and pinned.
- [ ] Tests cover success, edge, failure (if tests requested).
- [ ] README shows common invocations.

---

## Commit Message Template

<scope>: <concise change>

- Why: <reason/goal>
- What: <key changes>
- Test Plan: <commands, cases>
- Notes: <migration steps, perf impact>