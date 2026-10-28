#pragma once

#include <memory>
#include "platform/pcsc.h"

// An SCARDCONTEXT shared by the Context that established it and every Reader
// and Card created from it. PC/SC invalidates all card handles when their
// context is released, and GC finalizes those objects in no particular order,
// so the release waits for the last holder - unless Context.close() releases
// it explicitly, after which holders see IsValid() == false.
//
// Shared ownership rather than JS references between the objects: a
// persistent napi reference is a GC root, so Context <-> Reader/Card links
// held that way would keep a cycle alive forever.
//
// Main thread only. Async workers copy Get() when they are created.
class ContextHandle {
public:
    explicit ContextHandle(SCARDCONTEXT context) : context_(context) {}
    ~ContextHandle() { Release(); }

    ContextHandle(const ContextHandle&) = delete;
    ContextHandle& operator=(const ContextHandle&) = delete;

    SCARDCONTEXT Get() const { return context_; }
    bool IsValid() const { return context_ != 0; }

    void Release() {
        if (context_ != 0) {
            SCardReleaseContext(context_);
            context_ = 0;
        }
    }

private:
    SCARDCONTEXT context_;
};

using ContextHandlePtr = std::shared_ptr<ContextHandle>;
