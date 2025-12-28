#!/usr/bin/env npx ts-node
/**
 * Demonstrates error handling with specific error types
 *
 * Usage: npx ts-node error-handling.ts
 *
 * This example shows how to catch and handle different PC/SC error types.
 */

import {
    Context,
    Devices,
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    SCARD_SHARE_EXCLUSIVE,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
} from '../lib';
import type { Card, ReaderEventInfo } from '../lib/types';

/**
 * Example 1: Handling errors with the low-level Context API
 */
async function lowLevelExample(): Promise<void> {
    console.log('=== Low-Level Error Handling ===\n');

    let ctx: InstanceType<typeof Context> | undefined;
    try {
        ctx = new Context();
    } catch (err) {
        if (err instanceof ServiceNotRunningError) {
            console.log('PC/SC service is not running.');
            console.log('On Linux: sudo systemctl start pcscd');
            console.log('On Windows: Check "Smart Card" service');
            return;
        }
        throw err;
    }

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            throw new NoReadersError();
        }

        const reader = readers[0];
        console.log(`Using reader: ${reader.name}`);

        // Try to connect with exclusive access (may fail if card is in use)
        console.log('Attempting exclusive connection...');
        const card = await reader.connect(
            SCARD_SHARE_EXCLUSIVE,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        console.log('Connected! Sending command...');

        // Send a command - card might be removed during this
        const response = await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        console.log(`Response: ${response.toString('hex')}`);

        card.disconnect();
    } catch (err) {
        if (err instanceof NoReadersError) {
            console.log('No readers available. Please connect a reader.');
        } else if (err instanceof CardRemovedError) {
            console.log('Card was removed during operation.');
        } else if (err instanceof TimeoutError) {
            console.log('Operation timed out.');
        } else if (err instanceof SharingViolationError) {
            console.log('Card is in use by another application.');
            console.log('Close other smart card applications and try again.');
        } else if (err instanceof PCSCError) {
            // Generic PC/SC error with error code
            console.log(`PC/SC error: ${err.message}`);
            console.log(`Error code: 0x${err.code.toString(16)}`);
        } else {
            // Non-PC/SC error
            console.log(`Unexpected error: ${(err as Error).message}`);
        }
    } finally {
        if (ctx) {
            ctx.close();
        }
    }
}

/**
 * Example 2: Handling errors with the high-level Devices API
 */
export function highLevelExample(): void {
    console.log('\n=== High-Level Error Handling ===\n');

    const devices = new Devices();

    devices.on(
        'card-inserted',
        async ({ reader, card }: { reader: ReaderEventInfo; card: Card }) => {
            console.log(`Card inserted in ${reader.name}`);

            try {
                // This might fail if card is removed quickly
                const response = await card.transmit([
                    0xff, 0xca, 0x00, 0x00, 0x00,
                ]);
                const sw =
                    (response[response.length - 2] << 8) |
                    response[response.length - 1];

                if (sw === 0x9000) {
                    console.log(
                        `UID: ${response.subarray(0, -2).toString('hex')}`
                    );
                }
            } catch (err) {
                if (err instanceof CardRemovedError) {
                    console.log('Card was removed before we could read it.');
                } else if (err instanceof PCSCError) {
                    console.log(
                        `Card error: ${err.message} (code: 0x${err.code.toString(16)})`
                    );
                } else {
                    console.log(`Error: ${(err as Error).message}`);
                }
            }
        }
    );

    devices.on('error', (err: Error) => {
        // The Devices class emits errors that occur during monitoring
        if (err instanceof ServiceNotRunningError) {
            console.log('PC/SC service stopped.');
            devices.stop();
        } else if (err instanceof SharingViolationError) {
            // This can happen if another app grabs the card first
            console.log('Could not connect to card - in use by another app.');
        } else {
            console.log(`Monitor error: ${err.message}`);
        }
    });

    devices.on('reader-attached', (reader: ReaderEventInfo) => {
        console.log(`Reader attached: ${reader.name}`);
    });

    console.log('Starting monitor (press Ctrl+C to stop)...\n');
    devices.start();

    // Stop after 30 seconds for demo purposes
    setTimeout(() => {
        console.log('\nStopping after 30 seconds...');
        devices.stop();
    }, 30000);

    process.on('SIGINT', () => {
        devices.stop();
        process.exit(0);
    });
}

/**
 * Example 3: Using try/catch with specific error recovery
 */
async function errorRecoveryExample(): Promise<void> {
    console.log('\n=== Error Recovery Example ===\n');

    const ctx = new Context();

    try {
        const readers = ctx.listReaders();
        if (readers.length === 0) {
            console.log('No readers found.');
            return;
        }

        const reader = readers[0];
        let card: Card | undefined;

        // Retry logic for transient errors
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Connection attempt ${attempt}/${maxRetries}...`);
                card = await reader.connect();
                console.log('Connected successfully!');
                break;
            } catch (err) {
                if (
                    err instanceof SharingViolationError &&
                    attempt < maxRetries
                ) {
                    console.log('Card busy, waiting 1 second...');
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                throw err;
            }
        }

        if (card) {
            const status = card.getStatus();
            console.log(`ATR: ${status.atr.toString('hex')}`);
            card.disconnect();
        }
    } finally {
        ctx.close();
    }
}

// Run the examples
async function main(): Promise<void> {
    await lowLevelExample();
    await errorRecoveryExample();

    // Uncomment to run the high-level example (runs for 30 seconds)
    // highLevelExample();
}

main().catch(console.error);
