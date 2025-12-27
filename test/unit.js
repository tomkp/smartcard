'use strict';

const assert = require('assert');
const {
    MockCard,
    MockReader,
    MockContext,
    MockReaderMonitor,
    createMockDevices,
    UnresponsiveDualProtocolReader,
    FailingMockReader,
} = require('./mock');

// Test results
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.log(`  [FAIL] ${name}: ${err.message}`);
        failed++;
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.log(`  [FAIL] ${name}: ${err.message}`);
        failed++;
    }
}

(async () => {

console.log('\n=== Unit Tests (Mock-based, no hardware required) ===\n');

// ============================================================================
// MockCard Tests
// ============================================================================

console.log('MockCard Tests:');

test('should create a mock card with protocol and ATR', () => {
    const atr = Buffer.from([0x3B, 0x8F, 0x80, 0x01]);
    const card = new MockCard(1, atr);

    assert.strictEqual(card.protocol, 1);
    assert.strictEqual(card.connected, true);
    assert(card.atr.equals(atr));
});

test('should disconnect card', () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    assert.strictEqual(card.connected, true);

    card.disconnect();
    assert.strictEqual(card.connected, false);
    assert.strictEqual(card.atr, null);
});

await testAsync('should transmit APDU and return configured response', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]), [
        {
            command: [0xFF, 0xCA, 0x00, 0x00, 0x00],
            response: [0x04, 0xA2, 0x3B, 0x7A, 0x90, 0x00],
        },
    ]);

    const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xA2, 0x3B, 0x7A, 0x90, 0x00])));
});

await testAsync('should return default success for unknown commands', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    const response = await card.transmit([0x00, 0xA4, 0x04, 0x00]);
    assert(response.equals(Buffer.from([0x90, 0x00])));
});

await testAsync('should throw when transmitting on disconnected card', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    card.disconnect();

    try {
        await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
        assert.fail('Should have thrown');
    } catch (err) {
        assert.strictEqual(err.message, 'Card is not connected');
    }
});

test('should get card status', () => {
    const atr = Buffer.from([0x3B, 0x8F]);
    const card = new MockCard(2, atr);

    const status = card.getStatus();
    assert.strictEqual(status.protocol, 2);
    assert(status.atr.equals(atr));
    assert.strictEqual(typeof status.state, 'number');
});

await testAsync('should reconnect card async', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    card.disconnect();
    assert.strictEqual(card.connected, false);

    const protocol = await card.reconnect();
    assert.strictEqual(card.connected, true);
    assert.strictEqual(protocol, 1);
});

await testAsync('should accept maxRecvLength option in transmit', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00], { maxRecvLength: 65536 });
    assert.strictEqual(card._lastTransmitOptions.maxRecvLength, 65536);
});

await testAsync('should use default options when none provided', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
    assert.deepStrictEqual(card._lastTransmitOptions, {});
});

// ============================================================================
// MockReader Tests
// ============================================================================

console.log('\nMockReader Tests:');

test('should create reader without card', () => {
    const reader = new MockReader('Test Reader');

    assert.strictEqual(reader.name, 'Test Reader');
    assert.strictEqual(reader.atr, null);
    assert.strictEqual(reader.state & 0x20, 0); // Not PRESENT
});

test('should create reader with card', () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    const reader = new MockReader('Test Reader', card);

    assert.strictEqual(reader.name, 'Test Reader');
    assert(reader.atr.equals(Buffer.from([0x3B])));
    assert.strictEqual(reader.state & 0x20, 0x20); // PRESENT (0x100 | 0x20 | 0x02)
});

await testAsync('should connect to card', async () => {
    const card = new MockCard(1, Buffer.from([0x3B]));
    const reader = new MockReader('Test Reader', card);

    const connectedCard = await reader.connect(2, 3);
    assert.strictEqual(connectedCard, card);
});

await testAsync('should throw when connecting without card', async () => {
    const reader = new MockReader('Test Reader');

    try {
        await reader.connect();
        assert.fail('Should have thrown');
    } catch (err) {
        assert.strictEqual(err.message, 'No card in reader');
    }
});

test('should insert and remove cards', () => {
    const reader = new MockReader('Test Reader');
    assert.strictEqual(reader.atr, null);

    const card = new MockCard(1, Buffer.from([0x3B]));
    reader.insertCard(card);
    assert(reader.atr.equals(Buffer.from([0x3B])));

    reader.removeCard();
    assert.strictEqual(reader.atr, null);
});

// ============================================================================
// MockContext Tests
// ============================================================================

console.log('\nMockContext Tests:');

test('should create valid context', () => {
    const ctx = new MockContext();
    assert.strictEqual(ctx.isValid, true);
});

test('should close context', () => {
    const ctx = new MockContext();
    ctx.close();
    assert.strictEqual(ctx.isValid, false);
});

test('should list readers', () => {
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

test('should remove readers', () => {
    const ctx = new MockContext();
    ctx.addReader(new MockReader('Reader 1'));
    ctx.addReader(new MockReader('Reader 2'));

    ctx.removeReader('Reader 1');

    const readers = ctx.listReaders();
    assert.strictEqual(readers.length, 1);
    assert.strictEqual(readers[0].name, 'Reader 2');
});

test('should throw when listing readers on closed context', () => {
    const ctx = new MockContext();
    ctx.close();

    try {
        ctx.listReaders();
        assert.fail('Should have thrown');
    } catch (err) {
        assert.strictEqual(err.message, 'Context is not valid');
    }
});

// ============================================================================
// MockReaderMonitor Tests
// ============================================================================

console.log('\nMockReaderMonitor Tests:');

test('should start and stop monitoring', () => {
    const monitor = new MockReaderMonitor();

    assert.strictEqual(monitor.isRunning, false);

    monitor.start(() => {});
    assert.strictEqual(monitor.isRunning, true);

    monitor.stop();
    assert.strictEqual(monitor.isRunning, false);
});

test('should throw when starting already running monitor', () => {
    const monitor = new MockReaderMonitor();
    monitor.start(() => {});

    try {
        monitor.start(() => {});
        assert.fail('Should have thrown');
    } catch (err) {
        assert.strictEqual(err.message, 'Monitor is already running');
    }

    monitor.stop();
});

test('should emit reader-attached for existing readers on start', () => {
    const monitor = new MockReaderMonitor();
    const reader = new MockReader('Test Reader');
    monitor.attachReader(reader);

    const events = [];
    monitor.start((event) => events.push(event));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'reader-attached');
    assert.strictEqual(events[0].reader, 'Test Reader');

    monitor.stop();
});

test('should emit events when attaching/detaching readers', () => {
    const monitor = new MockReaderMonitor();
    const events = [];

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

test('should emit events when inserting/removing cards', () => {
    const monitor = new MockReaderMonitor();
    const events = [];

    const reader = new MockReader('Test Reader');
    monitor.attachReader(reader);

    monitor.start((event) => events.push(event));
    events.length = 0; // Clear the reader-attached event

    const card = new MockCard(1, Buffer.from([0x3B, 0x8F]));
    monitor.insertCard('Test Reader', card);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'card-inserted');
    assert(events[0].atr.equals(Buffer.from([0x3B, 0x8F])));

    monitor.removeCard('Test Reader');

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].type, 'card-removed');

    monitor.stop();
});

// ============================================================================
// MockDevices Integration Tests
// ============================================================================

console.log('\nMockDevices Integration Tests:');

await testAsync('should emit reader-attached events', async () => {
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();
    const mockReader = new MockReader('ACR122U');

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const events = [];

    devices.on('reader-attached', (reader) => events.push({ type: 'reader-attached', reader }));

    devices.start();

    // Wait for events to process
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'reader-attached');
    assert.strictEqual(events[0].reader.name, 'ACR122U');

    devices.stop();
});

await testAsync('should emit card-inserted events with card object', async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3B, 0x8F, 0x80, 0x01]), [
        { command: [0xFF, 0xCA, 0x00, 0x00, 0x00], response: [0x04, 0xA2, 0x90, 0x00] },
    ]);
    const mockReader = new MockReader('ACR122U', mockCard);
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const events = [];

    devices.on('card-inserted', (event) => events.push(event));

    devices.start();

    // Wait for events to process
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].reader.name, 'ACR122U');
    assert(events[0].card);

    // Test transmit
    const response = await events[0].card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
    assert(response.equals(Buffer.from([0x04, 0xA2, 0x90, 0x00])));

    devices.stop();
});

await testAsync('should emit card-removed events', async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3B]));
    const mockReader = new MockReader('ACR122U', mockCard);
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const events = [];

    devices.on('card-inserted', () => events.push('inserted'));
    devices.on('card-removed', () => events.push('removed'));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Simulate card removal
    mockMonitor.removeCard('ACR122U');
    await new Promise(resolve => setTimeout(resolve, 50));

    assert(events.includes('inserted'));
    assert(events.includes('removed'));

    devices.stop();
});

await testAsync('should handle multiple readers', async () => {
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    const reader1 = new MockReader('Reader 1', new MockCard(1, Buffer.from([0x3B])));
    const reader2 = new MockReader('Reader 2', new MockCard(2, Buffer.from([0x3C])));

    mockContext.addReader(reader1);
    mockContext.addReader(reader2);
    mockMonitor.attachReader(reader1);
    mockMonitor.attachReader(reader2);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const readerEvents = [];
    const cardEvents = [];

    devices.on('reader-attached', (r) => readerEvents.push(r.name));
    devices.on('card-inserted', (e) => cardEvents.push(e.reader.name));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(readerEvents.length, 2);
    assert(readerEvents.includes('Reader 1'));
    assert(readerEvents.includes('Reader 2'));

    assert.strictEqual(cardEvents.length, 2);
    assert(cardEvents.includes('Reader 1'));
    assert(cardEvents.includes('Reader 2'));

    devices.stop();
});

await testAsync('should emit reader-detached events', async () => {
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();
    const reader = new MockReader('ACR122U');

    mockContext.addReader(reader);
    mockMonitor.attachReader(reader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const events = [];

    devices.on('reader-attached', () => events.push('attached'));
    devices.on('reader-detached', () => events.push('detached'));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 10));

    mockMonitor.detachReader('ACR122U');
    await new Promise(resolve => setTimeout(resolve, 10));

    assert(events.includes('attached'));
    assert(events.includes('detached'));

    devices.stop();
});

// ============================================================================
// Protocol Fallback Tests (Issue #34)
// ============================================================================

console.log('\nProtocol Fallback Tests (Issue #34):');

await testAsync('should fallback to T=0 when dual protocol fails with unresponsive error', async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3B, 0x8F]));
    const mockReader = new UnresponsiveDualProtocolReader('Test Reader', mockCard);
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const cardEvents = [];
    const errors = [];

    devices.on('card-inserted', (event) => cardEvents.push(event));
    devices.on('error', (err) => errors.push(err));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have successfully connected with fallback
    assert.strictEqual(cardEvents.length, 1, 'Should emit card-inserted event');
    assert.strictEqual(errors.length, 0, 'Should not emit error');
    // Should have attempted connect twice (first dual, then T0 fallback)
    assert.strictEqual(mockReader.connectAttempts, 2, 'Should attempt connect twice (fallback)');

    devices.stop();
});

await testAsync('should rethrow non-unresponsive errors without fallback', async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3B, 0x8F]));
    const mockReader = new FailingMockReader('Test Reader', mockCard, 'Sharing violation');
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const cardEvents = [];
    const errors = [];

    devices.on('card-inserted', (event) => cardEvents.push(event));
    devices.on('error', (err) => errors.push(err));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have failed and emitted error
    assert.strictEqual(cardEvents.length, 0, 'Should not emit card-inserted event');
    assert.strictEqual(errors.length, 1, 'Should emit error');
    assert(errors[0].message.includes('Sharing violation'), 'Error should contain original message');
    // Should only attempt once (no fallback for non-unresponsive errors)
    assert.strictEqual(mockReader.connectAttempts, 1, 'Should only attempt connect once');

    devices.stop();
});

await testAsync('should succeed on first try when dual protocol works', async () => {
    const mockCard = new MockCard(1, Buffer.from([0x3B, 0x8F]));
    const mockReader = new MockReader('Test Reader', mockCard);
    const mockContext = new MockContext();
    const mockMonitor = new MockReaderMonitor();

    mockContext.addReader(mockReader);
    mockMonitor.attachReader(mockReader);

    const MockDevices = createMockDevices({
        Context: function() { return mockContext; },
        ReaderMonitor: function() { return mockMonitor; },
    });

    const devices = new MockDevices();
    const cardEvents = [];
    const errors = [];

    devices.on('card-inserted', (event) => cardEvents.push(event));
    devices.on('error', (err) => errors.push(err));

    devices.start();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should succeed on first try
    assert.strictEqual(cardEvents.length, 1, 'Should emit card-inserted event');
    assert.strictEqual(errors.length, 0, 'Should not emit error');
    assert.strictEqual(mockReader.connectAttempts, 1, 'Should only attempt connect once');

    devices.stop();
});

// ============================================================================
// Error Class Tests
// ============================================================================

console.log('\nError Class Tests:');

const {
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    createPCSCError,
} = require('../lib/errors');

test('PCSCError should have code property', () => {
    const err = new PCSCError('Test error', 0x80100001);
    assert.strictEqual(err.code, 0x80100001);
    assert.strictEqual(err.name, 'PCSCError');
    assert.strictEqual(err.message, 'Test error');
});

test('CardRemovedError should have correct code', () => {
    const err = new CardRemovedError();
    assert.strictEqual(err.code, 0x80100069);
    assert.strictEqual(err.name, 'CardRemovedError');
    assert(err instanceof PCSCError);
});

test('TimeoutError should have correct code', () => {
    const err = new TimeoutError();
    assert.strictEqual(err.code, 0x8010000A);
    assert.strictEqual(err.name, 'TimeoutError');
    assert(err instanceof PCSCError);
});

test('NoReadersError should have correct code', () => {
    const err = new NoReadersError();
    assert.strictEqual(err.code, 0x8010002E);
    assert.strictEqual(err.name, 'NoReadersError');
    assert(err instanceof PCSCError);
});

test('ServiceNotRunningError should have correct code', () => {
    const err = new ServiceNotRunningError();
    assert.strictEqual(err.code, 0x8010001D);
    assert.strictEqual(err.name, 'ServiceNotRunningError');
    assert(err instanceof PCSCError);
});

test('SharingViolationError should have correct code', () => {
    const err = new SharingViolationError();
    assert.strictEqual(err.code, 0x8010000B);
    assert.strictEqual(err.name, 'SharingViolationError');
    assert(err instanceof PCSCError);
});

test('createPCSCError should return CardRemovedError for 0x80100069', () => {
    const err = createPCSCError('Card was removed', 0x80100069);
    assert(err instanceof CardRemovedError);
    assert.strictEqual(err.code, 0x80100069);
});

test('createPCSCError should return TimeoutError for 0x8010000A', () => {
    const err = createPCSCError('Timeout', 0x8010000A);
    assert(err instanceof TimeoutError);
    assert.strictEqual(err.code, 0x8010000A);
});

test('createPCSCError should return NoReadersError for 0x8010002E', () => {
    const err = createPCSCError('No readers', 0x8010002E);
    assert(err instanceof NoReadersError);
    assert.strictEqual(err.code, 0x8010002E);
});

test('createPCSCError should return ServiceNotRunningError for 0x8010001D', () => {
    const err = createPCSCError('Service not running', 0x8010001D);
    assert(err instanceof ServiceNotRunningError);
    assert.strictEqual(err.code, 0x8010001D);
});

test('createPCSCError should return SharingViolationError for 0x8010000B', () => {
    const err = createPCSCError('Sharing violation', 0x8010000B);
    assert(err instanceof SharingViolationError);
    assert.strictEqual(err.code, 0x8010000B);
});

test('createPCSCError should return PCSCError for unknown codes', () => {
    const err = createPCSCError('Unknown error', 0x80100099);
    assert(err instanceof PCSCError);
    assert(!(err instanceof CardRemovedError));
    assert.strictEqual(err.code, 0x80100099);
});

// ============================================================================
// Control Code Constants Tests
// ============================================================================

console.log('\nControl Code Constants Tests:');

const {
    SCARD_CTL_CODE,
    CM_IOCTL_GET_FEATURE_REQUEST,
    FEATURE_VERIFY_PIN_DIRECT,
    FEATURE_MODIFY_PIN_DIRECT,
    FEATURE_IFD_PIN_PROPERTIES,
    FEATURE_GET_TLV_PROPERTIES,
} = require('../lib');

test('SCARD_CTL_CODE should generate correct control codes', () => {
    // On macOS/Linux, SCARD_CTL_CODE(code) = 0x42000000 + code
    // On Windows, SCARD_CTL_CODE(code) = (0x31 << 16) + (code << 2)
    const code = SCARD_CTL_CODE(3400);
    assert.strictEqual(typeof code, 'number');
    assert(code > 0);
});

test('CM_IOCTL_GET_FEATURE_REQUEST should be defined', () => {
    assert.strictEqual(typeof CM_IOCTL_GET_FEATURE_REQUEST, 'number');
    assert(CM_IOCTL_GET_FEATURE_REQUEST > 0);
});

test('FEATURE constants should have correct values', () => {
    assert.strictEqual(FEATURE_VERIFY_PIN_DIRECT, 0x06);
    assert.strictEqual(FEATURE_MODIFY_PIN_DIRECT, 0x07);
    assert.strictEqual(FEATURE_IFD_PIN_PROPERTIES, 0x0A);
    assert.strictEqual(FEATURE_GET_TLV_PROPERTIES, 0x12);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n=== Unit Test Summary ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('');

if (failed > 0) {
    process.exit(1);
}

})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
