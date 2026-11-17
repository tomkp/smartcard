// src/reader_state_utils.h
#pragma once
#include <cstdint>

namespace smartcard {

// Replaced: a card was present at both readings, but it was taken out and a
// card (maybe the same one) put back in between them
enum class CardEvent { None, Inserted, Removed, Replaced };

// pcsc-lite counts card insertions and removals per reader in bits 16-31 of
// dwEventState ("can be used to detect a card removal/insertion between two
// calls to SCardGetStatusChange()", winscard_clnt.c)
inline uint64_t CardEventCount(uint64_t state) {
    return (state >> 16) & 0xFFFF;
}

// presentMask is the platform's SCARD_STATE_PRESENT bit, passed in by the
// caller. This header deliberately includes no PC/SC headers so the logic is
// testable in isolation - receiving the mask instead of mirroring its value
// means there is no hand-typed copy of the constant to drift out of sync
// (the bug class behind the original 0x10/0x20 inversion).
//
// countsEvents: the platform keeps the card event counter above. Without
// it, a card swapped between two readings is indistinguishable from the
// same card staying put.
inline CardEvent DetectCardStateChange(uint64_t oldState, uint64_t newState,
                                       uint64_t presentMask, bool countsEvents = false) {
    bool wasPresent = (oldState & presentMask) != 0;
    bool isPresent = (newState & presentMask) != 0;

    if (!wasPresent && isPresent) return CardEvent::Inserted;
    if (wasPresent && !isPresent) return CardEvent::Removed;
    if (wasPresent && countsEvents &&
        CardEventCount(oldState) != CardEventCount(newState)) {
        return CardEvent::Replaced;
    }
    return CardEvent::None;
}

}  // namespace smartcard
