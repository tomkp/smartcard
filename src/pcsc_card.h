#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"

class PCSCCard : public Napi::ObjectWrap<PCSCCard> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, ContextHandlePtr context,
                                     SCARDHANDLE card, DWORD protocol,
                                     const std::string& readerName);

    PCSCCard(const Napi::CallbackInfo& info);
    ~PCSCCard();

    // Accessors
    SCARDHANDLE GetHandle() const { return card_; }
    DWORD GetProtocol() const { return protocol_; }
    // A card handle dies with its context: once Context.close() releases
    // it, PC/SC may give the same handle value to a new connection, so the
    // handle must never be used again
    bool IsConnected() const { return connected_ && context_ && context_->IsValid(); }

private:
    static Napi::FunctionReference constructor;

    // Keeps the context alive for as long as this card; destroyed after
    // ~PCSCCard's body, so the card disconnects before the context goes
    ContextHandlePtr context_;
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
