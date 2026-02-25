// src/test/reader_state_utils_test.cpp
#include "catch.hpp"
#include "reader_state_utils.h"

TEST_CASE("DetectCardStateChange", "[state]") {
    SECTION("returns Inserted when card becomes present") {
        REQUIRE(DetectCardStateChange(0x00, PCSC_STATE_PRESENT) == CardEvent::Inserted);
    }

    SECTION("returns Removed when card becomes absent") {
        REQUIRE(DetectCardStateChange(PCSC_STATE_PRESENT, 0x00) == CardEvent::Removed);
    }

    SECTION("returns None when state unchanged - no card") {
        REQUIRE(DetectCardStateChange(0x00, 0x00) == CardEvent::None);
    }

    SECTION("returns None when state unchanged - card present") {
        REQUIRE(DetectCardStateChange(PCSC_STATE_PRESENT, PCSC_STATE_PRESENT) == CardEvent::None);
    }

    SECTION("ignores other state flags on insertion") {
        uint32_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS, OTHER_FLAGS | PCSC_STATE_PRESENT) == CardEvent::Inserted);
    }

    SECTION("ignores other state flags on removal") {
        uint32_t OTHER_FLAGS = 0x00000102;
        REQUIRE(DetectCardStateChange(OTHER_FLAGS | PCSC_STATE_PRESENT, OTHER_FLAGS) == CardEvent::Removed);
    }
}
