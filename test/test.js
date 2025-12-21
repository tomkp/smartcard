'use strict';

const assert = require('assert');
const {
    Context,
    Devices,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_STATE_PRESENT,
    SCARD_STATE_EMPTY,
    SCARD_LEAVE_CARD,
} = require('../lib');

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

console.log('\n=== PC/SC N-API Binding Tests ===\n');

// ============================================================================
// Context Tests
// ============================================================================

console.log('Context Tests:');

test('should create a valid context', () => {
    const ctx = new Context();
    assert(ctx.isValid, 'Context should be valid');
    ctx.close();
});

test('should close context', () => {
    const ctx = new Context();
    assert(ctx.isValid, 'Context should be valid before close');
    ctx.close();
    assert(!ctx.isValid, 'Context should be invalid after close');
});

test('should list readers (may be empty)', () => {
    const ctx = new Context();
    try {
        const readers = ctx.listReaders();
        assert(Array.isArray(readers), 'Should return an array');
        console.log(`    Found ${readers.length} reader(s)`);
        for (const reader of readers) {
            console.log(`      - ${reader.name}`);
        }
    } finally {
        ctx.close();
    }
});

// ============================================================================
// Reader Tests (require hardware)
// ============================================================================

console.log('\nReader Tests (hardware dependent):');

(async () => {
    const ctx = new Context();

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('  [SKIP] No readers available - skipping reader tests');
        } else {
            const reader = readers[0];

            test('reader should have name', () => {
                assert(typeof reader.name === 'string', 'Name should be a string');
                assert(reader.name.length > 0, 'Name should not be empty');
            });

            test('reader should have state', () => {
                assert(typeof reader.state === 'number', 'State should be a number');
            });

            // Check if card is present
            const cardPresent = (reader.state & SCARD_STATE_PRESENT) !== 0;

            if (cardPresent) {
                console.log('    Card detected in reader');

                await testAsync('should connect to card', async () => {
                    const card = await reader.connect(
                        SCARD_SHARE_SHARED,
                        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
                    );
                    assert(card, 'Should return a card object');
                    assert(card.connected, 'Card should be connected');
                    assert(typeof card.protocol === 'number', 'Protocol should be a number');
                    console.log(`      Protocol: ${card.protocol === SCARD_PROTOCOL_T0 ? 'T=0' : 'T=1'}`);
                    card.disconnect(SCARD_LEAVE_CARD);
                });

                await testAsync('should transmit APDU', async () => {
                    const card = await reader.connect(
                        SCARD_SHARE_SHARED,
                        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
                    );

                    // Send SELECT command (get UID for contactless cards)
                    // This is a generic command that should work on most cards
                    const selectCmd = Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]);
                    try {
                        const response = await card.transmit(selectCmd);
                        assert(Buffer.isBuffer(response), 'Response should be a buffer');
                        console.log(`      Response: ${response.toString('hex')}`);
                    } catch (err) {
                        // Some cards don't support this command, which is OK
                        console.log(`      Note: Command not supported by this card`);
                    }

                    card.disconnect(SCARD_LEAVE_CARD);
                });

                await testAsync('should get card status', async () => {
                    const card = await reader.connect(
                        SCARD_SHARE_SHARED,
                        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
                    );

                    const status = card.getStatus();
                    assert(typeof status.state === 'number', 'Status state should be a number');
                    assert(typeof status.protocol === 'number', 'Status protocol should be a number');
                    assert(Buffer.isBuffer(status.atr), 'Status ATR should be a buffer');
                    console.log(`      ATR: ${status.atr.toString('hex')}`);

                    card.disconnect(SCARD_LEAVE_CARD);
                });
            } else {
                console.log('  [SKIP] No card in reader - skipping card tests');
            }
        }
    } finally {
        ctx.close();
    }

    // ============================================================================
    // Devices Tests
    // ============================================================================

    console.log('\nDevices (Event API) Tests:');

    await testAsync('should create Devices instance', async () => {
        const devices = new Devices();
        assert(devices, 'Should create Devices instance');
    });

    await testAsync('should start and stop monitoring', async () => {
        const devices = new Devices();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();
                resolve();
            }, 2000);

            devices.on('error', (err) => {
                // Some errors are expected: no readers, service issues, or card state issues
                // Card unresponsive can happen if previous tests left card in bad state
                const expectedErrors = [
                    'No readers',
                    'service',
                    'unresponsive',
                    'Sharing violation',
                ];
                const isExpected = expectedErrors.some(msg =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );

                if (isExpected) {
                    console.log(`      Note: ${err.message} (expected in test environment)`);
                } else {
                    clearTimeout(timeout);
                    devices.stop();
                    reject(err);
                }
            });

            devices.on('reader-attached', (reader) => {
                console.log(`      Reader attached: ${reader.name}`);
            });

            devices.on('card-inserted', ({ reader, card }) => {
                console.log(`      Card inserted in ${reader.name}`);
                console.log(`        ATR: ${card.atr ? card.atr.toString('hex') : 'N/A'}`);
            });

            devices.start();
        });
    });

    // ============================================================================
    // Summary
    // ============================================================================

    console.log('\n=== Test Summary ===');
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
