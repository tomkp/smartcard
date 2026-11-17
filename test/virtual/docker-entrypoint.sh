#!/bin/sh
# Build a copy of the repository mounted at /src (the host's build output
# and node_modules are left alone), start pcscd with the virtual readers,
# and run the virtual card tests - or whatever command is given.
set -e
mkdir -p /work
tar -C /src --exclude=./node_modules --exclude=./build --exclude=./dist \
    --exclude=./coverage --exclude=./spec/.tools -cf - . | tar -C /work -xf -
cd /work
npm ci --no-audit --no-fund
pcscd --disable-polkit
export SMARTCARD_VIRTUAL_CARD_REQUIRED=1
export SMARTCARD_TEST_RESTART_PCSCD=1
if [ "$#" -eq 0 ]; then
    set -- npm run test:virtual
fi
exec "$@"
