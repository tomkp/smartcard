---------------------------- MODULE MonitorEvents ----------------------------
(***************************************************************************)
(* Does smartcard's ReaderMonitor tell JS about every reader and card?     *)
(*                                                                         *)
(* Two things run concurrently: the world (readers plugged and unplugged,  *)
(* cards inserted and removed, as pcscd sees them) and MonitorLoop in      *)
(* src/reader_monitor.cpp. JS's view is whatever the emitted events add up *)
(* to. Start/stop and threads are MonitorLifecycle.tla's job; here the     *)
(* monitor just runs.                                                      *)
(*                                                                         *)
(* PC/SC behaviour follows pcsc-lite's SCardGetStatusChange                *)
(* (src/winscard_clnt.c): the call fails with SCARD_E_UNKNOWN_READER if    *)
(* any reader it is passed no longer exists; otherwise an entry is CHANGED *)
(* when the reader's state differs from the dwCurrentState passed in,      *)
(* including the per-reader event counter in the upper 16 bits; the        *)
(* "\\?PnP?\Notification" entry, passed SCARD_STATE_UNAWARE as the monitor *)
(* does, is CHANGED only if the number of readers changes while the call   *)
(* is in progress.                                                         *)
(*                                                                         *)
(* Granularity: a wait that returns is processed in the same atomic step,  *)
(* so the world can only move between waits - while the monitor is busy    *)
(* emitting, or looping back to the next call - and while it is blocked.   *)
(*                                                                         *)
(* Design "current" is the monitor on master. "v3.8" is the monitor as     *)
(* released in smartcard 3.8.0, before the fixes for the lost events these *)
(* specs found (spec/README.md).                                           *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Readers,       \* reader names, e.g. {r1, r2}
    MaxEnvSteps,   \* how many plug/unplug/insert/remove steps the world takes
    Design         \* "current", or "v3.8": the monitor as released in 3.8.0

ASSUME MaxEnvSteps \in Nat /\ Design \in {"current", "v3.8"}

VARIABLES
    \* the world, as pcscd sees it
    plugged,      \* readers connected now
    card,         \* card[r]: the card in reader r (its ATR, abstractly), 0 if none
    count,        \* count[r]: pcscd's event counter for r (dwEventState >> 16),
                  \*   +1 per insertion or removal, reset when the reader is plugged
    nextCard,     \* every insertion is a card the monitor hasn't seen before
    steps,        \* world steps taken so far
    \* the monitor thread
    mpc,          \* "start" | "top" (about to wait) | "blocked" (in the wait)
    tracked,      \* the keys of readerStates_
    last,         \* last[r]: readerStates_[r].lastState
    atr,          \* atr[r]: readerStates_[r].atr
    pnpBase,      \* the reader count when the blocked wait began
    failed,       \* the last SCardGetStatusChange failed (SCARD_E_UNKNOWN_READER)
    \* what the events have told JS
    jsReaders,    \* readers JS has been told are attached
    jsCard,       \* jsCard[r]: the card JS thinks is in r, 0 if none
    bad,          \* an event made no sense (e.g. card-removed with no card)
    \* ghost (read only by properties): readers unplugged and plugged back
    \* while the monitor still tracked them. pcscd restarts their event
    \* counter, so a card swapped that way can leave no trace.
    replugged

world == <<plugged, card, count, nextCard, steps>>
js == <<jsReaders, jsCard, bad>>
vars == <<plugged, card, count, nextCard, steps, mpc, tracked, last, atr,
          pnpBase, failed, jsReaders, jsCard, bad, replugged>>

-----------------------------------------------------------------------------
(* What SCardGetStatusChange reports for a reader: dwEventState without   *)
(* SCARD_STATE_CHANGED. kind "unaware" is SCARD_STATE_UNAWARE (0).        *)

Snap == [kind : {"unaware", "unknown", "known"}, present : BOOLEAN, count : Nat]

Unaware == [kind |-> "unaware", present |-> FALSE, count |-> 0]

Observe(r) ==
    IF r \in plugged
    THEN [kind |-> "known", present |-> card[r] # 0, count |-> count[r]]
    ELSE [kind |-> "unknown", present |-> FALSE, count |-> 0]

\* Before waiting, pcsc-lite checks that every reader it was passed exists.
\* If one doesn't, the whole call fails with SCARD_E_UNKNOWN_READER.
UnknownReader(T) == \E r \in T : r \notin plugged

\* pcsc-lite sets SCARD_STATE_CHANGED for reader r, given dwCurrentState cur.
\* (A reader that vanishes during a blocked wait comes back UNKNOWN.)
Changed(r, cur) ==
    IF r \notin plugged
    THEN cur.kind # "unknown"                    \* vanished during the wait
    ELSE \/ cur.kind # "known"                   \* UNAWARE, or the reader came back
         \/ cur.present # (card[r] # 0)
         \/ cur.count # 0 /\ cur.count # count[r] \* counter checked only if nonzero

-----------------------------------------------------------------------------
(* Events, and what JS makes of them *)

Event == [type : {"attached", "detached", "inserted", "removed"}, atr : Nat]
Attached(r, s) == [type |-> "attached", atr |-> IF s.present THEN card[r] ELSE 0]
Detached == [type |-> "detached", atr |-> 0]
Inserted(r) == [type |-> "inserted", atr |-> card[r]]
Removed == [type |-> "removed", atr |-> 0]

\* devices.ts: reader-attached with SCARD_STATE_PRESENT also means a card.
\* ok goes FALSE on an event that contradicts what JS already knows.
JsStep(v, e) ==
    CASE e.type = "attached" -> [in |-> TRUE,  c |-> e.atr, ok |-> v.ok /\ ~v.in]
      [] e.type = "detached" -> [in |-> FALSE, c |-> 0,     ok |-> v.ok /\ v.in]
      [] e.type = "inserted" -> [in |-> v.in,  c |-> e.atr, ok |-> v.ok /\ v.in /\ v.c = 0]
      [] e.type = "removed"  -> [in |-> v.in,  c |-> 0,     ok |-> v.ok /\ v.in /\ v.c # 0]

RECURSIVE Fold(_, _)
Fold(v, evs) == IF evs = <<>> THEN v ELSE Fold(JsStep(v, Head(evs)), Tail(evs))

\* JS receives evs[r] for each reader r, in order
Tell(evs) ==
    LET v == [r \in Readers |->
                Fold([in |-> r \in jsReaders, c |-> jsCard[r], ok |-> TRUE], evs[r])]
    IN /\ jsReaders' = {r \in Readers : v[r].in}
       /\ jsCard' = [r \in Readers |-> v[r].c]
       /\ bad' = (bad \/ \E r \in Readers : ~v[r].ok)

-----------------------------------------------------------------------------
(* The monitor's bookkeeping, as pure functions. Each returns, per reader, *)
(* a record [in, last, atr, evs]: whether the reader is tracked afterwards,*)
(* its new lastState and ATR, and the events emitted for it.               *)

\* reader_state_utils.h: DetectCardStateChange
Detect(old, new) ==
    IF ~old.present /\ new.present THEN "inserted"
    ELSE IF old.present /\ ~new.present THEN "removed"
    ELSE "none"

\* CardEvent::Replaced (since 3.8.0): a card present before and after, but
\* pcscd counted insertions/removals in between
Swapped(old, new) ==
    /\ Design = "current"
    /\ old.present /\ new.present
    /\ old.count # new.count

CardEvents(r, old, new) ==
    CASE Detect(old, new) = "inserted" -> <<Inserted(r)>>
      [] Detect(old, new) = "removed"  -> <<Removed>>
      [] Swapped(old, new)             -> <<Removed, Inserted(r)>>
      [] OTHER                         -> <<>>

\* ApplyCardStateChange(info, readerState) with a fresh reading of r
ApplyCard(r, s, a) ==
    LET new == Observe(r)
        evs == CardEvents(r, s, new)
        \* commit unless it's an unknown/unusable reading with no event
        commit == evs # <<>> \/ new.kind # "unknown"
    IN [in   |-> TRUE,
        last |-> IF commit THEN new ELSE s,
        atr  |-> IF evs = <<>> THEN a ELSE card[r],
        evs  |-> evs]

Keep(T, L, A, r) == [in |-> r \in T, last |-> L[r], atr |-> A[r], evs |-> <<>>]

\* After a successful wait: ApplyCardStateChange on each CHANGED entry
OnChanged(T, L, A) ==
    [r \in Readers |-> IF r \in T /\ Changed(r, L[r]) THEN ApplyCard(r, L[r], A[r])
                       ELSE Keep(T, L, A, r)]

\* v3.8's timeout path: RefreshAllReaderStates, an UNAWARE re-read of every
\* tracked reader. If that read fails, it changes nothing.
RefreshAll(T, L, A) ==
    [r \in Readers |-> IF r \in T /\ ~UnknownReader(T) THEN ApplyCard(r, L[r], A[r])
                       ELSE Keep(T, L, A, r)]

\* ResyncReaderList: UpdateReaderList (re-list, re-seed every reader from an
\* UNAWARE read), then emit the difference
Resync(T, L, A) ==
    [r \in Readers |->
        LET new == Observe(r) IN
        CASE r \in plugged /\ r \notin T ->
                [in |-> TRUE, last |-> new, atr |-> card[r], evs |-> <<Attached(r, new)>>]
          [] r \notin plugged /\ r \in T ->
                [in |-> FALSE, last |-> Unaware, atr |-> 0, evs |-> <<Detached>>]
          [] r \in plugged /\ r \in T ->
                [in |-> TRUE, last |-> new, atr |-> card[r],
                 evs |-> CardEvents(r, L[r], new)]
          [] OTHER -> [in |-> FALSE, last |-> Unaware, atr |-> 0, evs |-> <<>>]]

TrackedOf(R) == {r \in Readers : R[r].in}
LastOf(R) == [r \in Readers |-> R[r].last]
AtrOf(R) == [r \in Readers |-> R[r].atr]

\* R1 then R2: R2's final state, R1's events followed by R2's
Then(R1, R2) == [r \in Readers |-> [R2[r] EXCEPT !.evs = R1[r].evs \o R2[r].evs]]

\* Make R the monitor's state and send its events to JS. A reader the
\* monitor stops tracking is no longer a replugged one.
Commit(R) ==
    /\ tracked' = TrackedOf(R)
    /\ last' = LastOf(R)
    /\ atr' = AtrOf(R)
    /\ Tell([r \in Readers |-> R[r].evs])
    /\ replugged' = replugged \cap TrackedOf(R)

\* The body of the loop after SCardGetStatusChange succeeds. pnp: the PnP
\* entry came back CHANGED.
Process(pnp) ==
    LET R1 == OnChanged(tracked, last, atr)
        R == IF pnp
             THEN Then(R1, Resync(TrackedOf(R1), LastOf(R1), AtrOf(R1)))
             ELSE R1
    IN Commit(R)

-----------------------------------------------------------------------------

TypeOK ==
    /\ plugged \subseteq Readers
    /\ card \in [Readers -> Nat]
    /\ count \in [Readers -> Nat]
    /\ nextCard \in Nat \ {0}
    /\ steps \in 0..MaxEnvSteps
    /\ mpc \in {"start", "top", "blocked"}
    /\ tracked \subseteq Readers
    /\ last \in [Readers -> Snap]
    /\ atr \in [Readers -> Nat]
    /\ pnpBase \in Nat
    /\ failed \in BOOLEAN
    /\ jsReaders \subseteq Readers
    /\ jsCard \in [Readers -> Nat]
    /\ bad \in BOOLEAN
    /\ replugged \subseteq Readers

Init ==
    /\ plugged = {}
    /\ card = [r \in Readers |-> 0]
    /\ count = [r \in Readers |-> 0]
    /\ nextCard = 1
    /\ steps = 0
    /\ mpc = "start"
    /\ tracked = {}
    /\ last = [r \in Readers |-> Unaware]
    /\ atr = [r \in Readers |-> 0]
    /\ pnpBase = 0
    /\ failed = FALSE
    /\ jsReaders = {}
    /\ jsCard = [r \in Readers |-> 0]
    /\ bad = FALSE
    /\ replugged = {}

-----------------------------------------------------------------------------
(* The world *)

Plug(r) ==
    /\ r \notin plugged
    /\ plugged' = plugged \cup {r}
    /\ count' = [count EXCEPT ![r] = 0]
    /\ replugged' = IF r \in tracked THEN replugged \cup {r} ELSE replugged
    /\ UNCHANGED <<card, nextCard>>

Unplug(r) ==                      \* a card in it goes with it
    /\ r \in plugged
    /\ plugged' = plugged \ {r}
    /\ card' = [card EXCEPT ![r] = 0]
    /\ count' = [count EXCEPT ![r] = 0]
    /\ UNCHANGED <<nextCard, replugged>>

Insert(r) ==
    /\ r \in plugged
    /\ card[r] = 0
    /\ card' = [card EXCEPT ![r] = nextCard]
    /\ nextCard' = nextCard + 1
    /\ count' = [count EXCEPT ![r] = @ + 1]
    /\ UNCHANGED <<plugged, replugged>>

Remove(r) ==
    /\ card[r] # 0
    /\ card' = [card EXCEPT ![r] = 0]
    /\ count' = [count EXCEPT ![r] = @ + 1]
    /\ UNCHANGED <<plugged, nextCard, replugged>>

World ==
    /\ steps < MaxEnvSteps
    /\ steps' = steps + 1
    /\ \E r \in Readers : Plug(r) \/ Unplug(r) \/ Insert(r) \/ Remove(r)
    /\ UNCHANGED <<mpc, tracked, last, atr, pnpBase, failed, jsReaders, jsCard, bad>>

-----------------------------------------------------------------------------
(* MonitorLoop *)

\* UpdateReaderList, then reader-attached for every reader
Start ==
    /\ mpc = "start"
    /\ Commit(Resync({}, last, atr))
    /\ mpc' = "top"
    /\ UNCHANGED <<world, pnpBase, failed>>

\* Call SCardGetStatusChange with dwCurrentState = lastState for each
\* tracked reader, plus the PnP entry as SCARD_STATE_UNAWARE. It fails if a
\* tracked reader has gone; returns at once if an entry already differs;
\* otherwise blocks.
BeginWait ==
    /\ mpc = "top"
    /\ CASE UnknownReader(tracked) ->
            \* The error path: emit "error", sleep 1 s, loop. It isn't a
            \* context-fatal error; the current design re-lists the readers,
            \* v3.8 just tries the same list again.
            /\ failed' = TRUE
            /\ IF Design = "current" THEN Commit(Resync(tracked, last, atr))
               ELSE UNCHANGED <<tracked, last, atr, js, replugged>>
            /\ UNCHANGED <<mpc, pnpBase>>
         [] \E r \in tracked : Changed(r, last[r]) ->
            Process(FALSE) /\ failed' = FALSE /\ UNCHANGED <<mpc, pnpBase>>
         [] OTHER ->
            /\ mpc' = "blocked"
            /\ pnpBase' = Cardinality(plugged)
            /\ failed' = FALSE
            /\ UNCHANGED <<tracked, last, atr, js, replugged>>
    /\ UNCHANGED world

\* The blocked wait sees a change: a tracked reader's state, or the reader
\* count since the call began
Wake ==
    /\ mpc = "blocked"
    /\ LET pnp == Cardinality(plugged) # pnpBase IN
       /\ pnp \/ \E r \in tracked : Changed(r, last[r])
       /\ Process(pnp)
    /\ mpc' = "top"
    /\ pnpBase' = 0
    /\ UNCHANGED <<world, failed>>

\* The 1 s timeout: the current design re-lists the readers, v3.8 only
\* re-reads the tracked ones. (It can race with a change, so it is always
\* enabled while blocked. The every-10-iterations refresh does the same
\* work, so it is not modelled separately.)
Timeout ==
    /\ mpc = "blocked"
    /\ Commit(IF Design = "current" THEN Resync(tracked, last, atr)
              ELSE RefreshAll(tracked, last, atr))
    /\ mpc' = "top"
    /\ pnpBase' = 0
    /\ UNCHANGED <<world, failed>>

Next == World \/ Start \/ BeginWait \/ Wake \/ Timeout

\* The monitor thread keeps running and the timeout fires. Nothing forces
\* the world to do anything, and it stops after MaxEnvSteps.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(Start) /\ WF_vars(BeginWait) /\ WF_vars(Wake) /\ WF_vars(Timeout)

-----------------------------------------------------------------------------
(* Properties *)

\* Safety: every event makes sense given the ones before it
WellFormed == ~bad

\* The monitor's readerStates_ and JS agree on which readers exist
TrackedIsTold == tracked = jsReaders

\* Liveness. The world always stops changing eventually (MaxEnvSteps), so
\* "eventually always" means: once things settle, JS has the truth.

\* JS is told about every reader that is plugged in...
NewReadersAnnounced == <>[](plugged \subseteq jsReaders)

\* ...and about every reader that goes away
GoneReadersRemoved == <>[](jsReaders \subseteq plugged)

\* For readers JS knows, it knows whether a card is present
PresenceConverges ==
    <>[](\A r \in jsReaders \cap plugged : (jsCard[r] # 0) = (card[r] # 0))

\* ...and which card it is - except for a reader replugged while tracked,
\* where pcscd's restarted event counter can hide a swap
CardsConverge ==
    <>[](\A r \in (jsReaders \cap plugged) \ replugged : jsCard[r] = card[r])

\* The same without the exception (Events-replug shows why it's needed)
CardsConvergeEvenAfterReplug ==
    <>[](\A r \in jsReaders \cap plugged : jsCard[r] = card[r])

\* The monitor keeps getting back into a working wait, instead of failing
\* every call. (A loop that changes nothing is, to TLA+, stuttering: TLC's
\* trace ends in "Stuttering" or loops back to the same state.)
KeepsWaiting == []<>(mpc = "blocked")

=============================================================================
