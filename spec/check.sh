#!/bin/sh
# Run every model-checking configuration and compare TLC's verdict with the
# one the config expects (its first line: "... Expect: <verdict>.").
#
#   ./check.sh            run them all
#   ./check.sh Events     only configs whose name contains "Events"
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
    esac
    expect=$(head -1 "$cfg" | sed -n 's/.*Expect: \(.*\)\.$/\1/p')
    out=$("$tlc" "$spec" "$cfg" 2>&1)
    if echo "$out" | grep -q "Model checking completed. No error has been found."; then
        got="no errors"
    elif echo "$out" | grep -q "^Error: Deadlock reached."; then
        got="deadlock"
    elif inv=$(echo "$out" | sed -n 's/^Error: Invariant \(.*\) is violated\.$/\1/p') && [ -n "$inv" ]; then
        got="$inv violated"
    elif echo "$out" | grep -q "^Error: Temporal properties were violated."; then
        # TLC doesn't name the property; the config checks only the one expected
        got=$(echo "$expect" | sed -n 's/^\(.*\) violated$/\1 violated/p')
        [ -n "$got" ] || got="a temporal property violated"
    else
        got="TLC failed"
    fi
    if [ "$got" = "$expect" ]; then
        printf 'ok    %-28s %s\n' "$name" "$got"
    else
        printf 'FAIL  %-28s expected: %s, got: %s\n' "$name" "$expect" "$got"
        echo "$out" | tail -40
        failed=1
    fi
done
exit $failed
