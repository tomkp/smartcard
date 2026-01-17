#pragma once

#include <napi.h>
#include <thread>
#include <atomic>
#include <vector>
#include <string>
#include <mutex>
#include <unordered_map>
#include "platform/pcsc.h"

/**
 * ReaderMonitor - Native PC/SC event monitoring using ThreadSafeFunction
 *
 * Runs a background thread that monitors for reader/card state changes
 * and emits events to JavaScript without blocking the main thread.
 *
 * Issue #111 fix: Uses a map keyed by reader name instead of array indices
 * to prevent state mismatch when readers are added/removed during monitoring.
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

    // Current known reader states (Issue #111: keyed by reader name for reliable lookup)
    struct ReaderInfo {
        DWORD lastState;
        std::vector<uint8_t> atr;
    };
    std::unordered_map<std::string, ReaderInfo> readerStates_;

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
