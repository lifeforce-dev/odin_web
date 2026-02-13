# Agent: Modern C++ Builder

Build and maintain modern C++20/23 applications following contemporary best practices.

---

## Configuration

Modify these values to match your project requirements:

```yaml
cpp_standard: "C++20"  # or C++23
line_length: 120
indent: tabs
compiler: MSVC  # or GCC, Clang
```

---


## Modern C++ Standards

### Use Modern Features, Not Legacy Patterns

**This is critical.** C++ has evolved dramatically. Use C++20/23 idioms.

| Legacy (Avoid) | Modern (Prefer) |
|----------------|-----------------|
| Raw pointers for ownership | `std::unique_ptr`, `std::shared_ptr` |
| `new`/`delete` | `std::make_unique`, `std::make_shared` |
| C-style arrays | `std::array`, `std::vector`, `std::span` |
| `NULL` | `nullptr` |
| `#define` constants | `constexpr`, `const` |
| C-style casts | `static_cast`, `dynamic_cast`, etc. |
| `typedef` | `using` |
| Output parameters | Return values (with structured bindings) |
| Manual loops | Range-based for, `<algorithm>` |
| `std::endl` | `'\n'` (endl forces flush) |
| `char*` strings | `std::string`, `std::string_view` |
| Manual resource management | RAII, smart pointers |

### Smart Pointers

```cpp
// Unique ownership - default choice
auto widget = std::make_unique<Widget>(args...);

// Shared ownership - only when truly needed
auto shared = std::make_shared<Resource>();

// Non-owning observation - use raw pointer or reference
void process(Widget* widget);  // Does not own
void process(Widget& widget);  // Does not own, cannot be null

// Weak reference to shared
std::weak_ptr<Resource> observer = shared;
```

### Type Inference and Initialization

```cpp
// Use auto for complex types, explicit for simple ones
auto iter = container.begin();
auto result = computeComplexThing();
int count = 0;  // Simple types can be explicit

// Prefer uniform initialization
std::vector<int> numbers{1, 2, 3, 4, 5};
Point origin{0.0, 0.0};

// Use designated initializers (C++20)
struct Config {
    int timeout = 30;
    bool verbose = false;
    std::string name;
};

Config config{
    .timeout = 60,
    .verbose = true,
    .name = "test"
};
```

### String Handling

```cpp
#include <string>
#include <string_view>
#include <format>

// Use string_view for non-owning references
void process(std::string_view text);  // No allocation for string literals

// Use std::format (C++20) instead of sprintf or streams for formatting
auto message = std::format("User {} has {} points", name, score);

// Use raw string literals for complex strings
auto json = R"({
    "name": "test",
    "value": 42
})";

// String concatenation
using namespace std::string_literals;
auto greeting = "Hello, "s + name;  // s suffix creates std::string
```

### Algorithms (NOT std::ranges)

**IMPORTANT: `std::ranges` is banned.** The ranges library has severe compile-time overhead and generates bloated code. Use classic `<algorithm>` with range-based for loops instead.

**BEFORE writing any `for` loop, check this table:**

| If you're writing... | Use this instead |
|---------------------|------------------|
| `for (...) { if (cond) return true; } return false;` | `std::any_of(begin, end, predicate)` |
| `for (...) { if (!cond) return false; } return true;` | `std::all_of(begin, end, predicate)` |
| `for (...) { if (cond) return false; } return true;` | `std::none_of(begin, end, predicate)` |
| `for (...) { if (cond) return item; }` | `std::find_if(begin, end, predicate)` |
| `for (...) { if (item == target) return it; }` | `std::find(begin, end, target)` |
| `for (...) { result.push_back(transform(item)); }` | `std::transform(begin, end, back_inserter, func)` |
| `for (...) { if (cond) result.push_back(item); }` | `std::copy_if(begin, end, back_inserter, predicate)` |
| `for (...) { count++; }` | `std::count` or `std::count_if` |

**This is mandatory.** If you write a raw loop that matches one of these patterns, you have made an error.

```cpp
#include <algorithm>

// BAD - raw loop for "any match"
for (const auto& item : items)
{
    if (item.IsValid())
        return true;
}
return false;

// GOOD - std::any_of
return std::any_of(items.begin(), items.end(),
    [](const auto& item) { return item.IsValid(); });

// BAD - raw loop for "all match"
for (const auto& item : items)
{
    if (!item.IsValid())
        return false;
}
return true;

// GOOD - std::all_of
return std::all_of(items.begin(), items.end(),
    [](const auto& item) { return item.IsValid(); });
```

**When raw loops ARE appropriate:**
- Building up state across iterations (running totals, state machines)
- Early exit with complex side effects
- Nested iteration with non-trivial break/continue logic
- When the algorithm would be less readable than the loop
```

### Concepts and Constraints (C++20)

```cpp
#include <concepts>

// Use concepts to constrain templates
template<std::integral T>
T safeAdd(T a, T b);

template<typename T>
    requires std::default_initializable<T> && std::copyable<T>
class Container;

// Define custom concepts for domain clarity
template<typename T>
concept Serializable = requires(T t, std::ostream& os) {
    { t.serialize(os) } -> std::same_as<void>;
};

template<Serializable T>
void save(const T& obj, const std::filesystem::path& path);
```

### std::optional, std::expected, std::variant

```cpp
#include <optional>
#include <expected>  // C++23
#include <variant>

// Optional for values that may not exist
std::optional<User> findUser(int id) {
    if (auto it = users.find(id); it != users.end()) {
        return it->second;
    }
    return std::nullopt;
}

// Using optional
if (auto user = findUser(42)) {
    process(*user);
}

// Expected for operations that can fail (C++23)
std::expected<Config, Error> loadConfig(const path& p) {
    if (!exists(p)) {
        return std::unexpected(Error::FileNotFound);
    }
    return Config{...};
}

// Variant for type-safe unions
using Result = std::variant<Success, Error>;
std::visit([](auto&& arg) {
    using T = std::decay_t<decltype(arg)>;
    if constexpr (std::same_as<T, Success>) {
        handleSuccess(arg);
    } else {
        handleError(arg);
    }
}, result);
```

### Structured Bindings

```cpp
// Decompose pairs, tuples, structs
auto [key, value] = *map.begin();

for (const auto& [name, score] : playerScores) {
    std::println("{}: {}", name, score);
}

// With if-init statements
if (auto [iter, inserted] = map.insert({key, value}); inserted) {
    // Handle successful insertion
}
```

### constexpr and Compile-Time Computation

```cpp
// Prefer constexpr for compile-time constants
constexpr int MAX_BUFFER_SIZE = 1024;
constexpr double PI = 3.14159265358979323846;

// constexpr functions for compile-time computation
constexpr int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

// consteval for guaranteed compile-time evaluation (C++20)
consteval int mustBeCompileTime(int n) {
    return n * 2;
}

// if constexpr for compile-time branching
template<typename T>
auto stringify(const T& value) {
    if constexpr (std::is_same_v<T, std::string>) {
        return value;
    } else if constexpr (std::is_arithmetic_v<T>) {
        return std::to_string(value);
    } else {
        return value.toString();
    }
}
```

---

## Error Handling

### Prefer Return Values Over Exceptions

We do not use exceptions for control flow. Exceptions are reserved for:
- Third-party libraries that throw (e.g., nlohmann::json)
- Truly unrecoverable situations where continuing is impossible

```cpp
// Good: return error codes or bool for expected failures
bool LoadConfig(const std::string& path, Config& outConfig)
{
    if (!fs::exists(path))
    {
        return false;
    }
    // Load and populate outConfig
    return true;
}

// Good: use std::optional for "may not exist" semantics
std::optional<User> FindUser(int id)
{
    auto it = m_users.find(id);
    if (it == m_users.end())
    {
        return std::nullopt;
    }
    return it->second;
}

// Good: use std::expected for operations that can fail with error info (C++23)
std::expected<Data, ErrorCode> ParseInput(std::string_view input)
{
    if (input.empty())
    {
        return std::unexpected(ErrorCode::EmptyInput);
    }
    return Data{...};
}

// Acceptable: exceptions when third-party forces it
try
{
    auto json = nlohmann::json::parse(content);
    // process json
}
catch (const nlohmann::json::exception& e)
{
    BNETLOGERROR("JSON parse failed: " << e.what());
    return false;
}
```

### Mark Non-Throwing Functions

```cpp
// Use noexcept when functions cannot throw
int GetValue() const noexcept { return m_value; }
const std::string& GetName() const noexcept { return m_name; }

// Move operations should be noexcept when possible
Widget(Widget&& other) noexcept = default;
Widget& operator=(Widget&& other) noexcept = default;
```

---

## Class Design

### Rule of Zero/Five

```cpp
// Rule of Zero: If you can, don't define any special members
class Simple {
    std::string name_;
    std::vector<int> data_;
    // Compiler-generated special members are correct
};

// Rule of Five: If you must define one, define all five
class Resource {
public:
    Resource();
    ~Resource();
    Resource(const Resource& other);
    Resource& operator=(const Resource& other);
    Resource(Resource&& other) noexcept;
    Resource& operator=(Resource&& other) noexcept;
};

// Or explicitly default/delete them
class NonCopyable {
public:
    NonCopyable() = default;
    ~NonCopyable() = default;
    
    NonCopyable(const NonCopyable&) = delete;
    NonCopyable& operator=(const NonCopyable&) = delete;
    
    NonCopyable(NonCopyable&&) = default;
    NonCopyable& operator=(NonCopyable&&) = default;
};
```

### Member Initialization

```cpp
class Widget {
public:
    // Use member initializer list, not assignment in body
    Widget(std::string name, int value)
        : name_(std::move(name))
        , value_(value)
    {
    }

private:
    // Use default member initializers where possible
    std::string name_;
    int value_ = 0;
    bool active_ = true;
};
```

### Const Correctness

```cpp
class Data {
public:
    // Const member functions for non-mutating operations
    [[nodiscard]] int getValue() const noexcept {
        return value_;
    }
    
    // Const reference for read-only access
    [[nodiscard]] const std::string& getName() const noexcept {
        return name_;
    }
    
    // Non-const version only when mutation needed
    void setValue(int v) {
        value_ = v;
    }

private:
    std::string name_;
    int value_;
};
```

---

## Best Practices

### Use [[nodiscard]] for Important Return Values

```cpp
[[nodiscard]] bool initialize();
[[nodiscard]] std::optional<Error> validate();
[[nodiscard]] std::unique_ptr<Resource> create();
```

### Use std::span for Array Views (C++20)

```cpp
// Instead of pointer + size or begin + end
void process(std::span<const int> data);

// Works with any contiguous container
std::vector<int> vec{1, 2, 3};
std::array<int, 3> arr{4, 5, 6};
int raw[]{7, 8, 9};

process(vec);
process(arr);
process(raw);
```

### Use std::filesystem for Path Operations

```cpp
#include <filesystem>
namespace fs = std::filesystem;

fs::path configPath = fs::current_path() / "config" / "settings.json";

if (fs::exists(configPath)) {
    auto content = readFile(configPath);
}

for (const auto& entry : fs::directory_iterator(directory)) {
    if (entry.is_regular_file()) {
        process(entry.path());
    }
}
```

---

## Lambdas

### Always Capture Explicitly

Never use capture-all (`[=]` or `[&]`). Explicit captures make dependencies visible and prevent accidental lifetime issues.

```cpp
// Bad: hidden dependencies, unclear what's captured
auto callback = [=]() { return m_value + offset; };
auto callback = [&]() { process(m_data); };

// Good: explicit captures, dependencies are visible
auto callback = [this, offset]() { return m_value + offset; };
auto callback = [&data = m_data]() { process(data); };
```

### Capture by Reference or Value Based on Lifetime

```cpp
// Capture by reference when lambda is used synchronously
void ProcessItems(const std::vector<Item>& items)
{
    auto predicate = [&items](int id)
    {
        return std::find_if(items.begin(), items.end(),
            [id](const Item& item) { return item.id == id; });
    };
    // predicate used and destroyed before items goes out of scope
}

// Capture by value when lambda outlives the scope
void RegisterCallback(int threshold)
{
    // threshold is copied because callback persists
    m_callback = [threshold, this]()
    {
        return m_value > threshold;
    };
}

// Move-capture for unique_ptr or expensive-to-copy types
auto data = std::make_unique<LargeData>();
auto callback = [data = std::move(data)]()
{
    return data->Process();
};
```

### Use `mutable` When Lambdas Need to Modify Captured Values

```cpp
int counter = 0;
auto increment = [counter]() mutable
{
    return ++counter;  // modifies the lambda's copy
};
```

---

## Move Semantics

### Prefer Moving Over Copying

```cpp
// Good: move into member
Widget::Widget(std::string name)
    : m_name(std::move(name))
{
}

// Good: move into container
items.push_back(std::move(newItem));

// Good: return by value (compiler applies NRVO or move)
std::vector<Item> BuildItems()
{
    std::vector<Item> result;
    // populate result
    return result;  // moved or elided, never copied
}
```

### The unique_ptr Forward Declaration Trap

When a class has a `std::unique_ptr` member to a forward-declared type, the destructor must see the complete type. This commonly causes linker errors or undefined behavior.

```cpp
// Widget.h
#pragma once

#include <memory>

class Impl;  // forward declaration

class Widget
{
public:
    Widget();
    ~Widget();  // MUST be declared here

    Widget(Widget&&) noexcept;
    Widget& operator=(Widget&&) noexcept;

    // ... other methods

private:
    std::unique_ptr<Impl> m_impl;
};
```

```cpp
// Widget.cpp
#include "Widget.h"
#include "Impl.h"  // complete type available here

Widget::Widget()
    : m_impl(std::make_unique<Impl>())
{
}

// Define destructor in .cpp where Impl is complete
Widget::~Widget() = default;

// Same for move operations
Widget::Widget(Widget&&) noexcept = default;
Widget& Widget::operator=(Widget&&) noexcept = default;
```

The key: declare special members in the header, define them (even as `= default`) in the .cpp where the complete type is visible.

---

## Header Best Practices

### Include What You Use

Every file should include headers for all types it directly uses. Do not rely on transitive includes.

```cpp
// Good: explicit about dependencies
#include <string>
#include <vector>
#include <memory>

// Bad: relying on some other header to include <string> for you
```

### Forward Declarations

Prefer forward declarations in headers when only pointers or references are used:

```cpp
// Widget.h
#pragma once

namespace Phoenix {

class Backend;      // forward declaration - only used as pointer
class FeatureManager;

class Widget
{
public:
    Widget(Backend* backend);
    FeatureManager* GetFeatureManager() const;

private:
    Backend* m_backend;
};

} // namespace Phoenix
```

Include the full header in the .cpp file where you actually use the type.

### Include Order

Organize includes in groups, separated by blank lines:

```cpp
// 1. Precompiled header (if used)
#include "pch.h"

// 2. Corresponding header for this .cpp
#include "Widget.h"

// 3. Project headers
#include "backend/Backend.h"
#include "catalog/FeatureManager.h"

// 4. Third-party library headers
#include <boost/optional.hpp>
#include <fmt/format.h>

// 5. Standard library headers
#include <memory>
#include <string>
#include <vector>
```

### Inline vs Static in Headers

For functions defined in headers:

```cpp
// Use inline for functions that should be shared across translation units
inline std::string FormatError(int code)
{
    return std::format("Error: {}", code);
}

// Use static (or anonymous namespace) for internal linkage - 
// each TU gets its own copy (rarely what you want in headers)
static void HelperFunction();  // Usually wrong in a header

// For constants in headers:
inline constexpr int MAX_BUFFER_SIZE = 1024;  // C++17: inline variable
```

Rule of thumb: if it's in a header and meant to be shared, use `inline`.

---

## Naming Conventions

Based on project standards:

| Element | Convention | Example |
|---------|------------|---------|
| Classes/Structs | PascalCase | `CatalogManager`, `FeatureRecord` |
| Functions/Methods | PascalCase | `Initialize()`, `GetValue()` |
| Member variables | m_ prefix + camelCase | `m_backend`, `m_featureTable` |
| Local variables | camelCase | `foundItem`, `userCount` |
| Constants | UPPER_SNAKE or k prefix | `MAX_BUFFER_SIZE`, `kDefaultTimeout` |
| Namespaces | PascalCase or lowercase | `Phoenix`, `catalog` |
| Template params | T prefix or PascalCase | `TValue`, `Container` |
| Enums | PascalCase, members PascalCase | `enum class State { Active, Inactive }` |

### Descriptive Names Over Comments

```cpp
// Bad: cryptic name requires comment
int n;  // number of retries

// Good: name explains itself
int retryCount;

// Bad: abbreviated
auto mgr = GetMgr();

// Good: clear
auto* catalogManager = GetCatalogManager();
```

---

## Common Anti-Patterns to Avoid

**Memory and Resources**
- Raw `new`/`delete` - Memory leaks, exception safety. Use `make_unique`, `make_shared`.
- Manual resource cleanup - Leak-prone. Use RAII, smart pointers.
- Returning raw pointer ownership - Unclear ownership. Return smart pointer.

**Types and Containers**
- C-style arrays - No bounds checking, decay to pointer. Use `std::array`, `std::vector`.
- `#define` for constants - No scope, no type safety. Use `constexpr`.
- `reinterpret_cast` everywhere - Undefined behavior. Use type-safe alternatives.

**Code Style**
- `using namespace std;` - Name collisions, readability. Use explicit `std::` or targeted `using`.
- `std::endl` - Forces flush, slow. Use `'\n'`.
- Capture-all lambdas `[=]`/`[&]` - Hidden dependencies. Use explicit captures.

**Control Flow**
- Exceptions for control flow - Performance, unpredictable. Use return values, `std::optional`.
- `std::ranges` - Compile-time bloat, poor codegen. Use classic `<algorithm>`.

---

## Iteration Over Recursion

**Prefer iteration over recursion** for algorithms that naturally express as loops.

Recursion forces the reader to mentally maintain a call stack while reading. Iteration is linear and debugger-friendly.

### When to Use Iteration

- Walking a linked structure (parent chains, tree paths)
- Processing sequences with accumulation
- Any algorithm where recursion depth could grow with input size

### When Recursion Is Acceptable

- Tree traversals where you need to visit both subtrees (genuinely branching)
- Divide-and-conquer algorithms (quicksort, mergesort)
- When the recursive solution is dramatically simpler AND depth is bounded

### Conversion Pattern

Recursive algorithms that don't branch (single recursive call) convert trivially to loops:

```cpp
// Bad: Recursion for a linear walk
uint32_t InternTag(std::string_view tagPath)
{
    uint32_t existing = FindTag(tagPath);
    if (existing != kInvalidTagId)
        return existing;

    uint32_t parentId = kInvalidTagId;
    auto lastDot = tagPath.rfind('.');
    if (lastDot != std::string_view::npos)
    {
        parentId = InternTag(tagPath.substr(0, lastDot));  // Recursive call
    }

    return CreateEntry(tagPath, parentId);
}

// Good: Iteration with explicit stack
uint32_t InternTag(std::string_view tagPath)
{
    uint32_t existing = FindTag(tagPath);
    if (existing != kInvalidTagId)
        return existing;

    // Collect paths that need creation (deepest first).
    std::vector<std::string_view> pathsToCreate;
    pathsToCreate.push_back(tagPath);

    std::string_view current = tagPath;
    while (true)
    {
        auto lastDot = current.rfind('.');
        if (lastDot == std::string_view::npos)
            break;

        current = current.substr(0, lastDot);
        if (FindTag(current) != kInvalidTagId)
            break;

        pathsToCreate.push_back(current);
    }

    // Create from shallowest to deepest.
    uint32_t lastId = kInvalidTagId;
    for (auto it = pathsToCreate.rbegin(); it != pathsToCreate.rend(); ++it)
    {
        lastId = CreateEntry(*it, FindParentId(*it));
    }

    return lastId;
}
```

The iterative version:
- Is easier to step through in a debugger
- Has no stack overflow risk
- Makes the algorithm's structure explicit (collect, then process)

