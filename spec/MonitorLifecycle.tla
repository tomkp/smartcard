-------------------------- MODULE MonitorLifecycle --------------------------
(***************************************************************************)
(* Lifecycle of smartcard's native ReaderMonitor (src/reader_monitor.cpp): *)
(* the JS main thread calling start(), stop() and the destructor; the      *)
(* monitor thread's loop; mutex_; SCardCancel; and the thread-safe         *)
(* function (tsfn) that carries events to JS.                              *)
(*                                                                         *)
(* Readers and cards are abstracted away (MonitorEvents.tla models them).  *)
(* Here a wait either sees "a change", fails, times out or is cancelled,   *)
(* and every report is one event pushed onto the tsfn queue. The question  *)
(* is only whether start/stop/teardown can deadlock, hang or crash.        *)
(*                                                                         *)
(* Z reading guide: Init is the initial state schema, each action is an    *)
(* operation schema (unprimed = before, primed = after, UNCHANGED = Xi on  *)
(* those variables), and the invariants at the bottom are state schema     *)
(* predicates TLC checks in every reachable state.                         *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSessions,   \* how many times JS may call start()
    MaxChanges,    \* how many changes/errors PC/SC may report, in total
    QueueLimit,    \* the tsfn's max_queue_size: 0 = unlimited (the code passes 0)
    HasTimeout,    \* SCardGetStatusChange times out (the code passes 1000 ms)
    Design,        \* "current", or "pre139": the code before PR #139
    WithTeardown,  \* Node may tear the environment down (e.g. a worker exits)
    WithGC         \* GC may collect the ReaderMonitor (run its destructor)

ASSUME /\ MaxSessions \in Nat \ {0}
       /\ MaxChanges \in Nat
       /\ QueueLimit \in Nat
       /\ HasTimeout \in BOOLEAN
       /\ Design \in {"current", "pre139"}
       /\ WithTeardown \in BOOLEAN
       /\ WithGC \in BOOLEAN

Sessions == 1..MaxSessions

VARIABLES
    \* ReaderMonitor's fields
    running,     \* running_
    locked,      \* mutex_ is held by the monitor thread. JS only takes it
                 \*   inside one atomic step, so JS holding it is never a state.
    tsfnOf,      \* tsfn_: which session's tsfn the member currently holds
    tsfnActive,  \* tsfnActive_
    thread,      \* monitorThread_: "none" | "running" | "finished" (exited,
                 \*   not joined; still joinable)
    alive,       \* the C++ object exists (FALSE once ~ReaderMonitor has run)
    \* the monitor thread
    mpc,         \* where MonitorLoop is
    mine,        \* the session MonitorLoop was started for (its sessionActive)
    result,      \* what the last SCardGetStatusChange returned
    \* per-session state owned by Node
    sessions,    \* sessions started so far; the newest is the current one
    active,      \* active[s]: session s's shared sessionActive flag
    queue,       \* queue[s]: events waiting in session s's tsfn queue
    tsfn,        \* tsfn[s]: "unused" | "live" | "released" | "deleted"
    \* the JS main thread
    jpc,         \* "idle", or where it is blocked inside stop()/~ReaderMonitor;
                 \*   "dead" once the destructor has finished
    \* the environment
    changes,     \* changes/errors PC/SC has reported so far
    torn,        \* Node has torn the environment down
    crash        \* "none", or the fatal thing that happened

vars == <<running, locked, tsfnOf, tsfnActive, thread, alive, mpc, mine,
          result, sessions, active, queue, tsfn, jpc, changes, torn, crash>>

MonitorPCs == {"none", "init", "attach", "top", "build", "waiting", "woken",
               "process", "refresh", "report", "error", "recover", "exit"}
JsPCs == {"idle", "stopping", "joining", "dtorCancel", "dtorJoin", "dtorEnd", "dead"}
TsfnStates == {"unused", "live", "released", "deleted"}

TypeOK ==
    /\ running \in BOOLEAN
    /\ locked \in BOOLEAN
    /\ tsfnOf \in 0..MaxSessions
    /\ tsfnActive \in BOOLEAN
    /\ thread \in {"none", "running", "finished"}
    /\ alive \in BOOLEAN
    /\ mpc \in MonitorPCs
    /\ mine \in 0..MaxSessions
    /\ result \in {"none", "change", "error", "timeout", "cancelled"}
    /\ sessions \in 0..MaxSessions
    /\ active \in [Sessions -> BOOLEAN]
    /\ queue \in [Sessions -> Nat]
    /\ tsfn \in [Sessions -> TsfnStates]
    /\ jpc \in JsPCs
    /\ changes \in 0..MaxChanges
    /\ torn \in BOOLEAN
    /\ crash \in STRING

Init ==
    /\ running = FALSE
    /\ locked = FALSE
    /\ tsfnOf = 0
    /\ tsfnActive = FALSE
    /\ thread = "none"
    /\ alive = TRUE
    /\ mpc = "none"
    /\ mine = 0
    /\ result = "none"
    /\ sessions = 0
    /\ active = [s \in Sessions |-> FALSE]
    /\ queue = [s \in Sessions |-> 0]
    /\ tsfn = [s \in Sessions |-> "unused"]
    /\ jpc = "idle"
    /\ changes = 0
    /\ torn = FALSE
    /\ crash = "none"

-----------------------------------------------------------------------------
(* Helpers *)

\* The loop condition: while (running_ && sessionActive->load()).
\* Before #139 the loop only checked running_.
SessionLive == running /\ (Design = "pre139" \/ active[mine])

\* tsfn_.BlockingCall from the monitor thread: one event onto the queue.
\* Not enabled (it blocks) while a bounded queue is full. Calling it on a tsfn
\* Node has deleted is a use-after-free.
Push ==
    IF tsfn[tsfnOf] = "deleted"
    THEN /\ crash' = "use-after-free: monitor thread pushed to a deleted tsfn"
         /\ UNCHANGED queue
    ELSE /\ QueueLimit = 0 \/ queue[tsfnOf] < QueueLimit
         /\ queue' = [queue EXCEPT ![tsfnOf] = @ + 1]
         /\ UNCHANGED crash

\* tsfn_.Release() from the JS thread, as new values for tsfn and crash
Released == IF tsfn[tsfnOf] = "deleted" THEN tsfn
            ELSE [tsfn EXCEPT ![tsfnOf] = "released"]
ReleaseCrash == IF tsfn[tsfnOf] = "deleted"
                THEN "use-after-free: Release() on a tsfn Node already deleted"
                ELSE crash

\* lock_guard(mutex_); SCardCancel(context_). The cancel only interrupts a
\* call that is already blocked: issued at any other moment it does nothing
\* (pcsc-lite's SCardCancel returns early when no call is cancellable).
Cancel ==
    IF mpc = "waiting"
    THEN mpc' = "woken" /\ result' = "cancelled"
    ELSE UNCHANGED <<mpc, result>>

\* The callback passed to ThreadSafeFunction::New, run by Node when it
\* finalizes the tsfns of the sessions in S
Finalizers(S) ==
    IF Design = "current"
    THEN /\ active' = [s \in Sessions |-> IF s \in S THEN FALSE ELSE active[s]]
         /\ UNCHANGED <<running, crash>>              \* sessionActive->store(false)
    ELSE /\ UNCHANGED active                          \* [this] { running_ = false; }
         /\ IF S = {} THEN UNCHANGED <<running, crash>>
            ELSE IF alive THEN running' = FALSE /\ UNCHANGED crash
            ELSE /\ crash' = "use-after-free: tsfn finalizer wrote running_ on a destroyed ReaderMonitor"
                 /\ UNCHANGED running

-----------------------------------------------------------------------------
(* The JS main thread *)

\* JS can only call into the monitor when it is not blocked inside it
JsReady == jpc = "idle" /\ alive /\ ~torn

\* start(callback)
JsStart ==
    /\ JsReady
    /\ ~running                       \* otherwise: throws "already running"
    /\ sessions < MaxSessions
    /\ LET s == sessions + 1 IN
       /\ sessions' = s
       /\ active' = [active EXCEPT ![s] = TRUE]
       /\ tsfn' = [tsfn EXCEPT ![s] = "live"]
       /\ tsfnOf' = s
       /\ tsfnActive' = TRUE
       /\ running' = TRUE
       \* monitorThread_ = std::thread(...) over a joinable thread terminates
       /\ crash' = IF thread # "none"
                   THEN "std::terminate: start() assigned over a joinable monitorThread_"
                   ELSE crash
       /\ thread' = "running"
       /\ mpc' = "init"
       /\ mine' = s
    /\ UNCHANGED <<locked, alive, result, queue, jpc, changes, torn>>

\* stop(): running_ = false, then cancel, join, release
JsStop ==
    /\ JsReady
    /\ running                        \* otherwise: returns at once
    /\ running' = FALSE
    /\ jpc' = "stopping"
    /\ UNCHANGED <<locked, tsfnOf, tsfnActive, thread, alive, mpc, mine, result,
                   sessions, active, queue, tsfn, changes, torn, crash>>

StopCancel ==
    /\ jpc = "stopping"
    /\ ~locked                        \* lock_guard blocks while the monitor holds mutex_
    /\ Cancel
    /\ jpc' = "joining"
    /\ UNCHANGED <<running, locked, tsfnOf, tsfnActive, thread, alive, mine,
                   sessions, active, queue, tsfn, changes, torn, crash>>

StopJoin ==
    /\ jpc = "joining"
    /\ thread # "running"             \* join() waits for the thread to exit
    /\ thread' = "none"
    /\ tsfn' = Released
    /\ crash' = ReleaseCrash
    /\ tsfnActive' = FALSE
    /\ jpc' = "idle"
    /\ UNCHANGED <<running, locked, tsfnOf, alive, mpc, mine, result,
                   sessions, active, queue, changes, torn>>

\* ~ReaderMonitor, run by GC - or by Node during teardown, so it is still
\* allowed after torn
JsDestroy ==
    /\ WithGC
    /\ jpc = "idle" /\ alive
    /\ IF running
       THEN running' = FALSE /\ jpc' = "dtorCancel"
       ELSE UNCHANGED running /\ jpc' = "dtorEnd"
    /\ UNCHANGED <<locked, tsfnOf, tsfnActive, thread, alive, mpc, mine, result,
                   sessions, active, queue, tsfn, changes, torn, crash>>

DtorCancel ==
    /\ jpc = "dtorCancel"
    /\ ~locked
    /\ Cancel
    /\ jpc' = "dtorJoin"
    /\ UNCHANGED <<running, locked, tsfnOf, tsfnActive, thread, alive, mine,
                   sessions, active, queue, tsfn, changes, torn, crash>>

DtorJoin ==
    /\ jpc = "dtorJoin"
    /\ thread # "running"
    /\ thread' = "none"
    /\ jpc' = "dtorEnd"
    /\ UNCHANGED <<running, locked, tsfnOf, tsfnActive, alive, mpc, mine, result,
                   sessions, active, queue, tsfn, changes, torn, crash>>

\* Release the tsfn if stop() never did (#139 added this), then the members
\* are destroyed: a still-joinable std::thread member terminates the process
DtorEnd ==
    /\ jpc = "dtorEnd"
    /\ LET releases == Design = "current" /\ tsfnActive IN
       /\ tsfn' = IF releases THEN Released ELSE tsfn
       /\ tsfnActive' = IF releases THEN FALSE ELSE tsfnActive
       /\ crash' = CASE releases /\ ReleaseCrash # crash -> ReleaseCrash
                     [] thread # "none" ->
                          "std::terminate: ReaderMonitor destroyed with a joinable monitorThread_"
                     [] OTHER -> crash
    /\ alive' = FALSE
    /\ jpc' = "dead"
    /\ UNCHANGED <<running, locked, tsfnOf, thread, mpc, mine, result,
                   sessions, active, queue, changes, torn>>

-----------------------------------------------------------------------------
(* Node's event loop. It keeps running after the ReaderMonitor is gone, but *)
(* not while the JS thread is blocked in stop() or the destructor, and not  *)
(* after teardown.                                                           *)

LoopFree == jpc \in {"idle", "dead"} /\ ~torn

\* Run one queued callback
Dispatch(s) ==
    /\ LoopFree
    /\ tsfn[s] \in {"live", "released"}
    /\ queue[s] > 0
    /\ queue' = [queue EXCEPT ![s] = @ - 1]
    /\ UNCHANGED <<running, locked, tsfnOf, tsfnActive, thread, alive, mpc, mine,
                   result, sessions, active, tsfn, jpc, changes, torn, crash>>

\* A released tsfn whose queue has drained is closed: Node runs the
\* finalizer, then deletes it
Finalize(s) ==
    /\ LoopFree
    /\ tsfn[s] = "released"
    /\ queue[s] = 0
    /\ tsfn' = [tsfn EXCEPT ![s] = "deleted"]
    /\ Finalizers({s})
    /\ UNCHANGED <<locked, tsfnOf, tsfnActive, thread, alive, mpc, mine, result,
                   sessions, queue, jpc, changes, torn>>

\* Environment teardown (a worker exiting, say). The tsfn's cleanup hook
\* closes it whatever its thread count: Node runs the finalizer, drops the
\* queue and deletes it (node_api.cc: Cleanup -> CloseHandlesAndMaybeDelete
\* -> Finalize -> EmptyQueueAndDelete). ObjectWraps are finalized after
\* that, so JsDestroy stays enabled.
Teardown ==
    /\ WithTeardown
    /\ ~torn
    /\ jpc \in {"idle", "dead"}
    /\ torn' = TRUE
    /\ LET doomed == {s \in Sessions : tsfn[s] \in {"live", "released"}} IN
       /\ tsfn' = [s \in Sessions |-> IF s \in doomed THEN "deleted" ELSE tsfn[s]]
       /\ queue' = [s \in Sessions |-> IF s \in doomed THEN 0 ELSE queue[s]]
       /\ Finalizers(doomed)
    /\ UNCHANGED <<locked, tsfnOf, tsfnActive, thread, alive, mpc, mine, result,
                   sessions, jpc, changes>>

-----------------------------------------------------------------------------
(* The monitor thread: MonitorLoop. It holds mutex_ only in "attach" and   *)
(* "report", which is where it calls BlockingCall under the lock.          *)

monitorOnly == <<running, tsfnOf, tsfnActive, alive, mine, sessions, active,
                 tsfn, jpc, torn>>

\* UpdateReaderList(), then reader-attached for each reader, under mutex_
MonInit ==
    /\ mpc = "init"
    /\ ~locked
    /\ \/ locked' = TRUE /\ mpc' = "attach"      \* there are readers to announce
       \/ UNCHANGED locked /\ mpc' = "top"       \* no readers yet
    /\ UNCHANGED <<monitorOnly, thread, result, queue, changes, crash>>

MonAttach ==
    /\ mpc = "attach"
    /\ Push
    /\ locked' = FALSE
    /\ mpc' = "top"
    /\ UNCHANGED <<monitorOnly, thread, result, changes>>

\* while (running_ && sessionActive->load())
MonTop ==
    /\ mpc = "top"
    /\ mpc' = IF SessionLive THEN "build" ELSE "exit"
    /\ UNCHANGED <<monitorOnly, locked, thread, result, queue, changes, crash>>

\* Build the states array under mutex_, then call SCardGetStatusChange.
\* (The every-10-iterations refresh is left out: it behaves like the
\* timeout path below.)
MonBuild ==
    /\ mpc = "build"
    /\ ~locked
    /\ mpc' = "waiting"
    /\ UNCHANGED <<monitorOnly, locked, thread, result, queue, changes, crash>>

\* SCardGetStatusChange returns. Stop()/the destructor can also end the
\* wait, through Cancel.
PcscChange ==
    /\ mpc = "waiting"
    /\ changes < MaxChanges
    /\ changes' = changes + 1
    /\ mpc' = "woken"
    /\ result' = "change"
    /\ UNCHANGED <<monitorOnly, locked, thread, queue, crash>>

PcscError ==
    /\ mpc = "waiting"
    /\ changes < MaxChanges
    /\ changes' = changes + 1
    /\ mpc' = "woken"
    /\ result' = "error"
    /\ UNCHANGED <<monitorOnly, locked, thread, queue, crash>>

PcscTimeout ==
    /\ HasTimeout
    /\ mpc = "waiting"
    /\ mpc' = "woken"
    /\ result' = "timeout"
    /\ UNCHANGED <<monitorOnly, locked, thread, queue, changes, crash>>

\* if (!running_ || !sessionActive->load()) break;
\* if (result == SCARD_E_CANCELLED) break; ...
MonWoken ==
    /\ mpc = "woken"
    /\ mpc' = IF ~SessionLive \/ result = "cancelled" THEN "exit"
              ELSE CASE result = "change"  -> "process"
                     [] result = "timeout" -> "refresh"
                     [] OTHER              -> "error"
    /\ UNCHANGED <<monitorOnly, locked, thread, result, queue, changes, crash>>

\* Changes: lock_guard(mutex_), then ApplyCardStateChange emits under it
MonProcess ==
    /\ mpc = "process"
    /\ ~locked
    /\ locked' = TRUE
    /\ mpc' = "report"
    /\ UNCHANGED <<monitorOnly, thread, result, queue, changes, crash>>

\* Timeout: RefreshAllReaderStates under mutex_ may find a missed change
MonRefresh ==
    /\ mpc = "refresh"
    /\ ~locked
    /\ \/ /\ changes < MaxChanges
          /\ changes' = changes + 1
          /\ locked' = TRUE
          /\ mpc' = "report"
       \/ UNCHANGED <<changes, locked>> /\ mpc' = "top"
    /\ UNCHANGED <<monitorOnly, thread, result, queue, crash>>

MonReport ==
    /\ mpc = "report"
    /\ Push
    /\ locked' = FALSE
    /\ mpc' = "top"
    /\ UNCHANGED <<monitorOnly, thread, result, changes>>

\* Errors: EmitEvent("error") outside the lock, then context recovery under
\* mutex_, which may emit (resync events, monitor-recovered); then sleep 1 s
MonError ==
    /\ mpc = "error"
    /\ Push
    /\ mpc' = "recover"
    /\ UNCHANGED <<monitorOnly, locked, thread, result, changes>>

MonRecover ==
    /\ mpc = "recover"
    /\ ~locked
    /\ \/ locked' = TRUE /\ mpc' = "report"     \* context re-established
       \/ UNCHANGED locked /\ mpc' = "top"      \* not fatal, or still down
    /\ UNCHANGED <<monitorOnly, thread, result, queue, changes, crash>>

MonExit ==
    /\ mpc = "exit"
    /\ thread' = "finished"
    /\ mpc' = "none"
    /\ UNCHANGED <<monitorOnly, locked, result, queue, changes, crash>>

-----------------------------------------------------------------------------

\* Nothing left to do: let TLC stutter here instead of reporting a deadlock.
\* (Including JS having used up its MaxSessions starts: that is the model's
\* bound, not the program's.)
Done ==
    /\ \/ jpc = "dead"
       \/ crash # "none"
       \/ jpc = "idle" /\ ~running /\ sessions = MaxSessions
    /\ UNCHANGED vars

Next ==
    \/ JsStart \/ JsStop \/ StopCancel \/ StopJoin
    \/ JsDestroy \/ DtorCancel \/ DtorJoin \/ DtorEnd
    \/ \E s \in Sessions : Dispatch(s) \/ Finalize(s)
    \/ Teardown
    \/ MonInit \/ MonAttach \/ MonTop \/ MonBuild \/ MonWoken \/ MonProcess
    \/ MonRefresh \/ MonReport \/ MonError \/ MonRecover \/ MonExit
    \/ PcscChange \/ PcscError \/ PcscTimeout
    \/ Done

\* Threads that can run do run, timeouts fire, and the event loop runs.
\* Nothing forces JS to call start/stop, GC to collect, or PC/SC to report.
Fairness ==
    /\ WF_vars(StopCancel) /\ WF_vars(StopJoin)
    /\ WF_vars(DtorCancel) /\ WF_vars(DtorJoin) /\ WF_vars(DtorEnd)
    /\ \A s \in Sessions : WF_vars(Dispatch(s)) /\ WF_vars(Finalize(s))
    /\ WF_vars(MonInit) /\ WF_vars(MonAttach) /\ WF_vars(MonTop)
    /\ WF_vars(MonBuild) /\ WF_vars(MonWoken) /\ WF_vars(MonProcess)
    /\ WF_vars(MonRefresh) /\ WF_vars(MonReport) /\ WF_vars(MonError)
    /\ WF_vars(MonRecover) /\ WF_vars(MonExit)
    /\ WF_vars(PcscTimeout)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* Properties *)

\* Nothing fatal ever happens: no std::terminate, no use-after-free
NoCrash == crash = "none"

\* A running monitor thread belongs to the newest session, and tsfn_ (which
\* MonitorLoop reads as a member, not a copy) is that session's tsfn
OneSession == thread = "running" => mine = sessions /\ tsfnOf = mine

\* stop() and the destructor always return
StopReturns == (jpc = "stopping") ~> (jpc = "idle")
DestroyReturns == (jpc \in {"dtorCancel", "dtorJoin", "dtorEnd"}) ~> (jpc = "dead")

\* Once the ReaderMonitor is gone every tsfn is finalized, so nothing keeps
\* the event loop (and the process) alive
NothingLeaks == (jpc = "dead") ~> (\A s \in Sessions : tsfn[s] \in {"unused", "deleted"})

=============================================================================
