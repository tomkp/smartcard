import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    MockCard,
    MockReader,
    MockContext,
    MockReaderMonitor,
    createMockDevices,
    createTestSetup,
    UnresponsiveDualProtocolReader,
    FailingMockReader,
    SlowMockReader,
    IntermittentFailureMockReader,
    UnstableMockCard,
    SCARD_PROTOCOL_T1,
} from '../helpers/mock';
import type { Card, MonitorEvent, ReaderEventInfo } from '../../lib/types';

describe('MockCard', () => {
    it('should create a mock card with protocol and ATR', () => {
        const atr = Buffer.from([0x3b, 0x8f, 0x80, 0x01]);
        const card = new MockCard(1, atr);

        assert.strictEqual(card.protocol, 1);
        assert.strictEqual(card.connected, true);
        assert(card.atr!.equals(atr));
    });

    it('should disconnect card', () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        assert.strictEqual(card.connected, true);

        card.disconnect();
        assert.strictEqual(card.connected, false);
        assert.strictEqual(card.atr, null);
    });

    it('should transmit APDU and return configured response', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]), [
            {
                command: [0xff, 0xca, 0x00, 0x00, 0x00],
                response: [0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00],
            },
        ]);

        const response = await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        assert(
            response.equals(Buffer.from([0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00]))
        );
    });

    it('should return default success for unknown commands', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        const response = await card.transmit([0x00, 0xa4, 0x04, 0x00]);
        assert(response.equals(Buffer.from([0x90, 0x00])));
    });

    it('should throw when transmitting on disconnected card', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        card.disconnect();

        await assert.rejects(
            async () => card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]),
            { message: 'Card is not connected' }
        );
    });

    it('should get card status', () => {
        const atr = Buffer.from([0x3b, 0x8f]);
        const card = new MockCard(2, atr);

        const status = card.getStatus();
        assert.strictEqual(status.protocol, 2);
        assert(status.atr.equals(atr));
        assert.strictEqual(typeof status.state, 'number');
    });

    it('should reconnect card async', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        card.disconnect();
        assert.strictEqual(card.connected, false);

        const protocol = await card.reconnect();
        assert.strictEqual(card.connected, true);
        assert.strictEqual(protocol, 1);
    });

    it('should update protocol after reconnect with different protocol', async () => {
        const card = new MockCard(1, Buffer.from([0x3b])); // Start with T=0 (protocol 1)
        assert.strictEqual(card.protocol, 1);

        // Simulate reconnection with T=1 protocol
        card.setReconnectProtocol(2);
        const newProtocol = await card.reconnect();

        assert.strictEqual(newProtocol, 2, 'reconnect should return new protocol');
        assert.strictEqual(
            card.protocol,
            2,
            'card.protocol should be updated after reconnect'
        );
    });

    it('should accept maxRecvLength option in transmit', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00], {
            maxRecvLength: 65536,
        });
        assert.strictEqual(card._lastTransmitOptions.maxRecvLength, 65536);
    });

    it('should use default options when none provided', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        assert.deepStrictEqual(card._lastTransmitOptions, {});
    });
});

describe('MockReader', () => {
    it('should create reader without card', () => {
        const reader = new MockReader('Test Reader');

        assert.strictEqual(reader.name, 'Test Reader');
        assert.strictEqual(reader.atr, null);
        assert.strictEqual(reader.state & 0x20, 0); // Not PRESENT
    });

    it('should create reader with card', () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        const reader = new MockReader('Test Reader', card);

        assert.strictEqual(reader.name, 'Test Reader');
        assert(reader.atr!.equals(Buffer.from([0x3b])));
        assert.strictEqual(reader.state & 0x20, 0x20); // PRESENT
    });

    it('should connect to card', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        const reader = new MockReader('Test Reader', card);

        const connectedCard = await reader.connect(2, 3);
        assert.strictEqual(connectedCard, card);
    });

    it('should throw when connecting without card', async () => {
        const reader = new MockReader('Test Reader');

        await assert.rejects(async () => reader.connect(), {
            message: 'No card in reader',
        });
    });

    it('should insert and remove cards', () => {
        const reader = new MockReader('Test Reader');
        assert.strictEqual(reader.atr, null);

        const card = new MockCard(1, Buffer.from([0x3b]));
        reader.insertCard(card);
        assert(reader.atr!.equals(Buffer.from([0x3b])));

        reader.removeCard();
        assert.strictEqual(reader.atr, null);
    });
});

describe('MockContext', () => {
    it('should create valid context', () => {
        const ctx = new MockContext();
        assert.strictEqual(ctx.isValid, true);
    });

    it('should close context', () => {
        const ctx = new MockContext();
        ctx.close();
        assert.strictEqual(ctx.isValid, false);
    });

    it('should list readers', () => {
        const ctx = new MockContext();
        const reader1 = new MockReader('Reader 1');
        const reader2 = new MockReader('Reader 2');

        ctx.addReader(reader1);
        ctx.addReader(reader2);

        const readers = ctx.listReaders();
        assert.strictEqual(readers.length, 2);
        assert.strictEqual(readers[0].name, 'Reader 1');
        assert.strictEqual(readers[1].name, 'Reader 2');
    });

    it('should remove readers', () => {
        const ctx = new MockContext();
        ctx.addReader(new MockReader('Reader 1'));
        ctx.addReader(new MockReader('Reader 2'));

        ctx.removeReader('Reader 1');

        const readers = ctx.listReaders();
        assert.strictEqual(readers.length, 1);
        assert.strictEqual(readers[0].name, 'Reader 2');
    });

    it('should throw when listing readers on closed context', () => {
        const ctx = new MockContext();
        ctx.close();

        assert.throws(() => ctx.listReaders(), {
            message: 'Context is not valid',
        });
    });
});

describe('MockReaderMonitor', () => {
    it('should start and stop monitoring', () => {
        const monitor = new MockReaderMonitor();

        assert.strictEqual(monitor.isRunning, false);

        monitor.start(() => {});
        assert.strictEqual(monitor.isRunning, true);

        monitor.stop();
        assert.strictEqual(monitor.isRunning, false);
    });

    it('should throw when starting already running monitor', () => {
        const monitor = new MockReaderMonitor();
        monitor.start(() => {});

        assert.throws(() => monitor.start(() => {}), {
            message: 'Monitor is already running',
        });

        monitor.stop();
    });

    it('should emit reader-attached for existing readers on start', () => {
        const monitor = new MockReaderMonitor();
        const reader = new MockReader('Test Reader');
        monitor.attachReader(reader);

        const events: { type: string; reader: string }[] = [];
        monitor.start((event) => events.push(event));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'reader-attached');
        assert.strictEqual(events[0].reader, 'Test Reader');

        monitor.stop();
    });

    it('should emit events when attaching/detaching readers', () => {
        const monitor = new MockReaderMonitor();
        const events: { type: string }[] = [];

        monitor.start((event) => events.push(event));

        const reader = new MockReader('Test Reader');
        monitor.attachReader(reader);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'reader-attached');

        monitor.detachReader('Test Reader');

        assert.strictEqual(events.length, 2);
        assert.strictEqual(events[1].type, 'reader-detached');

        monitor.stop();
    });

    it('should emit events when inserting/removing cards', () => {
        const monitor = new MockReaderMonitor();
        const events: { type: string; atr?: Buffer | null }[] = [];

        const reader = new MockReader('Test Reader');
        monitor.attachReader(reader);

        monitor.start((event) => events.push(event));
        events.length = 0; // Clear the reader-attached event

        const card = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        monitor.insertCard('Test Reader', card);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'card-inserted');
        assert(events[0].atr!.equals(Buffer.from([0x3b, 0x8f])));

        monitor.removeCard('Test Reader');

        assert.strictEqual(events.length, 2);
        assert.strictEqual(events[1].type, 'card-removed');

        monitor.stop();
    });
});

describe('createTestSetup Helper', () => {
    it('should create a complete test setup with defaults', () => {
        const setup = createTestSetup();

        assert(setup.devices, 'Should have devices');
        assert(setup.context, 'Should have context');
        assert(setup.monitor, 'Should have monitor');
        assert(setup.reader, 'Should have reader');
        assert(setup.card, 'Should have card');
        assert.strictEqual(setup.reader.name, 'Test Reader');
    });

    it('should allow custom reader name', () => {
        const setup = createTestSetup({ readerName: 'Custom Reader' });
        assert.strictEqual(setup.reader.name, 'Custom Reader');
    });

    it('should allow custom card responses', async () => {
        const setup = createTestSetup({
            cardResponses: [
                { command: [0xff, 0xca, 0x00, 0x00, 0x00], response: [0x01, 0x02, 0x90, 0x00] }
            ]
        });

        const response = await setup.card.transmit(Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]));
        assert.deepStrictEqual(response, Buffer.from([0x01, 0x02, 0x90, 0x00]));
    });

    it('should emit events when started', async () => {
        const setup = createTestSetup();
        const events: unknown[] = [];

        setup.devices.on('reader-attached', (r: unknown) => events.push(r));
        setup.devices.start();

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(events.length, 1);
        setup.devices.stop();
    });
});

describe('Devices addListener/removeListener (Issue #96)', () => {
    it('addListener should register event handler', async () => {
        const setup = createTestSetup();
        const events: unknown[] = [];

        setup.devices.addListener('reader-attached', (r: unknown) => events.push(r));
        setup.devices.start();

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(events.length, 1);
        setup.devices.stop();
    });

    it('removeListener should unregister event handler', async () => {
        const setup = createTestSetup();
        const events: unknown[] = [];

        const handler = (r: unknown) => events.push(r);
        setup.devices.addListener('reader-attached', handler);
        setup.devices.removeListener('reader-attached', handler);
        setup.devices.start();

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(events.length, 0, 'Handler should have been removed');
        setup.devices.stop();
    });
});

describe('MockDevices Integration', () => {
    it('should emit reader-attached events', async () => {
        const setup = createTestSetup({ readerName: 'ACR122U' });
        const events: { type: string; reader: { name: string } }[] = [];

        setup.devices.on('reader-attached', (reader: { name: string }) =>
            events.push({ type: 'reader-attached', reader })
        );

        setup.devices.start();

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'reader-attached');
        assert.strictEqual(events[0].reader.name, 'ACR122U');

        setup.devices.stop();
    });

    it('should emit card-inserted events with card object', async () => {
        const mockCard = new MockCard(
            1,
            Buffer.from([0x3b, 0x8f, 0x80, 0x01]),
            [
                {
                    command: [0xff, 0xca, 0x00, 0x00, 0x00],
                    response: [0x04, 0xa2, 0x90, 0x00],
                },
            ]
        );
        const mockReader = new MockReader('ACR122U', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: { reader: ReaderEventInfo; card: Card }[] = [];

        devices.on(
            'card-inserted',
            (event: { reader: ReaderEventInfo; card: Card }) =>
                events.push(event)
        );

        devices.start();

        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].reader.name, 'ACR122U');
        assert(events[0].card);

        const response = await events[0].card.transmit([
            0xff, 0xca, 0x00, 0x00, 0x00,
        ]);
        assert(response.equals(Buffer.from([0x04, 0xa2, 0x90, 0x00])));

        devices.stop();
    });

    it('should emit card-removed events', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b]));
        const mockReader = new MockReader('ACR122U', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: string[] = [];

        devices.on('card-inserted', () => events.push('inserted'));
        devices.on('card-removed', () => events.push('removed'));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        mockMonitor.removeCard('ACR122U');
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert(events.includes('inserted'));
        assert(events.includes('removed'));

        devices.stop();
    });

    it('should handle multiple readers', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const reader1 = new MockReader(
            'Reader 1',
            new MockCard(1, Buffer.from([0x3b]))
        );
        const reader2 = new MockReader(
            'Reader 2',
            new MockCard(2, Buffer.from([0x3c]))
        );

        mockContext.addReader(reader1);
        mockContext.addReader(reader2);
        mockMonitor.attachReader(reader1);
        mockMonitor.attachReader(reader2);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const readerEvents: string[] = [];
        const cardEvents: string[] = [];

        devices.on('reader-attached', (r: { name: string }) =>
            readerEvents.push(r.name)
        );
        devices.on('card-inserted', (e: { reader: { name: string } }) =>
            cardEvents.push(e.reader.name)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(readerEvents.length, 2);
        assert(readerEvents.includes('Reader 1'));
        assert(readerEvents.includes('Reader 2'));

        assert.strictEqual(cardEvents.length, 2);
        assert(cardEvents.includes('Reader 1'));
        assert(cardEvents.includes('Reader 2'));

        devices.stop();
    });

    it('should emit reader-detached events', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();
        const reader = new MockReader('ACR122U');

        mockContext.addReader(reader);
        mockMonitor.attachReader(reader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: string[] = [];

        devices.on('reader-attached', () => events.push('attached'));
        devices.on('reader-detached', () => events.push('detached'));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 10));

        mockMonitor.detachReader('ACR122U');
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert(events.includes('attached'));
        assert(events.includes('detached'));

        devices.stop();
    });
});

describe('isUnresponsiveCardError', () => {
    const { isUnresponsiveCardError } = require('../../lib/errors');

    it('should return true for unresponsive error message', () => {
        const err = new Error('Card is unresponsive');
        assert.strictEqual(isUnresponsiveCardError(err), true);
    });

    it('should return true for SCARD_W_UNRESPONSIVE_CARD message', () => {
        const err = new Error('SCARD_W_UNRESPONSIVE_CARD');
        assert.strictEqual(isUnresponsiveCardError(err), true);
    });

    it('should return true for case-insensitive match', () => {
        const err = new Error('UNRESPONSIVE card detected');
        assert.strictEqual(isUnresponsiveCardError(err), true);
    });

    it('should return false for other errors', () => {
        const err = new Error('Sharing violation');
        assert.strictEqual(isUnresponsiveCardError(err), false);
    });

    it('should return false for error without message', () => {
        const err = new Error();
        assert.strictEqual(isUnresponsiveCardError(err), false);
    });

    it('should return false for non-Error objects', () => {
        assert.strictEqual(isUnresponsiveCardError('string error' as unknown as Error), false);
        assert.strictEqual(isUnresponsiveCardError(null as unknown as Error), false);
        assert.strictEqual(isUnresponsiveCardError(undefined as unknown as Error), false);
    });
});

describe('Protocol Fallback (Issue #34)', () => {
    it('should fallback to T=0 when dual protocol fails with unresponsive error', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new UnresponsiveDualProtocolReader(
            'Test Reader',
            mockCard
        );
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: unknown[] = [];
        const errors: Error[] = [];

        devices.on('card-inserted', (event: unknown) => cardEvents.push(event));
        devices.on('error', (err: Error) => errors.push(err));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(
            cardEvents.length,
            1,
            'Should emit card-inserted event'
        );
        assert.strictEqual(errors.length, 0, 'Should not emit error');
        assert.strictEqual(
            mockReader.connectAttempts,
            2,
            'Should attempt connect twice (fallback)'
        );

        devices.stop();
    });

    it('should rethrow non-unresponsive errors without fallback', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new FailingMockReader(
            'Test Reader',
            mockCard,
            'Sharing violation'
        );
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: unknown[] = [];
        const errors: Error[] = [];

        devices.on('card-inserted', (event: unknown) => cardEvents.push(event));
        devices.on('error', (err: Error) => errors.push(err));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(
            cardEvents.length,
            0,
            'Should not emit card-inserted event'
        );
        assert.strictEqual(errors.length, 1, 'Should emit error');
        assert(
            errors[0].message.includes('Sharing violation'),
            'Error should contain original message'
        );
        assert.strictEqual(
            mockReader.connectAttempts,
            1,
            'Should only attempt connect once'
        );

        devices.stop();
    });

    it('should succeed on first try when dual protocol works', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new MockReader('Test Reader', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: unknown[] = [];
        const errors: Error[] = [];

        devices.on('card-inserted', (event: unknown) => cardEvents.push(event));
        devices.on('error', (err: Error) => errors.push(err));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(
            cardEvents.length,
            1,
            'Should emit card-inserted event'
        );
        assert.strictEqual(errors.length, 0, 'Should not emit error');
        assert.strictEqual(
            mockReader.connectAttempts,
            1,
            'Should only attempt connect once'
        );

        devices.stop();
    });
});

describe('Reconnect protocol fallback', () => {
    const { wrapCard } = require('../../lib/card-wrapper');
    const { SCARD_PROTOCOL_T0, SCARD_PROTOCOL_T1 } = require('../helpers/mock');
    const T0 = SCARD_PROTOCOL_T0;
    const T1 = SCARD_PROTOCOL_T1;
    const T0_OR_T1 = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
    const RAW = 4;
    const SHARED = 2;
    const RESET = 1;

    /**
     * A card in `active` mode whose reconnect fails with each of `errors` in
     * turn, then succeeds. Records the protocol and initialization of each call.
     */
    class ReconnectingCard extends MockCard {
        calls: Array<{ protocol?: number; init?: number }> = [];
        constructor(
            active: number,
            private _errors: string[]
        ) {
            super(active, Buffer.from([0x3b, 0x6b]));
        }
        async reconnect(
            shareMode?: number,
            protocol?: number,
            init?: number
        ): Promise<number> {
            this.calls.push({ protocol, init });
            const error = this._errors.shift();
            if (error) {
                throw new Error(error);
            }
            return super.reconnect(shareMode, protocol, init);
        }
    }

    it('should retry with the active protocol when T=0|T=1 is unresponsive', async () => {
        const native = new ReconnectingCard(T0, ['Card is unresponsive']);
        const card = wrapCard(native);

        assert.strictEqual(await card.reconnect(SHARED, T0_OR_T1, RESET), T0);
        assert.deepStrictEqual(native.calls, [
            { protocol: T0_OR_T1, init: RESET },
            { protocol: T0, init: RESET },
        ]);
    });

    it('should treat no protocol as T=0|T=1', async () => {
        const native = new ReconnectingCard(T0, ['Card is unresponsive']);
        const card = wrapCard(native);

        assert.strictEqual(await card.reconnect(SHARED, undefined, RESET), T0);
        assert.deepStrictEqual(native.calls, [
            { protocol: undefined, init: RESET },
            { protocol: T0, init: RESET },
        ]);
    });

    it('should not retry when the active protocol was requested', async () => {
        const native = new ReconnectingCard(T0, ['Card is unresponsive']);
        const card = wrapCard(native);

        await assert.rejects(card.reconnect(SHARED, T0, RESET), /unresponsive/);
        assert.strictEqual(native.calls.length, 1);
    });

    it('should not retry with a protocol the caller did not offer', async () => {
        const t0Card = new ReconnectingCard(T0, ['Card is unresponsive']);
        await assert.rejects(wrapCard(t0Card).reconnect(SHARED, T1, RESET), /unresponsive/);
        assert.strictEqual(t0Card.calls.length, 1);

        const rawCard = new ReconnectingCard(RAW, ['Card is unresponsive']);
        await assert.rejects(wrapCard(rawCard).reconnect(SHARED, T0_OR_T1, RESET), /unresponsive/);
        assert.strictEqual(rawCard.calls.length, 1);
    });

    it('should rethrow other errors without retrying', async () => {
        const native = new ReconnectingCard(T0, ['Sharing violation']);
        const card = wrapCard(native);

        await assert.rejects(card.reconnect(SHARED, T0_OR_T1, RESET), /Sharing violation/);
        assert.strictEqual(native.calls.length, 1);
    });

    it('should report the original error when the retry fails too', async () => {
        const native = new ReconnectingCard(T0, ['Card is unresponsive', 'Card was removed']);
        const card = wrapCard(native);

        await assert.rejects(card.reconnect(SHARED, T0_OR_T1, RESET), (err: Error) => {
            assert.match(err.message, /unresponsive/);
            assert.match((err.cause as Error).message, /removed/);
            return true;
        });
        assert.strictEqual(native.calls.length, 2);
    });
});

describe('Enhanced Mock Scenarios', () => {
    it('SlowMockReader should delay before connecting', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b]));
        const reader = new SlowMockReader('Test Reader', mockCard, 50);

        const start = Date.now();
        const card = await reader.connect();
        const elapsed = Date.now() - start;

        assert(card, 'Should return card');
        assert(elapsed >= 40, `Should delay at least 40ms, got ${elapsed}ms`);
        assert.strictEqual(
            reader.connectAttempts,
            1,
            'Should record connect attempt'
        );
    });

    it('IntermittentFailureMockReader should fail then succeed', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b]));
        const reader = new IntermittentFailureMockReader(
            'Test Reader',
            mockCard,
            2,
            'Temporary failure'
        );

        // First attempt should fail
        await assert.rejects(async () => reader.connect(), {
            message: 'Temporary failure',
        });

        // Second attempt should fail
        await assert.rejects(async () => reader.connect(), {
            message: 'Temporary failure',
        });

        // Third attempt should succeed
        const card = await reader.connect();
        assert(card, 'Third attempt should succeed');
        assert.strictEqual(
            reader.connectAttempts,
            3,
            'Should record all attempts'
        );
    });

    it('UnstableMockCard should fail after N transmits', async () => {
        const card = new UnstableMockCard(1, Buffer.from([0x3b]), [], 2);

        // First two transmits should succeed
        await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);

        // Third should fail
        await assert.rejects(
            async () => card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]),
            { message: 'Card was removed' }
        );

        assert.strictEqual(
            card.connected,
            false,
            'Card should be disconnected'
        );
    });

    it('MockCard with delay should simulate slow responses', async () => {
        const card = new MockCard(1, Buffer.from([0x3b]), [], {
            transmitDelay: 50,
        });

        const start = Date.now();
        await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        const elapsed = Date.now() - start;

        assert(elapsed >= 40, `Should delay at least 40ms, got ${elapsed}ms`);
        assert.strictEqual(
            card.transmitCount,
            1,
            'Should record transmit count'
        );
    });

    it('MockCard should track transmit and control counts', () => {
        const card = new MockCard(1, Buffer.from([0x3b]));
        assert.strictEqual(
            card.transmitCount,
            0,
            'Initial transmit count should be 0'
        );
        assert.strictEqual(
            card.controlCount,
            0,
            'Initial control count should be 0'
        );
    });
});

describe('Error Classes', () => {
    // Dynamic import for the error classes
    const {
        PCSCError,
        CardRemovedError,
        TimeoutError,
        NoReadersError,
        ServiceNotRunningError,
        SharingViolationError,
        createPCSCError,
    } = require('../../lib/errors');

    it('PCSCError should have code property', () => {
        const err = new PCSCError('Test error', 0x80100001);
        assert.strictEqual(err.code, 0x80100001);
        assert.strictEqual(err.name, 'PCSCError');
        assert.strictEqual(err.message, 'Test error');
    });

    it('CardRemovedError should have correct code', () => {
        const err = new CardRemovedError();
        assert.strictEqual(err.code, 0x80100069);
        assert.strictEqual(err.name, 'CardRemovedError');
        assert(err instanceof PCSCError);
    });

    it('TimeoutError should have correct code', () => {
        const err = new TimeoutError();
        assert.strictEqual(err.code, 0x8010000a);
        assert.strictEqual(err.name, 'TimeoutError');
        assert(err instanceof PCSCError);
    });

    it('NoReadersError should have correct code', () => {
        const err = new NoReadersError();
        assert.strictEqual(err.code, 0x8010002e);
        assert.strictEqual(err.name, 'NoReadersError');
        assert(err instanceof PCSCError);
    });

    it('ServiceNotRunningError should have correct code', () => {
        const err = new ServiceNotRunningError();
        assert.strictEqual(err.code, 0x8010001d);
        assert.strictEqual(err.name, 'ServiceNotRunningError');
        assert(err instanceof PCSCError);
    });

    it('SharingViolationError should have correct code', () => {
        const err = new SharingViolationError();
        assert.strictEqual(err.code, 0x8010000b);
        assert.strictEqual(err.name, 'SharingViolationError');
        assert(err instanceof PCSCError);
    });

    it('createPCSCError should return CardRemovedError for 0x80100069', () => {
        const err = createPCSCError('Card was removed', 0x80100069);
        assert(err instanceof CardRemovedError);
        assert.strictEqual(err.code, 0x80100069);
    });

    it('createPCSCError should return TimeoutError for 0x8010000A', () => {
        const err = createPCSCError('Timeout', 0x8010000a);
        assert(err instanceof TimeoutError);
        assert.strictEqual(err.code, 0x8010000a);
    });

    it('createPCSCError should return NoReadersError for 0x8010002E', () => {
        const err = createPCSCError('No readers', 0x8010002e);
        assert(err instanceof NoReadersError);
        assert.strictEqual(err.code, 0x8010002e);
    });

    it('createPCSCError should return ServiceNotRunningError for 0x8010001D', () => {
        const err = createPCSCError('Service not running', 0x8010001d);
        assert(err instanceof ServiceNotRunningError);
        assert.strictEqual(err.code, 0x8010001d);
    });

    it('createPCSCError should return SharingViolationError for 0x8010000B', () => {
        const err = createPCSCError('Sharing violation', 0x8010000b);
        assert(err instanceof SharingViolationError);
        assert.strictEqual(err.code, 0x8010000b);
    });

    it('createPCSCError should return PCSCError for unknown codes', () => {
        const err = createPCSCError('Unknown error', 0x80100099);
        assert(err instanceof PCSCError);
        assert(!(err instanceof CardRemovedError));
        assert.strictEqual(err.code, 0x80100099);
    });
});

describe('Control Code Constants', () => {
    const {
        SCARD_CTL_CODE,
        CM_IOCTL_GET_FEATURE_REQUEST,
        FEATURE_VERIFY_PIN_DIRECT,
        FEATURE_MODIFY_PIN_DIRECT,
        FEATURE_IFD_PIN_PROPERTIES,
        FEATURE_GET_TLV_PROPERTIES,
    } = require('../../lib');

    it('SCARD_CTL_CODE should generate correct control codes', () => {
        const code = SCARD_CTL_CODE(3400);
        assert.strictEqual(typeof code, 'number');
        assert(code > 0);
    });

    it('CM_IOCTL_GET_FEATURE_REQUEST should be defined', () => {
        assert.strictEqual(typeof CM_IOCTL_GET_FEATURE_REQUEST, 'number');
        assert(CM_IOCTL_GET_FEATURE_REQUEST > 0);
    });

    it('FEATURE constants should have correct values', () => {
        assert.strictEqual(FEATURE_VERIFY_PIN_DIRECT, 0x06);
        assert.strictEqual(FEATURE_MODIFY_PIN_DIRECT, 0x07);
        assert.strictEqual(FEATURE_IFD_PIN_PROPERTIES, 0x0a);
        assert.strictEqual(FEATURE_GET_TLV_PROPERTIES, 0x12);
    });
});

describe('parseFeatures (Issue #86)', () => {
    const { parseFeatures, FEATURE_VERIFY_PIN_DIRECT, FEATURE_MODIFY_PIN_DIRECT } = require('../../lib');

    it('should return empty map for empty buffer', () => {
        const features = parseFeatures(Buffer.alloc(0));
        assert(features instanceof Map, 'Should return a Map');
        assert.strictEqual(features.size, 0, 'Map should be empty');
    });

    it('should parse single feature TLV', () => {
        // TLV: tag=0x06 (VERIFY_PIN_DIRECT), length=4, value=0x42000D48 (control code)
        const tlv = Buffer.from([0x06, 0x04, 0x42, 0x00, 0x0D, 0x48]);
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 1, 'Should have one feature');
        assert(features.has(FEATURE_VERIFY_PIN_DIRECT), 'Should have VERIFY_PIN_DIRECT');
        assert.strictEqual(features.get(FEATURE_VERIFY_PIN_DIRECT), 0x42000D48);
    });

    it('should parse multiple feature TLVs', () => {
        // Two TLVs: VERIFY_PIN_DIRECT and MODIFY_PIN_DIRECT
        const tlv = Buffer.from([
            0x06, 0x04, 0x42, 0x00, 0x0D, 0x48, // VERIFY_PIN_DIRECT = 0x42000D48
            0x07, 0x04, 0x42, 0x00, 0x0D, 0x4C, // MODIFY_PIN_DIRECT = 0x42000D4C
        ]);
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 2, 'Should have two features');
        assert.strictEqual(features.get(FEATURE_VERIFY_PIN_DIRECT), 0x42000D48);
        assert.strictEqual(features.get(FEATURE_MODIFY_PIN_DIRECT), 0x42000D4C);
    });

    it('should skip TLVs with non-4-byte length', () => {
        // TLV with length=2 (not 4) should be skipped
        const tlv = Buffer.from([
            0x06, 0x02, 0x00, 0x00, // length=2, skip this
            0x07, 0x04, 0x42, 0x00, 0x0D, 0x4C, // valid TLV
        ]);
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 1, 'Should have one feature (skipped invalid)');
        assert(!features.has(FEATURE_VERIFY_PIN_DIRECT), 'Should not have skipped feature');
        assert(features.has(FEATURE_MODIFY_PIN_DIRECT), 'Should have valid feature');
    });

    it('should handle truncated buffer gracefully', () => {
        // Buffer too short to contain a full TLV
        const tlv = Buffer.from([0x06, 0x04, 0x42]); // only 3 bytes after tag+length
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 0, 'Should return empty map for truncated buffer');
    });

    it('should handle buffer shorter than minimum TLV', () => {
        // Less than 4 bytes (minimum for tag + length + 2 bytes)
        const tlv = Buffer.from([0x06, 0x04]);
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 0, 'Should return empty map');
    });

    it('should parse real-world CCID response', () => {
        // Simulated response from a real pinpad reader
        const tlv = Buffer.from([
            0x06, 0x04, 0x42, 0x33, 0x00, 0x06, // VERIFY_PIN_DIRECT
            0x07, 0x04, 0x42, 0x33, 0x00, 0x07, // MODIFY_PIN_DIRECT
            0x0a, 0x04, 0x42, 0x33, 0x00, 0x0a, // IFD_PIN_PROPERTIES
            0x12, 0x04, 0x42, 0x33, 0x00, 0x12, // GET_TLV_PROPERTIES
        ]);
        const features = parseFeatures(tlv);

        assert.strictEqual(features.size, 4, 'Should have 4 features');
        assert.strictEqual(features.get(0x06), 0x42330006);
        assert.strictEqual(features.get(0x07), 0x42330007);
        assert.strictEqual(features.get(0x0a), 0x4233000a);
        assert.strictEqual(features.get(0x12), 0x42330012);
    });

    it('should not read beyond buffer with malformed length field', () => {
        // TLV with length=255 (would read way beyond buffer if not validated)
        const tlv = Buffer.from([0x06, 0xff, 0x42, 0x00, 0x0D, 0x48]);
        const features = parseFeatures(tlv);

        // Should safely skip this malformed entry and not crash
        assert.strictEqual(features.size, 0, 'Should return empty map for malformed length');
    });

    it('should handle length that exactly exceeds remaining bytes', () => {
        // TLV says length=6 but only 4 bytes remain
        const tlv = Buffer.from([0x06, 0x06, 0x42, 0x00, 0x0D, 0x48]);
        const features = parseFeatures(tlv);

        // length != 4, so should be skipped anyway
        assert.strictEqual(features.size, 0, 'Should skip non-4 length entries');
    });
});

describe('APDU Building Utilities (Issue #98)', () => {
    const { buildGetResponseCommand, correctLeInCommand } = require('../../lib');

    describe('buildGetResponseCommand', () => {
        it('should build GET RESPONSE with Le=0x1C', () => {
            const cmd = buildGetResponseCommand(0x1c);
            assert.deepStrictEqual(cmd, Buffer.from([0x00, 0xc0, 0x00, 0x00, 0x1c]));
        });

        it('should build GET RESPONSE with Le=0x00 (256 bytes)', () => {
            const cmd = buildGetResponseCommand(0x00);
            assert.deepStrictEqual(cmd, Buffer.from([0x00, 0xc0, 0x00, 0x00, 0x00]));
        });

        it('should build GET RESPONSE with Le=0xFF', () => {
            const cmd = buildGetResponseCommand(0xff);
            assert.deepStrictEqual(cmd, Buffer.from([0x00, 0xc0, 0x00, 0x00, 0xff]));
        });
    });

    describe('correctLeInCommand', () => {
        it('should append Le to Case 1 command (4 bytes, no Le)', () => {
            const cmd = Buffer.from([0x00, 0xa4, 0x04, 0x00]);
            const corrected = correctLeInCommand(cmd, 0x10);
            assert.deepStrictEqual(corrected, Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x10]));
        });

        it('should replace Le in Case 2 command (5 bytes, Le at end)', () => {
            const cmd = Buffer.from([0x00, 0xb0, 0x00, 0x00, 0xff]);
            const corrected = correctLeInCommand(cmd, 0x20);
            assert.deepStrictEqual(corrected, Buffer.from([0x00, 0xb0, 0x00, 0x00, 0x20]));
        });

        it('should replace Le in Case 4 command (Lc + data + Le)', () => {
            const cmd = Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x02, 0xab, 0xcd, 0x00]);
            const corrected = correctLeInCommand(cmd, 0x30);
            assert.deepStrictEqual(corrected, Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x02, 0xab, 0xcd, 0x30]));
        });

        it('should append Le to Case 3 command instead of overwriting data', () => {
            // SELECT AID with Lc=7 and no Le - the last byte is data, not Le
            const cmd = Buffer.from('00a4040007a0000000031010', 'hex');
            const corrected = correctLeInCommand(cmd, 0x1c);
            assert.deepStrictEqual(
                corrected,
                Buffer.from('00a4040007a00000000310101c', 'hex'),
                'Le must be appended, never overwrite the last data byte'
            );
        });

        it('should return unrecognized command structures unchanged', () => {
            // Length matches neither Case 3 (5+Lc) nor Case 4 (5+Lc+1)
            const cmd = Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x02, 0xab]);
            const corrected = correctLeInCommand(cmd, 0x30);
            assert.deepStrictEqual(corrected, cmd);
            assert.notStrictEqual(corrected, cmd, 'Should still be a copy');
        });

        it('should not modify original command buffer', () => {
            const cmd = Buffer.from([0x00, 0xb0, 0x00, 0x00, 0xff]);
            const original = Buffer.from(cmd);
            correctLeInCommand(cmd, 0x20);
            assert.deepStrictEqual(cmd, original, 'Original should not be modified');
        });
    });
});

describe('Package Exports (Issue #78)', () => {
    // Tests run from dist/test/unit/, so we need to go up 3 levels to reach the root
    const packageJsonPath = resolve(__dirname, '../../../package.json');

    it('should have import condition in exports for ESM support', () => {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        assert(packageJson.exports, 'exports field should exist');
        assert(packageJson.exports['.'], 'exports["."] should exist');
        assert(
            packageJson.exports['.'].import,
            'exports["."].import should exist for ESM support'
        );
        assert(
            packageJson.exports['.'].require,
            'exports["."].require should exist for CJS support'
        );
        assert(
            packageJson.exports['.'].types,
            'exports["."].types should exist for TypeScript support'
        );
    });

    it('import and require should point to the same entry file', () => {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        assert.strictEqual(
            packageJson.exports['.'].import,
            packageJson.exports['.'].require,
            'import and require conditions should point to same file'
        );
    });

    it('should expose the types subpath to legacy Node module resolution', () => {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        assert.deepStrictEqual(packageJson.typesVersions, {
            '*': {
                types: ['./dist/lib/types.d.ts'],
            },
        });
    });
});

describe('Get Connected Cards (Issue #80)', () => {
    it('getCards should return empty map when no cards connected', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();
        const mockReader = new MockReader('ACR122U'); // No card

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const cards = devices.getCards();
        assert(cards instanceof Map, 'getCards should return a Map');
        assert.strictEqual(cards.size, 0, 'Map should be empty when no cards');

        devices.stop();
    });

    it('getCards should return connected cards by reader name', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new MockReader('ACR122U', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const cards = devices.getCards();
        assert.strictEqual(cards.size, 1, 'Should have one card');
        assert(cards.has('ACR122U'), 'Should be keyed by reader name');
        const card = cards.get('ACR122U');
        assert(card, 'Card should exist');
        assert(card.atr!.equals(Buffer.from([0x3b, 0x8f])), 'Card should have correct ATR');

        devices.stop();
    });

    it('getCards should return multiple cards from multiple readers', async () => {
        const mockCard1 = new MockCard(1, Buffer.from([0x3b, 0x01]));
        const mockCard2 = new MockCard(2, Buffer.from([0x3b, 0x02]));
        const mockReader1 = new MockReader('Reader 1', mockCard1);
        const mockReader2 = new MockReader('Reader 2', mockCard2);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader1);
        mockContext.addReader(mockReader2);
        mockMonitor.attachReader(mockReader1);
        mockMonitor.attachReader(mockReader2);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const cards = devices.getCards();
        assert.strictEqual(cards.size, 2, 'Should have two cards');
        assert(cards.has('Reader 1'), 'Should have card from Reader 1');
        assert(cards.has('Reader 2'), 'Should have card from Reader 2');

        devices.stop();
    });

    it('getCard should return null for unknown reader', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const card = devices.getCard('Unknown Reader');
        assert.strictEqual(card, null, 'Should return null for unknown reader');

        devices.stop();
    });

    it('getCard should return null for reader without card', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();
        const mockReader = new MockReader('ACR122U'); // No card

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const card = devices.getCard('ACR122U');
        assert.strictEqual(card, null, 'Should return null when reader has no card');

        devices.stop();
    });

    it('getCard should return card for specific reader', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new MockReader('ACR122U', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const card = devices.getCard('ACR122U');
        assert(card, 'Should return card');
        assert(card.atr!.equals(Buffer.from([0x3b, 0x8f])), 'Card should have correct ATR');

        devices.stop();
    });

    it('getCards should update when card is removed', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        const mockReader = new MockReader('ACR122U', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(devices.getCards().size, 1, 'Should have one card initially');

        mockMonitor.removeCard('ACR122U');
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(devices.getCards().size, 0, 'Should have no cards after removal');
        assert.strictEqual(devices.getCard('ACR122U'), null, 'getCard should return null after removal');

        devices.stop();
    });

    it('getCards should return empty map when not started', () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cards = devices.getCards();
        assert(cards instanceof Map, 'getCards should return a Map');
        assert.strictEqual(cards.size, 0, 'Map should be empty when not started');
    });
});

describe('Auto GET RESPONSE (Issue #82)', () => {
    it('transmitWithAutoResponse should handle SW1=61 by sending GET RESPONSE', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        // Mock card that returns 61 1C (28 more bytes) then the data
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            // Initial command returns SW1=61 with 28 bytes remaining
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x61, 0x1c],
            },
            // GET RESPONSE command returns data + 90 00
            {
                command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
                response: [
                    0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59,
                    0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44, 0x46,
                    0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f,
                    0x2d, 0x02, 0x65, 0x6e, 0x90, 0x00,
                ],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xa4, 0x04, 0x00, 0x0e],
            { autoGetResponse: true }
        );

        // Should have sent 2 commands
        assert.strictEqual(mockCard.transmitCount, 2);

        // Response should be data (28 bytes) + 90 00
        assert.strictEqual(response.length, 30);
        assert.strictEqual(response[response.length - 2], 0x90);
        assert.strictEqual(response[response.length - 1], 0x00);
    });

    it('transmitWithAutoResponse should handle SW1=6C by retrying with correct Le', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        // Mock card that returns 6C 10 (wrong Le, should use 16) then succeeds
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            // Initial command with Le=00 returns 6C 10
            {
                command: [0x00, 0xb2, 0x01, 0x0c, 0x00],
                response: [0x6c, 0x10],
            },
            // Retry with Le=10 succeeds
            {
                command: [0x00, 0xb2, 0x01, 0x0c, 0x10],
                response: [
                    0x70, 0x0e, 0x9f, 0x0a, 0x08, 0x01, 0x02, 0x03,
                    0x04, 0x05, 0x06, 0x07, 0x08, 0x9f, 0x09, 0x02,
                    0x90, 0x00,
                ],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xb2, 0x01, 0x0c, 0x00],
            { autoGetResponse: true }
        );

        // Should have sent 2 commands
        assert.strictEqual(mockCard.transmitCount, 2);

        // Response should be the successful data
        assert.strictEqual(response[response.length - 2], 0x90);
        assert.strictEqual(response[response.length - 1], 0x00);
    });

    it('transmitWithAutoResponse should handle chained SW1=61 responses', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        // Mock card that returns multiple 61 XX responses
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            // Initial command
            {
                command: [0x00, 0xca, 0x00, 0x00, 0x00],
                response: [0x61, 0x10],
            },
            // First GET RESPONSE - returns more data available
            {
                command: [0x00, 0xc0, 0x00, 0x00, 0x10],
                response: [
                    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
                    0x61, 0x08,
                ],
            },
            // Second GET RESPONSE - final data
            {
                command: [0x00, 0xc0, 0x00, 0x00, 0x08],
                response: [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x90, 0x00],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xca, 0x00, 0x00, 0x00],
            { autoGetResponse: true }
        );

        // Should have sent 3 commands
        assert.strictEqual(mockCard.transmitCount, 3);

        // Response should be all data concatenated + 90 00
        assert.strictEqual(response.length, 26); // 16 + 8 + 2
        assert.strictEqual(response[0], 0x01);
        assert.strictEqual(response[15], 0x10);
        assert.strictEqual(response[16], 0x11);
        assert.strictEqual(response[23], 0x18);
        assert.strictEqual(response[response.length - 2], 0x90);
        assert.strictEqual(response[response.length - 1], 0x00);
    });

    it('transmitWithAutoResponse should pass through normal responses unchanged', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0xff, 0xca, 0x00, 0x00, 0x00],
                response: [0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0xff, 0xca, 0x00, 0x00, 0x00],
            { autoGetResponse: true }
        );

        // Should only transmit once
        assert.strictEqual(mockCard.transmitCount, 1);

        // Response unchanged
        assert(response.equals(Buffer.from([0x04, 0xa2, 0x3b, 0x7a, 0x90, 0x00])));
    });

    it('transmitWithAutoResponse should skip handling when autoGetResponse is false', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x61, 0x1c],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xa4, 0x04, 0x00, 0x0e],
            { autoGetResponse: false }
        );

        // Should only transmit once - no automatic GET RESPONSE
        assert.strictEqual(mockCard.transmitCount, 1);

        // Response unchanged (raw 61 1C)
        assert(response.equals(Buffer.from([0x61, 0x1c])));
    });

    it('transmitWithAutoResponse should skip handling when autoGetResponse is not specified', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x61, 0x1c],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xa4, 0x04, 0x00, 0x0e],
            {}
        );

        // Should only transmit once
        assert.strictEqual(mockCard.transmitCount, 1);

        // Response unchanged (raw 61 1C)
        assert(response.equals(Buffer.from([0x61, 0x1c])));
    });

    it('transmitWithAutoResponse should pass through error status words', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x6a, 0x82], // File not found
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xa4, 0x04, 0x00, 0x0e],
            { autoGetResponse: true }
        );

        // Should only transmit once
        assert.strictEqual(mockCard.transmitCount, 1);

        // Error response unchanged
        assert(response.equals(Buffer.from([0x6a, 0x82])));
    });

    it('transmitWithAutoResponse should handle SW1=6C with empty original Le', async () => {
        const { transmitWithAutoResponse } = require('../../lib/t0-handler');

        // 4-byte command (no Le byte)
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xca, 0x9f, 0x17],
                response: [0x6c, 0x01],
            },
            {
                command: [0x00, 0xca, 0x9f, 0x17, 0x01],
                response: [0x03, 0x90, 0x00],
            },
        ]);

        const response = await transmitWithAutoResponse(
            mockCard,
            [0x00, 0xca, 0x9f, 0x17],
            { autoGetResponse: true }
        );

        assert.strictEqual(mockCard.transmitCount, 2);
        assert(response.equals(Buffer.from([0x03, 0x90, 0x00])));
    });
});

describe('card.transmit() autoGetResponse option (Issue #105)', () => {
    it('should handle SW1=61 when autoGetResponse option is passed to card.transmit()', async () => {
        // Mock card that returns 61 1C (28 more bytes) then the data
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            // Initial command returns SW1=61 with 28 bytes remaining
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x61, 0x1c],
            },
            // GET RESPONSE command returns data + 90 00
            {
                command: [0x00, 0xc0, 0x00, 0x00, 0x1c],
                response: [
                    0x6f, 0x1a, 0x84, 0x0e, 0x31, 0x50, 0x41, 0x59,
                    0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44, 0x46,
                    0x30, 0x31, 0xa5, 0x08, 0x88, 0x01, 0x01, 0x5f,
                    0x2d, 0x02, 0x65, 0x6e, 0x90, 0x00,
                ],
            },
        ]);
        const mockReader = new MockReader('Test Reader', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: { card: Card }[] = [];

        devices.on('card-inserted', (event: { reader: ReaderEventInfo; card: Card }) =>
            cardEvents.push(event)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.strictEqual(cardEvents.length, 1, 'Should have card-inserted event');
        const card = cardEvents[0].card;

        // This should work - autoGetResponse passed directly to card.transmit()
        const response = await card.transmit(
            [0x00, 0xa4, 0x04, 0x00, 0x0e],
            { autoGetResponse: true }
        );

        // Should have sent 2 commands (initial + GET RESPONSE)
        assert.strictEqual(mockCard.transmitCount, 2, 'Should have sent 2 commands');

        // Response should be data (28 bytes) + 90 00
        assert.strictEqual(response.length, 30, 'Response should be 30 bytes');
        assert.strictEqual(response[response.length - 2], 0x90);
        assert.strictEqual(response[response.length - 1], 0x00);

        devices.stop();
    });

    it('should handle SW1=6C when autoGetResponse option is passed to card.transmit()', async () => {
        // Mock card that returns 6C 10 (wrong Le) then succeeds
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xb2, 0x01, 0x0c, 0x00],
                response: [0x6c, 0x10],
            },
            {
                command: [0x00, 0xb2, 0x01, 0x0c, 0x10],
                response: [
                    0x70, 0x0e, 0x9f, 0x0a, 0x08, 0x01, 0x02, 0x03,
                    0x04, 0x05, 0x06, 0x07, 0x08, 0x9f, 0x09, 0x02,
                    0x90, 0x00,
                ],
            },
        ]);
        const mockReader = new MockReader('Test Reader', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: { card: Card }[] = [];

        devices.on('card-inserted', (event: { reader: ReaderEventInfo; card: Card }) =>
            cardEvents.push(event)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const card = cardEvents[0].card;

        // This should work - autoGetResponse passed directly to card.transmit()
        const response = await card.transmit(
            [0x00, 0xb2, 0x01, 0x0c, 0x00],
            { autoGetResponse: true }
        );

        // Should have sent 2 commands
        assert.strictEqual(mockCard.transmitCount, 2, 'Should have sent 2 commands');

        // Response should be successful
        assert.strictEqual(response[response.length - 2], 0x90);
        assert.strictEqual(response[response.length - 1], 0x00);

        devices.stop();
    });

    it('should return raw response when autoGetResponse is not specified', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b, 0x8f]), [
            {
                command: [0x00, 0xa4, 0x04, 0x00, 0x0e],
                response: [0x61, 0x1c],
            },
        ]);
        const mockReader = new MockReader('Test Reader', mockCard);
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: { card: Card }[] = [];

        devices.on('card-inserted', (event: { reader: ReaderEventInfo; card: Card }) =>
            cardEvents.push(event)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const card = cardEvents[0].card;

        // Without autoGetResponse, should return raw 61 XX
        const response = await card.transmit([0x00, 0xa4, 0x04, 0x00, 0x0e]);

        assert.strictEqual(mockCard.transmitCount, 1, 'Should only transmit once');
        assert(response.equals(Buffer.from([0x61, 0x1c])), 'Should return raw response');

        devices.stop();
    });
});

describe('Windows Card Event State Tracking (Issue #111)', () => {
    it('should detect card-inserted when readers are added/removed during monitoring', async () => {
        // Simulates the scenario where reader list changes (PnP event) while
        // card events are being processed - tests that events aren't lost
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const reader1 = new MockReader('Reader 1');
        const reader2 = new MockReader('Reader 2');

        mockContext.addReader(reader1);
        mockContext.addReader(reader2);
        mockMonitor.attachReader(reader1);
        mockMonitor.attachReader(reader2);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const readerEvents: string[] = [];
        const cardEvents: { type: string; reader: string }[] = [];

        devices.on('reader-attached', (r: { name: string }) =>
            readerEvents.push(`attached:${r.name}`)
        );
        devices.on('reader-detached', (r: { name: string }) =>
            readerEvents.push(`detached:${r.name}`)
        );
        devices.on('card-inserted', (e: { reader: { name: string } }) =>
            cardEvents.push({ type: 'inserted', reader: e.reader.name })
        );
        devices.on('card-removed', (e: { reader: { name: string } }) =>
            cardEvents.push({ type: 'removed', reader: e.reader.name })
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Now simulate a reader being removed while inserting a card in another reader
        // This is the scenario that causes index mismatch in the native code
        mockMonitor.detachReader('Reader 1');
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Insert card in remaining reader
        const card = new MockCard(1, Buffer.from([0x3b, 0x8f]));
        mockMonitor.insertCard('Reader 2', card);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify the card event was correctly associated with Reader 2
        const insertEvent = cardEvents.find(e => e.type === 'inserted');
        assert(insertEvent, 'Should have card-inserted event');
        assert.strictEqual(
            insertEvent.reader,
            'Reader 2',
            'Card event should be associated with correct reader'
        );

        devices.stop();
    });

    it('should detect card-removed reliably after multiple reader changes', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const reader1 = new MockReader(
            'Reader 1',
            new MockCard(1, Buffer.from([0x3b, 0x01]))
        );
        const reader2 = new MockReader(
            'Reader 2',
            new MockCard(1, Buffer.from([0x3b, 0x02]))
        );

        mockContext.addReader(reader1);
        mockContext.addReader(reader2);
        mockMonitor.attachReader(reader1);
        mockMonitor.attachReader(reader2);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const cardEvents: { type: string; reader: string }[] = [];

        devices.on('card-inserted', (e: { reader: { name: string } }) =>
            cardEvents.push({ type: 'inserted', reader: e.reader.name })
        );
        devices.on('card-removed', (e: { reader: { name: string } }) =>
            cardEvents.push({ type: 'removed', reader: e.reader.name })
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Both cards should be detected
        assert.strictEqual(
            cardEvents.filter(e => e.type === 'inserted').length,
            2,
            'Should detect both cards initially'
        );

        // Add a new reader (PnP event)
        const reader3 = new MockReader('Reader 3');
        mockMonitor.attachReader(reader3);
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Remove card from Reader 1
        mockMonitor.removeCard('Reader 1');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Remove card from Reader 2
        mockMonitor.removeCard('Reader 2');
        await new Promise((resolve) => setTimeout(resolve, 50));

        const removeEvents = cardEvents.filter(e => e.type === 'removed');
        assert.strictEqual(
            removeEvents.length,
            2,
            'Should detect both card removals'
        );
        assert(
            removeEvents.some(e => e.reader === 'Reader 1'),
            'Should detect Reader 1 card removal'
        );
        assert(
            removeEvents.some(e => e.reader === 'Reader 2'),
            'Should detect Reader 2 card removal'
        );

        devices.stop();
    });

    it('should handle rapid card insert/remove cycles', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const reader = new MockReader('Test Reader');
        mockContext.addReader(reader);
        mockMonitor.attachReader(reader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: string[] = [];

        devices.on('card-inserted', () => events.push('inserted'));
        devices.on('card-removed', () => events.push('removed'));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Rapid insert/remove cycles
        for (let i = 0; i < 5; i++) {
            const card = new MockCard(1, Buffer.from([0x3b, i]));
            mockMonitor.insertCard('Test Reader', card);
            await new Promise((resolve) => setTimeout(resolve, 10));
            mockMonitor.removeCard('Test Reader');
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should have equal number of inserts and removes
        const insertCount = events.filter(e => e === 'inserted').length;
        const removeCount = events.filter(e => e === 'removed').length;

        assert.strictEqual(insertCount, 5, 'Should detect all 5 card insertions');
        assert.strictEqual(removeCount, 5, 'Should detect all 5 card removals');

        devices.stop();
    });

    it('should maintain correct state when reader is reattached', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        const reader = new MockReader(
            'USB Reader',
            new MockCard(1, Buffer.from([0x3b, 0x8f]))
        );
        mockContext.addReader(reader);
        mockMonitor.attachReader(reader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: string[] = [];

        devices.on('reader-attached', () => events.push('reader-attached'));
        devices.on('reader-detached', () => events.push('reader-detached'));
        devices.on('card-inserted', () => events.push('card-inserted'));

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert(events.includes('reader-attached'), 'Initial reader-attached');
        assert(events.includes('card-inserted'), 'Initial card-inserted');

        // Simulate USB reader being unplugged and replugged (with card still in it)
        mockMonitor.detachReader('USB Reader');
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Reattach with card
        const newReader = new MockReader(
            'USB Reader',
            new MockCard(1, Buffer.from([0x3b, 0x8f]))
        );
        mockMonitor.attachReader(newReader);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should see the full cycle: detach, attach, card-inserted
        assert.strictEqual(
            events.filter(e => e === 'reader-attached').length,
            2,
            'Should see two reader-attached events'
        );
        assert.strictEqual(
            events.filter(e => e === 'card-inserted').length,
            2,
            'Should see two card-inserted events'
        );

        devices.stop();
    });
});

describe('Insertion retry and event queue resilience (Issue #117)', () => {
    it('should retry the reader lookup when the list lags the event', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b]));
        const mockReader = new MockReader('ACR122U');
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        // Reader list lags the monitor event: empty on the first call after
        // insertion, populated afterwards
        let lagging = false;
        const realListReaders = mockContext.listReaders.bind(mockContext);
        mockContext.listReaders = () => {
            if (lagging) {
                lagging = false;
                return [];
            }
            return realListReaders();
        };

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const events: { reader: ReaderEventInfo; card: Card }[] = [];
        devices.on(
            'card-inserted',
            (event: { reader: ReaderEventInfo; card: Card }) =>
                events.push(event)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 20));

        lagging = true;
        mockMonitor.insertCard('ACR122U', mockCard);
        await new Promise((resolve) => setTimeout(resolve, 200));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].reader.name, 'ACR122U');
        assert(events[0].card);

        devices.stop();
    });

    it('should keep processing events after an error event with no error listener', async () => {
        const mockCard = new MockCard(1, Buffer.from([0x3b]));
        const mockReader = new MockReader('ACR122U');
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();

        mockContext.addReader(mockReader);
        mockMonitor.attachReader(mockReader);

        const MockDevices = createMockDevices({
            Context: function () {
                return mockContext;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return mockMonitor;
            } as unknown as new () => MockReaderMonitor,
        });

        // Deliberately no 'error' listener: the emit throws inside the
        // queue, which previously poisoned it and stopped all later events
        const devices = new MockDevices();
        const events: { reader: ReaderEventInfo; card: Card }[] = [];
        devices.on(
            'card-inserted',
            (event: { reader: ReaderEventInfo; card: Card }) =>
                events.push(event)
        );

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 20));

        mockMonitor.emitError('Service not available (0x8010001D)');
        mockMonitor.insertCard('ACR122U', mockCard);
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].reader.name, 'ACR122U');

        devices.stop();
    });
});

describe('T=0 status word regressions', () => {
    const { transmitWithAutoResponse } = require('../../lib/t0-handler');

    function scriptedCard(responses: Buffer[], sent: Buffer[]): Card {
        return {
            transmit: async (cmd: Buffer | number[]) => {
                sent.push(Buffer.isBuffer(cmd) ? cmd : Buffer.from(cmd));
                const next = responses.shift();
                if (!next) {
                    throw new Error('No scripted response left');
                }
                return next;
            },
        } as unknown as Card;
    }

    it('should retry the GET RESPONSE, not the original command, on 6C after 61', async () => {
        const sent: Buffer[] = [];
        const card = scriptedCard(
            [
                Buffer.from([0x61, 0x05]), // to the original READ BINARY
                Buffer.from([0x6c, 0x0a]), // wrong Le on the GET RESPONSE
                Buffer.from([0x11, 0x22, 0x90, 0x00]),
            ],
            sent
        );

        const response = await transmitWithAutoResponse(
            card,
            Buffer.from('00b0000005', 'hex'),
            { autoGetResponse: true }
        );

        assert.strictEqual(sent[1].toString('hex'), '00c0000005');
        assert.strictEqual(
            sent[2].toString('hex'),
            '00c000000a',
            'Must re-send the corrected GET RESPONSE, not the original command'
        );
        assert.strictEqual(response.toString('hex'), '11229000');
    });

    it('should correct the original command on an initial 6C', async () => {
        const sent: Buffer[] = [];
        const card = scriptedCard(
            [Buffer.from([0x6c, 0x0a]), Buffer.from([0xaa, 0x90, 0x00])],
            sent
        );

        await transmitWithAutoResponse(card, Buffer.from('00b0000005', 'hex'), {
            autoGetResponse: true,
        });

        assert.strictEqual(sent[1].toString('hex'), '00b000000a');
    });

    it('should reject instead of looping forever when the card keeps returning 61xx', async () => {
        let calls = 0;
        const card = {
            transmit: async () => {
                calls++;
                return Buffer.from([0x61, 0x10]);
            },
        } as unknown as Card;

        await assert.rejects(
            () =>
                transmitWithAutoResponse(card, Buffer.from('00b0000000', 'hex'), {
                    autoGetResponse: true,
                }),
            /round-trips/
        );
        assert.ok(calls <= 20, `Should stop after the cap, made ${calls} calls`);
    });

    it('should return an uncorrectable 6Cxx instead of resending it', async () => {
        const sent: Buffer[] = [];
        // Extended-length Case 2: correctLeInCommand can't place the Le
        const card = scriptedCard([Buffer.from([0x6c, 0x80])], sent);

        const response = await transmitWithAutoResponse(
            card,
            Buffer.from('00b00000000100', 'hex'),
            { autoGetResponse: true }
        );

        assert.strictEqual(sent.length, 1, 'Must not resend the same command');
        assert.strictEqual(response.toString('hex'), '6c80');
    });

    it('should collect long chains of small chunks', async () => {
        const chunk = Buffer.alloc(16, 0xab);
        const chunks = 320; // ~5KB, more round-trips than any fixed cap of 256
        const responses = [Buffer.from([0x61, 0x10])];
        for (let i = 0; i < chunks; i++) {
            responses.push(Buffer.concat([chunk, Buffer.from([0x61, 0x10])]));
        }
        responses.push(Buffer.concat([chunk, Buffer.from([0x90, 0x00])]));
        const card = scriptedCard(responses, []);

        const response = await transmitWithAutoResponse(
            card,
            Buffer.from('00ca9f7f00', 'hex'),
            { autoGetResponse: true }
        );

        assert.strictEqual(response.length, (chunks + 1) * chunk.length + 2);
        assert.strictEqual(response.subarray(-2).toString('hex'), '9000');
    });

    it('should reject a chain that exceeds the largest possible response', async () => {
        let calls = 0;
        const card = {
            transmit: async () => {
                calls++;
                return Buffer.concat([Buffer.alloc(256), Buffer.from([0x61, 0x00])]);
            },
        } as unknown as Card;

        await assert.rejects(
            () =>
                transmitWithAutoResponse(card, Buffer.from('00b0000000', 'hex'), {
                    autoGetResponse: true,
                }),
            /65536 bytes/
        );
        assert.ok(calls <= 260, `Should stop at 64KB, made ${calls} calls`);
    });

    it('should reject a card that keeps asking for a different Le', async () => {
        let calls = 0;
        const card = {
            transmit: async () => {
                calls++;
                // Alternates, so each correction really changes the command
                return Buffer.from([0x6c, calls % 2 ? 0x0a : 0x0b]);
            },
        } as unknown as Card;

        await assert.rejects(
            () =>
                transmitWithAutoResponse(card, Buffer.from('00b0000005', 'hex'), {
                    autoGetResponse: true,
                }),
            /round-trips/
        );
        assert.ok(calls <= 20, `Should stop after the cap, made ${calls} calls`);
    });
});

describe('Native error code mapping', () => {
    const {
        toPCSCError,
        createPCSCError,
        PCSCError,
        CardRemovedError,
        ServiceNotRunningError,
    } = require('../../lib/errors');
    const { isUnresponsiveCardError } = require('../../lib/errors');

    function codedError(message: string, code: number): Error {
        const err = new Error(message) as Error & { code: number };
        err.code = code;
        return err;
    }

    it('should map a coded native error onto the typed hierarchy', () => {
        const typed = toPCSCError(codedError('Card was removed', 0x80100069));
        assert.ok(typed instanceof CardRemovedError);
        assert.strictEqual(typed.message, 'Card was removed');
        assert.strictEqual(typed.code, 0x80100069);
    });

    it('should map unknown codes to the PCSCError base class', () => {
        const typed = toPCSCError(codedError('Unknown internal error', 0x80100014));
        assert.ok(typed instanceof PCSCError);
        assert.strictEqual(typed.code, 0x80100014);
    });

    it('should pass through errors without a numeric code', () => {
        const plain = new Error('something else');
        assert.strictEqual(toPCSCError(plain), plain);
    });

    it('should wrap non-Error values in an Error', () => {
        const wrapped = toPCSCError('string failure');
        assert.ok(wrapped instanceof Error);
        assert.strictEqual(wrapped.message, 'string failure');
    });

    it('should leave numeric codes outside the PC/SC range alone', () => {
        // e.g. a DOMException AbortError (20) thrown by a listener
        const foreign = codedError('aborted', 20);
        assert.strictEqual(toPCSCError(foreign), foreign);
    });

    it('should accept PC/SC codes in signed form', () => {
        // 0x80100069 as a signed 32-bit integer
        const typed = toPCSCError(codedError('Card was removed', 0x80100069 | 0));
        assert.ok(typed instanceof CardRemovedError);
        assert.strictEqual(typed.code, 0x80100069);
    });

    it('should map a stopped service to ServiceNotRunningError, keeping its code', () => {
        const typed = createPCSCError('PC/SC service stopped', 0x8010001e);
        assert.ok(typed instanceof ServiceNotRunningError);
        assert.strictEqual(typed.code, 0x8010001e);
    });

    it('should throw typed errors from the native addon', () => {
        // Real addon, no reader needed: where no PC/SC service runs (CI)
        // Context() itself fails, elsewhere a closed context refuses to list
        const { Context } = require('../../lib/index');
        let err: unknown;
        try {
            const ctx = new Context();
            ctx.close();
            ctx.listReaders();
        } catch (e) {
            err = e;
        }
        assert.ok(err instanceof PCSCError, `expected a PCSCError, got ${String(err)}`);
    });

    it('should emit typed errors for coded monitor error events', async () => {
        const { devices, monitor } = createTestSetup();
        const errors: Error[] = [];
        devices.on('error', (err: Error) => errors.push(err));

        devices.start();
        monitor.emitError('PC/SC service not running (0x8010001D)', 0x8010001d);
        await new Promise((resolve) => setTimeout(resolve, 20));
        devices.stop();

        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0] instanceof ServiceNotRunningError);
    });

    it('should detect unresponsive cards by code, not message text', () => {
        assert.strictEqual(
            isUnresponsiveCardError(codedError('some odd message', 0x80100066)),
            true
        );
        // A misleading message must not override the actual code
        assert.strictEqual(
            isUnresponsiveCardError(
                codedError('reader unresponsive during boot', 0x8010000b)
            ),
            false
        );
    });
});

describe('Devices.start() failure rollback', () => {
    class FailingOnceMonitor extends MockReaderMonitor {
        startAttempts = 0;

        start(callback: (event: MonitorEvent) => void): void {
            this.startAttempts++;
            if (this.startAttempts === 1) {
                throw new Error('PC/SC service not running');
            }
            super.start(callback);
        }
    }

    it('should stay retryable when the monitor fails to start', async () => {
        const monitor = new FailingOnceMonitor();
        const reader = new MockReader('Test Reader', null);
        monitor.attachReader(reader);

        // A fresh context per start(), as the real addon gives: the rollback
        // closes the first one, so a retry still using it would be broken
        const contexts: MockContext[] = [];
        const MockDevices = createMockDevices({
            Context: function () {
                const context = new MockContext();
                context.addReader(reader);
                contexts.push(context);
                return context;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return monitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const errors: Error[] = [];
        const attached: unknown[] = [];
        const inserted: unknown[] = [];
        devices.on('error', (err: Error) => errors.push(err));
        devices.on('reader-attached', (r: unknown) => attached.push(r));
        devices.on('card-inserted', (e: unknown) => inserted.push(e));

        devices.start();
        assert.strictEqual(errors.length, 1, 'First start should emit the error');
        assert.strictEqual(contexts[0].isValid, false, 'Rollback should close the context');

        devices.start();
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(
            monitor.startAttempts,
            2,
            'Second start() must reach the monitor again'
        );
        assert.strictEqual(attached.length, 1, 'Events must flow after retry');

        // Card handling goes through the context, so this fails if the
        // retry kept the closed one
        monitor.insertCard(
            'Test Reader',
            new MockCard(SCARD_PROTOCOL_T1, Buffer.from([0x3b, 0x8f]))
        );
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(inserted.length, 1, 'Card events must work after retry');
        assert.strictEqual(errors.length, 1, 'No errors after the retry');

        devices.stop();
    });

    it('should throw from start() when there is no error listener', () => {
        const monitor = new FailingOnceMonitor();
        const context = new MockContext();

        const MockDevices = createMockDevices({
            Context: function () {
                return context;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return monitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        assert.throws(() => devices.start(), /service not running/);

        // The failed attempt must not have latched _running
        devices.start();
        assert.strictEqual(monitor.startAttempts, 2);
        devices.stop();
    });

    it('should stay retryable when Context creation fails', () => {
        let contextCalls = 0;
        const context = new MockContext();
        const monitor = new MockReaderMonitor();

        const MockDevices = createMockDevices({
            Context: function () {
                contextCalls++;
                if (contextCalls === 1) {
                    throw new Error('PC/SC service not running');
                }
                return context;
            } as unknown as new () => MockContext,
            ReaderMonitor: function () {
                return monitor;
            } as unknown as new () => MockReaderMonitor,
        });

        const devices = new MockDevices();
        const errors: Error[] = [];
        devices.on('error', (err: Error) => errors.push(err));

        devices.start();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(monitor.isRunning, false);

        devices.start();
        assert.strictEqual(monitor.isRunning, true, 'Retry must succeed');
        devices.stop();
    });
});
