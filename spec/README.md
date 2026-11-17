# smartcard's ReaderMonitor in TLA+

Two TLA+ specifications of the native `ReaderMonitor`
([`src/reader_monitor.cpp`](../src/reader_monitor.cpp)), model-checked with
TLC. They were written against `master` at `f3d782e`, and the line links
below point at that commit. When the monitor changes, the specs should
change in the same PR.

| Spec | Question |
|---|---|
| `MonitorLifecycle.tla` | Can `start()`, `stop()`, the destructor or Node's teardown deadlock, hang or crash? Covers the JS thread, the monitor thread, `mutex_`, `SCardCancel` and the thread-safe function (tsfn). |
| `MonitorEvents.tla` | Is JS told about every reader and card? Covers the monitor loop against pcscd. |

## Running

You need Java 11 or later. `spec/check.sh` runs every config in `cfg/` and
checks that TLC returns the verdict written on the config's first line. It
takes about 30 s, and CI runs it (`.github/workflows/spec.yml`). On first use,
`tlc.sh` downloads `tla2tools.jar` v1.7.4 into `.tools/` and checks its
SHA-256.

To see a counterexample:

```sh
cd spec
./tlc.sh MonitorEvents.tla cfg/Events-swap.cfg -difftrace
```

`-difftrace` prints only the variables that changed in each step.

## Reading TLA+ with a Z background

| Z | TLA+ here |
|---|---|
| State schema | `VARIABLES`, plus `TypeOK` for the declarations |
| Initial state schema | `Init` |
| Operation schema `ΔS`, with pre- and postconditions | An action such as `StopJoin`. Unprimed names are the before-state, primed names are the after-state, and a conjunct like `thread # "running"` is the precondition. |
| `ΞS` for the parts left alone | `UNCHANGED <<...>>` |
| State invariant | An `INVARIANT` in a config, e.g. `NoCrash` or `WellFormed`. TLC checks it in every reachable state. |
| The system | `Next` is the disjunction of every operation. `Spec == Init /\ [][Next]_vars /\ fairness` |

Two ideas have no counterpart in Z:

- **Interleaving.** Each step is one action by one actor, and TLC tries every
  order. Atomicity is a modelling decision: whatever one action does happens
  indivisibly.
- **Liveness.** Z says what an operation may do. TLA+ can also say what must
  *eventually* happen, using `~>` ("leads to") and `<>[]` ("eventually
  always"). That is how "`stop()` always returns" and "JS eventually learns
  which card is in the reader" are written. Liveness needs fairness: `WF`
  says that a thread able to run does eventually run. The world (readers and
  cards) gets no fairness, so it is allowed to do nothing.

## Results

| Config | Checks | Verdict |
|---|---|---|
| `Lifecycle-current` | The code as it is, with 3 sessions and 4 PC/SC events | No errors (147k states) |
| `Lifecycle-pre139` | The code before PR #139 | Use-after-free: the tsfn finalizer runs after the destructor |
| `Lifecycle-pre139-restart` | The same code, with JS restarting the monitor | `std::terminate`: a stale finalizer stops the new session |
| `Lifecycle-boundedq` | What if the tsfn queue were bounded? | Deadlock |
| `Lifecycle-notimeout` | What if the wait had no timeout? | `stop()` can hang forever |
| `Lifecycle-teardown` | Node tears down the environment while the monitor runs | Use-after-free |
| `Events-safety` | Events are well formed and card presence converges (3 readers, 6 world steps) | No errors |
| `Events-swap` | JS learns which card is in the reader | Violated |
| `Events-newreader` | JS learns about every reader that is plugged in | Violated |
| `Events-gonereader` | JS learns about every reader that goes away | Violated |
| `Events-spin` | The loop goes back to sleep instead of spinning | Violated |
| `Events-fixed` | Every event property, with the candidate fixes applied | No errors |

The two pre-#139 configs reproduce, step for step, the two bugs that #139's
commit message describes. A human reviewer found those bugs; TLC finds them
in under a second. The current code passes the same checks.

## Findings

Findings 1–3 all come from the same window: the time between one
`SCardGetStatusChange` returning and the next one starting. That covers
emitting events, the re-read after a timeout, the 1 s sleep after any PC/SC
error ([`reader_monitor.cpp:334`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L334)), and at startup the gap between
`UpdateReaderList` and the first wait. In normal running the window lasts
milliseconds. After an error it lasts about a second. Tests rarely hit
interleavings like these, but a model checker always does.

The PC/SC behaviour behind findings 1–3 comes from pcsc-lite's source
([`src/winscard_clnt.c`](https://github.com/LudovicRousseau/PCSC/blob/master/src/winscard_clnt.c)).

### 1. A card swapped between two waits is never reported

This is `Events-swap`:

1. Reader r1 is plugged in with card 1. pcscd's event counter for r1 is 1.
2. The monitor starts and JS is told `reader-attached r1` with card 1.
3. Card 1 is removed and card 2 is inserted before the next wait. The counter
   is now 3.
4. The wait returns at once with r1 CHANGED, because pcsc-lite compares the
   counter in the upper 16 bits. `DetectCardStateChange` compares only the
   PRESENT bit, so present → present produces no event. The new `lastState`
   is committed.
5. From then on every wait blocks and times out. JS still believes card 1 is
   in the reader.

pcsc-lite documents the counter for exactly this purpose ("can be used to
detect a card removal/insertion between two calls"). The monitor stores the
counter in `lastState` but ignores it when deciding whether to emit.

### 2. A reader plugged in between two waits is never announced

This is `Events-newreader`. The monitor starts with no readers, and r1 is
plugged in before the first wait. The PnP entry is passed
`SCARD_STATE_UNAWARE` ([`reader_monitor.cpp:266`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L266)). pcsc-lite flags it only if
the reader count changes *during* the call, counted from the start of that
call, so the wait blocks. On timeout, `RefreshAllReaderStates` re-reads only
the readers already tracked. r1 stays unannounced until some other reader
event happens.

### 3. A reader unplugged between two waits is never removed, and an empty one makes the loop spin

This is `Events-gonereader` and `Events-spin`. Empty reader r1 is announced,
then unplugged before the next wait. From then on every wait returns at once:
r1's entry comes back UNKNOWN and CHANGED, because `lastState` lacks the
UNKNOWN bit. `ApplyCardStateChange` emits nothing and, by design, does not
commit an unknown reading ([`reader_monitor.cpp:194-198`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L194-L198)). So `lastState`
stays the same and the next wait returns at once too. The PnP entry never
fires. The result is a busy loop, and JS still thinks r1 is attached. TLC
prints this as `Stuttering`, because to TLA+ a step that changes nothing is
a stutter.

If r1 held a card, the outcome differs: `card-removed` is emitted, the
UNKNOWN state is committed and the wait blocks normally, but
`reader-detached` never comes.

The code comment says "the PnP path handles vanished readers". That holds
only when the reader vanishes during a wait. A mutation test confirms the
cause: committing the unknown reading removes the spin but not the phantom
reader.

### 4. Node tearing down the environment while the monitor runs: use-after-free

This is `Lifecycle-teardown`. JS calls `start()`, then Node tears down the
environment before the monitor thread has emitted its first
`reader-attached`. The thread then calls `BlockingCall` on a tsfn that Node
has already deleted. If the destructor runs after that, its
`tsfn_.Release()` ([`reader_monitor.cpp:75-78`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L75-L78)) touches the deleted tsfn as
well.

At teardown, Node's tsfn cleanup hook deletes the tsfn whatever its thread
count. In [`src/node_api.cc`](https://github.com/nodejs/node/blob/v22.x/src/node_api.cc), `Cleanup` calls `CloseHandlesAndMaybeDelete(true)`,
which reaches `Finalize`, then `EmptyQueueAndDelete`, then `delete this`. The
finalizer's `sessionActive = false` is only checked at the top of the loop
and just after the wait, so a thread that has already passed those checks
still pushes.

In practice the trigger is a `worker_thread` that uses smartcard and exits,
or is terminated, without calling `stop()`. The Node mechanism above is read
from source. The claim that the tsfn hook runs before the ReaderMonitor's
finalizer is my reading of env cleanup and has not been reproduced. A
worker-termination test under ASan would settle it.

### Details that look incidental but that correctness depends on

- **The unlimited queue** (`0` at [`reader_monitor.cpp:121`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L121)). The monitor calls
  `BlockingCall` while holding `mutex_` (when emitting `reader-attached`,
  card events and resync events). With any bound, the queue can fill while
  the JS thread sits in `stop()` waiting for `mutex_`, and neither side can
  move (`Lifecycle-boundedq`). The comment says "Unlimited queue size" but
  not that it must stay unlimited.
- **The 1000 ms timeout** ([`:271`](https://github.com/tomkp/smartcard/blob/f3d782eb1a57603ae1934dc90dba2feeb9715281/src/reader_monitor.cpp#L271)). `SCardCancel` interrupts only a call that
  is already blocked. pcsc-lite returns early when nothing can be cancelled.
  If `stop()` lands between the loop check and `SCardGetStatusChange`, the
  cancel does nothing and `join()` waits for the timeout. With `INFINITE` it
  would wait forever (`Lifecycle-notimeout`). So `stop()` can block the JS
  thread for up to about 1 s, by design.

## Candidate fixes (`Fixed = TRUE`)

`Events-fixed` passes every event property with 3 readers and 6 world steps:

1. **Swaps.** In `ApplyCardStateChange` and `ResyncReaderList`: if a card is
   present before and after, but the event counter (`dwEventState >> 16`) or
   the ATR changed, emit `card-removed` and then `card-inserted`.
2. **Missed attaches.** After a timeout, call `ResyncReaderList`, which
   re-lists the readers, instead of `RefreshAllReaderStates`. The periodic
   refresh should do the same, or continuous card activity on one reader can
   delay the re-list.
3. **Missed detaches and the spin.** When a tracked reader's entry comes back
   UNKNOWN, call `ResyncReaderList`.

With fix 2 in place, the PnP entry becomes a latency optimisation:
removing the PnP resync from the fixed model still passes. On pcsc-lite
2.3.0 and later, feeding the PnP entry's previous `dwEventState` back as its
`dwCurrentState` would catch reader changes between calls directly, but only
on that platform.

These fixes are proposals and have not been applied yet. Fix 1
identifies a card by its ATR, so two cards with the same ATR in the same
reader can only be told apart by the counter.

I did not model a fix for finding 4. One option is an env cleanup hook
registered after the tsfn, which runs first because hooks run in reverse
order, that stops and joins the monitor before Node deletes the tsfn. That
needs checking against Node's behaviour.

## What the model leaves out

- **Other platforms.** Only pcsc-lite's PC/SC semantics are modelled.
  Windows WinSCard and macOS behave differently around the PnP entry and the
  event counter.
- **The service-outage recovery path** in `MonitorEvents`. `MonitorLifecycle`
  has it only abstractly.
- **The JS layer** (`lib/devices.ts`). One hypothesis worth modelling next:
  after a same-tick `stop()`/`start()`, events still queued in the old
  monitor's tsfn are delivered, because Node keeps dispatching a released
  tsfn until its queue drains. They reach `_processEvent` with `_running`
  already true again, so stale events could be applied to the new session.
  This has not been checked.
- **Larger sizes.** TLC checks every behaviour, but only within the bounds:
  2–3 sessions, 1–3 readers and at most 6 world steps. The bet (the "small
  scope hypothesis") is that bugs show up at small sizes. Every finding here
  needed 4 steps or fewer.
- **Finer atomicity.** Each action is indivisible. For example,
  `UpdateReaderList`'s list-then-query is a single step.
