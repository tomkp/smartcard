#include "async_workers.h"
#include "pcsc_card.h"
#include "pcsc_errors.h"
#include <cstring>

// ============================================================================
// WaitForChangeWorker
// ============================================================================

WaitForChangeWorker::WaitForChangeWorker(
    Napi::Env env,
    SCARDCONTEXT context,
    std::vector<std::string> readerNames,
    std::vector<DWORD> currentStates,
    DWORD timeout,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      context_(context),
      readerNames_(std::move(readerNames)),
      timeout_(timeout),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {

    // Initialize reader states
    states_.resize(readerNames_.size());
    for (size_t i = 0; i < readerNames_.size(); i++) {
        memset(&states_[i], 0, sizeof(SCARD_READERSTATE));
        states_[i].szReader = readerNames_[i].c_str();
        states_[i].dwCurrentState = (i < currentStates.size()) ? currentStates[i] : SCARD_STATE_UNAWARE;
    }
}

void WaitForChangeWorker::Execute() {
    // This runs on worker thread - safe to block
    result_ = SCardGetStatusChange(context_, timeout_, states_.data(), states_.size());
}

void WaitForChangeWorker::OnOK() {
    Napi::Env env = Env();

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
    } else if (result_ == SCARD_E_CANCELLED) {
        // Cancelled - resolve with null
        deferred_.Resolve(env.Null());
    } else if (result_ == SCARD_E_TIMEOUT) {
        // Timeout - resolve with empty array
        deferred_.Resolve(Napi::Array::New(env, 0));
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void WaitForChangeWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}

// ============================================================================
// TransmitWorker
// ============================================================================

TransmitWorker::TransmitWorker(
    Napi::Env env,
    SCARDHANDLE card,
    DWORD protocol,
    std::vector<uint8_t> sendBuffer,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      card_(card),
      protocol_(protocol),
      sendBuffer_(std::move(sendBuffer)),
      recvLength_(0),
      result_(SCARD_S_SUCCESS),
      deferred_(deferred) {
    // Pre-allocate receive buffer (max APDU response size)
    recvBuffer_.resize(258);
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
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
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
    SCARDHANDLE card,
    DWORD controlCode,
    std::vector<uint8_t> sendBuffer,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
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
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
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
    SCARDCONTEXT context,
    std::string readerName,
    DWORD shareMode,
    DWORD preferredProtocols,
    Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(env),
      context_(context),
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
        Napi::Object card = PCSCCard::NewInstance(env, card_, activeProtocol_, readerName_);
        deferred_.Resolve(card);
    } else {
        deferred_.Reject(Napi::Error::New(env, GetPCSCErrorString(result_)).Value());
    }
}

void ConnectWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}
