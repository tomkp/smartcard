#pragma once

#include <napi.h>
#include <vector>
#include <string>
#include "platform/pcsc.h"

// Async worker for SCardGetStatusChange
class WaitForChangeWorker : public Napi::AsyncWorker {
public:
    WaitForChangeWorker(Napi::Env env,
                        SCARDCONTEXT context,
                        std::vector<std::string> readerNames,
                        std::vector<DWORD> currentStates,
                        DWORD timeout,
                        Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
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
                   SCARDHANDLE card,
                   DWORD protocol,
                   std::vector<uint8_t> sendBuffer,
                   Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
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
                  SCARDHANDLE card,
                  DWORD controlCode,
                  std::vector<uint8_t> sendBuffer,
                  Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
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
                  SCARDCONTEXT context,
                  std::string readerName,
                  DWORD shareMode,
                  DWORD preferredProtocols,
                  Napi::Promise::Deferred deferred);

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    SCARDCONTEXT context_;
    std::string readerName_;
    DWORD shareMode_;
    DWORD preferredProtocols_;
    SCARDHANDLE card_;
    DWORD activeProtocol_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};
