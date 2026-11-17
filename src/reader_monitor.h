#pragma once

#include <napi.h>
#include <thread>
#include <atomic>
#include <memory>
#include <vector>
#include <string>
#include <mutex>
#include <condition_variable>
#include <unordered_map>
#include <cstddef>
#include "platform/pcsc.h"
#include "reader_state_utils.h"

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
    // PC/SC context
    SCARDCONTEXT context_;
    bool contextValid_;

    // Monitoring thread
    std::thread monitorThread_;
    std::atomic<bool> running_;
    std::mutex mutex_;

    // One event on its way from the monitor thread to the JS callback
    struct EventData;

    // Called by Node for every queued event: delivers it to the JS
    // callback, then frees it. Node also calls it with no env to drain the
    // queue when the environment is torn down first, so the event is freed
    // either way.
    static void DeliverEvent(Napi::Env env, Napi::Function callback,
                             std::nullptr_t* context, EventData* data);
    using EventTsfn =
        Napi::TypedThreadSafeFunction<std::nullptr_t, EventData, DeliverEvent>;

    // Thread-safe function for emitting events. tsfnActive_ tracks whether
    // tsfn_ holds a live handle that still needs Release().
    EventTsfn tsfn_;
    bool tsfnActive_;

    // Shutdown() wakes the monitor thread from the pause between retries
    // on the error path, so stop() needn't wait it out
    std::mutex pauseMutex_;
    std::condition_variable pauseCv_;

    // OnEnvCleanup is registered with Node from start() until Shutdown()
    bool cleanupHookAdded_;

    // Current known reader states (Issue #111: keyed by reader name for reliable lookup)
    struct ReaderInfo {
        DWORD lastState;
        // Cached for reader-attached emissions; seeded by UpdateReaderList
        // and kept coherent on transitions by ApplyCardStateChange
        std::vector<uint8_t> atr;
    };
    std::unordered_map<std::string, ReaderInfo> readerStates_;
    // A recovery's resync couldn't read the readers afresh, so the cards
    // whose handles died in the outage are still to be reported (by the
    // next resync that can)
    bool outagePending_;

    // JavaScript methods
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value GetIsRunning(const Napi::CallbackInfo& info);

    // Internal methods
    void Shutdown();
    static void OnEnvCleanup(void* arg);
    void MonitorLoop(std::shared_ptr<std::atomic<bool>> sessionActive);
    bool UpdateReaderList();
    void ResyncReaderList(bool acrossOutage = false);
    LONG RecoverContext();
    void DetachAllReaders();
    void PauseBeforeRetry(const std::shared_ptr<std::atomic<bool>>& sessionActive);
    // code: the PC/SC error code, for "error" events only
    void EmitEvent(const std::string& eventType, const std::string& readerName,
                   DWORD state, const std::vector<uint8_t>& atr, DWORD code = 0);
    void ApplyCardStateChange(ReaderInfo& info, const std::string& readerName,
                              const SCARD_READERSTATE& readerState);
    void EmitCardEvent(smartcard::CardEvent event, const std::string& readerName,
                       DWORD state, const std::vector<uint8_t>& atr);
};
