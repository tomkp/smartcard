/**
 * Run a command with the virtual card in "Virtual PCD 00 00", e.g. the
 * hardware-dependent integration tests:
 *
 *   node dist/test/virtual/with-card.js node --test dist/test/integration/index.js
 *
 * Without vsmartcard it skips (exit 0), unless SMARTCARD_VIRTUAL_CARD_REQUIRED
 * is set. It fails if the card is lost while the command runs, since the
 * integration tests would then skip their card tests and pass.
 */
import { spawnSync } from 'node:child_process';
import { READER, REQUIRED, VirtualCard, unavailable } from './virtual-card';

async function main(): Promise<number> {
    const [command, ...args] = process.argv.slice(2);
    if (command === undefined) {
        console.error('usage: with-card.js <command> [args...]');
        return 2;
    }

    const reason = unavailable();
    if (reason !== undefined) {
        console.error(`virtual card: ${reason}`);
        if (REQUIRED) {
            return 1;
        }
        console.error(`skipping: ${[command, ...args].join(' ')}`);
        return 0;
    }

    const card = new VirtualCard();
    try {
        await card.insert();
        const result = spawnSync(command, args, { stdio: 'inherit' });
        if (result.error) {
            console.error(`could not run ${command}: ${result.error.message}`);
            return 1;
        }
        if (result.signal) {
            console.error(`${command} was killed by signal ${result.signal}`);
            return 1;
        }
        if (!card.running || !card.present()) {
            console.error(`the virtual card left "${READER}" during the run:\n${card.log()}`);
            return 1;
        }
        return result.status ?? 1;
    } finally {
        await card.remove();
    }
}

main().then(
    (status) => process.exit(status),
    (err: Error) => {
        console.error(err.message);
        process.exit(1);
    }
);
