/**
 * Tests against vsmartcard's virtual card (see README.md here), for what
 * needs a card to come and go. They skip without vsmartcard, unless
 * SMARTCARD_VIRTUAL_CARD_REQUIRED is set (CI), when they fail instead.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Devices, ReaderMonitor } from '../../lib';
import type { Card } from '../../lib/types';
import {
    READER,
    REQUIRED,
    RESTART_PCSCD,
    SELECT,
    SELECT_RESPONSE,
    VirtualCard,
    pcscd,
    unavailable,
    waitFor,
} from './virtual-card';

interface CardEvent {
    type: 'card-inserted' | 'card-removed';
    card: Card | null;
}

// Devices, recording the card events for READER and every error
function watch(): {
    devices: Devices;
    events: CardEvent[];
    errors: Error[];
    // waitFor's detail: what Devices reported, for timeout messages
    report: () => string;
} {
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
    const report = () =>
        `events [${events.map((e) => e.type).join(', ')}], ` +
        `errors [${errors.map((e) => e.message).join('; ')}]`;
    return { devices, events, errors, report };
}

const reason = unavailable();

describe('Virtual card', { skip: REQUIRED ? false : reason }, () => {
    const virtualCard = new VirtualCard();
    before(() => {
        if (reason !== undefined) {
            throw new Error(`the virtual card is required here: ${reason}`);
        }
    });
    after(() => virtualCard.remove());

    it('Devices reports a card inserted, which works, then removed', { timeout: 60000 }, async () => {
        const { devices, events, errors, report } = watch();
        devices.start();
        try {
            await virtualCard.insert();
            await waitFor(() => events.length >= 1, 'card-inserted', report);
            assert.deepStrictEqual(events.map((e) => e.type), ['card-inserted'], report());
            const card = events[0].card!;
            const response = await card.transmit(SELECT);
            assert.strictEqual(response.toString('hex'), SELECT_RESPONSE);

            await virtualCard.remove();
            await waitFor(() => events.length >= 2, 'card-removed', report);
            assert.deepStrictEqual(
                events.map((e) => e.type),
                ['card-inserted', 'card-removed'],
                report()
            );
            assert.strictEqual(events[1].card, card);
            assert.deepStrictEqual(errors, []);
        } finally {
            devices.stop();
            await virtualCard.remove();
        }
    });

    it('Devices reports a replaced card as removed, then inserted', { timeout: 60000 }, async () => {
        const { devices, events, errors, report } = watch();
        try {
            await virtualCard.insert();
            devices.start();
            // The card already in the reader
            await waitFor(() => events.length >= 1, 'card-inserted', report);
            const first = events[0].card!;

            await virtualCard.remove();
            await virtualCard.insert();
            await waitFor(() => events.length >= 3, 'card-removed, card-inserted', report);
            assert.deepStrictEqual(
                events.map((e) => e.type),
                ['card-inserted', 'card-removed', 'card-inserted'],
                report()
            );
            const second = events[2].card!;
            assert.notStrictEqual(second, first);
            const response = await second.transmit(SELECT);
            assert.strictEqual(response.toString('hex'), SELECT_RESPONSE);
            assert.deepStrictEqual(errors, []);
        } finally {
            devices.stop();
            await virtualCard.remove();
        }
    });

    // pcscd stops for 12 s with a card in the reader. While the service is
    // unavailable no reader can be used, so the monitor reports them
    // detached once its first retry fails, and attaches them again when it
    // recovers; the card comes back as a new Card (the old handle died).
    it(
        'Devices detaches the readers while the service is down, and reattaches them with a working card',
        {
            timeout: 90000,
            skip: RESTART_PCSCD ? false : 'set SMARTCARD_TEST_RESTART_PCSCD to let it restart pcscd',
        },
        async () => {
            const { devices, events, report } = watch();
            const attached: string[] = [];
            const detached: string[] = [];
            devices.on('reader-attached', ({ name }) => attached.push(name));
            devices.on('reader-detached', ({ name }) => detached.push(name));
            // A second monitor, stopped during the outage
            const monitor = new ReaderMonitor();
            try {
                await virtualCard.insert();
                devices.start();
                monitor.start(() => {});
                await waitFor(() => events.length >= 1, 'card-inserted', report);
                const before = events[0].card!;
                const readers = [...attached].sort();
                attached.length = 0;

                await pcscd.stop();
                const down = Date.now();
                await waitFor(() => detached.length >= readers.length, 'reader-detached', report);
                const detachTook = Date.now() - down;
                const t = Date.now();
                monitor.stop();
                const stopTook = Date.now() - t;
                await new Promise((r) => setTimeout(r, 10000));
                await pcscd.start();
                await virtualCard.insert();

                await waitFor(() => events.length >= 3, 'card-removed, card-inserted', report);
                assert.deepStrictEqual(
                    events.map((e) => e.type),
                    ['card-inserted', 'card-removed', 'card-inserted'],
                    report()
                );
                assert.strictEqual(events[1].card, before);
                const after = events[2].card!;
                const response = await after.transmit(SELECT);
                assert.strictEqual(response.toString('hex'), SELECT_RESPONSE);
                // Each reader detached once - at the first failed retry, not
                // at the periodic re-list about 10 s later - and attached again
                assert.deepStrictEqual([...detached].sort(), readers);
                assert(detachTook < 5000, `readers detached ${detachTook} ms after the outage began`);
                await waitFor(() => attached.length >= readers.length, 'reader-attached', report);
                assert.deepStrictEqual([...attached].sort(), readers);
                // It used to wait out a 1 s sleep
                assert(stopTook < 250, `stop() during the outage took ${stopTook} ms`);
            } finally {
                monitor.stop();
                devices.stop();
                await pcscd.ensureRunning();
                await virtualCard.remove();
            }
        }
    );

    // On Windows the Smart Card service is down while no reader is plugged
    // in; here pcscd stands in for it. Devices used to report the error
    // and never see a reader until it was restarted.
    it(
        'Devices started while pcscd is down attaches the readers once it starts',
        {
            timeout: 60000,
            skip: RESTART_PCSCD ? false : 'set SMARTCARD_TEST_RESTART_PCSCD to let it restart pcscd',
        },
        async () => {
            const { devices, errors, report } = watch();
            const attached: string[] = [];
            devices.on('reader-attached', ({ name }) => attached.push(name));
            try {
                await pcscd.stop();
                devices.start();
                await new Promise((r) => setTimeout(r, 2500));
                assert.strictEqual(errors.length, 1, `one error for the outage: ${report()}`);
                assert.strictEqual(attached.length, 0, `no readers while pcscd is down: ${report()}`);

                await pcscd.start();
                await waitFor(() => attached.includes(READER), 'reader-attached', report);
                assert.strictEqual(errors.length, 1, report());
            } finally {
                devices.stop();
                await pcscd.ensureRunning();
            }
        }
    );

    // Each environment that loads the addon (main thread, workers) builds
    // its own Cards; before #154 they shared one constructor reference,
    // and a worker's exit left the others using a dead one.
    it('connects in the main thread after a worker that connected exits', { timeout: 60000 }, async () => {
        try {
            await virtualCard.insert();
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
            for (const who of ['main', 'worker', 'main again']) {
                assert(
                    result.stdout.includes(`${who} ${SELECT_RESPONSE}\n`),
                    `${who} should get ${SELECT_RESPONSE}:\n${output}`
                );
            }
        } finally {
            await virtualCard.remove();
        }
    });
});
