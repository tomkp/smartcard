#include "pcsc_reader.h"
#include "pcsc_card.h"
#include "pcsc_errors.h"
#include "async_workers.h"

Napi::FunctionReference PCSCReader::constructor;

Napi::Object PCSCReader::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Reader", {
        InstanceAccessor("name", &PCSCReader::GetNameValue, nullptr),
        InstanceAccessor("state", &PCSCReader::GetStateValue, nullptr),
        InstanceAccessor("atr", &PCSCReader::GetAtrValue, nullptr),
        InstanceMethod("connect", &PCSCReader::Connect),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Reader", func);
    return exports;
}

Napi::Object PCSCReader::NewInstance(Napi::Env env, SCARDCONTEXT context,
                                      const std::string& name, DWORD state,
                                      const std::vector<uint8_t>& atr) {
    Napi::Object obj = constructor.New({});
    PCSCReader* reader = Napi::ObjectWrap<PCSCReader>::Unwrap(obj);
    reader->context_ = context;
    reader->name_ = name;
    reader->state_ = state;
    reader->atr_ = atr;
    return obj;
}

PCSCReader::PCSCReader(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCReader>(info),
      context_(0),
      state_(SCARD_STATE_UNAWARE) {
    // Properties set via NewInstance
}

void PCSCReader::UpdateState(DWORD state, const std::vector<uint8_t>& atr) {
    state_ = state;
    atr_ = atr;
}

Napi::Value PCSCReader::GetNameValue(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), name_);
}

Napi::Value PCSCReader::GetStateValue(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), state_);
}

Napi::Value PCSCReader::GetAtrValue(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (atr_.empty()) {
        return env.Null();
    }

    Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, atr_.data(), atr_.size());
    return buffer;
}

Napi::Value PCSCReader::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Parse arguments: shareMode (optional), preferredProtocols (optional)
    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }

    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }

    // Create promise for async connection
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ConnectWorker* worker = new ConnectWorker(
        env, context_, name_, shareMode, preferredProtocols, deferred);
    worker->Queue();

    return deferred.Promise();
}
