#!/usr/bin/env node
/**
 * Connect to a card and read its UID and ATR
 *
 * Usage: node read-card.js [reader-index]
 *
 * Examples:
 *   node read-card.js      # Use first reader
 *   node read-card.js 1    # Use second reader
 */

'use strict';

const {
    Context,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD,
    SCARD_STATE_PRESENT,
} = require('../lib');

async function main() {
    const readerIndex = parseInt(process.argv[2]) || 0;

    console.log('Creating PC/SC context...');
    const ctx = new Context();

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found.');
            return;
        }

        if (readerIndex >= readers.length) {
            console.log(`Reader index ${readerIndex} out of range. Found ${readers.length} reader(s).`);
            return;
        }

        const reader = readers[readerIndex];
        console.log(`Using reader: ${reader.name}`);

        // Check if card is present
        const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;
        if (!hasCard) {
            console.log('\nNo card in reader. Please insert a card and try again.');
            return;
        }

        console.log('\nConnecting to card...');
        const card = await reader.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        const protocolName = card.protocol === SCARD_PROTOCOL_T0 ? 'T=0' : 'T=1';
        console.log(`Connected! Protocol: ${protocolName}`);

        // Get card status
        const status = card.getStatus();
        console.log(`\nCard Information:`);
        console.log(`  ATR: ${status.atr.toString('hex')}`);

        // Try to get UID (works for contactless cards via PC/SC pseudo-APDU)
        console.log('\nTrying to read UID...');
        try {
            const getUidCmd = Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]);
            const response = await card.transmit(getUidCmd);

            // Response format: UID + SW1 SW2
            if (response.length >= 2) {
                const sw1 = response[response.length - 2];
                const sw2 = response[response.length - 1];

                if (sw1 === 0x90 && sw2 === 0x00) {
                    const uid = response.slice(0, -2);
                    console.log(`  UID: ${uid.toString('hex')}`);
                } else {
                    console.log(`  Command returned: ${sw1.toString(16)} ${sw2.toString(16)}`);
                    console.log('  (UID read may not be supported by this card type)');
                }
            }
        } catch (err) {
            console.log(`  Could not read UID: ${err.message}`);
        }

        // Disconnect
        card.disconnect(SCARD_LEAVE_CARD);
        console.log('\nDisconnected.');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        ctx.close();
    }
}

main();
