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
} = require('../../lib');

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

    // Test for issue #30: pre-existing readers should emit reader-attached on start()
    await testAsync('should emit reader-attached for pre-existing readers on start', async () => {
        // First, check if there are any readers using Context
        const checkCtx = new Context();
        let existingReaders = [];
        try {
            existingReaders = checkCtx.listReaders();
        } catch (err) {
            // No readers available
        } finally {
            checkCtx.close();
        }

        if (existingReaders.length === 0) {
            console.log('      [SKIP] No readers connected - cannot test pre-existing reader detection');
            return;
        }

        console.log(`      Found ${existingReaders.length} pre-existing reader(s)`);

        const devices = new Devices();
        const attachedReaders = [];

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();
                // Verify we received reader-attached events for all pre-existing readers
                if (attachedReaders.length === existingReaders.length) {
                    console.log(`      Received reader-attached for all ${attachedReaders.length} pre-existing reader(s)`);
                    resolve();
                } else {
                    reject(new Error(
                        `Expected ${existingReaders.length} reader-attached events but received ${attachedReaders.length}. ` +
                        `Pre-existing readers not detected on start(). (Issue #30)`
                    ));
                }
            }, 1000);

            devices.on('error', (err) => {
                // Ignore expected errors
                const expectedErrors = ['No readers', 'service', 'unresponsive', 'Sharing violation'];
                const isExpected = expectedErrors.some(msg =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );
                if (!isExpected) {
                    clearTimeout(timeout);
                    devices.stop();
                    reject(err);
                }
            });

            devices.on('reader-attached', (reader) => {
                console.log(`      reader-attached: ${reader.name}`);
                attachedReaders.push(reader);
            });

            // Start monitoring - should immediately emit reader-attached for existing readers
            devices.start();
        });
    });

    // Test for issue #32: race condition when multiple readers have cards present
    await testAsync('should emit card-inserted for all readers without race condition', async () => {
        // First, check if there are multiple readers with cards
        const checkCtx = new Context();
        let readersWithCards = [];
        try {
            const readers = checkCtx.listReaders();
            for (const reader of readers) {
                if ((reader.state & SCARD_STATE_PRESENT) !== 0) {
                    readersWithCards.push(reader);
                }
            }
        } catch (err) {
            // No readers available
        } finally {
            checkCtx.close();
        }

        if (readersWithCards.length < 2) {
            console.log('      [SKIP] Need at least 2 readers with cards to test race condition');
            return;
        }

        console.log(`      Found ${readersWithCards.length} readers with cards`);

        const devices = new Devices();
        const cardInsertedEvents = [];
        const errors = [];

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();

                // Check for race condition errors (SCARD_W_UNRESPONSIVE_CARD)
                const raceErrors = errors.filter(err =>
                    err.message.toLowerCase().includes('unresponsive')
                );

                if (raceErrors.length > 0) {
                    reject(new Error(
                        `Race condition detected! Got ${raceErrors.length} unresponsive card error(s). ` +
                        `This indicates concurrent access to readers. (Issue #32)`
                    ));
                    return;
                }

                // Verify we received card-inserted events for all readers with cards
                if (cardInsertedEvents.length === readersWithCards.length) {
                    console.log(`      Received card-inserted for all ${cardInsertedEvents.length} reader(s)`);
                    resolve();
                } else {
                    reject(new Error(
                        `Expected ${readersWithCards.length} card-inserted events but received ${cardInsertedEvents.length}. ` +
                        `Race condition may have caused some events to fail. (Issue #32)`
                    ));
                }
            }, 2000);

            devices.on('error', (err) => {
                errors.push(err);
                // Don't reject immediately - collect all errors and check at the end
                const expectedErrors = ['No readers', 'service', 'Sharing violation'];
                const isExpected = expectedErrors.some(msg =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );
                if (!isExpected) {
                    console.log(`      Error: ${err.message}`);
                }
            });

            devices.on('reader-attached', (reader) => {
                console.log(`      reader-attached: ${reader.name}`);
            });

            devices.on('card-inserted', ({ reader, card }) => {
                console.log(`      card-inserted: ${reader.name}`);
                cardInsertedEvents.push({ reader, card });
            });

            devices.start();
        });
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
    // Test for issue #34: T=0 protocol fallback
    // ============================================================================

    console.log('\nProtocol Fallback Tests (Issue #34):');

    // Test for issue #34: should fallback to T=0 if T=0|T=1 fails
    await testAsync('should fallback to T=0 protocol if dual protocol fails', async () => {
        // First, check if there are any readers with cards
        const checkCtx = new Context();
        let readersWithCards = [];
        try {
            const readers = checkCtx.listReaders();
            for (const reader of readers) {
                if ((reader.state & SCARD_STATE_PRESENT) !== 0) {
                    readersWithCards.push(reader);
                }
            }
        } catch (err) {
            // No readers available
        } finally {
            checkCtx.close();
        }

        if (readersWithCards.length === 0) {
            console.log('      [SKIP] No readers with cards - cannot test protocol fallback');
            return;
        }

        console.log(`      Testing protocol fallback behavior with ${readersWithCards.length} reader(s)`);

        const devices = new Devices();
        const cardInsertedEvents = [];
        const errors = [];

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                devices.stop();

                // Check for unresponsive card errors that would indicate fallback is needed
                const unresponsiveErrors = errors.filter(err =>
                    err.message.toLowerCase().includes('unresponsive')
                );

                if (unresponsiveErrors.length > 0) {
                    // This test FAILS if we get unresponsive errors - fallback should have prevented this
                    reject(new Error(
                        `Got ${unresponsiveErrors.length} unresponsive card error(s). ` +
                        `Devices should fallback to T=0 protocol when T=0|T=1 fails. (Issue #34)`
                    ));
                    return;
                }

                // Success - either card connected with dual protocol or fallback worked
                if (cardInsertedEvents.length > 0) {
                    console.log(`      Successfully connected to ${cardInsertedEvents.length} card(s)`);
                    for (const { card } of cardInsertedEvents) {
                        const protocol = card.protocol === SCARD_PROTOCOL_T0 ? 'T=0' : 'T=1';
                        console.log(`        Protocol used: ${protocol}`);
                    }
                    resolve();
                } else {
                    // No cards inserted but also no unresponsive errors - could be other errors
                    console.log(`      [SKIP] Could not connect to cards (non-unresponsive errors)`);
                    resolve();
                }
            }, 2000);

            devices.on('error', (err) => {
                errors.push(err);
                const expectedErrors = ['No readers', 'service', 'Sharing violation'];
                const isExpected = expectedErrors.some(msg =>
                    err.message.toLowerCase().includes(msg.toLowerCase())
                );
                if (!isExpected) {
                    console.log(`      Error: ${err.message}`);
                }
            });

            devices.on('card-inserted', ({ reader, card }) => {
                console.log(`      card-inserted: ${reader.name}`);
                cardInsertedEvents.push({ reader, card });
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
