/**
 * Tests against a virtual card, for what needs a card to come and go.
 *
 * Linux only, with pcscd and vsmartcard: the vpcd driver gives pcscd the
 * readers "Virtual PCD 00 00" and "Virtual PCD 00 01", and vicc, a card
 * emulator, is a card in the first one for as long as it runs. Every test
 * skips without them. CI installs them; see test/virtual/README.md to run
 * these locally (in Docker on macOS).
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import {
    Context,
    Devices,
    SCARD_STATE_PRESENT,
} from '../../lib';
import type { Card } from '../../lib/types';

const READER = 'Virtual PCD 00 00';
// ISO 7816 SELECT with no AID; the virtual card answers 6A 82
const SELECT = Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x00]);
const TIMEOUT = 15000;

function readerState(): number | null {
    const context = new Context();
    try {
        const reader = context.listReaders().find((r) => r.name === READER);
        return reader ? reader.state : null;
    } finally {
        context.close();
    }
}

function cardPresent(): boolean {
    const state = readerState();
    return state !== null && (state & SCARD_STATE_PRESENT) !== 0;
}

// Why these tests can't run here, or undefined if they can
function unavailable(): string | undefined {
    if (spawnSync('vicc', ['--version']).status !== 0) {
        return 'vicc (vsmartcard) is not installed';
    }
    try {
        if (readerState() === null) {
            return `pcscd has no "${READER}" (vsmartcard-vpcd)`;
        }
    } catch (err) {
        return `no PC/SC service: ${(err as Error).message}`;
    }
    return undefined;
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + TIMEOUT;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

// The card is in the reader while vicc runs
class VirtualCard {
    private vicc: ChildProcess | null = null;

    async insert(): Promise<void> {
        this.vicc = spawn('vicc', ['--type', 'iso7816'], { stdio: 'ignore' });
        await waitFor(cardPresent, 'the virtual card to be inserted');
    }

    async remove(): Promise<void> {
        const vicc = this.vicc;
        this.vicc = null;
        if (vicc === null || vicc.exitCode !== null) {
            return;
        }
        const exited = new Promise((r) => vicc.once('exit', r));
        vicc.kill();
        await exited;
        await waitFor(() => !cardPresent(), 'the virtual card to be removed');
    }
}

interface CardEvent {
    type: 'card-inserted' | 'card-removed';
    card: Card | null;
}

// Devices, recording the card events for READER and every error
function watch(): { devices: Devices; events: CardEvent[]; errors: Error[] } {
    const devices = new Devices();
    const events: CardEvent[] = [];
    const errors: Error[] = [];
    devices.on('card-inserted', ({ reader, card }) => {
        if (reader.name === READER) events.push({ type: 'card-inserted', card });
    });
    devices.on('card-removed', ({ reader, card }) => {
        if (reader.name === READER) events.push({ type: 'card-removed', card });
    });
    devices.on('error', (err) => errors.push(err));
    return { devices, events, errors };
}

const skip = unavailable();

describe('Virtual card', { skip }, () => {
    const virtualCard = new VirtualCard();
    after(() => virtualCard.remove());

    it('Devices reports a card inserted, which works, then removed', { timeout: 60000 }, async () => {
        const { devices, events, errors } = watch();
        devices.start();
        try {
            await virtualCard.insert();
            await waitFor(() => events.length === 1, 'card-inserted');
            assert.strictEqual(events[0].type, 'card-inserted');
            const card = events[0].card!;
            const response = await card.transmit(SELECT);
            assert(response.length >= 2, 'a response with a status word');

            await virtualCard.remove();
            await waitFor(() => events.length === 2, 'card-removed');
            assert.strictEqual(events[1].type, 'card-removed');
            assert.strictEqual(events[1].card, card);
            assert.deepStrictEqual(errors, []);
        } finally {
            devices.stop();
        }
    });

    it('Devices reports a replaced card as removed, then inserted', { timeout: 60000 }, async () => {
        await virtualCard.insert();
        const { devices, events, errors } = watch();
        devices.start();
        try {
            // The card already in the reader
            await waitFor(() => events.length === 1, 'card-inserted');
            const first = events[0].card!;

            await virtualCard.remove();
            await virtualCard.insert();
            await waitFor(() => events.length === 3, 'card-removed, card-inserted');
            assert.deepStrictEqual(
                events.map((e) => e.type),
                ['card-inserted', 'card-removed', 'card-inserted']
            );
            const second = events[2].card!;
            assert.notStrictEqual(second, first);
            const response = await second.transmit(SELECT);
            assert(response.length >= 2, 'a response with a status word');
            assert.deepStrictEqual(errors, []);
        } finally {
            devices.stop();
            await virtualCard.remove();
        }
    });

    // Each environment that loads the addon (main thread, workers) builds
    // its own Cards; before #154 they shared one constructor reference,
    // and a worker's exit left the others using a dead one.
    it('connects in the main thread after a worker that connected exits', { timeout: 60000 }, async () => {
        await virtualCard.insert();
        try {
            const lib = resolve(__dirname, '../../lib');
            const useCard = `
                async function useCard(lib) {
                    const context = new lib.Context();
                    const reader = context.listReaders().find((r) => r.name === ${JSON.stringify(READER)});
                    const card = await reader.connect(lib.SCARD_SHARE_SHARED,
                        lib.SCARD_PROTOCOL_T0 | lib.SCARD_PROTOCOL_T1);
                    const response = await card.transmit(Buffer.from(${JSON.stringify([...SELECT])}));
                    card.disconnect();
                    context.close();
                    return response.toString('hex');
                }
            `;
            const workerSource = `
                ${useCard}
                const { parentPort } = require('node:worker_threads');
                useCard(require(${JSON.stringify(lib)}))
                    .then((r) => parentPort.postMessage('worker ' + r));
            `;
            const mainSource = `
                ${useCard}
                const { Worker } = require('node:worker_threads');
                const lib = require(${JSON.stringify(lib)});
                (async () => {
                    console.log('main ' + (await useCard(lib)));
                    const worker = new Worker(${JSON.stringify(workerSource)}, { eval: true });
                    worker.on('message', (m) => console.log(m));
                    await new Promise((r) => worker.on('exit', r));
                    console.log('main again ' + (await useCard(lib)));
                })();
            `;
            const result = spawnSync(process.execPath, ['-e', mainSource], {
                encoding: 'utf-8',
                timeout: 30000,
            });
            const output = `${result.stdout}\n${result.stderr}`;
            assert.strictEqual(result.signal, null, output);
            assert.strictEqual(result.status, 0, output);
            assert.match(result.stdout, /^main [0-9a-f]{4,}$/m, output);
            assert.match(result.stdout, /^worker [0-9a-f]{4,}$/m, output);
            assert.match(result.stdout, /^main again [0-9a-f]{4,}$/m, output);
        } finally {
            await virtualCard.remove();
        }
    });
});
