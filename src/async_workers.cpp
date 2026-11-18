#include "async_workers.h"
#include "pcsc_card.h"
#include "pcsc_errors.h"
#include "pcsc_napi_error.h"
#include <chrono>
#include <cstring>

// ============================================================================
// WaitForChangeWorker
// ============================================================================

WaitForChangeWorker::WaitForChangeWorker(
    Napi::Env env,
    PendingWaitsPtr pendingWaits,
    std::vector<std::string> readerNames,
    std::vector<DWORD> currentStates,
    DWORD timeout)
    : deferred_(Napi::Promise::Deferred::New(env)),
      pendingWaits_(std::move(pendingWaits)),
      readerNames_(std::move(readerNames)),
      timeout_(timeout),
      result_(SCARD_S_SUCCESS),
      context_(0),
      contextValid_(false),
      waited_(false),
      cancelled_(false),
      cleanupHookAdded_(false),
      envTornDown_(false) {

    // Initialize reader states
    states_.resize(readerNames_.size());
    for (size_t i = 0; i < readerNames_.size(); i++) {
        memset(&states_[i], 0, sizeof(SCARD_READERSTATE));
        states_[i].szReader = readerNames_[i].c_str();
        states_[i].dwCurrentState = (i < currentStates.size()) ? currentStates[i] : SCARD_STATE_UNAWARE;
    }
}

Napi::Promise WaitForChangeWorker::Start(
    Napi::Env env,
    PendingWaitsPtr pendingWaits,
    std::vector<std::string> readerNames,
    std::vector<DWORD> currentStates,
    DWORD timeout) {

    auto* self = new WaitForChangeWorker(
        env, std::move(pendingWaits), std::move(readerNames),
        std::move(currentStates), timeout);
    Napi::Promise promise = self->deferred_.Promise();

    try {
        // Referenced until released, so a pending wait keeps the event
        // loop alive, as threadpool work did
        self->tsfn_ = DoneTsfn::New(env, "waitForChange", 0, 1, self, OnDone);
    } catch (...) {
        delete self;
        throw;
    }
    // From here OnDone frees self

    // Added after the tsfn, so that at environment teardown it runs before
    // the tsfn's own hook: Node runs them newest first. Without it nothing
    // could end the wait at teardown, so no wait is started.
    self->cleanupHookAdded_ =
        napi_add_env_cleanup_hook(env, OnEnvCleanup, self) == napi_ok;

    bool started = false;
    if (self->cleanupHookAdded_) {
        try {
            // Within cancel()'s reach before it begins
            self->pendingWaits_->insert(self);
            self->thread_ = std::thread(&WaitForChangeWorker::Execute, self);
            started = true;
        } catch (...) {
            // No thread to be had (std::system_error, std::bad_alloc)
            self->pendingWaits_->erase(self);
        }
    }
    if (!started) {
        // Fail the wait: OnDone rejects it
        self->result_ = SCARD_E_NO_MEMORY;
        self->tsfn_.Release();
    }

    return promise;
}

void WaitForChangeWorker::Execute() {
    SCARDCONTEXT context = 0;
    LONG established = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context);
    bool cancelled;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (established == SCARD_S_SUCCESS) {
            context_ = context;
            contextValid_ = true;
        }
        cancelled = cancelled_;
    }

    if (established != SCARD_S_SUCCESS) {
        result_ = established;
    } else if (cancelled) {
        result_ = SCARD_E_CANCELLED;
    } else {
        // One call, however long: separate calls would leave gaps between
        // them, in which pcsc-lite misses a reader being added (the PnP
        // entry counts only during a call) and fails the next call
        // outright for a reader removed (spec/README.md, findings 2 and 3)
        result_ = SCardGetStatusChange(context, timeout_, states_.data(), states_.size());
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (contextValid_) {
            SCardReleaseContext(context_);
            contextValid_ = false;
        }
        waited_ = true;
    }
    waitedCv_.notify_all();
    tsfn_.Release();
}

void WaitForChangeWorker::CancelUntilReturned(int maxAttempts, int maxFailures) {
    std::unique_lock<std::mutex> lock(mutex_);
    cancelled_ = true;
    // SCardCancel ends only a wait in progress. One whose thread hasn't
    // reached SCardGetStatusChange yet sees cancelled_ instead; one that
    // has, but isn't waiting yet, needs another try (SCardCancel succeeds
    // then, doing nothing).
    int failures = 0;
    for (int attempt = 0; !waited_ && (maxAttempts == 0 || attempt < maxAttempts); attempt++) {
        if (contextValid_) {
            if (SCardCancel(context_) == SCARD_S_SUCCESS) {
                failures = 0;
            } else if (maxFailures != 0 && ++failures >= maxFailures) {
                // SCardCancel itself keeps failing. On pcsc-lite it needs a
                // connection of its own to pcscd, which pcscd refuses once
                // it serves its maximum number of contexts (200 by
                // default): trying for longer only blocks the caller
                break;
            }
        }
        waitedCv_.wait_for(lock, std::chrono::milliseconds(5), [this] { return waited_; });
    }
}

void WaitForChangeWorker::Cancel() {
    CancelUntilReturned(200, 3);
}

// The environment is being torn down (a worker exiting, or terminated)
// with the wait still pending: end it, so the tsfn's own cleanup hook,
// which runs next, finds the thread done with it (as in ReaderMonitor).
// The promise is left unsettled; nothing can observe it any more.
void WaitForChangeWorker::OnEnvCleanup(void* arg) {
    auto* self = static_cast<WaitForChangeWorker*>(arg);
    // Node drops the hook itself once it has run
    self->cleanupHookAdded_ = false;
    self->envTornDown_ = true;
    if (self->thread_.joinable()) {
        // However long it takes: the thread must be done before Node
        // frees the tsfn
        self->CancelUntilReturned(0, 0);
        self->thread_.join();
    }
}

void WaitForChangeWorker::OnDone(Napi::Env env, void*, WaitForChangeWorker* self) {
    if (self->thread_.joinable()) {
        // Execute() has released the tsfn, so it is returning
        self->thread_.join();
    }
    if (self->cleanupHookAdded_) {
        napi_remove_env_cleanup_hook(env, OnEnvCleanup, self);
        self->cleanupHookAdded_ = false;
    }
    self->pendingWaits_->erase(self);
    if (!self->envTornDown_) {
        // If building the result fails, fail the wait with that error.
        // Node can also finalize the tsfn early in a teardown, before the
        // cleanup hooks run, when JS can't run: then rejecting fails too,
        // nothing can observe the promise any more, and the failure must
        // not escape into Node.
        try {
            self->Settle(env);
        } catch (const Napi::Error& e) {
            try {
                self->deferred_.Reject(e.Value());
            } catch (...) {
            }
        } catch (...) {
            try {
                self->deferred_.Reject(Napi::Error::New(
                    env, "waitForChange() could not deliver its result").Value());
            } catch (...) {
            }
        }
    }
    delete self;
}

void WaitForChangeWorker::Settle(Napi::Env env) {
    if (result_ == SCARD_S_SUCCESS) {
        // Build array of reader states
        Napi::Array changes = Napi::Array::New(env);

        for (size_t i = 0; i < states_.size(); i++) {
            Napi::Object reader = Napi::Object::New(env);
            reader.Set("name", Napi::String::New(env, readerNames_[i]));
            reader.Set("state", Napi::Number::New(env, states_[i].dwEventState));
            reader.Set("changed", Napi::Boolean::New(env,
                (states_[i].dwEventState & SCARD_STATE_CHANGED) != 0));

            if (states_[i].cbAtr > 0) {
                reader.Set("atr", Napi::Buffer<uint8_t>::Copy(
                    env, states_[i].rgbAtr, states_[i].cbAtr));
            } else {
                reader.Set("atr", env.Null());
            }

            changes.Set(static_cast<uint32_t>(i), reader);
        }

        deferred_.Resolve(changes);
    } else if (result_ == static_cast<LONG>(SCARD_E_CANCELLED)) {
        // Cancelled - resolve with null
        deferred_.Resolve(env.Null());
    } else if (result_ == static_cast<LONG>(SCARD_E_TIMEOUT)) {
        // Timeout - resolve with empty array
        deferred_.Resolve(Napi::Array::New(env, 0));
    } else {
        deferred_.Reject(NewPCSCError(env, result_).Value());
    }
}

// ============================================================================
// TransmitWorker
// ============================================================================

TransmitWorker::TransmitWorker(
    Napi::Env env,
    Napi::Object owner,
    SCARDHANDLE card,
    DWORD protocol,
    std::vector<uint8_t> sendBuffer,
    size_t maxRecvLength,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      ownerRef_(Napi::Persistent(owner)),
      card_(card),
      protocol_(protocol),
      sendBuffer_(std::move(sendBuffer)),
      recvLength_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
    // Pre-allocate receive buffer with configurable size
    // Default is 258 (standard APDU: 256 data + 2 status bytes)
    // Max is 262144 (256KB) for extended APDUs
    size_t bufferSize = maxRecvLength;
    if (bufferSize == 0) {
        bufferSize = 258;  // Default
    } else if (bufferSize > 262144) {
        bufferSize = 262144;  // Cap at 256KB
    }
    recvBuffer_.resize(bufferSize);
}

void TransmitWorker::Execute() {
    // Select protocol-specific PCI structure
    const SCARD_IO_REQUEST* pioSendPci;
    if (protocol_ == SCARD_PROTOCOL_T0) {
        pioSendPci = SCARD_PCI_T0;
    } else if (protocol_ == SCARD_PROTOCOL_T1) {
        pioSendPci = SCARD_PCI_T1;
    } else {
        pioSendPci = SCARD_PCI_RAW;
    }

    recvLength_ = static_cast<DWORD>(recvBuffer_.size());

    result_ = SCardTransmit(
        card_,
        pioSendPci,
        sendBuffer_.data(),
        static_cast<DWORD>(sendBuffer_.size()),
        nullptr,
        recvBuffer_.data(),
        &recvLength_
    );
}

void TransmitWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
            env, recvBuffer_.data(), recvLength_);
        deferred_.Resolve(buffer);
    } else {
        deferred_.Reject(NewPCSCError(env, result_).Value());
    }
}

void TransmitWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ControlWorker
// ============================================================================

ControlWorker::ControlWorker(
    Napi::Env env,
    Napi::Object owner,
    SCARDHANDLE card,
    DWORD controlCode,
    std::vector<uint8_t> sendBuffer,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      ownerRef_(Napi::Persistent(owner)),
      card_(card),
      controlCode_(controlCode),
      sendBuffer_(std::move(sendBuffer)),
      bytesReturned_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
    // Pre-allocate receive buffer
    recvBuffer_.resize(256);
}

void ControlWorker::Execute() {
    result_ = SCardControl(
        card_,
        controlCode_,
        sendBuffer_.empty() ? nullptr : sendBuffer_.data(),
        static_cast<DWORD>(sendBuffer_.size()),
        recvBuffer_.data(),
        static_cast<DWORD>(recvBuffer_.size()),
        &bytesReturned_
    );
}

void ControlWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
            env, recvBuffer_.data(), bytesReturned_);
        deferred_.Resolve(buffer);
    } else {
        deferred_.Reject(NewPCSCError(env, result_).Value());
    }
}

void ControlWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ConnectWorker
// ============================================================================

ConnectWorker::ConnectWorker(
    Napi::Env env,
    Napi::Object owner,
    ContextHandlePtr context,
    std::string readerName,
    DWORD shareMode,
    DWORD preferredProtocols,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      ownerRef_(Napi::Persistent(owner)),
      contextHandle_(std::move(context)),
      context_(contextHandle_->Get()),
      readerName_(std::move(readerName)),
      shareMode_(shareMode),
      preferredProtocols_(preferredProtocols),
      card_(0),
      activeProtocol_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
}

void ConnectWorker::Execute() {
    result_ = SCardConnect(
        context_,
        readerName_.c_str(),
        shareMode_,
        preferredProtocols_,
        &card_,
        &activeProtocol_
    );
}

void ConnectWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        Napi::Object card = PCSCCard::NewInstance(
            env, contextHandle_, card_, activeProtocol_, readerName_);
        deferred_.Resolve(card);
    } else {
        deferred_.Reject(NewPCSCError(env, result_).Value());
    }
}

void ConnectWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// ReconnectWorker
// ============================================================================

ReconnectWorker::ReconnectWorker(
    Napi::Env env,
    Napi::Object owner,
    SCARDHANDLE card,
    DWORD shareMode,
    DWORD preferredProtocols,
    DWORD initialization,
    DWORD* protocolOut,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      ownerRef_(Napi::Persistent(owner)),
      card_(card),
      shareMode_(shareMode),
      preferredProtocols_(preferredProtocols),
      initialization_(initialization),
      activeProtocol_(0),
      protocolOut_(protocolOut),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
}

void ReconnectWorker::Execute() {
    result_ = SCardReconnect(
        card_,
        shareMode_,
        preferredProtocols_,
        initialization_,
        &activeProtocol_
    );
}

void ReconnectWorker::OnOK() {
    Napi::Env env = Env();

    if (result_ == SCARD_S_SUCCESS) {
        // Update the card object's protocol
        if (protocolOut_) {
            *protocolOut_ = activeProtocol_;
        }
        deferred_.Resolve(Napi::Number::New(env, activeProtocol_));
    } else {
        deferred_.Reject(NewPCSCError(env, result_).Value());
    }
}

void ReconnectWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}
