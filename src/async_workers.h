#pragma once

#include <napi.h>
#include <vector>
#include <string>
#include "platform/pcsc.h"
#include "pcsc_context_handle.h"

// Every worker holds a Napi::ObjectReference to the JS object that owns its
// PC/SC handle (Card, Reader, or Context). Without it, GC can finalize the
// owner while Execute() is blocked in a PC/SC call: the finalizer disconnects
// or releases the handle out from under the worker, and PC/SC reuses handle
// values, so a late call can even land on a different card. The reference is
// released when the worker is destroyed on the main thread after OnOK/OnError.

// Async worker for SCardGetStatusChange
class WaitForChangeWorker : public Napi::AsyncWorker {
public:
    WaitForChangeWorker(Napi::Env env,
                        Napi::Object owner,
                        SCARDCONTEXT context,
                        std::vector<std::string> readerNames,
                        std::vector<DWORD> currentStates,
                        DWORD timeout,
                        Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::ObjectReference ownerRef_;
    SCARDCONTEXT context_;
    std::vector<std::string> readerNames_;
    std::vector<SCARD_READERSTATE> states_;
    DWORD timeout_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
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
