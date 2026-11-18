#pragma once

#include <napi.h>
#include <vector>
#include <string>
#include <thread>
#include <mutex>
#include <condition_variable>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"

// Every worker holds a Napi::ObjectReference to the JS object that owns its
// PC/SC handle (Card, Reader, or Context). Without it, GC can finalize the
// owner while Execute() is blocked in a PC/SC call: the finalizer disconnects
// or releases the handle out from under the worker, and PC/SC reuses handle
// values, so a late call can even land on a different card. The reference is
// released on the main thread once the result is delivered (OnOK/OnError;
// for WaitForChangeWorker, OnDone), or at environment teardown.

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
class WaitForChangeWorker {
public:
    // Start the wait; returns the promise it settles
    static Napi::Promise Start(Napi::Env env,
                               Napi::Object owner,
                               SCARDCONTEXT context,
                               std::vector<std::string> readerNames,
                               std::vector<DWORD> currentStates,
                               DWORD timeout);

private:
    WaitForChangeWorker(Napi::Env env,
                        Napi::Object owner,
                        SCARDCONTEXT context,
                        std::vector<std::string> readerNames,
                        std::vector<DWORD> currentStates,
                        DWORD timeout);

    // On thread_: the wait, then releasing tsfn_
    void Execute();
    // The tsfn's finalizer, on the main thread: Node calls it once
    // Execute() has released the tsfn, or at environment teardown
    static void OnDone(Napi::Env env, void*, WaitForChangeWorker* self);
    static void OnEnvCleanup(void* arg);
    void Settle(Napi::Env env);

    // Only ever released, never called: OnDone delivers the result
    using DoneTsfn = Napi::TypedThreadSafeFunction<WaitForChangeWorker>;

    Napi::ObjectReference ownerRef_;
    Napi::Promise::Deferred deferred_;
    SCARDCONTEXT context_;
    std::vector<std::string> readerNames_;
    std::vector<SCARD_READERSTATE> states_;
    DWORD timeout_;
    LONG result_;
    DoneTsfn tsfn_;
    std::thread thread_;
    // Execute() has returned from SCardGetStatusChange
    std::mutex waitedMutex_;
    std::condition_variable waitedCv_;
    bool waited_;
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
