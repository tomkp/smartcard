#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"

class PCSCReader : public Napi::ObjectWrap<PCSCReader> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, ContextHandlePtr context,
                                     const std::string& name, DWORD state,
                                     const std::vector<uint8_t>& atr);

    PCSCReader(const Napi::CallbackInfo& info);

    // Accessors
    const std::string& GetName() const { return name_; }
    DWORD GetState() const { return state_; }
    const std::vector<uint8_t>& GetAtr() const { return atr_; }
    SCARDCONTEXT GetContext() const { return context_ ? context_->Get() : 0; }

    // Update state (called from monitoring)
    void UpdateState(DWORD state, const std::vector<uint8_t>& atr);

private:
    static Napi::FunctionReference constructor;

    std::string name_;
    // Shared with the PCSCContext that created this reader, so the handle
    // outlives the Context object; checked before use, since close() can
    // still release it
    ContextHandlePtr context_;
    DWORD state_;
    std::vector<uint8_t> atr_;

    // JavaScript-exposed methods
    Napi::Value GetNameValue(const Napi::CallbackInfo& info);
    Napi::Value GetStateValue(const Napi::CallbackInfo& info);
    Napi::Value GetAtrValue(const Napi::CallbackInfo& info);
    Napi::Value Connect(const Napi::CallbackInfo& info);
};
