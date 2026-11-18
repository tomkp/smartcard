---------------------------- MODULE WaitLifecycle ----------------------------
(***************************************************************************)
(* Context.waitForChange(), cancel() and close() (src/async_workers.cpp,   *)
(* src/pcsc_context.cpp): the JS main thread; each wait's own thread; its  *)
(* mutex_, cancelled_ and waited_; its PC/SC context; pcsc-lite's locks;   *)
(* the wait's thread-safe function (tsfn), whose finalizer OnDone settles  *)
(* the promise; and the environment cleanup hook OnEnvCleanup.             *)
(*                                                                         *)
(* Readers and cards are abstracted away: a wait returns because pcscd     *)
(* reported something, it timed out, or it was cancelled. The questions:   *)
(* does cancel() end every pending wait, does every JS call return, is     *)
(* every wait settled and freed, and can teardown hang or crash?           *)
(*                                                                         *)
(* pcsc-lite (src/winscard_clnt.c) has a global lock and one lock per      *)
(* context. Every call takes the global lock. SCardGetStatusChange and     *)
(* SCardReleaseContext then lock their context while still holding the     *)
(* global lock (SCardGetContextAndLock), and a wait keeps its context      *)
(* locked for as long as it lasts. SCardCancel only reads the context's    *)
(* "cancellable" flag, which a wait sets only while it is blocked waiting  *)
(* for pcscd: a cancel at any other moment does nothing.                   *)
(*                                                                         *)
(* pcscd is assumed to answer: a call's exchange with it is part of one    *)
(* step. (SCardEstablishContext, for one, holds the global lock through    *)
(* two round trips to pcscd, so a pcscd that stops answering stalls every  *)
(* PC/SC call in the process; that is outside the model.)                  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    MaxWaits,     \* how many times JS may call waitForChange()
    MaxEvents,    \* how many things pcscd may do, in total: report a change
                  \*   or an error, wake a wait for another reader's event,
                  \*   or fail SCardEstablishContext
    MaxAttempts,  \* how many times cancel() and close() call SCardCancel on
                  \*   one wait before giving up (the code: 200, 5 ms apart);
                  \*   0 = until the wait returns
    Ops,          \* what else JS may call: a subset of {"cancel", "close", "list"}
                  \*   ("list" stands for any call on the Context's own PC/SC
                  \*   context: listReaders(), or waitForChange() listing the
                  \*   readers when none are given)
    Design,       \* "current"; "pre161": as in #158 (698e2d9), where every wait
                  \*   used the Context's PC/SC context and cancel() called
                  \*   SCardCancel once
    WithTeardown  \* Node may tear the environment down (e.g. a worker exits)

ASSUME /\ MaxWaits \in Nat \ {0}
       /\ MaxEvents \in Nat
       /\ MaxAttempts \in Nat
       /\ Ops \subseteq {"cancel", "close", "list"}
       /\ Design \in {"current", "pre161"}
       /\ WithTeardown \in BOOLEAN

Waits == 1..MaxWaits
\* PC/SC contexts: 0 is the Context's own; w is wait w's (current design)
Ctxs == 0..MaxWaits
\* Who holds a pcsc-lite lock
Nobody == 0
JS == MaxWaits + 1
Holders == 0..MaxWaits + 1

\* The context wait w waits on
CtxOf(w) == IF Design = "current" THEN w ELSE 0

VARIABLES
    \* each WaitForChangeWorker w
    wpc,        \* where its thread is
    result,     \* result_
    timed,      \* it was given a timeout (else INFINITE, the default)
    cancelled,  \* cancelled_
    waited,     \* waited_: Execute() is done with the context
    mtx,        \* who holds mutex_: "none" | "js" | "thread"
    ctxValid,   \* contextValid_
    tsfn,       \* "unused" | "live" | "released" | "closing" (its teardown
                \*   hook has run) | "deleted". Deleted once OnDone has run,
                \*   which deletes the worker too.
    hook,       \* OnEnvCleanup is registered with Node
    envGone,    \* envTornDown_
    outcome,    \* what JS got: "pending" | "array" | "empty" | "null" |
                \*   "rejected" | "unsettled" (freed at teardown)
    cancelReq,  \* ghost: JS called cancel() or close() before w returned
    \* pcsc-lite, in this process
    ctx,        \* ctx[c]: "none" | "open" | "released"
    glock,      \* who holds the global lock across steps (blocked on a
                \*   context lock); calls that take it only briefly do so
                \*   inside one step
    ctxLock,    \* ctxLock[c]: who holds context c's lock
    events,     \* things pcscd has done so far
    \* the JS main thread
    jpc,        \* where it is
    jcall,      \* the JS call it is in: "none" | "cancel" | "close" | "list"
    jret,       \* who is running CancelUntilReturned or OnDone: "call" (cancel()
                \*   or close()), "hook" (OnEnvCleanup), "loop" (the event
                \*   loop), "td" (the tsfn's cleanup hook)
    cw,         \* the wait being cancelled, joined or finalized
    attempts,   \* SCardCancel calls on cw so far (counted only with a limit)
    toCancel,   \* CancelPendingWaits: the waits it has yet to cancel
    started,    \* waits started so far
    \* the environment
    dying,      \* Node has begun tearing the environment down: JS can't run
    tslot,      \* teardown: whose OnEnvCleanup runs next, counting down
                \*   from the newest wait (0: not yet begun)
    torn,       \* every cleanup hook has run
    crash       \* "none", or the fatal thing that happened

waitVars == <<wpc, result, timed, cancelled, waited, mtx, ctxValid, tsfn, hook,
              envGone, outcome, cancelReq>>
pcscVars == <<ctx, glock, ctxLock, events>>
jsVars == <<jpc, jcall, jret, cw, attempts, toCancel, started>>
envVars == <<dying, tslot, torn>>
vars == <<waitVars, pcscVars, jsVars, envVars, crash>>

ThreadPCs == {"none", "establish", "publish", "lock", "stuck", "check",
              "blocked", "returned", "releasectx", "release", "finished",
              "joined"}
JsPCs == {"idle", "listAcq", "listStuck", "preCancel", "cancelNext", "cuLock",
          "cuCall", "cuSleep", "closeAcq", "closeStuck", "doneJoin",
          "hookJoin", "tdNext", "gone"}

TypeOK ==
    /\ wpc \in [Waits -> ThreadPCs]
    /\ result \in [Waits -> {"none", "change", "timeout", "cancelled", "error"}]
    /\ timed \in [Waits -> BOOLEAN]
    /\ cancelled \in [Waits -> BOOLEAN]
    /\ waited \in [Waits -> BOOLEAN]
    /\ mtx \in [Waits -> {"none", "js", "thread"}]
    /\ ctxValid \in [Waits -> BOOLEAN]
    /\ tsfn \in [Waits -> {"unused", "live", "released", "closing", "deleted"}]
    /\ hook \in [Waits -> BOOLEAN]
    /\ envGone \in [Waits -> BOOLEAN]
    /\ outcome \in [Waits -> {"pending", "array", "empty", "null", "rejected",
                              "unsettled"}]
    /\ cancelReq \in [Waits -> BOOLEAN]
    /\ ctx \in [Ctxs -> {"none", "open", "released"}]
    /\ glock \in Holders
    /\ ctxLock \in [Ctxs -> Holders]
    /\ events \in 0..MaxEvents
    /\ jpc \in JsPCs
    /\ jcall \in {"none", "cancel", "close", "list"}
    /\ jret \in {"call", "hook", "loop", "td"}
    /\ cw \in 0..MaxWaits
    /\ attempts \in 0..MaxAttempts
    /\ toCancel \subseteq Waits
    /\ started \in 0..MaxWaits
    /\ dying \in BOOLEAN
    /\ tslot \in 0..MaxWaits + 1
    /\ torn \in BOOLEAN
    /\ crash \in STRING

Init ==
    /\ wpc = [w \in Waits |-> "none"]
    /\ result = [w \in Waits |-> "none"]
    /\ timed = [w \in Waits |-> FALSE]
    /\ cancelled = [w \in Waits |-> FALSE]
    /\ waited = [w \in Waits |-> FALSE]
    /\ mtx = [w \in Waits |-> "none"]
    /\ ctxValid = [w \in Waits |-> FALSE]
    /\ tsfn = [w \in Waits |-> "unused"]
    /\ hook = [w \in Waits |-> FALSE]
    /\ envGone = [w \in Waits |-> FALSE]
    /\ outcome = [w \in Waits |-> "pending"]
    /\ cancelReq = [w \in Waits |-> FALSE]
    /\ ctx = [c \in Ctxs |-> IF c = 0 THEN "open" ELSE "none"]
    /\ glock = Nobody
    /\ ctxLock = [c \in Ctxs |-> Nobody]
    /\ events = 0
    /\ jpc = "idle"
    /\ jcall = "none"
    /\ jret = "call"
    /\ cw = 0
    /\ attempts = 0
    /\ toCancel = {}
    /\ started = 0
    /\ dying = FALSE
    /\ tslot = 0
    /\ torn = FALSE
    /\ crash = "none"

-----------------------------------------------------------------------------
(* Helpers *)

\* OnDone has run: the worker and its tsfn are gone
Freed(w) == tsfn[w] = "deleted"

\* The Context's pendingWaits_: inserted by Start(), erased by OnDone
Pending == {w \in 1..started : ~Freed(w)}

\* Pending waits whose SCardGetStatusChange hasn't returned
Unreturned == {w \in Pending : ~waited[w]}

\* The wait blocked, cancellably, on context c (it holds c's lock)
BlockedOn(c) == {u \in Waits : ctxLock[c] = u /\ wpc[u] = "blocked"}

\* SCardCancel(c). Called only while the caller can take the global lock.
\* It ends the wait blocked on c, if there is one, and otherwise does
\* nothing. (pcscd wakes the wait a little later; the model has it return
\* at once. A pcscd event that wins that race would end the wait with a
\* change instead, which no property here forbids.) pcsc-lite rejects a
\* handle it doesn't know, but context handles are reused, so a released
\* one may name someone else's context by now.
CancelOn(c) ==
    IF ctx[c] = "released"
    THEN /\ crash' = "SCardCancel on a released context, whose handle may name another by now"
         /\ UNCHANGED <<wpc, result, ctxLock>>
    ELSE IF BlockedOn(c) # {}
    THEN LET u == CHOOSE u \in BlockedOn(c) : TRUE IN
         /\ wpc' = [wpc EXCEPT ![u] = "returned"]
         /\ result' = [result EXCEPT ![u] = "cancelled"]
         /\ ctxLock' = [ctxLock EXCEPT ![c] = Nobody]
         /\ UNCHANGED crash
    ELSE UNCHANGED <<wpc, result, ctxLock, crash>>

\* How OnDone settles the promise (Settle)
Settled(r) == CASE r = "change"    -> "array"
                [] r = "timeout"   -> "empty"
                [] r = "cancelled" -> "null"
                [] OTHER           -> "rejected"

\* Every JS-facing wait is pending on a Context until OnDone erases it, and
\* the waits CancelPendingWaits is told about are exactly those
CancelReqs == [w \in Waits |-> cancelReq[w] \/ w \in Unreturned]

-----------------------------------------------------------------------------
(* The JS main thread: calls into the Context *)

JsReady == jpc = "idle" /\ ~dying

\* waitForChange(): Start() creates the tsfn, adds OnEnvCleanup, inserts the
\* wait into pendingWaits_ and starts its thread
JsWait ==
    /\ JsReady
    /\ started < MaxWaits
    /\ ctx[0] = "open"                 \* otherwise: throws "Context is not valid"
    /\ LET w == started + 1 IN
       /\ started' = w
       /\ tsfn' = [tsfn EXCEPT ![w] = "live"]
       /\ hook' = [hook EXCEPT ![w] = TRUE]
       /\ \E t \in BOOLEAN : timed' = [timed EXCEPT ![w] = t]
       /\ wpc' = [wpc EXCEPT ![w] = IF Design = "current" THEN "establish"
                                                          ELSE "lock"]
    /\ UNCHANGED <<result, cancelled, waited, mtx, ctxValid, envGone, outcome,
                   cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jpc, jcall, jret, cw, attempts, toCancel>>
    /\ UNCHANGED <<envVars, crash>>

\* cancel(). Current: CancelPendingWaits. Before #161: if the context is
\* valid, SCardCancel on it, once.
JsCancel ==
    /\ JsReady
    /\ "cancel" \in Ops
    /\ cancelReq' = CancelReqs
    /\ IF Design = "current"
       THEN /\ toCancel' = Pending
            /\ jpc' = "cancelNext"
            /\ jcall' = "cancel"
            /\ jret' = "call"
       ELSE /\ UNCHANGED <<toCancel, jret>>
            /\ jpc' = IF ctx[0] = "open" THEN "preCancel" ELSE "idle"
            /\ jcall' = IF ctx[0] = "open" THEN "cancel" ELSE "none"
    /\ UNCHANGED <<wpc, result, timed, cancelled, waited, mtx, ctxValid, tsfn,
                   hook, envGone, outcome>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<cw, attempts, started>>
    /\ UNCHANGED <<envVars, crash>>

\* close(). Current: CancelPendingWaits, then release the Context's own
\* context. Before #161: just the release.
JsClose ==
    /\ JsReady
    /\ "close" \in Ops
    /\ cancelReq' = CancelReqs
    /\ jcall' = "close"
    /\ IF Design = "current"
       THEN /\ toCancel' = Pending
            /\ jpc' = "cancelNext"
            /\ jret' = "call"
       ELSE /\ UNCHANGED <<toCancel, jret>>
            /\ jpc' = "closeAcq"
    /\ UNCHANGED <<wpc, result, timed, cancelled, waited, mtx, ctxValid, tsfn,
                   hook, envGone, outcome>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<cw, attempts, started>>
    /\ UNCHANGED <<envVars, crash>>

\* listReaders(): a call on the Context's own context
JsList ==
    /\ JsReady
    /\ "list" \in Ops
    /\ ctx[0] = "open"
    /\ jpc' = "listAcq"
    /\ jcall' = "list"
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

\* SCardGetContextAndLock(context 0), then the call, then unlock. If a wait
\* holds context 0's lock, this blocks holding the global lock.
ListAcq ==
    /\ jpc = "listAcq"
    /\ glock = Nobody
    /\ IF ctxLock[0] = Nobody
       THEN /\ jpc' = "idle"
            /\ jcall' = "none"
            /\ UNCHANGED glock
       ELSE /\ glock' = JS
            /\ jpc' = "listStuck"
            /\ UNCHANGED jcall
    /\ UNCHANGED waitVars
    /\ UNCHANGED <<ctx, ctxLock, events>>
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

ListStuck ==
    /\ jpc = "listStuck"
    /\ ctxLock[0] = Nobody
    /\ glock' = Nobody
    /\ jpc' = "idle"
    /\ jcall' = "none"
    /\ UNCHANGED waitVars
    /\ UNCHANGED <<ctx, ctxLock, events>>
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

\* Before #161: SCardCancel(context 0)
PreCancel ==
    /\ jpc = "preCancel"
    /\ glock = Nobody
    /\ CancelOn(0)
    /\ jpc' = "idle"
    /\ jcall' = "none"
    /\ UNCHANGED <<timed, cancelled, waited, mtx, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<ctx, glock, events>>
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED envVars

\* SCardReleaseContext(context 0): SCardGetContextAndLock, as above
CloseAcq ==
    /\ jpc = "closeAcq"
    /\ IF ctx[0] # "open"
       THEN /\ jpc' = "idle"                \* already released
            /\ jcall' = "none"
            /\ UNCHANGED <<ctx, glock>>
       ELSE /\ glock = Nobody
            /\ IF ctxLock[0] = Nobody
               THEN /\ ctx' = [ctx EXCEPT ![0] = "released"]
                    /\ jpc' = "idle"
                    /\ jcall' = "none"
                    /\ UNCHANGED glock
               ELSE /\ glock' = JS
                    /\ jpc' = "closeStuck"
                    /\ UNCHANGED <<ctx, jcall>>
    /\ UNCHANGED waitVars
    /\ UNCHANGED <<ctxLock, events>>
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

CloseStuck ==
    /\ jpc = "closeStuck"
    /\ ctxLock[0] = Nobody
    /\ ctx' = [ctx EXCEPT ![0] = "released"]
    /\ glock' = Nobody
    /\ jpc' = "idle"
    /\ jcall' = "none"
    /\ UNCHANGED waitVars
    /\ UNCHANGED <<ctxLock, events>>
    /\ UNCHANGED <<jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

\* CancelPendingWaits: Cancel() each wait in pendingWaits_, in any order
CancelNext ==
    /\ jpc = "cancelNext"
    /\ IF toCancel = {}
       THEN /\ jpc' = IF jcall = "close" THEN "closeAcq" ELSE "idle"
            /\ jcall' = IF jcall = "close" THEN "close" ELSE "none"
            /\ UNCHANGED <<cw, attempts, toCancel>>
       ELSE \E w \in toCancel :
            /\ cw' = w
            /\ toCancel' = toCancel \ {w}
            /\ attempts' = 0
            /\ jpc' = "cuLock"
            /\ UNCHANGED jcall
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jret, started>>
    /\ UNCHANGED <<envVars, crash>>

-----------------------------------------------------------------------------
(* CancelUntilReturned(maxAttempts), on the JS thread: for cancel() and     *)
(* close() (MaxAttempts), and for OnEnvCleanup (no limit). Current: lock   *)
(* mutex_, set cancelled_, then until waited_: SCardCancel if contextValid_ *)
(* (under mutex_), then wait_for 5 ms (which unlocks it). Before #161,     *)
(* only OnEnvCleanup looped, with no mutex_ held or cancelled_ to set.     *)

Limit == IF jret = "hook" THEN 0 ELSE MaxAttempts

\* Where the JS thread goes once it is done with cw
CuDone == IF jret = "hook" THEN "hookJoin" ELSE "cancelNext"

CuLock ==
    /\ jpc = "cuLock"
    /\ crash' = IF Freed(cw) THEN "use-after-free: cancelling a freed wait"
                ELSE crash
    /\ IF Design = "current"
       THEN /\ mtx[cw] = "none"
            /\ cancelled' = [cancelled EXCEPT ![cw] = TRUE]
            /\ IF waited[cw]
               THEN /\ jpc' = CuDone
                    /\ UNCHANGED mtx
               ELSE /\ jpc' = "cuCall"
                    /\ mtx' = [mtx EXCEPT ![cw] = "js"]
       ELSE /\ jpc' = IF waited[cw] THEN CuDone ELSE "cuCall"
            /\ UNCHANGED <<cancelled, mtx>>
    /\ UNCHANGED <<wpc, result, timed, waited, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED envVars

CuCall ==
    /\ jpc = "cuCall"
    /\ IF Design = "pre161" \/ ctxValid[cw]
       THEN /\ glock = Nobody
            /\ CancelOn(CtxOf(cw))
       ELSE UNCHANGED <<wpc, result, ctxLock, crash>>
    /\ mtx' = IF Design = "current" THEN [mtx EXCEPT ![cw] = "none"] ELSE mtx
    /\ attempts' = IF Limit = 0 THEN 0 ELSE attempts + 1
    /\ jpc' = "cuSleep"
    /\ UNCHANGED <<timed, cancelled, waited, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<ctx, glock, events>>
    /\ UNCHANGED <<jcall, jret, cw, toCancel, started>>
    /\ UNCHANGED envVars

\* wait_for returns when waited_ is set, or after 5 ms. The model has no
\* clock: the wait's thread need not have moved in between.
CuSleep ==
    /\ jpc = "cuSleep"
    /\ jpc' = IF waited[cw] \/ (Limit # 0 /\ attempts >= Limit) THEN CuDone
              ELSE "cuLock"
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

-----------------------------------------------------------------------------
(* Node's event loop, and environment teardown *)

\* The loop runs callbacks only while the JS thread isn't busy
LoopRuns == jpc = "idle" /\ ~torn

\* Execute() has released the tsfn, so Node finalizes it: OnDone, on the
\* JS thread
Finalize(w) ==
    /\ LoopRuns
    /\ tsfn[w] = "released"
    /\ jpc' = "doneJoin"
    /\ cw' = w
    /\ jret' = "loop"
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

\* OnDone: join the thread if joinable (it blocks until the thread exits),
\* remove OnEnvCleanup, erase from pendingWaits_, settle unless
\* OnEnvCleanup has run, delete the worker; then Node deletes the tsfn.
\* While dying, Settle runs but can't reach JS: it fails, and the model
\* assumes OnDone's try/catch swallows that, so JS gets nothing.
DoneJoin ==
    /\ jpc = "doneJoin"
    /\ wpc[cw] \in {"finished", "joined"}
    /\ wpc' = [wpc EXCEPT ![cw] = "joined"]
    /\ hook' = [hook EXCEPT ![cw] = FALSE]
    /\ outcome' = [outcome EXCEPT ![cw] =
                     IF envGone[cw] \/ dying THEN "unsettled"
                     ELSE Settled(result[cw])]
    /\ tsfn' = [tsfn EXCEPT ![cw] = "deleted"]
    /\ jpc' = IF jret = "td" THEN "tdNext" ELSE "idle"
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, envGone,
                   cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

\* Teardown begins (a worker exits): JS can no longer run, though the
\* event loop runs once more
TeardownBegin ==
    /\ WithTeardown
    /\ ~dying
    /\ jpc = "idle"
    /\ dying' = TRUE
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED jsVars
    /\ UNCHANGED <<tslot, torn, crash>>

\* Then Node runs the cleanup hooks, newest first (Environment::RunCleanup,
\* env.cc). Each wait registered two: its tsfn's, when Start() created it,
\* then OnEnvCleanup. OnDone removes OnEnvCleanup, and Node the tsfn's.
\*
\* - OnEnvCleanup: envTornDown_ = true, then CancelUntilReturned(0) and
\*   join. They run newest wait first.
\* - The tsfn's hook (node_api.cc, Cleanup) only marks it closing and
\*   schedules uv_close. Its finalizer, OnDone, runs once every hook has
\*   run, when Node runs the loop to close handles (CleanupHandles). That
\*   is so on Node 22 and 24, so the order of the two hooks doesn't matter.
TdStart ==
    /\ dying
    /\ tslot = 0
    /\ jpc = "idle"
    /\ tslot' = 1
    /\ jpc' = "tdNext"
    /\ UNCHANGED waitVars
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<dying, torn, crash>>

TdNext ==
    /\ jpc = "tdNext"
    /\ IF tslot <= started
       THEN LET w == started + 1 - tslot IN
            /\ tslot' = tslot + 1
            /\ IF hook[w]
               THEN /\ hook' = [hook EXCEPT ![w] = FALSE]
                    /\ envGone' = [envGone EXCEPT ![w] = TRUE]
                    /\ cw' = w
                    /\ attempts' = 0
                    /\ jret' = "hook"
                    /\ jpc' = "cuLock"
               ELSE UNCHANGED <<hook, envGone, jret, cw, attempts, jpc>>
            /\ UNCHANGED <<tsfn, torn>>
       ELSE IF \E w \in Waits : tsfn[w] \in {"live", "released"}
       THEN \* the tsfns' hooks. They run between the OnEnvCleanups, but
            \* only mark their tsfns closing, so all at once is the same.
            /\ tsfn' = [w \in Waits |-> IF tsfn[w] \in {"live", "released"}
                                        THEN "closing" ELSE tsfn[w]]
            /\ UNCHANGED <<hook, envGone, jret, cw, attempts, jpc, tslot, torn>>
       ELSE IF \E w \in Waits : tsfn[w] = "closing"
       THEN \* closing the handles: OnDone for each
            \E w \in Waits :
            /\ tsfn[w] = "closing"
            /\ cw' = w
            /\ jret' = "td"
            /\ jpc' = "doneJoin"
            /\ UNCHANGED <<hook, envGone, attempts, tsfn, tslot, torn>>
       ELSE /\ torn' = TRUE
            /\ jpc' = "gone"
            /\ UNCHANGED <<hook, envGone, jret, cw, attempts, tsfn, tslot>>
    /\ UNCHANGED <<wpc, result, timed, cancelled, waited, mtx, ctxValid,
                   outcome, cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, toCancel, started>>
    /\ UNCHANGED <<dying, crash>>

\* OnEnvCleanup's join
HookJoin ==
    /\ jpc = "hookJoin"
    /\ wpc[cw] \in {"finished", "joined"}
    /\ wpc' = [wpc EXCEPT ![cw] = "joined"]
    /\ jpc' = "tdNext"
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, tsfn, hook,
                   envGone, outcome, cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jcall, jret, cw, attempts, toCancel, started>>
    /\ UNCHANGED <<envVars, crash>>

-----------------------------------------------------------------------------
(* Each wait's thread: Execute() *)

\* SCardEstablishContext (current design). It takes the global lock briefly
\* and may fail (pcscd isn't running, say).
Establish(w) ==
    /\ wpc[w] = "establish"
    /\ glock = Nobody
    /\ wpc' = [wpc EXCEPT ![w] = "publish"]
    /\ \/ /\ ctx' = [ctx EXCEPT ![w] = "open"]
          /\ UNCHANGED <<result, events>>
       \/ /\ events < MaxEvents
          /\ events' = events + 1
          /\ result' = [result EXCEPT ![w] = "error"]
          /\ UNCHANGED ctx
    /\ UNCHANGED <<timed, cancelled, waited, mtx, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<glock, ctxLock>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* Under mutex_: publish the context (contextValid_), read cancelled_
Publish(w) ==
    /\ wpc[w] = "publish"
    /\ mtx[w] = "none"
    /\ ctxValid' = [ctxValid EXCEPT ![w] = (ctx[w] = "open")]
    /\ IF ctx[w] # "open"
       THEN wpc' = [wpc EXCEPT ![w] = "returned"] /\ UNCHANGED result
       ELSE IF cancelled[w]
       THEN /\ wpc' = [wpc EXCEPT ![w] = "returned"]
            /\ result' = [result EXCEPT ![w] = "cancelled"]
       ELSE wpc' = [wpc EXCEPT ![w] = "lock"] /\ UNCHANGED result
    /\ UNCHANGED <<timed, cancelled, waited, mtx, tsfn, hook, envGone, outcome,
                   cancelReq>>
    /\ UNCHANGED pcscVars
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* SCardGetStatusChange begins: SCardGetContextAndLock. If another thread
\* holds the context's lock, block holding the global lock.
Lock(w) ==
    /\ wpc[w] = "lock"
    /\ glock = Nobody
    /\ LET c == CtxOf(w) IN
       IF ctx[c] # "open"
       THEN /\ wpc' = [wpc EXCEPT ![w] = "returned"]     \* SCARD_E_INVALID_HANDLE
            /\ result' = [result EXCEPT ![w] = "error"]
            /\ UNCHANGED <<glock, ctxLock>>
       ELSE IF ctxLock[c] = Nobody
       THEN /\ ctxLock' = [ctxLock EXCEPT ![c] = w]
            /\ wpc' = [wpc EXCEPT ![w] = "check"]
            /\ UNCHANGED <<glock, result>>
       ELSE /\ glock' = w
            /\ wpc' = [wpc EXCEPT ![w] = "stuck"]
            /\ UNCHANGED <<ctxLock, result>>
    /\ UNCHANGED <<timed, cancelled, waited, mtx, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<ctx, events>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

Stuck(w) ==
    /\ wpc[w] = "stuck"
    /\ ctxLock[CtxOf(w)] = Nobody
    /\ ctxLock' = [ctxLock EXCEPT ![CtxOf(w)] = w]
    /\ glock' = Nobody
    /\ wpc' = [wpc EXCEPT ![w] = "check"]
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, tsfn, hook,
                   envGone, outcome, cancelReq>>
    /\ UNCHANGED <<ctx, events>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* Inside the call: nothing to report yet, so wait for pcscd, cancellably.
\* ("check" is the rest of the call: registering with pcscd, reading
\* reader states, comparing them. A cancel then does nothing.)
Arm(w) ==
    /\ wpc[w] = "check"
    /\ wpc' = [wpc EXCEPT ![w] = "blocked"]
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, tsfn, hook,
                   envGone, outcome, cancelReq>>
    /\ UNCHANGED <<pcscVars, jsVars, envVars, crash>>

\* pcscd: the call returns with a change or an error
PcscReport(w) ==
    /\ wpc[w] \in {"check", "blocked"}
    /\ events < MaxEvents
    /\ events' = events + 1
    /\ \E r \in {"change", "error"} : result' = [result EXCEPT ![w] = r]
    /\ wpc' = [wpc EXCEPT ![w] = "returned"]
    /\ ctxLock' = [ctxLock EXCEPT ![CtxOf(w)] = Nobody]
    /\ UNCHANGED <<timed, cancelled, waited, mtx, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<ctx, glock>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* pcscd: an event this wait isn't waiting for wakes it; it checks again
PcscWake(w) ==
    /\ wpc[w] = "blocked"
    /\ events < MaxEvents
    /\ events' = events + 1
    /\ wpc' = [wpc EXCEPT ![w] = "check"]
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, tsfn, hook,
                   envGone, outcome, cancelReq>>
    /\ UNCHANGED <<ctx, glock, ctxLock>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

PcscTimeout(w) ==
    /\ timed[w]
    /\ wpc[w] = "blocked"
    /\ result' = [result EXCEPT ![w] = "timeout"]
    /\ wpc' = [wpc EXCEPT ![w] = "returned"]
    /\ ctxLock' = [ctxLock EXCEPT ![CtxOf(w)] = Nobody]
    /\ UNCHANGED <<timed, cancelled, waited, mtx, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<ctx, glock, events>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* After the call (or instead of it). Current: lock mutex_. Before #161:
\* set waited_.
Returned(w) ==
    /\ wpc[w] = "returned"
    /\ IF Design = "current"
       THEN /\ mtx[w] = "none"
            /\ mtx' = [mtx EXCEPT ![w] = "thread"]
            /\ wpc' = [wpc EXCEPT ![w] = "releasectx"]
            /\ UNCHANGED waited
       ELSE /\ waited' = [waited EXCEPT ![w] = TRUE]
            /\ wpc' = [wpc EXCEPT ![w] = "release"]
            /\ UNCHANGED mtx
    /\ UNCHANGED <<result, timed, cancelled, ctxValid, tsfn, hook, envGone,
                   outcome, cancelReq>>
    /\ UNCHANGED <<pcscVars, jsVars, envVars, crash>>

\* Under mutex_: if contextValid_, SCardReleaseContext (which needs the
\* global lock and the context's lock); then waited_ = true, unlock
ReleaseCtx(w) ==
    /\ wpc[w] = "releasectx"
    /\ IF ctxValid[w]
       THEN /\ glock = Nobody
            /\ ctxLock[w] = Nobody
            /\ ctx' = [ctx EXCEPT ![w] = "released"]
            /\ ctxValid' = [ctxValid EXCEPT ![w] = FALSE]
       ELSE UNCHANGED <<ctx, ctxValid>>
    /\ waited' = [waited EXCEPT ![w] = TRUE]
    /\ mtx' = [mtx EXCEPT ![w] = "none"]
    /\ wpc' = [wpc EXCEPT ![w] = "release"]
    /\ UNCHANGED <<result, timed, cancelled, tsfn, hook, envGone, outcome,
                   cancelReq>>
    /\ UNCHANGED <<glock, ctxLock, events>>
    /\ UNCHANGED <<jsVars, envVars, crash>>

\* tsfn_.Release(), and the thread function returns. Releasing a tsfn whose
\* teardown hook has run leaves it to close.
Release(w) ==
    /\ wpc[w] = "release"
    /\ CASE tsfn[w] = "deleted" ->
              /\ crash' = "use-after-free: Release() on a deleted tsfn"
              /\ UNCHANGED tsfn
         [] tsfn[w] = "closing" -> UNCHANGED <<tsfn, crash>>
         [] OTHER ->
              /\ tsfn' = [tsfn EXCEPT ![w] = "released"]
              /\ UNCHANGED crash
    /\ wpc' = [wpc EXCEPT ![w] = "finished"]
    /\ UNCHANGED <<result, timed, cancelled, waited, mtx, ctxValid, hook,
                   envGone, outcome, cancelReq>>
    /\ UNCHANGED <<pcscVars, jsVars, envVars>>

-----------------------------------------------------------------------------

Thread(w) ==
    \/ Establish(w) \/ Publish(w) \/ Lock(w) \/ Stuck(w) \/ Arm(w)
    \/ Returned(w) \/ ReleaseCtx(w) \/ Release(w)

Pcsc(w) == PcscReport(w) \/ PcscWake(w) \/ PcscTimeout(w)

\* The JS thread's steps inside a call, a hook or OnDone: which one can run
\* depends only on jpc
JsStep ==
    \/ ListAcq \/ ListStuck \/ PreCancel \/ CloseAcq \/ CloseStuck
    \/ CancelNext \/ CuLock \/ CuCall \/ CuSleep
    \/ DoneJoin \/ TdNext \/ HookJoin

Next ==
    \/ JsWait \/ JsCancel \/ JsClose \/ JsList \/ JsStep
    \/ TeardownBegin \/ TdStart
    \/ \E w \in Waits : Thread(w) \/ Pcsc(w) \/ Finalize(w)

\* Threads that can run do run, timeouts fire, the event loop runs, and a
\* teardown that has begun completes. Steps that need a lock (mutex_, or
\* one of pcsc-lite's) are why this is strong fairness: a lock that is free
\* again and again is eventually taken. (std::mutex promises nothing of
\* the kind, but cancel() leaves mutex_ free for 5 ms at a time.) Nothing
\* forces JS to call anything, Node to begin a teardown, or pcscd to
\* report.
\*
\* Each thread is one condition, not one per step: a thread can take only
\* the step its pc names, so it is the same thing, and TLC's liveness
\* checking grows exponentially with the number of conditions. Likewise a
\* wait times out, or is finalized, at most once.
Fairness ==
    /\ \A w \in Waits : SF_vars(Thread(w))
    /\ SF_vars(JsStep)
    /\ SF_vars(\E w \in Waits : Finalize(w))
    /\ WF_vars(\E w \in Waits : PcscTimeout(w))
    /\ WF_vars(TdStart)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* Properties *)

\* Nothing fatal: no use-after-free, no SCardCancel on a stale handle
NoCrash == crash = "none"

\* No thread ever blocks on a lock while holding pcsc-lite's global lock, so
\* no PC/SC call anywhere in the process waits for a pending
\* waitForChange() (given that pcscd answers: see the top)
GlobalLockFree == glock = Nobody

\* A wait's own context is locked only by that wait
OwnContextsUnshared == \A w \in Waits : ctxLock[w] \in {Nobody, w}

\* A wait resolves with null only if JS cancelled it
NullOnlyIfCancelled == \A w \in Waits : outcome[w] = "null" => cancelReq[w]

\* After teardown, every wait has been freed (and its thread joined)
TeardownFrees == torn => \A w \in 1..started : Freed(w) /\ wpc[w] = "joined"

\* Every call JS makes (cancel(), close(), listReaders()) returns
JsReturns == (jcall # "none") ~> (jcall = "none")

\* cancel() and close() end every wait pending at the time
CancelEnds == \A w \in Waits : cancelReq[w] ~> waited[w]

\* A wait that has returned is settled (or dropped at teardown) and freed
Delivered == \A w \in Waits : waited[w] ~> Freed(w)

\* A teardown that has begun completes
TeardownReturns == dying ~> torn

=============================================================================
