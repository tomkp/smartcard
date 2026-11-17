#pragma once

// Cross-platform PC/SC header
// Normalizes differences between Windows, macOS, and Linux PC/SC libraries

#ifdef _WIN32
    #include <winscard.h>
    #pragma comment(lib, "winscard.lib")
#elif __APPLE__
    #include <PCSC/winscard.h>
    #include <PCSC/wintypes.h>
#else
    // Linux
    #include <winscard.h>
    #include <reader.h>
#endif

// Normalize error codes that may be missing on some platforms
#ifndef SCARD_E_NO_READERS_AVAILABLE
    #define SCARD_E_NO_READERS_AVAILABLE 0x8010002E
#endif

#ifndef SCARD_E_NO_SERVICE
    #define SCARD_E_NO_SERVICE 0x8010001D
#endif

// Windows uses LPTSTR which can be wide, macOS/Linux use char*
// This ensures we work with char* consistently
#ifdef _WIN32
    #ifndef SCARD_AUTOALLOCATE
        #define SCARD_AUTOALLOCATE ((DWORD)-1)
    #endif
#endif

// MAX_ATR_SIZE may not be defined on some Windows SDK versions
#ifndef MAX_ATR_SIZE
    #define MAX_ATR_SIZE 33
#endif

// pcsc-lite keeps a per-reader card insertion/removal counter in the upper
// 16 bits of dwEventState. Windows and macOS don't document that word for
// reader entries (Windows uses it for the reader count on the PnP entry),
// so it is only relied on with pcsc-lite.
#if defined(_WIN32) || defined(__APPLE__)
    #define SMARTCARD_PCSC_COUNTS_CARD_EVENTS false
#else
    #define SMARTCARD_PCSC_COUNTS_CARD_EVENTS true
#endif

// pcsc-lite 2.3.0 and later put a count of reader events (readers added or
// removed) in the upper 16 bits of the "\\?PnP?\Notification" entry's
// dwEventState. Passed back as its dwCurrentState, the next call returns at
// once if readers changed in between. Older pcsc-lite leaves the word 0,
// and a 0 count turns the check off. Windows reports the reader count there
// instead, untested here; macOS doesn't support the PnP entry.
#if defined(_WIN32) || defined(__APPLE__)
    #define SMARTCARD_PCSC_PNP_COUNTS_READER_EVENTS false
#else
    #define SMARTCARD_PCSC_PNP_COUNTS_READER_EVENTS true
#endif

// Helper macro for unused parameters
#define PCSC_UNUSED(x) (void)(x)
