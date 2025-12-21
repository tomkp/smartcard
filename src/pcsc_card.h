#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"

class PCSCCard : public Napi::ObjectWrap<PCSCCard> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, SCARDHANDLE card,
                                     DWORD protocol, const std::string& readerName);

    PCSCCard(const Napi::CallbackInfo& info);
    ~PCSCCard();

    // Accessors
    SCARDHANDLE GetHandle() const { return card_; }
    DWORD GetProtocol() const { return protocol_; }
    bool IsConnected() const { return connected_; }

private:
    static Napi::FunctionReference constructor;

    SCARDHANDLE card_;
    DWORD protocol_;
    std::string readerName_;
    bool connected_;

    // JavaScript-exposed methods
    Napi::Value Transmit(const Napi::CallbackInfo& info);
    Napi::Value Control(const Napi::CallbackInfo& info);
    Napi::Value GetStatus(const Napi::CallbackInfo& info);
    Napi::Value Disconnect(const Napi::CallbackInfo& info);
    Napi::Value Reconnect(const Napi::CallbackInfo& info);

    // Getters
    Napi::Value GetProtocolValue(const Napi::CallbackInfo& info);
    Napi::Value GetConnectedValue(const Napi::CallbackInfo& info);
    Napi::Value GetAtr(const Napi::CallbackInfo& info);
};
