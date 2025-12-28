#!/usr/bin/env npx ts-node
/**
 * Monitor for card insert/remove events using the high-level Devices API
 *
 * Usage: npx ts-node monitor-cards.ts
 *
 * Press Ctrl+C to stop monitoring.
 */

import { Devices } from '../lib';
import type { Card, ReaderEventInfo } from '../lib/types';

console.log('PC/SC Card Monitor');
console.log('==================');
console.log('Monitoring for card events. Press Ctrl+C to stop.\n');

const devices = new Devices();

devices.on('reader-attached', (reader: ReaderEventInfo) => {
    console.log(`[+] Reader attached: ${reader.name}`);
});

devices.on('reader-detached', (reader: ReaderEventInfo) => {
    console.log(`[-] Reader detached: ${reader.name}`);
});

devices.on(
    'card-inserted',
    async ({ reader, card }: { reader: ReaderEventInfo; card: Card }) => {
        console.log(`\n[*] Card inserted in: ${reader.name}`);

        // Get ATR
        try {
            const status = card.getStatus();
            console.log(`    ATR: ${status.atr.toString('hex')}`);
        } catch (err) {
            console.log(`    Could not get ATR: ${(err as Error).message}`);
        }

        // Try to read UID
        try {
            const response = await card.transmit([
                0xff, 0xca, 0x00, 0x00, 0x00,
            ]);
            if (response.length >= 2) {
                const sw1 = response[response.length - 2];
                const sw2 = response[response.length - 1];
                if (sw1 === 0x90 && sw2 === 0x00) {
                    const uid = response.subarray(0, -2);
                    console.log(`    UID: ${uid.toString('hex')}`);
                }
            }
        } catch {
            // UID read not supported, that's OK
        }

        console.log();
    }
);

devices.on('card-removed', ({ reader }: { reader: ReaderEventInfo }) => {
    console.log(`[*] Card removed from: ${reader.name}\n`);
});

devices.on('error', (err: Error) => {
    // Ignore common transient errors
    const ignorable = ['unresponsive', 'Sharing violation', 'cancelled'];
    if (!ignorable.some((msg) => err.message.includes(msg))) {
        console.error(`[!] Error: ${err.message}`);
    }
});

// Start monitoring
devices.start();

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nStopping...');
    devices.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    devices.stop();
    process.exit(0);
});
