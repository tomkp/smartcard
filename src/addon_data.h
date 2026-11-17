#pragma once

#include <napi.h>

// Per-environment addon state: the main thread and each worker_thread that
// loads the addon get their own, set up in Init (addon.cpp) and freed with
// that environment.
//
// No JS reference may be held in a static. A static is shared by all the
// environments that load the addon, so each load overwrote the last one's
// reference (deleting it from the wrong thread), and after a worker exited
// the others used a reference into that dead environment. Long-lived
// references that belong to the environment go here; references owned by
// one object (an async worker's, a monitor's tsfn) stay with that object.
struct AddonData {
    // (message, code) => Error, registered by lib/index.ts via
    // setErrorFactory() so native failures arrive as the typed PCSCError
    // classes from lib/errors.ts
    Napi::FunctionReference errorFactory;
    // Classes the addon instantiates itself (listReaders, connect)
    Napi::FunctionReference readerConstructor;
    Napi::FunctionReference cardConstructor;
};
