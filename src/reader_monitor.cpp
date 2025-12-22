#include "reader_monitor.h"
#include "pcsc_errors.h"
#include <cstring>

Napi::FunctionReference ReaderMonitor::constructor;

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

    readers_.clear();

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
        for (const auto& reader : readers_) {
            EmitEvent("reader-attached", reader.name, reader.lastState, reader.atr);
        }
    }

    // Build initial states array with PnP notification
    std::vector<SCARD_READERSTATE> states;
    std::vector<std::string> readerNames;

    while (running_) {
        // Build states array
        {
            std::lock_guard<std::mutex> lock(mutex_);
            states.clear();
            readerNames.clear();

            // Add known readers
            for (auto& reader : readers_) {
                SCARD_READERSTATE state = {};
                readerNames.push_back(reader.name);
                state.szReader = readerNames.back().c_str();
                state.dwCurrentState = reader.lastState;
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
            // No changes, continue
            continue;
        }

        if (result != SCARD_S_SUCCESS) {
            // Error - emit and continue
            EmitEvent("error", GetPCSCErrorString(result), 0, {});
            std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            continue;
        }

        // Process changes
        std::lock_guard<std::mutex> lock(mutex_);

        for (size_t i = 0; i < states.size(); i++) {
            if (!(states[i].dwEventState & SCARD_STATE_CHANGED)) {
                continue;
            }

            // PnP notification - reader list changed
            if (readerNames[i] == "\\\\?PnP?\\Notification") {
                // Get old reader names
                std::vector<std::string> oldNames;
                for (const auto& r : readers_) {
                    oldNames.push_back(r.name);
                }

                // Update reader list
                UpdateReaderList();

                // Find new readers
                for (const auto& r : readers_) {
                    bool found = false;
                    for (const auto& old : oldNames) {
                        if (old == r.name) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        EmitEvent("reader-attached", r.name, r.lastState, r.atr);
                    }
                }

                // Find removed readers
                for (const auto& old : oldNames) {
                    bool found = false;
                    for (const auto& r : readers_) {
                        if (r.name == old) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        EmitEvent("reader-detached", old, 0, {});
                    }
                }
                continue;
            }

            // Reader state change
            if (i < readers_.size()) {
                DWORD oldState = readers_[i].lastState;
                DWORD newState = states[i].dwEventState;

                bool wasPresent = (oldState & SCARD_STATE_PRESENT) != 0;
                bool isPresent = (newState & SCARD_STATE_PRESENT) != 0;

                // Get ATR
                std::vector<uint8_t> atr;
                if (states[i].cbAtr > 0) {
                    atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
                }

                // Update stored state
                readers_[i].lastState = newState & ~SCARD_STATE_CHANGED;
                readers_[i].atr = atr;

                // Emit appropriate event
                if (!wasPresent && isPresent) {
                    EmitEvent("card-inserted", readerNames[i], newState, atr);
                } else if (wasPresent && !isPresent) {
                    EmitEvent("card-removed", readerNames[i], newState, {});
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
        readers_.clear();
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

    // Update reader list
    readers_.clear();
    for (size_t i = 0; i < newNames.size(); i++) {
        ReaderInfo info;
        info.name = newNames[i];
        info.lastState = states[i].dwEventState & ~SCARD_STATE_CHANGED;
        if (states[i].cbAtr > 0) {
            info.atr.assign(states[i].rgbAtr, states[i].rgbAtr + states[i].cbAtr);
        }
        readers_.push_back(info);
    }
}

void ReaderMonitor::EmitEvent(const std::string& eventType, const std::string& readerName,
                               DWORD state, const std::vector<uint8_t>& atr) {
    // Copy data for transfer to JS thread
    EventData* data = new EventData{eventType, readerName, state, atr};

    // Call JavaScript callback on main thread
    tsfn_.BlockingCall(data, [](Napi::Env env, Napi::Function callback, EventData* data) {
        // Build event object
        Napi::Object event = Napi::Object::New(env);
        event.Set("type", Napi::String::New(env, data->eventType));
        event.Set("reader", Napi::String::New(env, data->readerName));
        event.Set("state", Napi::Number::New(env, data->state));

        if (!data->atr.empty()) {
            event.Set("atr", Napi::Buffer<uint8_t>::Copy(env, data->atr.data(), data->atr.size()));
        } else {
            event.Set("atr", env.Null());
        }

        // Call the callback
        callback.Call({event});

        delete data;
    });
}
