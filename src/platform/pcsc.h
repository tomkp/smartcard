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

// Helper macro for unused parameters
#define PCSC_UNUSED(x) (void)(x)
