#!/usr/bin/env node
/**
 * Monitor for card insert/remove events using the high-level Devices API
 *
 * Usage: node monitor-cards.js
 *
 * Press Ctrl+C to stop monitoring.
 */

'use strict';

const { Devices } = require('../lib');

console.log('PC/SC Card Monitor');
console.log('==================');
console.log('Monitoring for card events. Press Ctrl+C to stop.\n');

const devices = new Devices();

devices.on('reader-attached', (reader) => {
    console.log(`[+] Reader attached: ${reader.name}`);
});

devices.on('reader-detached', (reader) => {
    console.log(`[-] Reader detached: ${reader.name}`);
});

devices.on('card-inserted', async ({ reader, card }) => {
    console.log(`\n[*] Card inserted in: ${reader.name}`);

    // Get ATR
    try {
        const status = card.getStatus();
        console.log(`    ATR: ${status.atr.toString('hex')}`);
    } catch (err) {
        console.log(`    Could not get ATR: ${err.message}`);
    }

    // Try to read UID
    try {
        const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
        if (response.length >= 2) {
            const sw1 = response[response.length - 2];
            const sw2 = response[response.length - 1];
            if (sw1 === 0x90 && sw2 === 0x00) {
                const uid = response.slice(0, -2);
                console.log(`    UID: ${uid.toString('hex')}`);
            }
        }
    } catch (err) {
        // UID read not supported, that's OK
    }

    console.log();
});

devices.on('card-removed', ({ reader }) => {
    console.log(`[*] Card removed from: ${reader.name}\n`);
});

devices.on('error', (err) => {
    // Ignore common transient errors
    const ignorable = ['unresponsive', 'Sharing violation', 'cancelled'];
    if (!ignorable.some(msg => err.message.includes(msg))) {
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
