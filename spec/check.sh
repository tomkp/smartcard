#!/bin/sh
# Run every model-checking configuration and compare TLC's verdict with the
# one the config expects. The config's first line ends "Expect: <verdict>.";
# an optional second line "\* Trace: <text>" must also appear in TLC's
# output (e.g. which crash the counterexample reaches).
#
#   spec/check.sh            run them all
#   spec/check.sh Events     only configs whose name contains "Events"
#
# A config that expects a violation passes when TLC finds that violation:
# those configs document bugs (or would-be bugs) the model catches.
set -u
cd "$(dirname "$0")"
tlc=./tlc.sh
filter=${1:-}
failed=0

for cfg in cfg/*.cfg; do
    name=$(basename "$cfg" .cfg)
    case "$name" in *"$filter"*) ;; *) continue ;; esac
    case "$name" in
        Lifecycle-*) spec=MonitorLifecycle.tla ;;
        Events-*) spec=MonitorEvents.tla ;;
        *)
            printf 'FAIL  %-28s name must start with Lifecycle- or Events-\n' "$name"
            failed=1
            continue
            ;;
    esac
    expect=$(head -1 "$cfg" | sed -n 's/.*Expect: \(.*\)\.$/\1/p')
    trace=$(sed -n '2s/^\\\* Trace: //p' "$cfg")
    out=$("$tlc" "$spec" "$cfg" 2>&1)
    if echo "$out" | grep -q "Model checking completed. No error has been found."; then
        got="no errors"
    elif echo "$out" | grep -q "^Error: Deadlock reached."; then
        got="deadlock"
    elif inv=$(echo "$out" | sed -n 's/^Error: Invariant \(.*\) is violated\.$/\1/p') && [ -n "$inv" ]; then
        got="$inv violated"
    elif echo "$out" | grep -q "^Error: Temporal properties were violated."; then
        # TLC doesn't say which property failed, so name it only when the
        # config checks exactly one
        props=$(sed -n 's/^PROPERTIES* //p' "$cfg")
        case "$props" in
            *" "*|"") got="a temporal property violated" ;;
            *) got="$props violated" ;;
        esac
    else
        got="TLC failed"
    fi
    if [ "$got" = "$expect" ] && { [ -z "$trace" ] || echo "$out" | grep -qF "$trace"; }; then
        printf 'ok    %-28s %s\n' "$name" "$got"
    else
        printf 'FAIL  %-28s expected: %s%s, got: %s\n' "$name" "$expect" \
            "${trace:+ (trace: $trace)}" "$got"
        echo "$out" | tail -40
        failed=1
    fi
done
exit $failed
