#pragma once

#include "platform/pcsc.h"

// Convert PC/SC error codes to human-readable strings
// Using explicit casts to handle unsigned->signed on macOS
inline const char* GetPCSCErrorString(LONG code) {
    // Cast to unsigned for comparison to avoid sign issues
    DWORD ucode = static_cast<DWORD>(code);

    if (ucode == SCARD_S_SUCCESS) return "Success";
    if (ucode == SCARD_E_CANCELLED) return "Operation cancelled";
    if (ucode == SCARD_E_CANT_DISPOSE) return "Cannot dispose handle";
    if (ucode == SCARD_E_INSUFFICIENT_BUFFER) return "Insufficient buffer";
    if (ucode == SCARD_E_INVALID_ATR) return "Invalid ATR";
    if (ucode == SCARD_E_INVALID_HANDLE) return "Invalid handle";
    if (ucode == SCARD_E_INVALID_PARAMETER) return "Invalid parameter";
    if (ucode == SCARD_E_INVALID_TARGET) return "Invalid target";
    if (ucode == SCARD_E_INVALID_VALUE) return "Invalid value";
    if (ucode == SCARD_E_NO_MEMORY) return "Not enough memory";
    if (ucode == SCARD_E_NO_SERVICE) return "PC/SC service not running";
    if (ucode == SCARD_E_NO_SMARTCARD) return "No smart card present";
    if (ucode == SCARD_E_NOT_READY) return "Reader not ready";
    if (ucode == SCARD_E_NOT_TRANSACTED) return "Transaction failed";
    if (ucode == SCARD_E_PCI_TOO_SMALL) return "PCI struct too small";
    if (ucode == SCARD_E_PROTO_MISMATCH) return "Protocol mismatch";
    if (ucode == SCARD_E_READER_UNAVAILABLE) return "Reader unavailable";
    if (ucode == SCARD_E_SERVICE_STOPPED) return "PC/SC service stopped";
    if (ucode == SCARD_E_SHARING_VIOLATION) return "Sharing violation";
    if (ucode == SCARD_E_SYSTEM_CANCELLED) return "System cancelled operation";
    if (ucode == SCARD_E_TIMEOUT) return "Operation timed out";
    if (ucode == SCARD_E_UNKNOWN_CARD) return "Unknown card type";
    if (ucode == SCARD_E_UNKNOWN_READER) return "Unknown reader";
    if (ucode == SCARD_E_NO_READERS_AVAILABLE) return "No readers available";
    if (ucode == SCARD_F_COMM_ERROR) return "Communication error";
    if (ucode == SCARD_F_INTERNAL_ERROR) return "Internal error";
    if (ucode == SCARD_W_REMOVED_CARD) return "Card was removed";
    if (ucode == SCARD_W_RESET_CARD) return "Card was reset";
    if (ucode == SCARD_W_UNPOWERED_CARD) return "Card is unpowered";
    if (ucode == SCARD_W_UNRESPONSIVE_CARD) return "Card is unresponsive";
    if (ucode == SCARD_W_UNSUPPORTED_CARD) return "Card is not supported";

    return "Unknown PC/SC error";
}

// Get the error code value
inline LONG GetPCSCErrorCode(LONG code) {
    return code;
}
