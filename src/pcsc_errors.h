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

    // Extended mappings - numeric literals because macro availability differs
    // between winscard.h and pcsc-lite while the code values are shared
    // (MS SCARD error space). Note: 0x8010001F is SCARD_E_UNEXPECTED on
    // Windows but SCARD_E_UNSUPPORTED_FEATURE on pcsc-lite.
    if (ucode == 0x80100007) return "Waited too long";                        // SCARD_F_WAITED_TOO_LONG
    if (ucode == 0x80100014) return "Unknown internal error";                 // SCARD_F_UNKNOWN_ERROR
    if (ucode == 0x80100018) return "Service shutting down";                  // SCARD_P_SHUTDOWN
    if (ucode == 0x8010001A) return "Reader unsupported";                     // SCARD_E_READER_UNSUPPORTED
    if (ucode == 0x8010001B) return "Duplicate reader name";                  // SCARD_E_DUPLICATE_READER
    if (ucode == 0x8010001C) return "Card unsupported";                       // SCARD_E_CARD_UNSUPPORTED
    if (ucode == 0x8010001F) return "Unexpected error / unsupported feature"; // SCARD_E_UNEXPECTED (win) / SCARD_E_UNSUPPORTED_FEATURE (pcsc-lite)
    if (ucode == 0x80100020) return "ICC installation error";                 // SCARD_E_ICC_INSTALLATION
    if (ucode == 0x80100021) return "ICC create-order error";                 // SCARD_E_ICC_CREATEORDER
    if (ucode == 0x80100022) return "Unsupported feature";                    // SCARD_E_UNSUPPORTED_FEATURE (win)
    if (ucode == 0x80100023) return "Directory not found";                    // SCARD_E_DIR_NOT_FOUND
    if (ucode == 0x80100024) return "File not found";                         // SCARD_E_FILE_NOT_FOUND
    if (ucode == 0x80100025) return "No directory";                           // SCARD_E_NO_DIR
    if (ucode == 0x80100026) return "No file";                                // SCARD_E_NO_FILE
    if (ucode == 0x80100027) return "Access denied";                          // SCARD_E_NO_ACCESS
    if (ucode == 0x80100028) return "Too many writes";                        // SCARD_E_WRITE_TOO_MANY
    if (ucode == 0x80100029) return "Bad seek";                               // SCARD_E_BAD_SEEK
    if (ucode == 0x8010002A) return "Invalid CHV/PIN";                        // SCARD_E_INVALID_CHV
    if (ucode == 0x8010002B) return "Unknown resource manager";               // SCARD_E_UNKNOWN_RES_MNG
    if (ucode == 0x8010002C) return "No such certificate";                    // SCARD_E_NO_SUCH_CERTIFICATE
    if (ucode == 0x8010002D) return "Certificate unavailable";                // SCARD_E_CERTIFICATE_UNAVAILABLE
    if (ucode == 0x8010002F) return "Communication data lost";                // SCARD_E_COMM_DATA_LOST
    if (ucode == 0x80100030) return "No key container";                       // SCARD_E_NO_KEY_CONTAINER
    if (ucode == 0x80100031) return "Server too busy";                        // SCARD_E_SERVER_TOO_BUSY
    if (ucode == 0x8010006A) return "Security violation";                     // SCARD_W_SECURITY_VIOLATION
    if (ucode == 0x8010006B) return "Wrong CHV/PIN";                          // SCARD_W_WRONG_CHV
    if (ucode == 0x8010006C) return "CHV/PIN blocked";                        // SCARD_W_CHV_BLOCKED
    if (ucode == 0x8010006D) return "End of file";                            // SCARD_W_EOF
    if (ucode == 0x8010006E) return "Cancelled by user";                      // SCARD_W_CANCELLED_BY_USER
    if (ucode == 0x8010006F) return "Card not authenticated";                 // SCARD_W_CARD_NOT_AUTHENTICATED

    return "Unknown PC/SC error";
}

// Get the error code value
inline LONG GetPCSCErrorCode(LONG code) {
    return code;
}
