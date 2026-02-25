// src/test/reader_state_utils_test.cpp
#include "catch.hpp"
#include "reader_state_utils.h"

TEST_CASE("DetectCardStateChange", "[state]") {
    SECTION("returns Inserted when card becomes present") {
        REQUIRE(DetectCardStateChange(0x00, PCSC_STATE_PRESENT) == CardEvent::Inserted);
    }
}
