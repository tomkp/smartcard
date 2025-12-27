#!/usr/bin/env node
/**
 * Wait for a card using the low-level waitForChange API
 *
 * Usage: node wait-for-card.js [timeout-seconds]
 *
 * Examples:
 *   node wait-for-card.js        # Wait indefinitely
 *   node wait-for-card.js 30     # Wait up to 30 seconds
 *
 * This demonstrates the polling-based approach using Context.waitForChange()
 * as an alternative to the event-driven Devices API.
 */

'use strict';

const {
    Context,
    SCARD_STATE_PRESENT,
    SCARD_STATE_EMPTY,
    SCARD_STATE_CHANGED,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD,
} = require('../lib');

async function main() {
    const timeoutSeconds = parseInt(process.argv[2]) || 0;
    const timeout = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0; // 0 = infinite

    console.log('Wait for Card Example');
    console.log('=====================\n');

    const ctx = new Context();

    try {
        // Get initial reader list
        let readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found. Waiting for a reader to be connected...');
            console.log('(Connect a USB card reader)\n');

            // Wait for readers to appear
            // Pass empty array to wait for any reader change
            while (readers.length === 0) {
                const changes = await ctx.waitForChange([], timeout);

                if (changes === null) {
                    console.log('Cancelled.');
                    return;
                }

                if (changes.length === 0) {
                    console.log('Timeout waiting for reader.');
                    return;
                }

                readers = ctx.listReaders();
            }
        }

        console.log(`Found ${readers.length} reader(s):`);
        for (const reader of readers) {
            console.log(`  - ${reader.name}`);
        }
        console.log();

        // Check if any reader already has a card
        let readerWithCard = readers.find(r => (r.state & SCARD_STATE_PRESENT) !== 0);

        if (readerWithCard) {
            console.log(`Card already present in: ${readerWithCard.name}`);
        } else {
            console.log('Waiting for a card to be inserted...');
            if (timeout > 0) {
                console.log(`(Timeout: ${timeoutSeconds} seconds)`);
            }
            console.log();

            // Wait for card insertion
            while (!readerWithCard) {
                const changes = await ctx.waitForChange(readers, timeout);

                if (changes === null) {
                    console.log('Cancelled.');
                    return;
                }

                if (changes.length === 0) {
                    console.log('Timeout waiting for card.');
                    return;
                }

                // Check for card insertion
                for (const change of changes) {
                    if (change.changed && (change.state & SCARD_STATE_PRESENT) !== 0) {
                        readerWithCard = readers.find(r => r.name === change.name);
                        console.log(`Card detected in: ${change.name}`);
                        if (change.atr) {
                            console.log(`ATR: ${change.atr.toString('hex')}`);
                        }
                        break;
                    }
                }

                // Update reader states for next iteration
                for (const change of changes) {
                    const reader = readers.find(r => r.name === change.name);
                    if (reader) {
                        // Update the reader's known state
                        readers = ctx.listReaders();
                    }
                }
            }
        }

        // Connect to the card
        console.log('\nConnecting to card...');
        const card = await readerWithCard.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        const status = card.getStatus();
        console.log(`Connected! Protocol: ${card.protocol === SCARD_PROTOCOL_T0 ? 'T=0' : 'T=1'}`);
        console.log(`ATR: ${status.atr.toString('hex')}`);

        // Try to read UID
        try {
            const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
            if (response.length >= 2) {
                const sw = (response[response.length - 2] << 8) | response[response.length - 1];
                if (sw === 0x9000) {
                    console.log(`UID: ${response.slice(0, -2).toString('hex')}`);
                }
            }
        } catch (err) {
            // UID not available for this card type
        }

        card.disconnect(SCARD_LEAVE_CARD);
        console.log('\nDone!');

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        ctx.close();
    }
}

// Handle Ctrl+C to cancel waitForChange
let ctx;
process.on('SIGINT', () => {
    console.log('\nCancelling...');
    if (ctx) {
        ctx.cancel();
    }
    process.exit(0);
});

main().catch(console.error);
