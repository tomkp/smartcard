#include <napi.h>
#include "pcsc_context.h"
#include "pcsc_reader.h"
#include "pcsc_card.h"
#include "reader_monitor.h"
#include "pcsc_napi_error.h"
#include "platform/pcsc.h"

// setErrorFactory(fn): fn(message, code) builds the Error that native
// PC/SC failures throw or reject with
static Napi::Value SetErrorFactory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected error factory function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    env.GetInstanceData<AddonData>()->errorFactory =
        Napi::Persistent(info[0].As<Napi::Function>());
    return env.Undefined();
}

// Export PC/SC constants
void ExportConstants(Napi::Env env, Napi::Object exports) {
    // Share modes
    exports.Set("SCARD_SHARE_EXCLUSIVE", Napi::Number::New(env, SCARD_SHARE_EXCLUSIVE));
    exports.Set("SCARD_SHARE_SHARED", Napi::Number::New(env, SCARD_SHARE_SHARED));
    exports.Set("SCARD_SHARE_DIRECT", Napi::Number::New(env, SCARD_SHARE_DIRECT));

    // Protocols
    exports.Set("SCARD_PROTOCOL_T0", Napi::Number::New(env, SCARD_PROTOCOL_T0));
    exports.Set("SCARD_PROTOCOL_T1", Napi::Number::New(env, SCARD_PROTOCOL_T1));
    exports.Set("SCARD_PROTOCOL_RAW", Napi::Number::New(env, SCARD_PROTOCOL_RAW));
    exports.Set("SCARD_PROTOCOL_UNDEFINED", Napi::Number::New(env, SCARD_PROTOCOL_UNDEFINED));

    // Disposition
    exports.Set("SCARD_LEAVE_CARD", Napi::Number::New(env, SCARD_LEAVE_CARD));
    exports.Set("SCARD_RESET_CARD", Napi::Number::New(env, SCARD_RESET_CARD));
    exports.Set("SCARD_UNPOWER_CARD", Napi::Number::New(env, SCARD_UNPOWER_CARD));
    exports.Set("SCARD_EJECT_CARD", Napi::Number::New(env, SCARD_EJECT_CARD));

    // State flags
    exports.Set("SCARD_STATE_UNAWARE", Napi::Number::New(env, SCARD_STATE_UNAWARE));
    exports.Set("SCARD_STATE_IGNORE", Napi::Number::New(env, SCARD_STATE_IGNORE));
    exports.Set("SCARD_STATE_CHANGED", Napi::Number::New(env, SCARD_STATE_CHANGED));
    exports.Set("SCARD_STATE_UNKNOWN", Napi::Number::New(env, SCARD_STATE_UNKNOWN));
    exports.Set("SCARD_STATE_UNAVAILABLE", Napi::Number::New(env, SCARD_STATE_UNAVAILABLE));
    exports.Set("SCARD_STATE_EMPTY", Napi::Number::New(env, SCARD_STATE_EMPTY));
    exports.Set("SCARD_STATE_PRESENT", Napi::Number::New(env, SCARD_STATE_PRESENT));
    exports.Set("SCARD_STATE_ATRMATCH", Napi::Number::New(env, SCARD_STATE_ATRMATCH));
    exports.Set("SCARD_STATE_EXCLUSIVE", Napi::Number::New(env, SCARD_STATE_EXCLUSIVE));
    exports.Set("SCARD_STATE_INUSE", Napi::Number::New(env, SCARD_STATE_INUSE));
    exports.Set("SCARD_STATE_MUTE", Napi::Number::New(env, SCARD_STATE_MUTE));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Freed by node-addon-api's default finalizer when the env shuts down
    env.SetInstanceData(new AddonData());
    exports.Set("setErrorFactory", Napi::Function::New(env, SetErrorFactory, "setErrorFactory"));

    // Initialize wrapper classes
    PCSCContext::Init(env, exports);
    PCSCReader::Init(env, exports);
    PCSCCard::Init(env, exports);
    ReaderMonitor::Init(env, exports);

    // Export constants
    ExportConstants(env, exports);

    return exports;
}

NODE_API_MODULE(smartcard_napi, Init)
