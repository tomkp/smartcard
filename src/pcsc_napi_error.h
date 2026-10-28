#pragma once

#include <napi.h>
#include "pcsc_errors.h"

// Build a JS Error for a PC/SC failure with the numeric code attached as
// err.code, so the JS layer can map it onto its typed error hierarchy
// (createPCSCError in lib/errors.ts). The code is exposed unsigned
// (e.g. 0x80100069) to match the constants used there.
inline Napi::Error NewPCSCError(Napi::Env env, LONG code) {
    Napi::Error err = Napi::Error::New(env, GetPCSCErrorString(code));
    err.Set("code", Napi::Number::New(env, static_cast<double>(static_cast<DWORD>(code))));
    return err;
}
