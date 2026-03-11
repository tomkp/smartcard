#include "pcsc_context.h"
#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include "async_workers.h"
#include <cstring>

Napi::FunctionReference PCSCContext::constructor;

Napi::Object PCSCContext::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Context", {
        InstanceMethod("listReaders", &PCSCContext::ListReaders),
        InstanceMethod("waitForChange", &PCSCContext::WaitForChange),
        InstanceMethod("cancel", &PCSCContext::Cancel),
        InstanceMethod("close", &PCSCContext::Close),
        InstanceAccessor("isValid", &PCSCContext::GetIsValid, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Context", func);
    return exports;
}

Napi::Object PCSCContext::NewInstance(Napi::Env env) {
    return constructor.New({});
}

PCSCContext::PCSCContext(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCContext>(info), context_(0), valid_(false) {

    Napi::Env env = info.Env();

    // Establish PC/SC context
    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context_);

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
        return;
    }

    valid_ = true;
}

PCSCContext::~PCSCContext() {
    if (valid_ && context_ != 0) {
        SCardReleaseContext(context_);
        valid_ = false;
        context_ = 0;
    }
}

Napi::Value PCSCContext::ListReaders(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!valid_) {
        Napi::Error::New(env, "Context is not valid").ThrowAsJavaScriptException();
        return env.Null();
    }

    // First call to get buffer size
    DWORD readersLen = 0;
    LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

    if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE)) {
        // No readers - return empty array
        return Napi::Array::New(env, 0);
    }

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Allocate buffer and get reader names
    std::vector<char> readersBuffer(readersLen);
    result = SCardListReaders(context_, nullptr, readersBuffer.data(), &readersLen);

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Parse multi-string result (null-separated, double-null terminated)
    std::vector<std::string> readerNames;
    const char* p = readersBuffer.data();
    while (*p != '\0') {
        readerNames.push_back(std::string(p));
        p += strlen(p) + 1;
    }

    // Get initial state for each reader
    std::vector<SCARD_READERSTATE> states(readerNames.size());
    for (size_t i = 0; i < readerNames.size(); i++) {
        states[i].szReader = readerNames[i].c_str();
        states[i].dwCurrentState = SCARD_STATE_UNAWARE;
    }

    // Get current state (non-blocking with 0 timeout)
    result = SCardGetStatusChange(context_, 0, states.data(), states.size());

    // Create Reader objects
    Napi::Array readers = Napi::Array::New(env, readerNames.size());
    for (size_t i = 0; i < readerNames.size(); i++) {
        std::vector<uint8_t> atr;
        if (result == SCARD_S_SUCCESS && states[i].cbAtr > 0) {
            atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
        }
        DWORD state = (result == SCARD_S_SUCCESS) ? states[i].dwEventState : 0;

        Napi::Object reader = PCSCReader::NewInstance(env, context_, readerNames[i], state, atr);
        readers.Set(static_cast<uint32_t>(i), reader);
    }

    return readers;
}

Napi::Value PCSCContext::WaitForChange(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!valid_) {
        Napi::Error::New(env, "Context is not valid").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Parse arguments: readers array (optional), timeout (optional)
    std::vector<std::string> readerNames;
    std::vector<DWORD> currentStates;
    DWORD timeout = INFINITE;

    size_t argIndex = 0;

    // First argument can be array of readers or timeout
    if (info.Length() > 0 && info[0].IsArray()) {
        Napi::Array readersArray = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < readersArray.Length(); i++) {
            Napi::Value item = readersArray.Get(i);
            if (item.IsObject()) {
                // It's a Reader object
                Napi::Object obj = item.As<Napi::Object>();
                if (obj.Has("name")) {
                    readerNames.push_back(obj.Get("name").As<Napi::String>().Utf8Value());
                    if (obj.Has("state")) {
                        currentStates.push_back(obj.Get("state").As<Napi::Number>().Uint32Value());
                    } else {
                        currentStates.push_back(SCARD_STATE_UNAWARE);
                    }
                }
            } else if (item.IsString()) {
                readerNames.push_back(item.As<Napi::String>().Utf8Value());
                currentStates.push_back(SCARD_STATE_UNAWARE);
            }
        }
        argIndex++;
    }

    // Next argument is timeout
    if (info.Length() > argIndex && info[argIndex].IsNumber()) {
        timeout = info[argIndex].As<Napi::Number>().Uint32Value();
    }

    // If no readers specified, get all readers
    if (readerNames.empty()) {
        DWORD readersLen = 0;
        LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

        if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE)) {
            // Add PnP notification to detect when readers are attached
            readerNames.push_back("\\\\?PnP?\\Notification");
            currentStates.push_back(SCARD_STATE_UNAWARE);
        } else if (result == SCARD_S_SUCCESS) {
            std::vector<char> readersBuffer(readersLen);
            result = SCardListReaders(context_, nullptr, readersBuffer.data(), &readersLen);
            if (result == SCARD_S_SUCCESS) {
                const char* p = readersBuffer.data();
                while (*p != '\0') {
                    readerNames.push_back(std::string(p));
                    currentStates.push_back(SCARD_STATE_UNAWARE);
                    p += strlen(p) + 1;
                }
            }
        }
    }

    // Create promise and start async worker
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    WaitForChangeWorker* worker = new WaitForChangeWorker(
        env, context_, readerNames, currentStates, timeout, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCContext::Cancel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!valid_) {
        return env.Undefined();
    }

    LONG result = SCardCancel(context_);
    if (result != SCARD_S_SUCCESS && result != static_cast<LONG>(SCARD_E_INVALID_HANDLE)) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
    }

    return env.Undefined();
}

Napi::Value PCSCContext::Close(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (valid_ && context_ != 0) {
        SCardReleaseContext(context_);
        valid_ = false;
        context_ = 0;
    }

    return env.Undefined();
}

Napi::Value PCSCContext::GetIsValid(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), valid_);
}
