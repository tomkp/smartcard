#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"

class PCSCReader : public Napi::ObjectWrap<PCSCReader> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, SCARDCONTEXT context,
                                     const std::string& name, DWORD state,
                                     const std::vector<uint8_t>& atr);

    PCSCReader(const Napi::CallbackInfo& info);

    // Accessors
    const std::string& GetName() const { return name_; }
    DWORD GetState() const { return state_; }
    const std::vector<uint8_t>& GetAtr() const { return atr_; }
    SCARDCONTEXT GetContext() const { return context_; }

    // Update state (called from monitoring)
    void UpdateState(DWORD state, const std::vector<uint8_t>& atr);

private:
    static Napi::FunctionReference constructor;

    std::string name_;
    SCARDCONTEXT context_;
    DWORD state_;
    std::vector<uint8_t> atr_;

    // JavaScript-exposed methods
    Napi::Value GetNameValue(const Napi::CallbackInfo& info);
    Napi::Value GetStateValue(const Napi::CallbackInfo& info);
    Napi::Value GetAtrValue(const Napi::CallbackInfo& info);
    Napi::Value Connect(const Napi::CallbackInfo& info);
};
