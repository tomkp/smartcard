#pragma once

#include <napi.h>
#include <thread>
#include <atomic>
#include <vector>
#include <string>
#include <mutex>
#include "platform/pcsc.h"

/**
 * ReaderMonitor - Native PC/SC event monitoring using ThreadSafeFunction
 *
 * Runs a background thread that monitors for reader/card state changes
 * and emits events to JavaScript without blocking the main thread.
 */
class ReaderMonitor : public Napi::ObjectWrap<ReaderMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    ReaderMonitor(const Napi::CallbackInfo& info);
    ~ReaderMonitor();

private:
    static Napi::FunctionReference constructor;

    // PC/SC context
    SCARDCONTEXT context_;
    bool contextValid_;

    // Monitoring thread
    std::thread monitorThread_;
    std::atomic<bool> running_;
    std::mutex mutex_;

    // Thread-safe function for emitting events
    Napi::ThreadSafeFunction tsfn_;

    // Current known reader states
    struct ReaderInfo {
        std::string name;
        DWORD lastState;
        std::vector<uint8_t> atr;
    };
    std::vector<ReaderInfo> readers_;

    // JavaScript methods
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value GetIsRunning(const Napi::CallbackInfo& info);

    // Internal methods
    void MonitorLoop();
    void UpdateReaderList();
    void EmitEvent(const std::string& eventType, const std::string& readerName,
                   DWORD state, const std::vector<uint8_t>& atr);
};
