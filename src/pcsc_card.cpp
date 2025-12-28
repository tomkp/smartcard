#include "pcsc_card.h"
#include "pcsc_errors.h"
#include "async_workers.h"
#include <cstring>

Napi::FunctionReference PCSCCard::constructor;

Napi::Object PCSCCard::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "Card", {
        InstanceAccessor("protocol", &PCSCCard::GetProtocolValue, nullptr),
        InstanceAccessor("connected", &PCSCCard::GetConnectedValue, nullptr),
        InstanceAccessor("atr", &PCSCCard::GetAtr, nullptr),
        InstanceMethod("transmit", &PCSCCard::Transmit),
        InstanceMethod("control", &PCSCCard::Control),
        InstanceMethod("getStatus", &PCSCCard::GetStatus),
        InstanceMethod("disconnect", &PCSCCard::Disconnect),
        InstanceMethod("reconnect", &PCSCCard::Reconnect),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("Card", func);
    return exports;
}

Napi::Object PCSCCard::NewInstance(Napi::Env env, SCARDHANDLE card,
                                    DWORD protocol, const std::string& readerName) {
    Napi::Object obj = constructor.New({});
    PCSCCard* cardObj = Napi::ObjectWrap<PCSCCard>::Unwrap(obj);
    cardObj->card_ = card;
    cardObj->protocol_ = protocol;
    cardObj->readerName_ = readerName;
    cardObj->connected_ = true;
    return obj;
}

PCSCCard::PCSCCard(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCCard>(info),
      card_(0),
      protocol_(SCARD_PROTOCOL_UNDEFINED),
      connected_(false) {
    // Properties set via NewInstance
}

PCSCCard::~PCSCCard() {
    if (connected_ && card_ != 0) {
        SCardDisconnect(card_, SCARD_LEAVE_CARD);
        connected_ = false;
        card_ = 0;
    }
}

Napi::Value PCSCCard::GetProtocolValue(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), protocol_);
}

Napi::Value PCSCCard::GetConnectedValue(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), connected_);
}

Napi::Value PCSCCard::GetAtr(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Null();
    }

    // Get ATR via SCardStatus
    DWORD readerLen = 0;
    DWORD state = 0;
    DWORD protocol = 0;
    BYTE atr[MAX_ATR_SIZE];
    DWORD atrLen = sizeof(atr);

    LONG result = SCardStatus(card_, nullptr, &readerLen, &state, &protocol, atr, &atrLen);

    if (result != SCARD_S_SUCCESS) {
        return env.Null();
    }

    return Napi::Buffer<uint8_t>::Copy(env, atr, atrLen);
}

Napi::Value PCSCCard::Transmit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected command buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<uint8_t> sendBuffer;

    if (info[0].IsBuffer()) {
        Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
        sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());
    } else if (info[0].IsArray()) {
        Napi::Array arr = info[0].As<Napi::Array>();
        sendBuffer.reserve(arr.Length());
        for (uint32_t i = 0; i < arr.Length(); i++) {
            sendBuffer.push_back(static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value()));
        }
    } else {
        Napi::TypeError::New(env, "Expected Buffer or Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Parse options (optional second argument)
    size_t maxRecvLength = 0;  // 0 means use default
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        if (options.Has("maxRecvLength") && options.Get("maxRecvLength").IsNumber()) {
            maxRecvLength = options.Get("maxRecvLength").As<Napi::Number>().Uint32Value();
        }
    }

    // Create promise for async transmit
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    TransmitWorker* worker = new TransmitWorker(
        env, card_, protocol_, sendBuffer, maxRecvLength, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCCard::Control(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected control code").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD controlCode = info[0].As<Napi::Number>().Uint32Value();

    std::vector<uint8_t> sendBuffer;
    if (info.Length() > 1) {
        if (info[1].IsBuffer()) {
            Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
            sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());
        } else if (info[1].IsArray()) {
            Napi::Array arr = info[1].As<Napi::Array>();
            sendBuffer.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); i++) {
                sendBuffer.push_back(static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value()));
            }
        }
    }

    // Create promise for async control
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ControlWorker* worker = new ControlWorker(
        env, card_, controlCode, sendBuffer, deferred);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value PCSCCard::GetStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD readerLen = 0;
    DWORD state = 0;
    DWORD protocol = 0;
    BYTE atr[MAX_ATR_SIZE];
    DWORD atrLen = sizeof(atr);

    // First call to get reader name length
    LONG result = SCardStatus(card_, nullptr, &readerLen, &state, &protocol, atr, &atrLen);

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object status = Napi::Object::New(env);
    status.Set("state", Napi::Number::New(env, state));
    status.Set("protocol", Napi::Number::New(env, protocol));
    status.Set("atr", Napi::Buffer<uint8_t>::Copy(env, atr, atrLen));

    return status;
}

Napi::Value PCSCCard::Disconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Undefined();
    }

    DWORD disposition = SCARD_LEAVE_CARD;
    if (info.Length() > 0 && info[0].IsNumber()) {
        disposition = info[0].As<Napi::Number>().Uint32Value();
    }

    LONG result = SCardDisconnect(card_, disposition);
    connected_ = false;
    card_ = 0;

    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
    }

    return env.Undefined();
}

Napi::Value PCSCCard::Reconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
    DWORD initialization = SCARD_LEAVE_CARD;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 2 && info[2].IsNumber()) {
        initialization = info[2].As<Napi::Number>().Uint32Value();
    }

    // Create promise for async reconnect
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ReconnectWorker* worker = new ReconnectWorker(
        env, card_, shareMode, preferredProtocols, initialization, &protocol_, deferred);
    worker->Queue();

    return deferred.Promise();
}
