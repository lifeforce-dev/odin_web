---
applyTo: "**/*.cpp,**/*.h,**/*.hpp"
relatedAgents:
  - agent-cpp-modern.agent.md
  - agent-zone_control-designer.agent.md
---

# Agent: Unreal Engine 5 C++ Builder

Build and maintain Unreal Engine 5 C++ gameplay systems following Epic's best practices and modern C++ standards.

**IMPORTANT**: When implementing gameplay-affecting changes for ZoneControl, always consult the zone_control-designer agent first to ensure alignment with the game design document.

---

## Configuration

Modify these values to match your project requirements:

```yaml
unreal_version: "5.4"
cpp_standard: "C++20"  # UE5 uses C++20
line_length: 120
indent: tabs
project_prefix: "My"  # e.g., MyGameState, MyPlayerController
```

### Pinned Versions

```yaml
unreal_engine: "5.4"
visual_studio: "2022"
```

---

## Project Structure

```
Source/GameName/
├── Public/
│   ├── Core/
│   │   ├── MyGameMode.h
│   │   └── MyGameState.h
│   ├── Player/
│   │   ├── MyPlayerController.h
│   │   └── MyPlayerState.h
│   ├── Gameplay/
│   │   └── MyGameplayActor.h
│   └── Subsystems/
│       └── MyGameSubsystem.h
├── Private/
│   ├── Core/
│   │   ├── MyGameMode.cpp
│   │   └── MyGameState.cpp
│   └── ...
└── GameName.Build.cs
```

---

## Unreal Naming Conventions

### Class Prefixes

| Prefix | Used For | Example |
|--------|----------|---------|
| `A` | Actors | `AMyCharacter`, `AMyGameMode` |
| `U` | UObjects | `UMyComponent`, `UMySubsystem` |
| `F` | Structs, non-UObject classes | `FMyData`, `FAsyncTask` |
| `I` | Interfaces | `IMyInterface` |
| `E` | Enums | `EMyState` |
| `T` | Templates | `TMyContainer` |

### Project Prefix

All custom classes should use a project-specific prefix after the UE type prefix:

```cpp
// Project prefix: "My"
class AMyGameMode;      // A + My + GameMode
class UMyInventory;     // U + My + Inventory
struct FMyItemData;     // F + My + ItemData
```

### Member Variables

```cpp
class AMyActor : public AActor
{
private:
    // Booleans: prefix with b
    bool bIsActive = false;
    bool bHasInitialized = false;
    
    // Regular members: PascalCase, no prefix
    int32 CurrentHealth;
    float MovementSpeed;
    
    // Pointers: use TObjectPtr for UPROPERTY
    UPROPERTY()
    TObjectPtr<UMyComponent> MyComponent;
    
    // Delegates
    FOnHealthChanged OnHealthChanged;
};
```

---

## Unreal-Specific Types

### Use Unreal Types, Not STL

| STL Type | Unreal Type |
|----------|-------------|
| `std::vector` | `TArray` |
| `std::map` | `TMap` |
| `std::set` | `TSet` |
| `std::string` | `FString` |
| `std::unique_ptr` | `TUniquePtr` |
| `std::shared_ptr` | `TSharedPtr` / `TSharedRef` |
| `std::weak_ptr` | `TWeakPtr` |
| `std::optional` | `TOptional` |
| `std::function` | `TFunction` / `TUniqueFunction` |
| `std::variant` | `TVariant` |

### Pointer Types

```cpp
// For UPROPERTY UObject references (garbage collected)
UPROPERTY()
TObjectPtr<UMyComponent> OwnedComponent;

// Non-owning, nullable reference to UObject
UPROPERTY()
TWeakObjectPtr<AActor> ObservedActor;

// Blueprint class reference
UPROPERTY(EditDefaultsOnly)
TSubclassOf<AMyActor> ActorClass;

// Soft reference (async loading)
UPROPERTY(EditDefaultsOnly)
TSoftObjectPtr<UTexture2D> LazyTexture;

// Asset ID reference
UPROPERTY(EditDefaultsOnly)
FPrimaryAssetId AssetId;

// For non-UObject shared ownership
TSharedPtr<FMyData> SharedData;
TSharedRef<FMyData> GuaranteedData;  // Never null
TWeakPtr<FMyData> WeakData;
TUniquePtr<FMyNonUObject> UniqueData;
```

### String Types

```cpp
// General purpose mutable string
FString PlayerName = TEXT("Player1");

// Immutable identifier (fast comparison, case-insensitive)
FName AssetName = FName(TEXT("MyAsset"));

// Localized text for UI
FText DisplayText = NSLOCTEXT("Game", "Welcome", "Welcome!");

// String formatting
FString Message = FString::Printf(TEXT("Player %s scored %d"), *PlayerName, Score);

// Modern formatting with UE_LOGFMT style
FString Formatted = FString::Format(TEXT("Health: {0}/{1}"), {Current, Max});
```

### Integer Types

```cpp
int32 Index;        // Not int
uint32 Count;       // Not unsigned int
int64 UniqueId;     // Not long long
uint8 ByteValue;    // Not unsigned char
```

---

## UPROPERTY and UFUNCTION

### Common Specifiers

```cpp
// Editable in editor, visible in details panel
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Stats")
float MaxHealth = 100.0f;

// Only editable on the class default, not instances
UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
TSubclassOf<AActor> SpawnClass;

// Only visible, not editable
UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "State")
bool bIsAlive = true;

// Replicated property
UPROPERTY(ReplicatedUsing = OnRep_Health)
float Health;

// Delegate
UPROPERTY(BlueprintAssignable, Category = "Events")
FOnHealthChanged OnHealthChanged;
```

### UFUNCTION Specifiers

```cpp
// Callable from Blueprint
UFUNCTION(BlueprintCallable, Category = "Combat")
void TakeDamage(float Amount);

// Implementable in Blueprint
UFUNCTION(BlueprintImplementableEvent, Category = "Events")
void OnDeath();

// Native with Blueprint override option
UFUNCTION(BlueprintNativeEvent, Category = "Combat")
float CalculateDamage(float BaseDamage);

// Server RPC (client calls, server executes)
UFUNCTION(Server, Reliable)
void Server_RequestAction(FActionData Data);

// Client RPC (server calls, client executes)
UFUNCTION(Client, Reliable)
void Client_ReceiveResult(FResultData Result);

// Multicast RPC (server calls, all clients execute)
UFUNCTION(NetMulticast, Reliable)
void Multicast_PlayEffect(FVector Location);
```

---

## Comments and Documentation

```cpp
// Comments go ABOVE the UPROPERTY/UFUNCTION macro, not above the member.
// Maximum health value used for percentage calculations.
UPROPERTY(EditDefaultsOnly, Category = "Stats")
float MaxHealth = 100.0f;

// Applies damage and triggers death if health reaches zero.
UFUNCTION(BlueprintCallable, Category = "Combat")
void ApplyDamage(float Amount);
```

---

## Modern C++ in Unreal

### Use Modern Features

```cpp
// Range-based for loops
for (const AActor* Actor : Actors)
{
    Process(Actor);
}

// Structured bindings with TMap
for (const auto& [Key, Value] : MyMap)
{
    UE_LOG(LogTemp, Log, TEXT("Key: %s, Value: %d"), *Key, Value);
}

// Auto for iterators and complex types
auto It = Container.CreateIterator();

// Lambda expressions
Actors.RemoveAll([](const AActor* Actor)
{
    return Actor == nullptr || Actor->IsPendingKillPending();
});

// TOptional for values that may not exist
TOptional<FVector> FindSpawnLocation()
{
    if (HasValidSpawn())
    {
        return SpawnLocation;
    }
    return {};
}
```

### Avoid These Legacy Patterns

```cpp
// Bad: C-style cast
AMyActor* Actor = (AMyActor*)SomeActor;

// Good: Unreal cast
AMyActor* Actor = Cast<AMyActor>(SomeActor);

// Bad: Raw pointer ownership
UMyObject* Obj = NewObject<UMyObject>();
// ... who owns this? When is it cleaned up?

// Good: Clear ownership with UPROPERTY or explicit management
UPROPERTY()
TObjectPtr<UMyObject> OwnedObject;

// Bad: NULL
if (Actor == NULL)

// Good: nullptr
if (Actor == nullptr)

// Better: Unreal validity check
if (IsValid(Actor))
```

---

## Algorithms

Use Unreal's `Algo` namespace instead of `std::`:

```cpp
#include "Algo/Find.h"
#include "Algo/AllOf.h"
#include "Algo/Transform.h"

// Finding
AActor** Found = Algo::FindByPredicate(Actors, [](AActor* A)
{
    return A && A->GetName().Contains(TEXT("Target"));
});

// Checking conditions
bool bAllValid = Algo::AllOf(Items, [](const FItem& Item)
{
    return Item.IsValid();
});

// Transforming
TArray<FString> Names;
Algo::Transform(Actors, Names, [](const AActor* A)
{
    return A->GetName();
});

// Sorting
Actors.Sort([](const AActor& A, const AActor& B)
{
    return A.GetScore() > B.GetScore();
});
```

---

## Logging

Use `UE_LOGFMT` for structured logging (UE 5.2+):

```cpp
#include "Logging/StructuredLog.h"

// Define log category in header
DECLARE_LOG_CATEGORY_EXTERN(LogMyGame, Log, All);

// Define in cpp
DEFINE_LOG_CATEGORY(LogMyGame);

// Use structured logging
UE_LOGFMT(LogMyGame, Display, "Player spawned. Name={Name}, Location={Location}",
    ("Name", PlayerName),
    ("Location", SpawnLocation));

UE_LOGFMT(LogMyGame, Warning, "Health low. Current={Current}, Max={Max}",
    ("Current", CurrentHealth),
    ("Max", MaxHealth));

UE_LOGFMT(LogMyGame, Error, "Failed to load asset. AssetId={AssetId}",
    ("AssetId", AssetId.ToString()));
```

---

## Assertions and Validation

```cpp
// Fatal in development, does nothing in shipping
check(Pointer != nullptr);
checkf(Index >= 0, TEXT("Index must be non-negative, got %d"), Index);

// Logs error and returns false, doesn't crash
ensure(Pointer != nullptr);
ensureMsgf(Index >= 0, TEXT("Index must be non-negative"));

// Use ensure for recoverable validation
if (!ensure(IsValid(TargetActor)))
{
    return;
}

// Use check only for invariants that indicate programmer error
check(GetWorld() != nullptr);  // Should always have a world
```

---

## Networking and Replication

### RPC Naming Convention

```cpp
// Server RPCs: Server_ prefix
UFUNCTION(Server, Reliable)
void Server_RequestMove(FVector Destination);

// Client RPCs: Client_ prefix  
UFUNCTION(Client, Reliable)
void Client_ReceiveInventory(const TArray<FItemData>& Items);

// Multicast: Multicast_ prefix
UFUNCTION(NetMulticast, Unreliable)
void Multicast_PlayHitEffect(FVector Location, FRotator Rotation);
```

### RepNotify

```cpp
UPROPERTY(ReplicatedUsing = OnRep_Health)
float Health;

UFUNCTION()
void OnRep_Health(float OldHealth)
{
    // React to health change
    float Delta = Health - OldHealth;
    PlayHealthChangeEffect(Delta);
}

// In GetLifetimeReplicatedProps
void AMyCharacter::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    
    DOREPLIFETIME(AMyCharacter, Health);
    DOREPLIFETIME_CONDITION(AMyCharacter, SecretData, COND_OwnerOnly);
}
```

---

## Subsystems

Prefer subsystems over singletons for game-wide services:

```cpp
// GameInstanceSubsystem - persists across levels
UCLASS()
class UMyGameSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
    
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    
    UFUNCTION(BlueprintCallable, Category = "MyGame")
    void DoSomething();
};

// Access from anywhere
if (UMyGameSubsystem* Subsystem = GetGameInstance()->GetSubsystem<UMyGameSubsystem>())
{
    Subsystem->DoSomething();
}
```

---

## Async Operations

### Latent Actions for Blueprint

```cpp
UFUNCTION(BlueprintCallable, Category = "Async", meta = (Latent, LatentInfo = "LatentInfo"))
void AsyncLoadData(FLatentActionInfo LatentInfo);
```

### Async Tasks

```cpp
// Simple async on game thread
AsyncTask(ENamedThreads::GameThread, [this]()
{
    // Runs on game thread
    ProcessData();
});

// Background thread work
Async(EAsyncExecution::ThreadPool, [Data = MoveTemp(LargeData)]()
{
    // Runs on thread pool
    return ProcessLargeData(Data);
}).Then([this](TFuture<FResult> Future)
{
    // Back on calling thread
    HandleResult(Future.Get());
});
```

---

## Common Anti-Patterns

| Anti-Pattern | Issue | Correct Approach |
|--------------|-------|------------------|
| `std::vector` in Unreal | Not UObject aware | Use `TArray` |
| `std::string` | Not Unreal compatible | Use `FString` |
| Raw `new` for UObjects | Bypasses garbage collection | Use `NewObject<T>()` |
| Storing `AActor*` without UPROPERTY | Dangling pointer after GC | Use `TWeakObjectPtr` or `UPROPERTY()` |
| `dynamic_cast` | Slower than Unreal cast | Use `Cast<T>()` |
| Tick for everything | Performance | Use timers, events, delegates |
| Hardcoded asset paths | Fragile | Use `TSoftObjectPtr`, `FPrimaryAssetId` |
| Blueprint-heavy logic | Hard to debug/version | Move logic to C++ |
| `GetWorld()->SpawnActor` in constructor | World not ready | Use `BeginPlay` |
| `FindObject` at runtime | Slow | Cache references |

---

## Gameplay Tags

```cpp
#include "GameplayTagContainer.h"

// Define tag in code (prefer Data Table or .ini)
UE_DEFINE_GAMEPLAY_TAG(Tag_Status_Burning, "Status.Burning");

// Check for tag
if (TagContainer.HasTag(Tag_Status_Burning))
{
    ApplyBurnDamage();
}

// Check for any/all
if (TagContainer.HasAny(RequiredTags))
{
    // Has at least one
}

if (TagContainer.HasAll(RequiredTags))
{
    // Has all of them
}
```

---

## Blueprint/C++ Split Philosophy

### C++ Should Handle

- Core gameplay logic and rules
- Networking and replication
- Performance-critical code
- State management
- Complex algorithms
- Public APIs for Blueprint

### Blueprint Should Handle

- Player input binding
- UI interactions and animations
- Event routing (connecting systems)
- Designer-tunable values
- Quick iteration and prototyping

### Keep Blueprint Thin

If Blueprint logic exceeds 10-15 nodes, consider moving to C++.

```cpp
// Expose clean API for Blueprint
UFUNCTION(BlueprintCallable, Category = "Combat")
bool TryAttack(AActor* Target);

// Blueprint just calls: OnAttackInput -> TryAttack(CurrentTarget)
```
