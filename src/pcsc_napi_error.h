#pragma once

#include <napi.h>
#include <string>
#include "pcsc_errors.h"

// Per-instance addon state (each worker_thread loads its own instance)
struct AddonData {
    // (message, code) => Error, registered by lib/index.ts via
    // setErrorFactory() so native failures arrive as the typed PCSCError
    // classes from lib/errors.ts
    Napi::FunctionReference errorFactory;
};

// Build a JS Error for a PC/SC failure. The code is exposed unsigned
// (e.g. 0x80100069) to match the constants in lib/errors.ts; message
// defaults to the description of the code.
inline Napi::Error NewPCSCError(Napi::Env env, LONG code, const char* message = nullptr) {
    std::string text = message != nullptr ? message : GetPCSCErrorString(code);
    Napi::Number ucode = Napi::Number::New(env, static_cast<double>(static_cast<DWORD>(code)));

    AddonData* data = env.GetInstanceData<AddonData>();
    if (data != nullptr && !data->errorFactory.IsEmpty()) {
        try {
            Napi::Value err = data->errorFactory.Call({Napi::String::New(env, text), ucode});
            if (err.IsObject()) {
                return Napi::Error(env, err);
            }
        } catch (const Napi::Error&) {
            // Factory threw - fall back to a plain coded Error
        }
    }

    Napi::Error err = Napi::Error::New(env, text);
    err.Set("code", ucode);
    return err;
}

// For a handle this library already knows is unusable (disconnected card,
// closed context): coded as the SCARD_E_INVALID_HANDLE PC/SC would return
inline Napi::Error NewInvalidHandleError(Napi::Env env, const char* message) {
    return NewPCSCError(env, static_cast<LONG>(SCARD_E_INVALID_HANDLE), message);
}
