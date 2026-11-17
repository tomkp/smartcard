#!/bin/sh
# Run TLC, the TLA+ model checker: tlc.sh Spec.tla path/to/config.cfg [TLC args]
# Downloads the pinned tla2tools.jar into .tools/ on first use. Needs Java 11+.
set -e
here=$(cd "$(dirname "$0")" && pwd)
version=v1.7.4
sha256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
jar="$here/.tools/tla2tools-$version.jar"

if [ ! -f "$jar" ]; then
    mkdir -p "$here/.tools"
    curl -sSfL --retry 3 -o "$jar.part" \
        "https://github.com/tlaplus/tlaplus/releases/download/$version/tla2tools.jar"
    if command -v sha256sum >/dev/null 2>&1; then
        got=$(sha256sum "$jar.part" | cut -d' ' -f1)
    else
        got=$(shasum -a 256 "$jar.part" | cut -d' ' -f1)
    fi
    if [ "$got" != "$sha256" ]; then
        rm -f "$jar.part"
        echo "tla2tools.jar checksum mismatch: got $got" >&2
        exit 1
    fi
    mv "$jar.part" "$jar"
fi

spec=$1; cfg=$2; shift 2
# TLC writes its working state here; keep it out of the tree
meta=$(mktemp -d "${TMPDIR:-/tmp}/tlc.XXXXXX")
trap 'rm -rf "$meta"' EXIT
java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto -metadir "$meta" \
    -config "$cfg" "$@" "$spec"
