// src/test/reader_state_utils_test.cpp
#include "catch.hpp"
#include "reader_state_utils.h"

using smartcard::CardEvent;
using smartcard::DetectCardStateChange;
using smartcard::DetectCardStateChangeAcrossOutage;

// The production caller passes the platform's SCARD_STATE_PRESENT (0x20 on
// Windows, macOS, and pcsc-lite); the helper itself is mask-agnostic, which
// is what these tests exercise.
namespace {
constexpr uint64_t PRESENT = 0x00000020;
}

TEST_CASE("DetectCardStateChange", "[state]") {
    SECTION("returns Inserted when card becomes present") {
        REQUIRE(DetectCardStateChange(0x00, PRESENT, PRESENT, false) == CardEvent::Inserted);
    }

    SECTION("returns Removed when card becomes absent") {
        REQUIRE(DetectCardStateChange(PRESENT, 0x00, PRESENT, false) == CardEvent::Removed);
    }

    SECTION("returns None when state unchanged - no card") {
        REQUIRE(DetectCardStateChange(0x00, 0x00, PRESENT, false) == CardEvent::None);
    }

    SECTION("returns None when state unchanged - card present") {
        REQUIRE(DetectCardStateChange(PRESENT, PRESENT, PRESENT, false) == CardEvent::None);
    }

    SECTION("ignores other state flags on insertion") {
        uint64_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS, OTHER_FLAGS | PRESENT, PRESENT, false) == CardEvent::Inserted);
    }

    SECTION("ignores other state flags on removal") {
        uint64_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS | PRESENT, OTHER_FLAGS, PRESENT, false) == CardEvent::Removed);
    }

    SECTION("only the given mask bit decides presence") {
        // A transition on some other bit is not a card event
        REQUIRE(DetectCardStateChange(0x00, 0x10, PRESENT, false) == CardEvent::None);
        // The same transition IS a card event when that bit is the mask
        REQUIRE(DetectCardStateChange(0x00, 0x10, 0x10, false) == CardEvent::Inserted);
    }

    SECTION("handles masks above 32 bits without truncation") {
        // pcsc-lite's DWORD is 64-bit on Linux; a high bit must survive
        uint64_t HIGH_BIT = 1ULL << 40;
        REQUIRE(DetectCardStateChange(0x00, HIGH_BIT, HIGH_BIT, false) == CardEvent::Inserted);
        REQUIRE(DetectCardStateChange(HIGH_BIT, 0x00, HIGH_BIT, false) == CardEvent::Removed);
    }
}

TEST_CASE("DetectCardStateChange with a card event counter", "[state]") {
    // pcsc-lite's counter lives in bits 16-31 and counts insertions and
    // removals; build states with a given count
    auto withCount = [](uint64_t state, uint64_t count) { return state | (count << 16); };

    SECTION("returns Replaced when the count moved with a card present throughout") {
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(PRESENT, 3), PRESENT, true)
                == CardEvent::Replaced);
    }

    SECTION("returns None for the same move when the platform doesn't count") {
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(PRESENT, 3), PRESENT, false)
                == CardEvent::None);
    }

    SECTION("returns None when the count is unchanged") {
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 3), withCount(PRESENT, 3), PRESENT, true)
                == CardEvent::None);
    }

    SECTION("returns None when a card came and went with none present at either read") {
        REQUIRE(DetectCardStateChange(withCount(0, 2), withCount(0, 4), PRESENT, true)
                == CardEvent::None);
    }

    SECTION("insertion and removal still win over the count") {
        REQUIRE(DetectCardStateChange(withCount(0, 2), withCount(PRESENT, 5), PRESENT, true)
                == CardEvent::Inserted);
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(0, 4), PRESENT, true)
                == CardEvent::Removed);
    }

    SECTION("a counter that wrapped still counts as moved") {
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 0xFFFF), withCount(PRESENT, 1), PRESENT, true)
                == CardEvent::Replaced);
    }

    SECTION("a counter pcscd restarted is not a swap") {
        // Reader plugged back in, or pcscd restarted, with the card still in
        // it: pcscd starts the counter again at 0 without counting that card
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(PRESENT, 0), PRESENT, true)
                == CardEvent::None);
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 7), withCount(PRESENT, 2), PRESENT, true)
                == CardEvent::None);
    }

    SECTION("events counted after a restart are a swap again") {
        // Card present at count 0, then taken out and put back: 2
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 0), withCount(PRESENT, 2), PRESENT, true)
                == CardEvent::Replaced);
    }

    SECTION("only bits 16-31 are the counter") {
        // Other state flags, or bits above 32 on 64-bit DWORDs, are not counts
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(PRESENT | 0x100, 1), PRESENT, true)
                == CardEvent::None);
        REQUIRE(DetectCardStateChange(withCount(PRESENT, 1), withCount(PRESENT, 1) | (1ULL << 40), PRESENT, true)
                == CardEvent::None);
    }
}

TEST_CASE("DetectCardStateChangeAcrossOutage", "[state]") {
    auto withCount = [](uint64_t state, uint64_t count) { return state | (count << 16); };

    SECTION("a card in the reader before and after is replaced: its handle died") {
        // pcscd restarted with the card still in: counter back to 0
        REQUIRE(DetectCardStateChangeAcrossOutage(withCount(PRESENT, 3), withCount(PRESENT, 0), PRESENT)
                == CardEvent::Replaced);
        // Same counter, presence unchanged: still a dead handle
        REQUIRE(DetectCardStateChangeAcrossOutage(PRESENT, PRESENT, PRESENT) == CardEvent::Replaced);
    }

    SECTION("otherwise as without an outage") {
        REQUIRE(DetectCardStateChangeAcrossOutage(0x00, PRESENT, PRESENT) == CardEvent::Inserted);
        REQUIRE(DetectCardStateChangeAcrossOutage(withCount(PRESENT, 3), 0x00, PRESENT) == CardEvent::Removed);
        REQUIRE(DetectCardStateChangeAcrossOutage(0x00, 0x00, PRESENT) == CardEvent::None);
    }
}
