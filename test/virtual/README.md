# Virtual card tests

Some behaviour can only be tested with a card that comes and goes: card
events from the monitor, connecting and transmitting, and what happens to
cards across worker threads. These tests use
[vsmartcard](https://frankmorgner.github.io/vsmartcard/) instead of
hardware:

- **vpcd**, a pcscd driver, adds two readers, `Virtual PCD 00 00` and
  `Virtual PCD 00 01`.
- **vicc**, a card emulator, is a card in `Virtual PCD 00 00` for as long as
  it runs. The tests start and stop it to insert and remove the card.

`npm run test:virtual` runs `test/virtual`, then the card tests in
`test/integration` with the virtual card inserted (`with-card.ts`). Without
pcscd and vsmartcard both skip, unless `SMARTCARD_VIRTUAL_CARD_REQUIRED` is
set: then a missing setup is a failure, and so is losing the card while
the integration tests run (they would skip their card tests and pass).

CI runs them on Linux with `SMARTCARD_VIRTUAL_CARD_REQUIRED` set. pcscd is
started with `--disable-polkit`, because its polkit check refuses the
runner's user.

One test simulates a PC/SC service outage by stopping and starting pcscd.
It runs only with `SMARTCARD_TEST_RESTART_PCSCD` set (CI and the Docker
image set it), as root or with passwordless sudo, and only where pcscd was
started by hand as `pcscd --disable-polkit`: the test starts it again that
way, and with systemd's socket activation pcscd would restart itself as
soon as the test checks whether it has stopped.

## Running them locally

On Linux, install the packages and restart pcscd so that it loads vpcd:

```sh
sudo apt-get install pcscd vsmartcard-vpcd vsmartcard-vpicc python3-pycryptodome
sudo systemctl restart pcscd
npm run test:virtual
```

(`python3-pycryptodome` is a dependency of vicc that its package doesn't
pull in.)

On macOS, or anywhere else with Docker, run them in a Linux container. It
builds a copy of the repository, so your own `build/` is left alone:

```sh
docker build -t smartcard-virtual test/virtual
# or with another Node version, e.g. the newest that CI tests:
# docker build --build-arg NODE_VERSION=26.13.1 -t smartcard-virtual test/virtual
docker run --rm -v "$PWD":/src:ro smartcard-virtual
```

Pass a command to run something else in the same environment, e.g.
`docker run --rm -v "$PWD":/src:ro smartcard-virtual npm run test:unit`.
