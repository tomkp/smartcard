#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"

class PCSCContext : public Napi::ObjectWrap<PCSCContext> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env);

    PCSCContext(const Napi::CallbackInfo& info);
    ~PCSCContext();

    // Get the raw context handle (for use by other classes)
    SCARDCONTEXT GetContext() const { return context_; }
    bool IsValid() const { return valid_; }

private:
    static Napi::FunctionReference constructor;

    SCARDCONTEXT context_;
    bool valid_;

    // JavaScript-exposed methods
    Napi::Value ListReaders(const Napi::CallbackInfo& info);
    Napi::Value WaitForChange(const Napi::CallbackInfo& info);
    Napi::Value Cancel(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetIsValid(const Napi::CallbackInfo& info);
};
