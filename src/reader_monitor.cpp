#include "reader_monitor.h"
#include "pcsc_errors.h"
#include <cstdio>
#include <cstring>
#include <unordered_map>
#include <memory>
#include "reader_state_utils.h"

using smartcard::CardEvent;
using smartcard::DetectCardStateChange;

Napi::FunctionReference ReaderMonitor::constructor;

// Format a PC/SC error as "message (0xXXXXXXXX)" so the numeric code
// survives to JS even when only the message string is consumed.
static std::string FormatPCSCError(LONG code) {
    char hex[16];
    std::snprintf(hex, sizeof(hex), " (0x%08X)", static_cast<unsigned int>(static_cast<DWORD>(code)));
    return std::string(GetPCSCErrorString(code)) + hex;
}

// Number of iterations between forced full state refreshes (Windows reliability fix)
static const int STATE_REFRESH_INTERVAL = 10;

// Event data passed from worker thread to JS thread
struct EventData {
    std::string eventType;
    std::string readerName;
    DWORD state;
    std::vector<uint8_t> atr;
};

Napi::Object ReaderMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ReaderMonitor", {
        InstanceMethod("start", &ReaderMonitor::Start),
        InstanceMethod("stop", &ReaderMonitor::Stop),
        InstanceAccessor("isRunning", &ReaderMonitor::GetIsRunning, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("ReaderMonitor", func);
    return exports;
}

ReaderMonitor::ReaderMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ReaderMonitor>(info),
      context_(0),
      contextValid_(false),
      running_(false),
      tsfnActive_(false) {
}

ReaderMonitor::~ReaderMonitor() {
    // Ensure monitoring is stopped
    if (running_) {
        running_ = false;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (contextValid_) {
                SCardCancel(context_);
            }
        }
        if (monitorThread_.joinable()) {
            monitorThread_.join();
        }
    }

    // A monitor destroyed without stop() would otherwise leak the tsfn,
    // keeping the event loop referenced and letting its finalizer run
    // after this object is gone
    if (tsfnActive_) {
        tsfn_.Release();
        tsfnActive_ = false;
    }

    if (contextValid_) {
        SCardReleaseContext(context_);
    }
}

Napi::Value ReaderMonitor::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (running_) {
        Napi::Error::New(env, "Monitor is already running").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Require callback function
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    // Establish PC/SC context
    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context_);
    if (result != SCARD_S_SUCCESS) {
        Napi::Error::New(env, GetPCSCErrorString(result)).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    contextValid_ = true;

    // Per-session liveness flag. The tsfn finalizer runs asynchronously on a
    // later event-loop tick, so after a same-tick stop()/start() a stale
    // finalizer from the previous session must only be able to kill its own
    // session - clearing running_ directly here would silently stop the new
    // monitor thread and leave its std::thread joinable but never joined.
    auto sessionActive = std::make_shared<std::atomic<bool>>(true);

    // Create thread-safe function
    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ReaderMonitor",
        0,    // Unlimited queue size
        1,    // 1 initial thread
        [sessionActive](Napi::Env) {
            // Called when the tsfn is released (stop() or env teardown)
            sessionActive->store(false);
        }
    );
    tsfnActive_ = true;

    // Start monitoring
    running_ = true;
    monitorThread_ = std::thread(&ReaderMonitor::MonitorLoop, this, sessionActive);

    return env.Undefined();
}

Napi::Value ReaderMonitor::Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!running_) {
        return env.Undefined();
    }

    running_ = false;

    // Cancel any blocking SCardGetStatusChange call. mutex_ guards
    // context_/contextValid_ against the recovery path swapping them
    // on the monitor thread.
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (contextValid_) {
            SCardCancel(context_);
        }
    }

    // Wait for thread to finish
    if (monitorThread_.joinable()) {
        monitorThread_.join();
    }

    // Release thread-safe function
    tsfn_.Release();
    tsfnActive_ = false;

    // Release context
    if (contextValid_) {
        SCardReleaseContext(context_);
        contextValid_ = false;
        context_ = 0;
    }

    readerStates_.clear();

    return env.Undefined();
}

Napi::Value ReaderMonitor::GetIsRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), running_.load());
}

// Single commit point for card state transitions: all three detection paths
// (main wait, timeout re-query, periodic refresh) must apply identical
// masking, ATR, and event rules or their stored states drift apart.
void ReaderMonitor::ApplyCardStateChange(ReaderInfo& info, const std::string& readerName,
                                         const SCARD_READERSTATE& readerState) {
    DWORD newState = readerState.dwEventState & ~SCARD_STATE_CHANGED;
    CardEvent event = DetectCardStateChange(info.lastState, newState, SCARD_STATE_PRESENT);

    // Commit so a stale lastState can't make the next SCardGetStatusChange
    // re-report the same change - but never store SCARD_STATE_IGNORE (fed
    // back as dwCurrentState it excludes the reader from future waits), and
    // don't absorb an unknown/empty no-event result: the PnP path handles
    // vanished readers.
    bool unusable = readerState.dwEventState == 0 ||
                    (newState & SCARD_STATE_UNKNOWN) != 0;
    if (event != CardEvent::None || !unusable) {
        info.lastState = newState & ~SCARD_STATE_IGNORE;
    }

    if (event == CardEvent::Inserted) {
        // cbAtr comes from the PC/SC service; clamp to the actual buffer size
        DWORD atrLen = readerState.cbAtr;
        if (atrLen > sizeof(readerState.rgbAtr)) {
            atrLen = sizeof(readerState.rgbAtr);
        }
        info.atr.assign(readerState.rgbAtr, readerState.rgbAtr + atrLen);
        EmitEvent("card-inserted", readerName, newState, info.atr);
    } else if (event == CardEvent::Removed) {
        info.atr.clear();
        EmitEvent("card-removed", readerName, newState, {});
    }
}

void ReaderMonitor::MonitorLoop(std::shared_ptr<std::atomic<bool>> sessionActive) {
    // Get initial reader list
    UpdateReaderList();

    // Emit reader-attached events for all pre-existing readers (Issue #30)
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& pair : readerStates_) {
            EmitEvent("reader-attached", pair.first, pair.second.lastState, pair.second.atr);
        }
    }

    // Build initial states array with PnP notification
    std::vector<SCARD_READERSTATE> states;
    std::vector<std::string> readerNames;
    int iterationCount = 0;

    while (running_ && sessionActive->load()) {
        // Periodic full state refresh to handle Windows PC/SC state drift (Issue #111)
        // This ensures we don't miss events if the state tracking gets out of sync
        if (++iterationCount >= STATE_REFRESH_INTERVAL) {
            iterationCount = 0;
            std::lock_guard<std::mutex> lock(mutex_);
            RefreshAllReaderStates();
        }

        // Build states array using reader names from our map
        {
            std::lock_guard<std::mutex> lock(mutex_);
            states.clear();
            readerNames.clear();

            // Reserve for all tracked readers + the PnP entry so no
            // push_back reallocates after szReader pointers are taken
            // (SSO strings move with the vector - see the refresh block
            // above). With a single reader the PnP push_back below is
            // otherwise guaranteed to reallocate on the first iteration.
            readerNames.reserve(readerStates_.size() + 1);

            // Add known readers - use the map for name-based lookup
            for (const auto& pair : readerStates_) {
                SCARD_READERSTATE state = {};
                readerNames.push_back(pair.first);
                state.szReader = readerNames.back().c_str();
                state.dwCurrentState = pair.second.lastState;
                states.push_back(state);
            }

            // Add PnP notification for new reader detection
            readerNames.push_back("\\\\?PnP?\\Notification");
            SCARD_READERSTATE pnpState = {};
            pnpState.szReader = readerNames.back().c_str();
            pnpState.dwCurrentState = SCARD_STATE_UNAWARE;
            states.push_back(pnpState);
        }

        // Wait for changes (with 1 second timeout for periodic refresh)
        LONG result = SCardGetStatusChange(context_, 1000, states.data(), states.size());

        if (!running_ || !sessionActive->load()) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_CANCELLED)) {
            break;
        }

        if (result == static_cast<LONG>(SCARD_E_TIMEOUT)) {
            // Timeout - query fresh state to detect missed events (Issue #111)
            // On Windows, dwEventState after timeout may just mirror dwCurrentState
            // rather than reflecting actual hardware state. We must explicitly
            // query with SCARD_STATE_UNAWARE to get the real current state.
            std::lock_guard<std::mutex> lock(mutex_);
            RefreshAllReaderStates();
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            // Error - emit and continue. The numeric code rides in the
            // message; state stays 0 so the field keeps its bitmask meaning.
            EmitEvent("error", FormatPCSCError(result), 0, {});

            // Context-fatal errors (Smart Card service restart, dead handle):
            // the existing context will never recover, so retrying it forever
            // is pointless (Issue #119). Release it and re-establish before
            // the next iteration. If re-establish fails, the next
            // SCardGetStatusChange on the zeroed handle fails fast and we
            // land back here - still one attempt per second.
            // SCARD_E_INVALID_PARAMETER is deliberately not in this list: it
            // is a per-call argument error, and recycling a healthy context
            // would re-seed lastState and latch away pending transitions.
            DWORD ucode = static_cast<DWORD>(result);
            if (ucode == SCARD_E_SERVICE_STOPPED ||
                ucode == SCARD_E_NO_SERVICE ||
                ucode == SCARD_E_INVALID_HANDLE) {
                // mutex_ also guards context_/contextValid_ against Stop()
                // and the destructor reading them for SCardCancel.
                std::lock_guard<std::mutex> lock(mutex_);
                if (contextValid_) {
                    SCardReleaseContext(context_);
                    contextValid_ = false;
                }
                context_ = 0;

                LONG establishResult = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context_);
                if (establishResult == SCARD_S_SUCCESS) {
                    contextValid_ = true;
                    // Reader states were tracked against the dead context:
                    // rebuild, emit whatever changed during the outage, and
                    // tell the JS layer to refresh its own context.
                    ResyncReaderList();
                    EmitEvent("monitor-recovered", "", 0, {});
                } else {
                    // The error event above already fired this cycle - stay
                    // at one error event per second while the service is down.
                    context_ = 0;
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            continue;
        }

        // Process changes - use reader name for lookup (Issue #111 fix)
        std::lock_guard<std::mutex> lock(mutex_);

        for (size_t i = 0; i < states.size(); i++) {
            if (!(states[i].dwEventState & SCARD_STATE_CHANGED)) {
                continue;
            }

            // PnP notification - reader list changed. The PnP entry is
            // always pushed last, and ResyncReaderList rebuilds the map, so
            // stop here: any entry processed after it would apply stale
            // states[] data against the rebuilt map.
            if (readerNames[i] == "\\\\?PnP?\\Notification") {
                ResyncReaderList();
                break;
            }

            // Reader state change - look up by name, not index (Issue #111 fix)
            const std::string& readerName = readerNames[i];
            auto it = readerStates_.find(readerName);

            if (it != readerStates_.end()) {
                ApplyCardStateChange(it->second, readerName, states[i]);
            }
        }
    }
}

// Re-query every tracked reader with SCARD_STATE_UNAWARE and commit/emit any
// missed transitions - the shared body of the periodic refresh and the
// timeout re-query (Issue #111). Caller holds mutex_.
void ReaderMonitor::RefreshAllReaderStates() {
    if (readerStates_.empty()) {
        return;
    }

    // Reserve before taking c_str() pointers: a reallocating push_back moves
    // SSO strings and dangles every previously captured szReader
    std::vector<SCARD_READERSTATE> states;
    std::vector<std::string> names;
    names.reserve(readerStates_.size());
    states.reserve(readerStates_.size());

    for (const auto& pair : readerStates_) {
        names.push_back(pair.first);
        SCARD_READERSTATE state = {};
        state.szReader = names.back().c_str();
        state.dwCurrentState = SCARD_STATE_UNAWARE;  // Force fresh state
        states.push_back(state);
    }

    if (SCardGetStatusChange(context_, 0, states.data(), states.size()) != SCARD_S_SUCCESS) {
        return;
    }

    for (size_t i = 0; i < states.size(); i++) {
        auto it = readerStates_.find(names[i]);
        if (it != readerStates_.end()) {
            ApplyCardStateChange(it->second, names[i], states[i]);
        }
    }
}

// Rebuild readerStates_ and emit the difference: reader-attached/detached
// for membership changes, card-inserted/removed for presence changes on
// surviving readers. Needed because UpdateReaderList re-seeds lastState
// from a fresh SCARD_STATE_UNAWARE query, which would otherwise silently
// latch away any transition that happened since the last wait (PnP churn,
// or a service outage the recovery path just healed). Caller holds mutex_.
void ReaderMonitor::ResyncReaderList() {
    std::unordered_map<std::string, DWORD> oldStates;
    for (const auto& pair : readerStates_) {
        oldStates[pair.first] = pair.second.lastState;
    }

    UpdateReaderList();

    for (const auto& pair : readerStates_) {
        if (oldStates.find(pair.first) == oldStates.end()) {
            EmitEvent("reader-attached", pair.first, pair.second.lastState, pair.second.atr);
        }
    }

    for (const auto& pair : oldStates) {
        if (readerStates_.find(pair.first) == readerStates_.end()) {
            EmitEvent("reader-detached", pair.first, 0, {});
        }
    }

    for (const auto& pair : readerStates_) {
        auto oldIt = oldStates.find(pair.first);
        if (oldIt == oldStates.end()) {
            continue;  // New reader - reader-attached already emitted
        }
        CardEvent event = DetectCardStateChange(oldIt->second, pair.second.lastState, SCARD_STATE_PRESENT);
        if (event == CardEvent::Inserted) {
            EmitEvent("card-inserted", pair.first, pair.second.lastState, pair.second.atr);
        } else if (event == CardEvent::Removed) {
            EmitEvent("card-removed", pair.first, pair.second.lastState, {});
        }
    }
}

void ReaderMonitor::UpdateReaderList() {
    // Get reader list size
    DWORD readersLen = 0;
    LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

    if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE) || readersLen == 0) {
        readerStates_.clear();
        return;
    }

    if (result != SCARD_S_SUCCESS) {
        return;
    }

    // Get reader names
    std::vector<char> buffer(readersLen);
    result = SCardListReaders(context_, nullptr, buffer.data(), &readersLen);

    if (result != SCARD_S_SUCCESS) {
        return;
    }

    // Parse multi-string
    std::vector<std::string> newNames;
    const char* p = buffer.data();
    while (*p != '\0') {
        newNames.push_back(std::string(p));
        p += strlen(p) + 1;
    }

    // Get initial state for new readers
    std::vector<SCARD_READERSTATE> states(newNames.size());
    for (size_t i = 0; i < newNames.size(); i++) {
        states[i].szReader = newNames[i].c_str();
        states[i].dwCurrentState = SCARD_STATE_UNAWARE;
    }

    LONG statusResult = SCardGetStatusChange(context_, 0, states.data(), states.size());
    bool seeded = (statusResult == SCARD_S_SUCCESS);

    // Update reader states map (Issue #111 fix: use map keyed by name)
    std::unordered_map<std::string, ReaderInfo> newStates;
    for (size_t i = 0; i < newNames.size(); i++) {
        ReaderInfo info;
        info.lastState = SCARD_STATE_UNAWARE;
        if (seeded) {
            info.lastState = states[i].dwEventState & ~SCARD_STATE_CHANGED;
            DWORD atrLen = states[i].cbAtr;
            if (atrLen > sizeof(states[i].rgbAtr)) {
                atrLen = sizeof(states[i].rgbAtr);
            }
            if (atrLen > 0) {
                info.atr.assign(states[i].rgbAtr, states[i].rgbAtr + atrLen);
            }
        } else {
            // Seed query failed: keep what we already knew about this reader
            // instead of zeroing it - a zeroed lastState reads as a card
            // removal to ResyncReaderList and as UNAWARE to the main wait.
            auto existing = readerStates_.find(newNames[i]);
            if (existing != readerStates_.end()) {
                info = existing->second;
            }
        }
        newStates[newNames[i]] = info;
    }
    readerStates_ = std::move(newStates);
}

void ReaderMonitor::EmitEvent(const std::string& eventType, const std::string& readerName,
                               DWORD state, const std::vector<uint8_t>& atr) {
    // Use shared_ptr to ensure memory is freed even if ThreadSafeFunction is released
    // before the callback executes (prevents memory leak)
    auto data = std::make_shared<EventData>(EventData{eventType, readerName, state, atr});

    // Call JavaScript callback on main thread
    // Capture shared_ptr by value to extend lifetime until callback executes
    tsfn_.BlockingCall(data.get(), [data](Napi::Env env, Napi::Function callback, EventData* ptr) {
        // Build event object
        Napi::Object event = Napi::Object::New(env);
        event.Set("type", Napi::String::New(env, ptr->eventType));
        event.Set("reader", Napi::String::New(env, ptr->readerName));
        event.Set("state", Napi::Number::New(env, ptr->state));

        if (!ptr->atr.empty()) {
            event.Set("atr", Napi::Buffer<uint8_t>::Copy(env, ptr->atr.data(), ptr->atr.size()));
        } else {
            event.Set("atr", env.Null());
        }

        // Call the callback
        callback.Call({event});
        // shared_ptr automatically cleaned up when lambda is destroyed
    });
}
