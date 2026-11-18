#pragma once

#include <napi.h>
#include <vector>
#include <string>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <memory>
#include <unordered_set>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"

// Every AsyncWorker below holds a Napi::ObjectReference to the JS object
// that owns its PC/SC handle (Card or Reader). Without it, GC can finalize
// the owner while Execute() is blocked in a PC/SC call: the finalizer
// disconnects or releases the handle out from under the worker, and PC/SC
// reuses handle values, so a late call can even land on a different card.
// The reference is released on the main thread once the result is
// delivered (OnOK/OnError). WaitForChangeWorker needs none: its context is
// its own.

// waitForChange(): SCardGetStatusChange on a thread of its own, not as a
// Napi::AsyncWorker on libuv's threadpool, because the wait can last
// forever (with no timeout, the default):
// - The threadpool is shared by the whole process, 4 threads by default.
//   Four pending waits stopped every fs, dns, crypto and zlib call, and
//   this addon's transmit() and connect(), until one of them returned.
// - Node tears an environment down (a worker exiting, or terminated) only
//   once its threadpool work has finished, and runs cleanup hooks only
//   after that, so nothing could cancel the wait: the worker never ended,
//   and nor did the process, whose exit waits for its workers.
// Off the threadpool the wait doesn't hold up teardown, and OnEnvCleanup
// cancels it.
//
// Each wait also has a PC/SC context of its own, established and released
// on its thread. pcsc-lite holds a context's lock for as long as a wait on
// it lasts, and a call that needs the lock waits for it while holding the
// library's global lock: on the waiting Context, listReaders() and close()
// blocked the main thread until the wait ended (with no timeout, forever),
// and a second wait, or a connect(), blocked every PC/SC call in the
// process, cancel() included.
//
// spec/WaitLifecycle.tla models this class, cancel() and close(); change
// it in the same PR (spec/README.md, "waitForChange()").
class WaitForChangeWorker {
public:
    // The waits pending on one Context, for cancel() and close(). Main
    // thread only; shared by the Context and its waits.
    using PendingWaits = std::unordered_set<WaitForChangeWorker*>;
    using PendingWaitsPtr = std::shared_ptr<PendingWaits>;

    // Start the wait; returns the promise it settles
    static Napi::Promise Start(Napi::Env env,
                               PendingWaitsPtr pendingWaits,
                               std::vector<std::string> readerNames,
                               std::vector<DWORD> currentStates,
                               DWORD timeout);

    // The wait is cancelled: if it hasn't begun it won't, and when it
    // returns it resolves with null. Cancel() ends it as well. Main thread.
    void MarkCancelled();
    // Mark the wait cancelled and end it: returns once it has returned,
    // normally at once, or after about a second if SCardCancel can't end
    // it. Returns false, sooner, if SCardCancel itself keeps failing (pcscd
    // refusing new connections). Main thread.
    bool Cancel();

private:
    WaitForChangeWorker(Napi::Env env,
                        PendingWaitsPtr pendingWaits,
                        std::vector<std::string> readerNames,
                        std::vector<DWORD> currentStates,
                        DWORD timeout);

    // On thread_: the wait, then releasing tsfn_
    void Execute();
    // Set cancelled_, then cancel the wait until it has returned (see
    // kCancelFor in the .cpp). teardown: for as long as it takes
    bool CancelUntilReturned(bool teardown);
    // The tsfn's finalizer, on the main thread: Node calls it once
    // Execute() has released the tsfn, or at environment teardown
    static void OnDone(Napi::Env env, void*, WaitForChangeWorker* self);
    static void OnEnvCleanup(void* arg);
    void Settle(Napi::Env env);

    // Only ever released, never called: OnDone delivers the result
    using DoneTsfn = Napi::TypedThreadSafeFunction<WaitForChangeWorker>;

    Napi::Promise::Deferred deferred_;
    PendingWaitsPtr pendingWaits_;
    std::vector<std::string> readerNames_;
    std::vector<SCARD_READERSTATE> states_;
    DWORD timeout_;
    LONG result_;
    DoneTsfn tsfn_;
    std::thread thread_;
    // Guards the rest
    std::mutex mutex_;
    // This wait's own context, while thread_ holds it
    SCARDCONTEXT context_;
    bool contextValid_;
    // Execute() is done with the context: the wait has returned
    std::condition_variable waitedCv_;
    bool waited_;
    // Cancel() or OnEnvCleanup: end the wait, or don't begin it
    bool cancelled_;
    // OnEnvCleanup is registered with Node from Start() until OnDone
    bool cleanupHookAdded_;
    // OnEnvCleanup ran: the environment can't run JS any more
    bool envTornDown_;
};

// Async worker for SCardTransmit
class TransmitWorker : public Napi::AsyncWorker {
public:
    TransmitWorker(Napi::Env env,
                   Napi::Object owner,
                   SCARDHANDLE card,
                   DWORD protocol,
                   std::vector<uint8_t> sendBuffer,
                   size_t maxRecvLength,
                   Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::ObjectReference ownerRef_;
    SCARDHANDLE card_;
    DWORD protocol_;
    std::vector<uint8_t> sendBuffer_;
    std::vector<uint8_t> recvBuffer_;
    DWORD recvLength_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

// Async worker for SCardControl
class ControlWorker : public Napi::AsyncWorker {
public:
    ControlWorker(Napi::Env env,
                  Napi::Object owner,
                  SCARDHANDLE card,
                  DWORD controlCode,
                  std::vector<uint8_t> sendBuffer,
                  Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::ObjectReference ownerRef_;
    SCARDHANDLE card_;
    DWORD controlCode_;
    std::vector<uint8_t> sendBuffer_;
    std::vector<uint8_t> recvBuffer_;
    DWORD bytesReturned_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

// Async worker for SCardConnect
class ConnectWorker : public Napi::AsyncWorker {
public:
    ConnectWorker(Napi::Env env,
                  Napi::Object owner,
                  ContextHandlePtr context,
                  std::string readerName,
                  DWORD shareMode,
                  DWORD preferredProtocols,
                  Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::ObjectReference ownerRef_;
    // Handed to the new Card, which needs the context alive as long as it is
    ContextHandlePtr contextHandle_;
    // Copied on the main thread; Execute() never touches contextHandle_
    SCARDCONTEXT context_;
    std::string readerName_;
    DWORD shareMode_;
    DWORD preferredProtocols_;
    SCARDHANDLE card_;
    DWORD activeProtocol_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

// Async worker for SCardReconnect
class ReconnectWorker : public Napi::AsyncWorker {
public:
    ReconnectWorker(Napi::Env env,
                    Napi::Object owner,
                    SCARDHANDLE card,
                    DWORD shareMode,
                    DWORD preferredProtocols,
                    DWORD initialization,
                    DWORD* protocolOut,
                    Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

    DWORD GetActiveProtocol() const { return activeProtocol_; }

private:
    Napi::ObjectReference ownerRef_;
    SCARDHANDLE card_;
    DWORD shareMode_;
    DWORD preferredProtocols_;
    DWORD initialization_;
    DWORD activeProtocol_;
    // Points into the owning PCSCCard; ownerRef_ keeps that object alive
    // for the duration, so the pointer cannot dangle
    DWORD* protocolOut_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};
