// src/reader_state_utils.h
#pragma once
#include <cstdint>

namespace smartcard {

enum class CardEvent { None, Inserted, Removed };

// presentMask is the platform's SCARD_STATE_PRESENT bit, passed in by the
// caller. This header deliberately includes no PC/SC headers so the logic is
// testable in isolation - receiving the mask instead of mirroring its value
// means there is no hand-typed copy of the constant to drift out of sync
// (the bug class behind the original 0x10/0x20 inversion).
inline CardEvent DetectCardStateChange(uint64_t oldState, uint64_t newState,
                                       uint64_t presentMask) {
    bool wasPresent = (oldState & presentMask) != 0;
    bool isPresent = (newState & presentMask) != 0;

    if (!wasPresent && isPresent) return CardEvent::Inserted;
    if (wasPresent && !isPresent) return CardEvent::Removed;
    return CardEvent::None;
}

}  // namespace smartcard
