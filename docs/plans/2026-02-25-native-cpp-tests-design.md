# Native C++ Unit Tests Design

## Overview

Add native C++ unit tests for the Issue #111 state tracking logic using Catch2.

## Problem

PR #112 fixed Windows card event reliability issues, but the tests added only exercise the JavaScript layer with mocks. They don't test the actual C++ logic that was fixed.

## Approach

Extract the core state detection logic from `reader_monitor.cpp` into pure functions that can be tested without mocking PC/SC APIs.

## File Structure

```
src/
├── reader_state_utils.h           # Pure functions (header-only)
├── reader_monitor.cpp             # Modified to use reader_state_utils.h
└── test/
    ├── catch.hpp                  # Catch2 single-header
    ├── reader_state_utils_test.cpp
    └── test_main.cpp
```

## API

```cpp
// reader_state_utils.h
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

## Test Cases

1. Returns Inserted when card becomes present
2. Returns Removed when card becomes absent
3. Returns None when state unchanged (no card)
4. Returns None when state unchanged (card present)
5. Ignores other state flags (insertion)
6. Ignores other state flags (removal)

## Build System

- Add `smartcard_tests` target to `binding.gyp`
- No PC/SC library linking (pure C++ only)
- Add `test:native` script to package.json
- Add CI step to run native tests

## Refactoring

Replace duplicated state detection logic at three locations in `reader_monitor.cpp`:
- Line ~190: Periodic refresh
- Line ~285: Timeout fresh state check
- Line ~375: Normal state change processing

## Scope Limitations

These tests verify the detection logic works correctly. The actual Issue #111 fix was about using map-based lookup instead of array indices - that architectural change is not directly unit-testable but is validated by the existing integration tests.
