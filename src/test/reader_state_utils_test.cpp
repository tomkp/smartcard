// src/test/reader_state_utils_test.cpp
#include "catch.hpp"
#include "reader_state_utils.h"

using smartcard::CardEvent;
using smartcard::DetectCardStateChange;

// The production caller passes the platform's SCARD_STATE_PRESENT (0x20 on
// Windows, macOS, and pcsc-lite); the helper itself is mask-agnostic, which
// is what these tests exercise.
namespace {
constexpr uint64_t PRESENT = 0x00000020;
}

TEST_CASE("DetectCardStateChange", "[state]") {
    SECTION("returns Inserted when card becomes present") {
        REQUIRE(DetectCardStateChange(0x00, PRESENT, PRESENT) == CardEvent::Inserted);
    }

    SECTION("returns Removed when card becomes absent") {
        REQUIRE(DetectCardStateChange(PRESENT, 0x00, PRESENT) == CardEvent::Removed);
    }

    SECTION("returns None when state unchanged - no card") {
        REQUIRE(DetectCardStateChange(0x00, 0x00, PRESENT) == CardEvent::None);
    }

    SECTION("returns None when state unchanged - card present") {
        REQUIRE(DetectCardStateChange(PRESENT, PRESENT, PRESENT) == CardEvent::None);
    }

    SECTION("ignores other state flags on insertion") {
        uint64_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS, OTHER_FLAGS | PRESENT, PRESENT) == CardEvent::Inserted);
    }

    SECTION("ignores other state flags on removal") {
        uint64_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS | PRESENT, OTHER_FLAGS, PRESENT) == CardEvent::Removed);
    }

    SECTION("only the given mask bit decides presence") {
        // A transition on some other bit is not a card event
        REQUIRE(DetectCardStateChange(0x00, 0x10, PRESENT) == CardEvent::None);
        // The same transition IS a card event when that bit is the mask
        REQUIRE(DetectCardStateChange(0x00, 0x10, 0x10) == CardEvent::Inserted);
    }

    SECTION("handles masks above 32 bits without truncation") {
        // pcsc-lite's DWORD is 64-bit on Linux; a high bit must survive
        uint64_t HIGH_BIT = 1ULL << 40;
        REQUIRE(DetectCardStateChange(0x00, HIGH_BIT, HIGH_BIT) == CardEvent::Inserted);
        REQUIRE(DetectCardStateChange(HIGH_BIT, 0x00, HIGH_BIT) == CardEvent::Removed);
    }
}
