#!/usr/bin/env npx ts-node
/**
 * Send a custom APDU command to a card
 *
 * Usage: npx ts-node send-apdu.ts <hex-apdu> [reader-index]
 *
 * Examples:
 *   npx ts-node send-apdu.ts "FF CA 00 00 00"        # Get UID
 *   npx ts-node send-apdu.ts "00 A4 04 00"           # Select (no data)
 *   npx ts-node send-apdu.ts "00A40400" 1            # Use second reader
 */

import {
    Context,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD,
    SCARD_STATE_PRESENT,
} from '../lib';

function parseHex(str: string): Buffer {
    // Remove spaces, 0x prefixes, and parse
    const clean = str.replace(/\s+/g, '').replace(/0x/gi, '');
    if (!/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error('Invalid hex string');
    }
    if (clean.length % 2 !== 0) {
        throw new Error('Hex string must have even length');
    }

    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.substr(i, 2), 16));
    }
    return Buffer.from(bytes);
}

function formatResponse(buffer: Buffer): string {
    const hex = buffer.toString('hex').toUpperCase();
    // Add spaces every 2 characters
    return hex.match(/.{2}/g)!.join(' ');
}

async function main(): Promise<void> {
    if (process.argv.length < 3) {
        console.log('Usage: npx ts-node send-apdu.ts <hex-apdu> [reader-index]');
        console.log('');
        console.log('Examples:');
        console.log('  npx ts-node send-apdu.ts "FF CA 00 00 00"    # Get UID');
        console.log('  npx ts-node send-apdu.ts "00 A4 04 00"       # Select');
        process.exit(1);
    }

    let apdu: Buffer;
    try {
        apdu = parseHex(process.argv[2]);
    } catch (err) {
        console.error(`Invalid APDU: ${(err as Error).message}`);
        process.exit(1);
    }

    const readerIndex = parseInt(process.argv[3]) || 0;

    console.log(`APDU: ${formatResponse(apdu)}`);
    console.log('');

    const ctx = new Context();

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found.');
            return;
        }

        if (readerIndex >= readers.length) {
            console.log(`Reader index ${readerIndex} out of range.`);
            return;
        }

        const reader = readers[readerIndex];
        console.log(`Reader: ${reader.name}`);

        const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;
        if (!hasCard) {
            console.log('No card in reader.');
            return;
        }

        const card = await reader.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        const protocolName =
            card.protocol === SCARD_PROTOCOL_T0 ? 'T=0' : 'T=1';
        console.log(`Protocol: ${protocolName}`);
        console.log('');

        console.log('Sending APDU...');
        const response = await card.transmit(apdu);

        console.log(`Response: ${formatResponse(response)}`);

        // Parse status word if present
        if (response.length >= 2) {
            const sw1 = response[response.length - 2];
            const sw2 = response[response.length - 1];
            const sw = (sw1 << 8) | sw2;

            console.log('');
            console.log(`SW: ${sw.toString(16).toUpperCase().padStart(4, '0')}`);

            // Common status words
            if (sw === 0x9000) {
                console.log('Status: Success');
            } else if (sw1 === 0x61) {
                console.log(`Status: ${sw2} bytes available`);
            } else if (sw1 === 0x6c) {
                console.log(`Status: Wrong Le, use Le=${sw2}`);
            } else if (sw === 0x6a82) {
                console.log('Status: File not found');
            } else if (sw === 0x6a86) {
                console.log('Status: Incorrect P1-P2');
            } else if (sw === 0x6d00) {
                console.log('Status: Instruction not supported');
            } else if (sw === 0x6e00) {
                console.log('Status: Class not supported');
            }

            // Data portion
            if (response.length > 2) {
                const data = response.subarray(0, -2);
                console.log(
                    `Data (${data.length} bytes): ${formatResponse(data)}`
                );
            }
        }

        card.disconnect(SCARD_LEAVE_CARD);
    } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
    } finally {
        ctx.close();
    }
}

main();
