import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    Context,
    Devices,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_STATE_PRESENT,
    SCARD_LEAVE_CARD,
} from '../../lib';
import type { Reader as ReaderType } from '../../lib/types';

// Helper functions to check hardware availability
function hasReaders(): boolean {
    try {
        const ctx = new Context();
        const readers = ctx.listReaders();
        ctx.close();
        return readers.length > 0;
    } catch {
        return false;
    }
}

function hasCardPresent(): boolean {
    try {
        const ctx = new Context();
        const readers = ctx.listReaders();
        ctx.close();
        return readers.some((r) => (r.state & SCARD_STATE_PRESENT) !== 0);
    } catch {
        return false;
    }
}

describe('Context', () => {
    it('should create a valid context', () => {
        const ctx = new Context();
        assert(ctx.isValid, 'Context should be valid');
        ctx.close();
    });

    it('should close context', () => {
        const ctx = new Context();
        assert(ctx.isValid, 'Context should be valid before close');
        ctx.close();
        assert(!ctx.isValid, 'Context should be invalid after close');
    });

    it('should list readers (may be empty)', () => {
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            assert(Array.isArray(readers), 'Should return an array');
        } finally {
            ctx.close();
        }
    });
});

describe('Reader (hardware dependent)', () => {
    it('reader should have name', (t) => {
        if (!hasReaders()) {
            t.skip('No readers available');
            return;
        }
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            const reader = readers[0];
            assert(typeof reader.name === 'string', 'Name should be a string');
            assert(reader.name.length > 0, 'Name should not be empty');
        } finally {
            ctx.close();
        }
    });

    it('reader should have state', (t) => {
        if (!hasReaders()) {
            t.skip('No readers available');
            return;
        }
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            const reader = readers[0];
            assert(
                typeof reader.state === 'number',
                'State should be a number'
            );
        } finally {
            ctx.close();
        }
    });
});

describe('Card operations (hardware dependent)', () => {
    it('should connect to card', async (t) => {
        if (!hasCardPresent()) {
            t.skip('No card present');
            return;
        }
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            const reader = readers.find(
                (r: ReaderType) => (r.state & SCARD_STATE_PRESENT) !== 0
            );
            const card = await reader!.connect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
            );
            assert(card, 'Should return a card object');
            assert(card.connected, 'Card should be connected');
            assert(
                typeof card.protocol === 'number',
                'Protocol should be a number'
            );
            card.disconnect(SCARD_LEAVE_CARD);
        } finally {
            ctx.close();
        }
    });

    it('should transmit APDU', async (t) => {
        if (!hasCardPresent()) {
            t.skip('No card present');
            return;
        }
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            const reader = readers.find(
                (r: ReaderType) => (r.state & SCARD_STATE_PRESENT) !== 0
            );
            const card = await reader!.connect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
            );

            try {
                const selectCmd = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
                const response = await card.transmit(selectCmd);
                assert(
                    Buffer.isBuffer(response),
                    'Response should be a buffer'
                );
            } catch {
                // Some cards don't support this command, which is OK
            }

            card.disconnect(SCARD_LEAVE_CARD);
        } finally {
            ctx.close();
        }
    });

    it('should get card status', async (t) => {
        if (!hasCardPresent()) {
            t.skip('No card present');
            return;
        }
        const ctx = new Context();
        try {
            const readers = ctx.listReaders();
            const reader = readers.find(
                (r: ReaderType) => (r.state & SCARD_STATE_PRESENT) !== 0
            );
            const card = await reader!.connect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
            );

            const status = card.getStatus();
            assert(
                typeof status.state === 'number',
                'Status state should be a number'
            );
            assert(
                typeof status.protocol === 'number',
                'Status protocol should be a number'
            );
            assert(
                Buffer.isBuffer(status.atr),
                'Status ATR should be a buffer'
            );

            card.disconnect(SCARD_LEAVE_CARD);
        } finally {
            ctx.close();
        }
    });
});

describe('Devices (Event API)', () => {
    it('should create Devices instance', () => {
        const devices = new Devices();
        assert(devices, 'Should create Devices instance');
    });

    it('should start and stop monitoring', async () => {
        const devices = new Devices();

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();
                resolve();
            }, 1000);

            devices.on('error', (err: Error) => {
                const expectedErrors = [
                    'No readers',
                    'service',
                    'unresponsive',
                    'Sharing violation',
                ];
                const isExpected = expectedErrors.some((msg) =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );

                if (!isExpected) {
                    clearTimeout(timeout);
                    devices.stop();
                    reject(err);
                }
            });

            devices.start();
        });
    });

    it('should emit reader-attached for pre-existing readers on start', async (t) => {
        if (!hasReaders()) {
            t.skip('No readers available');
            return;
        }

        const checkCtx = new Context();
        const existingReaders = checkCtx.listReaders();
        checkCtx.close();

        const devices = new Devices();
        const attachedReaders: unknown[] = [];

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();
                if (attachedReaders.length === existingReaders.length) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            `Expected ${existingReaders.length} reader-attached events but received ${attachedReaders.length}`
                        )
                    );
                }
            }, 1000);

            devices.on('error', (err: Error) => {
                const expectedErrors = [
                    'No readers',
                    'service',
                    'unresponsive',
                    'Sharing violation',
                ];
                const isExpected = expectedErrors.some((msg) =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );
                if (!isExpected) {
                    clearTimeout(timeout);
                    devices.stop();
                    reject(err);
                }
            });

            devices.on('reader-attached', (reader: unknown) => {
                attachedReaders.push(reader);
            });

            devices.start();
        });
    });
});

describe('Protocol Fallback (Issue #34)', () => {
    it('should fallback to T=0 protocol if dual protocol fails', async (t) => {
        if (!hasCardPresent()) {
            t.skip('No card present');
            return;
        }

        const devices = new Devices();
        const cardInsertedEvents: unknown[] = [];
        const errors: Error[] = [];

        await new Promise<void>((resolve, reject) => {
            const _timeout = setTimeout(() => {
                devices.stop();

                const unresponsiveErrors = errors.filter((err) =>
                    err.message.toLowerCase().includes('unresponsive')
                );
                void _timeout; // Reference to avoid unused variable warning

                if (unresponsiveErrors.length > 0) {
                    reject(
                        new Error(
                            `Got ${unresponsiveErrors.length} unresponsive card error(s). ` +
                                `Devices should fallback to T=0 protocol when T=0|T=1 fails.`
                        )
                    );
                    return;
                }

                resolve();
            }, 2000);

            devices.on('error', (err: Error) => {
                errors.push(err);
            });

            devices.on(
                'card-inserted',
                ({
                    reader,
                    card,
                }: {
                    reader: unknown;
                    card: unknown;
                }) => {
                    cardInsertedEvents.push({ reader, card });
                }
            );

            devices.start();
        });
    });
});
