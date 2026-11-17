#include "reader_monitor.h"
#include "pcsc_errors.h"
#include "pcsc_napi_error.h"
#include <cstdio>
#include <cstring>
#include <unordered_map>
#include <memory>
#include "reader_state_utils.h"

using smartcard::CardEvent;
using smartcard::DetectCardStateChange;
using smartcard::DetectCardStateChangeAcrossOutage;

// Format a PC/SC error as "message (0xXXXXXXXX)" so the numeric code
// survives to JS even when only the message string is consumed.
static std::string FormatPCSCError(LONG code) {
    char hex[16];
    std::snprintf(hex, sizeof(hex), " (0x%08X)", static_cast<unsigned int>(static_cast<DWORD>(code)));
    return std::string(GetPCSCErrorString(code)) + hex;
}

// The context will never work again (Smart Card service stopped or
// restarted, dead handle), so release it and re-establish (Issue #119).
// SCARD_E_INVALID_PARAMETER is deliberately not one: it is a per-call
// argument error, and recycling a healthy context would re-seed lastState
// and latch away pending transitions.
static bool IsContextFatal(LONG result) {
    DWORD code = static_cast<DWORD>(result);
    if (code == SCARD_E_SERVICE_STOPPED || code == SCARD_E_NO_SERVICE ||
        code == SCARD_E_INVALID_HANDLE) {
        return true;
    }
#ifdef _WIN32
    // WinSCard may report a dead context as the Win32 error instead
    if (code == ERROR_INVALID_HANDLE) {
        return true;
    }
#endif
    return false;
}

// Number of iterations between forced full state refreshes (Windows reliability fix)
static const int STATE_REFRESH_INTERVAL = 10;

// Event data passed from worker thread to JS thread
struct EventData {
    std::string eventType;
    std::string readerName;
    DWORD state;
    std::vector<uint8_t> atr;
    DWORD code;
};

Napi::Object ReaderMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ReaderMonitor", {
        InstanceMethod("start", &ReaderMonitor::Start),
        InstanceMethod("stop", &ReaderMonitor::Stop),
        InstanceAccessor("isRunning", &ReaderMonitor::GetIsRunning, nullptr),
    });

    exports.Set("ReaderMonitor", func);
    return exports;
}

ReaderMonitor::ReaderMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ReaderMonitor>(info),
      context_(0),
      contextValid_(false),
      running_(false),
      tsfnActive_(false),
      cleanupHookAdded_(false),
      outagePending_(false) {
}

ReaderMonitor::~ReaderMonitor() {
    Shutdown();
}

// Stop the monitor thread and release the tsfn and the PC/SC context.
// stop(), the destructor (GC, or Node finalizing objects at environment
// teardown) and the environment cleanup hook all end up here.
void ReaderMonitor::Shutdown() {
    if (cleanupHookAdded_) {
        napi_remove_env_cleanup_hook(Env(), OnEnvCleanup, this);
        cleanupHookAdded_ = false;
    }

    if (running_) {
        running_ = false;

        // Wake the monitor thread if it is pausing between retries
        {
            std::lock_guard<std::mutex> lock(pauseMutex_);
        }
        pauseCv_.notify_all();

        // Cancel any blocking SCardGetStatusChange call. mutex_ guards
        // context_/contextValid_ against the recovery path swapping them
        // on the monitor thread.
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
        contextValid_ = false;
        context_ = 0;
    }

    readerStates_.clear();
    outagePending_ = false;
}

// Node is tearing the environment down (a worker exiting or terminated)
// with the monitor still running. The tsfn's own cleanup hook would close
// it first and finalize this object only afterwards, so the destructor's
// Release() would reach a tsfn Node has finished with: on Node 24.15+ it
// locks the tsfn's mutex again (SIGABRT, or a hang on Linux); on Node
// 20/22 it touches a tsfn being deleted, and the monitor thread may still
// push to it (spec/README.md, finding 4). Node runs cleanup hooks newest
// first, and start() adds this one after the tsfn has added its own, so
// it stops the monitor while the tsfn is still alive.
void ReaderMonitor::OnEnvCleanup(void* arg) {
    auto* self = static_cast<ReaderMonitor*>(arg);
    // Node drops the hook itself once it has run
    self->cleanupHookAdded_ = false;
    self->Shutdown();
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
        NewPCSCError(env, result).ThrowAsJavaScriptException();
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
    tsfn_ = MonitorEventTsfn::New(
        env,
        callback,
        "ReaderMonitor",
        0,          // Unlimited queue size
        1,          // 1 initial thread
        nullptr,    // No context
        [sessionActive](Napi::Env, void*, std::nullptr_t*) {
            // Called when the tsfn is released (stop() or env teardown)
            sessionActive->store(false);
        }
    );
    tsfnActive_ = true;

    // Added after the tsfn, so that at environment teardown it runs first
    cleanupHookAdded_ =
        napi_add_env_cleanup_hook(env, OnEnvCleanup, this) == napi_ok;

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

    Shutdown();

    return env.Undefined();
}

Napi::Value ReaderMonitor::GetIsRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), running_.load());
}

// Emit what a detected card event means to JS. state is the reader's
// state now; a Replaced card is reported as the old card leaving, then the
// new one arriving, and the leaving event gets that state as an empty
// reader so its flags match the event.
void ReaderMonitor::EmitCardEvent(CardEvent event, const std::string& readerName,
                                  DWORD state, const std::vector<uint8_t>& atr) {
    if (event == CardEvent::Removed) {
        EmitEvent("card-removed", readerName, state, {});
    } else if (event == CardEvent::Replaced) {
        EmitEvent("card-removed", readerName,
                  (state & ~SCARD_STATE_PRESENT) | SCARD_STATE_EMPTY, {});
    }
    if (event == CardEvent::Inserted || event == CardEvent::Replaced) {
        EmitEvent("card-inserted", readerName, state, atr);
    }
}

// Commit point for card state transitions seen by the main wait.
// ResyncReaderList (PnP, timeouts, periodic refresh, recovery) detects
// events from its fresh reads with the same DetectCardStateChange and
// EmitCardEvent; UpdateReaderList, which stores those reads, applies the
// same IGNORE masking.
void ReaderMonitor::ApplyCardStateChange(ReaderInfo& info, const std::string& readerName,
                                         const SCARD_READERSTATE& readerState) {
    DWORD newState = readerState.dwEventState & ~SCARD_STATE_CHANGED;
    CardEvent event = DetectCardStateChange(info.lastState, newState, SCARD_STATE_PRESENT,
                                            SMARTCARD_PCSC_COUNTS_CARD_EVENTS);

    // Commit so a stale lastState can't make the next SCardGetStatusChange
    // re-report the same change - but never store SCARD_STATE_IGNORE (fed
    // back as dwCurrentState it excludes the reader from future waits), and
    // don't absorb an unknown/empty no-event result: a reader that vanished
    // during the wait is dropped by the PnP resync, one that vanished
    // between waits by the SCARD_E_UNKNOWN_READER resync.
    bool unusable = readerState.dwEventState == 0 ||
                    (newState & SCARD_STATE_UNKNOWN) != 0;
    if (event != CardEvent::None || !unusable) {
        info.lastState = newState & ~SCARD_STATE_IGNORE;
    }

    if (event == CardEvent::Inserted || event == CardEvent::Replaced) {
        // cbAtr comes from the PC/SC service; clamp to the actual buffer size
        DWORD atrLen = readerState.cbAtr;
        if (atrLen > sizeof(readerState.rgbAtr)) {
            atrLen = sizeof(readerState.rgbAtr);
        }
        info.atr.assign(readerState.rgbAtr, readerState.rgbAtr + atrLen);
    } else if (event == CardEvent::Removed) {
        info.atr.clear();
    }
    EmitCardEvent(event, readerName, newState, info.atr);
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
    // The last wait failed with SCARD_E_UNKNOWN_READER right after a resync
    bool resyncedForUnknownReader = false;
    // The PnP entry's dwCurrentState: the reader event count from the last
    // wait (SMARTCARD_PCSC_PNP_COUNTS_READER_EVENTS), so that a reader
    // plugged in or unplugged between two waits ends the next one at once
    // rather than at the next re-list. SCARD_STATE_UNAWARE until known.
    DWORD pnpCurrentState = SCARD_STATE_UNAWARE;

    while (running_ && sessionActive->load()) {
        // The context died in a service outage and re-establishing it
        // failed: keep trying, once a second, before anything uses it.
        // (Waiting on the dead handle instead relied on the error that
        // returns, which differs by platform: pcsc-lite says
        // SCARD_E_INVALID_HANDLE, which was in the recovery list below,
        // but WinSCard may say ERROR_INVALID_HANDLE, which isn't.)
        if (!contextValid_) {
            LONG recovered = RecoverContext();
            if (recovered != SCARD_S_SUCCESS) {
                // One error event a second while the service is down
                EmitEvent("error", FormatPCSCError(recovered), 0, {},
                          static_cast<DWORD>(recovered));
                // Still down a second after it failed: no reader can be
                // used, so report them all detached (once). On Windows the
                // service stops when its last reader is unplugged, so this
                // is also how that unplug is reported.
                DetachAllReaders();
                PauseBeforeRetry(sessionActive);
                continue;
            }
            // The recovery re-listed the readers
            iterationCount = 0;
            resyncedForUnknownReader = false;
        }

        // Periodic full resync to handle Windows PC/SC state drift (Issue
        // #111). It re-lists readers too, because under constant card
        // activity the wait may not time out, and the timeout path's
        // re-list (see below) catches what the waits can't see.
        if (++iterationCount >= STATE_REFRESH_INTERVAL) {
            iterationCount = 0;
            std::lock_guard<std::mutex> lock(mutex_);
            ResyncReaderList();
        }

        // Build states array using reader names from our map
        {
            std::lock_guard<std::mutex> lock(mutex_);
            states.clear();
            readerNames.clear();

            // Reserve for all tracked readers + the PnP entry so no
            // push_back reallocates after szReader pointers are taken: a
            // reallocation moves the strings, and short names live inline
            // in the string object (SSO - 15 chars on MSVC, e.g. "ACS ACR122
            // 0"), so every szReader taken earlier would dangle and
            // SCardGetStatusChange would read garbage. With a single reader
            // the PnP push_back below would otherwise reallocate on the first
            // iteration.
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
            pnpState.dwCurrentState = pnpCurrentState;
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

        // A returned wait has the count in the PnP entry (pushed last);
        // a failed one may not
        if (SMARTCARD_PCSC_PNP_COUNTS_READER_EVENTS &&
            (result == SCARD_S_SUCCESS ||
             result == static_cast<LONG>(SCARD_E_TIMEOUT))) {
            pnpCurrentState = states.back().dwEventState & 0xFFFF0000;
        }

        // A reader passed to the wait has gone: pcsc-lite checks every name
        // before waiting and rejects the whole call, so every later wait
        // would fail the same way and no reader's events get through
        // (spec/README.md, finding 3). An unplug is routine, so re-list and
        // wait again at once - no error event, no sleep. If it fails the
        // same way straight after a re-list, take the error path below (one
        // error a second, still re-listing) so a lasting failure can't spin.
        bool unknownReader = result == static_cast<LONG>(SCARD_E_UNKNOWN_READER);
        if (unknownReader && !resyncedForUnknownReader) {
            resyncedForUnknownReader = true;
            std::lock_guard<std::mutex> lock(mutex_);
            ResyncReaderList();
            continue;
        }
        resyncedForUnknownReader = unknownReader;

        if (result == static_cast<LONG>(SCARD_E_TIMEOUT)) {
            // Timeout - re-list readers and re-read every reader with
            // SCARD_STATE_UNAWARE to catch missed events:
            // - On Windows, dwEventState after timeout may just mirror
            //   dwCurrentState rather than the hardware (Issue #111).
            // - Without a reader event count (see pnpCurrentState) the PnP
            //   entry reports only reader changes made during a call; a
            //   reader plugged in between two waits is otherwise never
            //   announced (spec/README.md, finding 2). With the count, one
            //   plugged in before the first wait still isn't.
            // - pcsc-lite compares a reader's card event counter only if
            //   the one passed in is nonzero, so a card swapped between
            //   waits in a reader that was plugged in with it doesn't end
            //   the wait (Events-seeded-swap).
            // That is the periodic resync's work too, so restart its count.
            iterationCount = 0;
            std::lock_guard<std::mutex> lock(mutex_);
            ResyncReaderList();
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            // Error - emit and continue. The numeric code rides in the
            // event's code field (and the message, for message-only
            // consumers); state stays 0 so it keeps its bitmask meaning.
            EmitEvent("error", FormatPCSCError(result), 0, {}, static_cast<DWORD>(result));

            // The context is dead: release it. The top of the loop
            // re-establishes it after the pause - once a second until the
            // service is back - so there is one recovery path, and it
            // can't spin.
            DWORD ucode = static_cast<DWORD>(result);
            if (IsContextFatal(result)) {
                // mutex_ also guards context_/contextValid_ against Stop()
                // and the destructor reading them for SCardCancel
                std::lock_guard<std::mutex> lock(mutex_);
                if (contextValid_) {
                    SCardReleaseContext(context_);
                    contextValid_ = false;
                }
                context_ = 0;
            } else if (ucode == SCARD_E_UNKNOWN_READER) {
                // Still failing after the re-list above: keep re-listing,
                // once a second
                std::lock_guard<std::mutex> lock(mutex_);
                ResyncReaderList();
            }

            PauseBeforeRetry(sessionActive);
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

// Re-establish the context after a service outage. On success tell JS
// (monitor-recovered), then report what changed during the outage.
LONG ReaderMonitor::RecoverContext() {
    // Establish outside mutex_: it can take a while when the service is
    // starting, and Shutdown() needs mutex_ to cancel
    SCARDCONTEXT context = 0;
    LONG result = SCardEstablishContext(SCARD_SCOPE_SYSTEM, nullptr, nullptr, &context);
    if (result != SCARD_S_SUCCESS) {
        return result;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    context_ = context;
    contextValid_ = true;
    // JS's own context died in the same outage. Tell it first, so it
    // replaces that context before handling the card events below.
    EmitEvent("monitor-recovered", "", 0, {});
    // Reader states were tracked against the dead context: rebuild them.
    // Every card handle died too, so each card still in its reader is
    // reported as replaced, and JS connects to it again. (If the readers
    // were reported detached during the outage, they are attached again.)
    ResyncReaderList(true);
    return SCARD_S_SUCCESS;
}

// The service is unavailable: report every reader detached and forget
// them. Recovery's resync attaches whatever is there when it is back.
void ReaderMonitor::DetachAllReaders() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& pair : readerStates_) {
        EmitEvent("reader-detached", pair.first, 0, {});
    }
    readerStates_.clear();
    outagePending_ = false;
}

// The 1 s pause between retries on the error path. Shutdown() cuts it
// short, so stop(), the destructor and the teardown hook don't wait it out.
void ReaderMonitor::PauseBeforeRetry(const std::shared_ptr<std::atomic<bool>>& sessionActive) {
    std::unique_lock<std::mutex> lock(pauseMutex_);
    pauseCv_.wait_for(lock, std::chrono::milliseconds(1000), [&] {
        return !running_ || !sessionActive->load();
    });
}

// Rebuild readerStates_ and emit the difference: reader-attached/detached
// for membership changes, card-inserted/removed for presence changes and
// swaps on surviving readers. Needed because UpdateReaderList re-seeds
// lastState from a fresh SCARD_STATE_UNAWARE query, which would otherwise
// silently latch away any transition that happened since the last wait
// (PnP churn, a vanished reader, a timeout, or a service outage the
// recovery path just healed). Caller holds mutex_. acrossOutage: the old
// states were read before a service outage (see RecoverContext).
void ReaderMonitor::ResyncReaderList(bool acrossOutage) {
    std::unordered_map<std::string, DWORD> oldStates;
    for (const auto& pair : readerStates_) {
        oldStates[pair.first] = pair.second.lastState;
    }

    bool fresh = UpdateReaderList();

    // Across an outage only a fresh reading shows which cards are still
    // there; if this one isn't, the next resync owes the comparison
    acrossOutage = acrossOutage || outagePending_;
    outagePending_ = acrossOutage && !fresh;
    bool replaceHeldCards = acrossOutage && fresh;

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
        CardEvent event = replaceHeldCards
            ? DetectCardStateChangeAcrossOutage(oldIt->second, pair.second.lastState,
                                                SCARD_STATE_PRESENT)
            : DetectCardStateChange(oldIt->second, pair.second.lastState,
                                    SCARD_STATE_PRESENT,
                                    SMARTCARD_PCSC_COUNTS_CARD_EVENTS);
        EmitCardEvent(event, pair.first, pair.second.lastState, pair.second.atr);
    }
}

// Returns whether readerStates_ now comes from a fresh reading (false: it
// kept what it had, because a call failed)
bool ReaderMonitor::UpdateReaderList() {
    // Get reader list size
    DWORD readersLen = 0;
    LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

    if (result == static_cast<LONG>(SCARD_E_NO_READERS_AVAILABLE)) {
        readerStates_.clear();
        return true;
    }

    // Any other failure (the service went away, say) says nothing about
    // the readers: keep the map rather than report every reader detached.
    // readersLen is left untouched on failure, so check this first.
    if (result != SCARD_S_SUCCESS) {
        return false;
    }

    if (readersLen == 0) {
        readerStates_.clear();
        return true;
    }

    // Get reader names
    std::vector<char> buffer(readersLen);
    result = SCardListReaders(context_, nullptr, buffer.data(), &readersLen);

    if (result != SCARD_S_SUCCESS) {
        return false;
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
    if (statusResult == static_cast<LONG>(SCARD_E_UNKNOWN_READER)) {
        // A listed reader vanished before this read (pcsc-lite rejects the
        // whole call). Keep the current map rather than announce readers
        // with no state; the next resync lists again.
        return false;
    }
    bool seeded = (statusResult == SCARD_S_SUCCESS);

    // Update reader states map (Issue #111 fix: use map keyed by name)
    std::unordered_map<std::string, ReaderInfo> newStates;
    for (size_t i = 0; i < newNames.size(); i++) {
        ReaderInfo info;
        info.lastState = SCARD_STATE_UNAWARE;
        if (seeded) {
            // Never store SCARD_STATE_IGNORE: fed back as dwCurrentState it
            // excludes the reader from future waits (as ApplyCardStateChange)
            info.lastState = states[i].dwEventState & ~(SCARD_STATE_CHANGED | SCARD_STATE_IGNORE);
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
    return seeded;
}

void ReaderMonitor::EmitEvent(const std::string& eventType, const std::string& readerName,
                               DWORD state, const std::vector<uint8_t>& atr, DWORD code) {
    // Owned by the tsfn's queue from here: DeliverMonitorEvent frees it.
    // If the tsfn won't take it (closing), it was never queued.
    auto* data = new EventData{eventType, readerName, state, atr, code};
    if (tsfn_.BlockingCall(data) != napi_ok) {
        delete data;
    }
}

void DeliverMonitorEvent(Napi::Env env, Napi::Function callback,
                         std::nullptr_t* /*context*/, EventData* data) {
    std::unique_ptr<EventData> owned(data);

    // Node is draining the queue because the environment is being torn
    // down (a worker exiting) before the event was dispatched
    if (static_cast<napi_env>(env) == nullptr || callback.IsEmpty()) {
        return;
    }

    napi_value event;
    try {
        Napi::Object object = Napi::Object::New(env);
        object.Set("type", Napi::String::New(env, owned->eventType));
        object.Set("reader", Napi::String::New(env, owned->readerName));
        object.Set("state", Napi::Number::New(env, owned->state));
        if (!owned->atr.empty()) {
            object.Set("atr", Napi::Buffer<uint8_t>::Copy(env, owned->atr.data(),
                                                         owned->atr.size()));
        } else {
            object.Set("atr", env.Null());
        }
        if (owned->code != 0) {
            object.Set("code", Napi::Number::New(env, owned->code));
        }
        event = object;
    } catch (const Napi::Error&) {
        // The environment is shutting down and can no longer build it
        return;
    }

    // Through the C API, not callback.Call(): if the callback throws, its
    // exception stays pending and Node reports it as uncaught (as before);
    // if the call is refused because the environment is shutting down,
    // the event is dropped. callback.Call() turned that refusal into a C++
    // exception which node-addon-api, unable to throw it into JS, rethrew
    // into Node - std::terminate, killing the whole process.
    napi_call_function(env, env.Undefined(), callback, 1, &event, nullptr);
}
