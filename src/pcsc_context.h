#pragma once

#include <napi.h>
#include <string>
#include <vector>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"
#include "async_workers.h"

class PCSCContext : public Napi::ObjectWrap<PCSCContext> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    PCSCContext(const Napi::CallbackInfo& info);

    // Get the raw context handle (for use by other classes)
    SCARDCONTEXT GetContext() const { return handle_ ? handle_->Get() : 0; }
    bool IsValid() const { return handle_ && handle_->IsValid(); }

private:
    // Shared with the Readers (and their Cards) created from this context;
    // released when the last of them is finalized, or by close()
    ContextHandlePtr handle_;

    // waitForChange() calls still pending, each on a context of its own:
    // cancel() and close() end them
    WaitForChangeWorker::PendingWaitsPtr pendingWaits_;

    void CancelPendingWaits();

    // JavaScript-exposed methods
    Napi::Value ListReaders(const Napi::CallbackInfo& info);
    Napi::Value WaitForChange(const Napi::CallbackInfo& info);
    Napi::Value Cancel(const Napi::CallbackInfo& info);
    Napi::Value Close(const Napi::CallbackInfo& info);
    Napi::Value GetIsValid(const Napi::CallbackInfo& info);
};
