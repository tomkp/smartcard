// Run a command with vsmartcard's virtual card (vicc) in the reader
// "Virtual PCD 00 00", e.g. the hardware-dependent integration tests:
//
//   node scripts/with-virtual-card.js node --test dist/test/integration/index.js
//
// Needs pcscd with vsmartcard-vpcd and vsmartcard-vpicc (test/virtual).
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const addon = require(path.join(__dirname, '..', 'build', 'Release', 'smartcard_napi.node'));
const READER = 'Virtual PCD 00 00';

function cardPresent() {
    const context = new addon.Context();
    try {
        const reader = context.listReaders().find((r) => r.name === READER);
        return reader !== undefined && (reader.state & addon.SCARD_STATE_PRESENT) !== 0;
    } finally {
        context.close();
    }
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const vicc = spawn('vicc', ['--type', 'iso7816'], { stdio: 'inherit' });
    vicc.on('error', (err) => {
        console.error(`could not start vicc: ${err.message}`);
        process.exit(1);
    });

    const deadline = Date.now() + 15000;
    while (!cardPresent()) {
        if (Date.now() > deadline || vicc.exitCode !== null) {
            console.error(`no card in "${READER}": is vsmartcard-vpcd loaded by pcscd?`);
            vicc.kill();
            process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 100));
    }

    const result = spawnSync(command, args, { stdio: 'inherit' });
    vicc.kill();
    process.exit(result.status === null ? 1 : result.status);
}

main();
