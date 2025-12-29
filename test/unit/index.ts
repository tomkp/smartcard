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
} from '../helpers/mock';
import type { Card, ReaderEventInfo } from '../../lib/types';

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
    const { isUnresponsiveCardError } = require('../../lib/devices');

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
