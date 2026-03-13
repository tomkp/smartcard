# Native C++ Unit Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add native C++ unit tests for Issue #111 state tracking logic using Catch2.

**Architecture:** Extract `DetectCardStateChange` pure function from `reader_monitor.cpp` into a header-only utility, test with Catch2 framework.

**Tech Stack:** C++17, Catch2 (header-only), node-gyp

---

### Task 1: Create GitHub Issue

**Step 1: Create issue**

Run:
```bash
gh issue create --title "Add native C++ unit tests for Issue #111 state tracking logic" --body "## Problem

PR #112 fixed Windows card event reliability issues, but the tests added only exercise the JavaScript layer with mocks. They don't test the actual C++ logic that was fixed.

## Solution

Add native C++ unit tests using Catch2 that test the state detection logic directly.

## Tasks

- [ ] Extract state detection logic into pure functions
- [ ] Add Catch2 test framework
- [ ] Write unit tests for DetectCardStateChange
- [ ] Update build system
- [ ] Add CI step for native tests

Related: #111, #112"
```

**Step 2: Note the issue number for branch name**

---

### Task 2: Create Feature Branch

**Step 1: Create and checkout branch**

Run:
```bash
gh issue list --state open --limit 1
```

Then (assuming issue #117):
```bash
git checkout -b feat/native-cpp-tests-117
```

**Step 2: Verify branch**

Run: `git branch --show-current`
Expected: `feat/native-cpp-tests-117`

---

### Task 3: Add Catch2 Header

**Files:**
- Create: `src/test/catch.hpp`

**Step 1: Download Catch2 single-header**

Run:
```bash
mkdir -p src/test
curl -L https://github.com/catchorg/Catch2/releases/download/v2.13.10/catch.hpp -o src/test/catch.hpp
```

**Step 2: Verify download**

Run: `head -5 src/test/catch.hpp`
Expected: Catch2 header comment

**Step 3: Commit**

Run:
```bash
git add src/test/catch.hpp
git commit -m "chore: add Catch2 test framework header"
```

---

### Task 4: Create Test Main Entry Point

**Files:**
- Create: `src/test/test_main.cpp`

**Step 1: Create test main**

```cpp
#define CATCH_CONFIG_MAIN
#include "catch.hpp"
```

**Step 2: Commit**

Run:
```bash
git add src/test/test_main.cpp
git commit -m "chore: add Catch2 test main entry point"
```

---

### Task 5: Write Failing Test - Card Insertion

**Files:**
- Create: `src/test/reader_state_utils_test.cpp`
- Create: `src/reader_state_utils.h` (empty stub)

**Step 1: Create empty header stub**

```cpp
// src/reader_state_utils.h
#pragma once
```

**Step 2: Write first failing test**

```cpp
// src/test/reader_state_utils_test.cpp
#include "catch.hpp"
#include "reader_state_utils.h"

TEST_CASE("DetectCardStateChange", "[state]") {
    SECTION("returns Inserted when card becomes present") {
        REQUIRE(DetectCardStateChange(0x00, PCSC_STATE_PRESENT) == CardEvent::Inserted);
    }
}
```

**Step 3: Commit failing test**

Run:
```bash
git add src/reader_state_utils.h src/test/reader_state_utils_test.cpp
git commit -m "test: add failing test for card insertion detection"
```

---

### Task 6: Update Build System

**Files:**
- Modify: `binding.gyp`
- Modify: `package.json`

**Step 1: Add test target to binding.gyp**

Add second target to the targets array:

```json
{
    "target_name": "smartcard_tests",
    "type": "executable",
    "sources": [
        "src/test/test_main.cpp",
        "src/test/reader_state_utils_test.cpp"
    ],
    "include_dirs": [
        "src",
        "src/test"
    ],
    "cflags_cc!": ["-fno-exceptions"],
    "conditions": [
        ["OS=='mac'", {
            "xcode_settings": {
                "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
            }
        }],
        ["OS=='linux'", {
            "cflags_cc": ["-std=c++17", "-fexceptions"]
        }],
        ["OS=='win'", {
            "msvs_settings": {
                "VCCLCompilerTool": {
                    "ExceptionHandling": 1,
                    "AdditionalOptions": ["/std:c++17"]
                }
            }
        }]
    ]
}
```

**Step 2: Add test:native script to package.json**

Add to scripts:
```json
"test:native": "node-gyp build && ./build/Release/smartcard_tests"
```

**Step 3: Commit build system changes**

Run:
```bash
git add binding.gyp package.json
git commit -m "build: add native test target and script"
```

---

### Task 7: Run Test to Verify It Fails

**Step 1: Build and run tests**

Run: `npm run test:native`

Expected: Compilation error - `DetectCardStateChange` not defined, `CardEvent` not defined, `PCSC_STATE_PRESENT` not defined

---

### Task 8: Implement DetectCardStateChange

**Files:**
- Modify: `src/reader_state_utils.h`

**Step 1: Implement the function**

```cpp
// src/reader_state_utils.h
#pragma once
#include <cstdint>

enum class CardEvent { None, Inserted, Removed };

constexpr uint32_t PCSC_STATE_PRESENT = 0x00000010;

inline CardEvent DetectCardStateChange(uint32_t oldState, uint32_t newState) {
    bool wasPresent = (oldState & PCSC_STATE_PRESENT) != 0;
    bool isPresent = (newState & PCSC_STATE_PRESENT) != 0;

    if (!wasPresent && isPresent) return CardEvent::Inserted;
    if (wasPresent && !isPresent) return CardEvent::Removed;
    return CardEvent::None;
}
```

**Step 2: Run test to verify it passes**

Run: `npm run test:native`
Expected: 1 test passing

**Step 3: Commit**

Run:
```bash
git add src/reader_state_utils.h
git commit -m "feat: implement DetectCardStateChange function"
```

---

### Task 9: Add Remaining Tests (TDD cycle per test)

**Files:**
- Modify: `src/test/reader_state_utils_test.cpp`

**Step 1: Add test for card removal**

```cpp
SECTION("returns Removed when card becomes absent") {
    REQUIRE(DetectCardStateChange(PCSC_STATE_PRESENT, 0x00) == CardEvent::Removed);
}
```

Run: `npm run test:native`
Expected: 2 tests passing

**Step 2: Add test for no change (absent)**

```cpp
SECTION("returns None when state unchanged - no card") {
    REQUIRE(DetectCardStateChange(0x00, 0x00) == CardEvent::None);
}
```

Run: `npm run test:native`
Expected: 3 tests passing

**Step 3: Add test for no change (present)**

```cpp
SECTION("returns None when state unchanged - card present") {
    REQUIRE(DetectCardStateChange(PCSC_STATE_PRESENT, PCSC_STATE_PRESENT) == CardEvent::None);
}
```

Run: `npm run test:native`
Expected: 4 tests passing

**Step 4: Add test for other flags on insertion**

```cpp
SECTION("ignores other state flags on insertion") {
    uint32_t OTHER_FLAGS = 0x00000102;
    REQUIRE(DetectCardStateChange(OTHER_FLAGS, OTHER_FLAGS | PCSC_STATE_PRESENT) == CardEvent::Inserted);
}
```

Run: `npm run test:native`
Expected: 5 tests passing

**Step 5: Add test for other flags on removal**

```cpp
SECTION("ignores other state flags on removal") {
    uint32_t OTHER_FLAGS = 0x00000102;
    REQUIRE(DetectCardStateChange(OTHER_FLAGS | PCSC_STATE_PRESENT, OTHER_FLAGS) == CardEvent::Removed);
}
```

Run: `npm run test:native`
Expected: 6 tests passing

**Step 6: Commit all tests**

Run:
```bash
git add src/test/reader_state_utils_test.cpp
git commit -m "test: add complete test coverage for DetectCardStateChange"
```

---

### Task 10: Refactor reader_monitor.cpp

**Files:**
- Modify: `src/reader_monitor.cpp`

**Step 1: Add include**

At top of file after other includes:
```cpp
#include "reader_state_utils.h"
```

**Step 2: Refactor periodic refresh (around line 187-205)**

Replace:
```cpp
bool wasPresent = (oldState & SCARD_STATE_PRESENT) != 0;
bool isPresent = (newState & SCARD_STATE_PRESENT) != 0;

if (wasPresent != isPresent) {
    // ... emit event code
    if (isPresent) {
        EmitEvent("card-inserted", name, newState, atr);
    } else {
        EmitEvent("card-removed", name, newState, {});
    }
}
```

With:
```cpp
CardEvent event = DetectCardStateChange(oldState, newState);
if (event == CardEvent::Inserted) {
    EmitEvent("card-inserted", name, newState, atr);
} else if (event == CardEvent::Removed) {
    EmitEvent("card-removed", name, newState, {});
}
```

**Step 3: Refactor timeout check (around line 282-299)**

Same pattern as Step 2.

**Step 4: Refactor normal state change (around line 372-390)**

Same pattern as Step 2.

**Step 5: Run all tests**

Run: `npm run test:native && npm run test:unit`
Expected: All tests passing

**Step 6: Commit refactor**

Run:
```bash
git add src/reader_monitor.cpp
git commit -m "refactor: use DetectCardStateChange in reader_monitor"
```

---

### Task 11: Update CI

**Files:**
- Modify: `.github/workflows/test.yml`

**Step 1: Add native test step**

After "Run unit tests with coverage" step, add:
```yaml
- name: Run native C++ tests
  run: npm run test:native
```

**Step 2: Commit**

Run:
```bash
git add .github/workflows/test.yml
git commit -m "ci: add native C++ test step"
```

---

### Task 12: Create Pull Request

**Step 1: Push branch**

Run:
```bash
git push -u origin feat/native-cpp-tests-117
```

**Step 2: Create PR**

Run:
```bash
gh pr create --title "feat: add native C++ unit tests for state tracking logic" --body "## Summary

- Extracts state detection logic into pure function \`DetectCardStateChange\`
- Adds Catch2 test framework
- Adds 6 unit tests covering all state transitions
- Refactors \`reader_monitor.cpp\` to use the extracted function
- Adds CI step to run native tests

Closes #117

## Test plan

- [x] All 6 native C++ tests pass
- [x] Existing TypeScript unit tests pass
- [x] Build succeeds on all platforms (CI)
- [x] \`npm run test:native\` runs successfully"
```

**Step 3: Note PR URL**

---

### Task 13: Verify CI Passes

**Step 1: Check CI status**

Run: `gh pr checks`
Expected: All checks passing

---
