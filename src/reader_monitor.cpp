#include "reader_monitor.h"
#include "pcsc_errors.h"
#include <cstring>
#include <unordered_map>
#include <memory>

Napi::FunctionReference ReaderMonitor::constructor;

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
      running_(false) {
}

ReaderMonitor::~ReaderMonitor() {
    // Ensure monitoring is stopped
    if (running_) {
        running_ = false;
        if (contextValid_) {
            SCardCancel(context_);
        }
        if (monitorThread_.joinable()) {
            monitorThread_.join();
        }
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

    // Create thread-safe function
    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ReaderMonitor",
        0,    // Unlimited queue size
        1,    // 1 initial thread
        [this](Napi::Env) {
            // Invoke destructor callback - called when tsfn is released
            running_ = false;
        }
    );

    // Start monitoring
    running_ = true;
    monitorThread_ = std::thread(&ReaderMonitor::MonitorLoop, this);

    return env.Undefined();
}

Napi::Value ReaderMonitor::Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!running_) {
        return env.Undefined();
    }

    running_ = false;

    // Cancel any blocking SCardGetStatusChange call
    if (contextValid_) {
        SCardCancel(context_);
    }

    // Wait for thread to finish
    if (monitorThread_.joinable()) {
        monitorThread_.join();
    }

    // Release thread-safe function
    tsfn_.Release();

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

void ReaderMonitor::MonitorLoop() {
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

    while (running_) {
        // Periodic full state refresh to handle Windows PC/SC state drift (Issue #111)
        // This ensures we don't miss events if the state tracking gets out of sync
        if (++iterationCount >= STATE_REFRESH_INTERVAL) {
            iterationCount = 0;
            std::lock_guard<std::mutex> lock(mutex_);

            // Get fresh state for all readers
            std::vector<SCARD_READERSTATE> refreshStates;
            std::vector<std::string> refreshNames;

            for (const auto& pair : readerStates_) {
                refreshNames.push_back(pair.first);
                SCARD_READERSTATE state = {};
                state.szReader = refreshNames.back().c_str();
                state.dwCurrentState = SCARD_STATE_UNAWARE;  // Force fresh state
                refreshStates.push_back(state);
            }

            if (!refreshStates.empty()) {
                LONG refreshResult = SCardGetStatusChange(context_, 0, refreshStates.data(), refreshStates.size());
                if (refreshResult == SCARD_S_SUCCESS) {
                    // Check for state divergence and emit missed events
                    for (size_t i = 0; i < refreshStates.size(); i++) {
                        const std::string& name = refreshNames[i];
                        auto it = readerStates_.find(name);
                        if (it != readerStates_.end()) {
                            DWORD oldState = it->second.lastState;
                            DWORD newState = refreshStates[i].dwEventState & ~SCARD_STATE_CHANGED;

                            bool wasPresent = (oldState & SCARD_STATE_PRESENT) != 0;
                            bool isPresent = (newState & SCARD_STATE_PRESENT) != 0;

                            if (wasPresent != isPresent) {
                                // State diverged - emit missed event
                                std::vector<uint8_t> atr;
                                if (refreshStates[i].cbAtr > 0) {
                                    atr.assign(refreshStates[i].rgbAtr,
                                              refreshStates[i].rgbAtr + refreshStates[i].cbAtr);
                                }

                                it->second.lastState = newState;
                                it->second.atr = atr;

                                if (isPresent) {
                                    EmitEvent("card-inserted", name, newState, atr);
                                } else {
                                    EmitEvent("card-removed", name, newState, {});
                                }
                            }
                        }
                    }
                }
            }
        }

        // Build states array using reader names from our map
        {
            std::lock_guard<std::mutex> lock(mutex_);
            states.clear();
            readerNames.clear();

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

        if (!running_) {
            break;
        }

        if (result == SCARD_E_CANCELLED) {
            break;
        }

        if (result == SCARD_E_TIMEOUT) {
            // Timeout - check for state divergence on Windows (Issue #111)
            // Windows PC/SC may not always set SCARD_STATE_CHANGED correctly
            // IMPORTANT: On timeout, dwEventState may contain stale data, so we must
            // make a fresh non-blocking query to get the actual current state
            std::lock_guard<std::mutex> lock(mutex_);

            // Guard against underflow if states only has PnP entry
            if (states.size() <= 1) {
                continue;
            }

            // Build fresh query states with SCARD_STATE_UNAWARE to get current state
            std::vector<SCARD_READERSTATE> freshStates;
            std::vector<std::string> freshNames;
            for (size_t i = 0; i < states.size() - 1; i++) {  // Skip PnP entry
                freshNames.push_back(readerNames[i]);
                SCARD_READERSTATE state = {};
                state.szReader = freshNames.back().c_str();
                state.dwCurrentState = SCARD_STATE_UNAWARE;  // Force fresh state query
                freshStates.push_back(state);
            }

            // Query current state (non-blocking)
            LONG freshResult = SCardGetStatusChange(context_, 0, freshStates.data(), freshStates.size());
            if (freshResult != SCARD_S_SUCCESS) {
                continue;
            }

            for (size_t i = 0; i < freshStates.size(); i++) {
                const std::string& name = freshNames[i];
                auto it = readerStates_.find(name);
                if (it != readerStates_.end()) {
                    DWORD currentState = freshStates[i].dwEventState & ~SCARD_STATE_CHANGED;
                    DWORD storedState = it->second.lastState;

                    bool wasPresent = (storedState & SCARD_STATE_PRESENT) != 0;
                    bool isPresent = (currentState & SCARD_STATE_PRESENT) != 0;

                    // If the PRESENT flag differs, we missed an event
                    if (wasPresent != isPresent) {
                        std::vector<uint8_t> atr;
                        if (freshStates[i].cbAtr > 0) {
                            atr.assign(freshStates[i].rgbAtr, freshStates[i].rgbAtr + freshStates[i].cbAtr);
                        }

                        it->second.lastState = currentState;
                        it->second.atr = atr;

                        if (isPresent) {
                            EmitEvent("card-inserted", name, currentState, atr);
                        } else {
                            EmitEvent("card-removed", name, currentState, {});
                        }
                    }
                }
            }
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            // Error - emit and continue
            EmitEvent("error", GetPCSCErrorString(result), 0, {});
            std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            continue;
        }

        // Process changes - use reader name for lookup (Issue #111 fix)
        std::lock_guard<std::mutex> lock(mutex_);
        bool pnpTriggered = false;

        for (size_t i = 0; i < states.size(); i++) {
            if (!(states[i].dwEventState & SCARD_STATE_CHANGED)) {
                continue;
            }

            // PnP notification - reader list changed
            if (readerNames[i] == "\\\\?PnP?\\Notification") {
                pnpTriggered = true;
                // Get old reader names
                std::vector<std::string> oldNames;
                for (const auto& pair : readerStates_) {
                    oldNames.push_back(pair.first);
                }

                // Update reader list (this rebuilds readerStates_ map)
                UpdateReaderList();

                // Find new readers
                for (const auto& pair : readerStates_) {
                    bool found = false;
                    for (const auto& old : oldNames) {
                        if (old == pair.first) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        EmitEvent("reader-attached", pair.first, pair.second.lastState, pair.second.atr);
                    }
                }

                // Find removed readers
                for (const auto& old : oldNames) {
                    if (readerStates_.find(old) == readerStates_.end()) {
                        EmitEvent("reader-detached", old, 0, {});
                    }
                }
                continue;
            }

            // Skip reader state processing if PnP was triggered in this iteration
            // The reader list has changed, so indices are no longer valid
            // We'll pick up any card changes on the next iteration with fresh state
            if (pnpTriggered) {
                continue;
            }

            // Reader state change - look up by name, not index (Issue #111 fix)
            const std::string& readerName = readerNames[i];
            auto it = readerStates_.find(readerName);

            if (it != readerStates_.end()) {
                DWORD oldState = it->second.lastState;
                DWORD newState = states[i].dwEventState;

                bool wasPresent = (oldState & SCARD_STATE_PRESENT) != 0;
                bool isPresent = (newState & SCARD_STATE_PRESENT) != 0;

                // Get ATR
                std::vector<uint8_t> atr;
                if (states[i].cbAtr > 0) {
                    atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
                }

                // Update stored state using the map
                it->second.lastState = newState & ~SCARD_STATE_CHANGED;
                it->second.atr = atr;

                // Emit appropriate event
                if (!wasPresent && isPresent) {
                    EmitEvent("card-inserted", readerName, newState, atr);
                } else if (wasPresent && !isPresent) {
                    EmitEvent("card-removed", readerName, newState, {});
                }
            }
        }
    }
}

void ReaderMonitor::UpdateReaderList() {
    // Get reader list size
    DWORD readersLen = 0;
    LONG result = SCardListReaders(context_, nullptr, nullptr, &readersLen);

    if (result == SCARD_E_NO_READERS_AVAILABLE || readersLen == 0) {
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

    SCardGetStatusChange(context_, 0, states.data(), states.size());

    // Update reader states map (Issue #111 fix: use map keyed by name)
    readerStates_.clear();
    for (size_t i = 0; i < newNames.size(); i++) {
        ReaderInfo info;
        info.lastState = states[i].dwEventState & ~SCARD_STATE_CHANGED;
        if (states[i].cbAtr > 0) {
            info.atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
        }
        readerStates_[newNames[i]] = info;
    }
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
