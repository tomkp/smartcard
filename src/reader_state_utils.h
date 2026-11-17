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

// Did pcsc-lite count card events between two readings? The counter only
// goes up (wrapping at 16 bits), but starts again at 0 when pcscd re-creates
// the reader - plugged back in, or pcscd restarted - without counting a card
// that is already in it. So only a forward move counts: a restarted counter
// reads as a large backward jump, and is not mistaken for a swap.
inline bool CardEventsCountedBetween(uint64_t oldState, uint64_t newState) {
    uint64_t forward = (CardEventCount(newState) - CardEventCount(oldState)) & 0xFFFF;
    return forward != 0 && forward < 0x8000;
}

// presentMask is the platform's SCARD_STATE_PRESENT bit, passed in by the
// caller. This header deliberately includes no PC/SC headers so the logic is
// testable in isolation - receiving the mask instead of mirroring its value
// means there is no hand-typed copy of the constant to drift out of sync
// (the bug class behind the original 0x10/0x20 inversion).
//
// countsEvents: the platform keeps the card event counter above
// (SMARTCARD_PCSC_COUNTS_CARD_EVENTS). Without it, a card swapped between
// two readings is indistinguishable from the same card staying put.
inline CardEvent DetectCardStateChange(uint64_t oldState, uint64_t newState,
                                       uint64_t presentMask, bool countsEvents) {
    bool wasPresent = (oldState & presentMask) != 0;
    bool isPresent = (newState & presentMask) != 0;

    if (!wasPresent && isPresent) return CardEvent::Inserted;
    if (wasPresent && !isPresent) return CardEvent::Removed;
    if (wasPresent && countsEvents && CardEventsCountedBetween(oldState, newState)) {
        return CardEvent::Replaced;
    }
    return CardEvent::None;
}

// The same, comparing a reading from before a PC/SC service outage with
// one from after it. Every card handle opened before the outage died with
// it, so a card present at both readings is reported as Replaced: JS is
// told the old card is gone and connects to it again. That also covers a
// card swapped during the outage, which presence and pcscd's restarted
// counters can't show.
inline CardEvent DetectCardStateChangeAcrossOutage(uint64_t oldState, uint64_t newState,
                                                   uint64_t presentMask) {
    bool wasPresent = (oldState & presentMask) != 0;
    bool isPresent = (newState & presentMask) != 0;
    if (wasPresent && isPresent) return CardEvent::Replaced;
    return DetectCardStateChange(oldState, newState, presentMask, false);
}

}  // namespace smartcard
