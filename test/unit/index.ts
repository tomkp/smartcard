import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    MockCard,
    MockReader,
    MockContext,
    MockReaderMonitor,
    createMockDevices,
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

describe('MockDevices Integration', () => {
    it('should emit reader-attached events', async () => {
        const mockContext = new MockContext();
        const mockMonitor = new MockReaderMonitor();
        const mockReader = new MockReader('ACR122U');

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
        const events: { type: string; reader: { name: string } }[] = [];

        devices.on('reader-attached', (reader: { name: string }) =>
            events.push({ type: 'reader-attached', reader })
        );

        devices.start();

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'reader-attached');
        assert.strictEqual(events[0].reader.name, 'ACR122U');

        devices.stop();
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
