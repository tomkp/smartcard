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
