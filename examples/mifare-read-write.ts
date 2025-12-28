#!/usr/bin/env npx ts-node
/**
 * Read and write MIFARE Classic cards
 *
 * Usage:
 *   npx ts-node mifare-read-write.ts read [block]       # Read a block (default: 4)
 *   npx ts-node mifare-read-write.ts write [block] <hex-data>  # Write to a block
 *   npx ts-node mifare-read-write.ts dump               # Dump readable blocks
 *
 * Examples:
 *   npx ts-node mifare-read-write.ts read               # Read block 4
 *   npx ts-node mifare-read-write.ts read 8             # Read block 8
 *   npx ts-node mifare-read-write.ts write 4 "00112233445566778899AABBCCDDEEFF"
 *   npx ts-node mifare-read-write.ts dump               # Dump all readable blocks
 *
 * MIFARE Classic Memory Layout:
 * - 1K: 16 sectors x 4 blocks = 64 blocks (blocks 0-63)
 * - 4K: 32 sectors x 4 blocks + 8 sectors x 16 blocks = 256 blocks
 * - Block 0: Manufacturer data (read-only)
 * - Every 4th block (3, 7, 11, ...): Sector trailer (keys + access bits)
 *
 * WARNING: Be careful when writing! Writing to sector trailers can lock
 * the card permanently if you don't know what you're doing.
 */

import {
    Context,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD,
    SCARD_STATE_PRESENT,
} from '../lib';
import type { Card } from '../lib/types';

// MIFARE default keys
const KEY_A_DEFAULT = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

// Key types for authentication
const KEY_TYPE_A = 0x60;

/**
 * Load authentication key into the reader's key slot
 */
async function loadKey(
    card: Card,
    keySlot: number,
    key: number[]
): Promise<void> {
    // FF 82 00 <slot> 06 <key bytes>
    const cmd = [0xff, 0x82, 0x00, keySlot, 0x06, ...key];
    const response = await card.transmit(cmd);
    const sw =
        (response[response.length - 2] << 8) | response[response.length - 1];

    if (sw !== 0x9000) {
        throw new Error(`Load key failed: ${sw.toString(16)}`);
    }
}

/**
 * Authenticate to a block using a loaded key
 */
async function authenticate(
    card: Card,
    block: number,
    keyType: number,
    keySlot: number
): Promise<void> {
    // FF 86 00 00 05 01 00 <block> <key type> <key slot>
    const cmd = [
        0xff,
        0x86,
        0x00,
        0x00,
        0x05,
        0x01,
        0x00,
        block,
        keyType,
        keySlot,
    ];
    const response = await card.transmit(cmd);
    const sw =
        (response[response.length - 2] << 8) | response[response.length - 1];

    if (sw !== 0x9000) {
        throw new Error(`Authentication failed: ${sw.toString(16)}`);
    }
}

/**
 * Read a block (16 bytes)
 */
async function readBlock(card: Card, block: number): Promise<Buffer> {
    // FF B0 00 <block> 10
    const cmd = [0xff, 0xb0, 0x00, block, 0x10];
    const response = await card.transmit(cmd);
    const sw =
        (response[response.length - 2] << 8) | response[response.length - 1];

    if (sw !== 0x9000) {
        throw new Error(`Read failed: ${sw.toString(16)}`);
    }

    return response.subarray(0, 16);
}

/**
 * Write a block (16 bytes)
 */
async function writeBlock(
    card: Card,
    block: number,
    data: number[]
): Promise<void> {
    if (data.length !== 16) {
        throw new Error('Data must be exactly 16 bytes');
    }

    // FF D6 00 <block> 10 <data>
    const cmd = [0xff, 0xd6, 0x00, block, 0x10, ...data];
    const response = await card.transmit(cmd);
    const sw =
        (response[response.length - 2] << 8) | response[response.length - 1];

    if (sw !== 0x9000) {
        throw new Error(`Write failed: ${sw.toString(16)}`);
    }
}

/**
 * Get sector number for a block
 */
function getSector(block: number): number {
    if (block < 128) {
        return Math.floor(block / 4);
    }
    // For 4K cards, sectors 32-39 have 16 blocks each
    return 32 + Math.floor((block - 128) / 16);
}

/**
 * Check if block is a sector trailer
 */
function isSectorTrailer(block: number): boolean {
    if (block < 128) {
        return (block + 1) % 4 === 0;
    }
    return (block - 128 + 1) % 16 === 0;
}

function parseHexData(str: string): number[] {
    const clean = str.replace(/\s+/g, '').replace(/0x/gi, '');
    if (!/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error('Invalid hex string');
    }
    if (clean.length !== 32) {
        throw new Error('Data must be exactly 32 hex characters (16 bytes)');
    }

    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.substr(i, 2), 16));
    }
    return bytes;
}

function formatHex(buffer: Buffer): string {
    return buffer.toString('hex').toUpperCase().match(/.{2}/g)!.join(' ');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0] || 'read';

    console.log('MIFARE Classic Example');
    console.log('======================\n');

    const ctx = new Context();

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found.');
            return;
        }

        const reader = readers[0];
        console.log(`Reader: ${reader.name}`);

        const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;
        if (!hasCard) {
            console.log('No card in reader. Please insert a MIFARE card.');
            return;
        }

        const card = await reader.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        // Get UID
        const uidResponse = await card.transmit([0xff, 0xca, 0x00, 0x00, 0x00]);
        const sw =
            (uidResponse[uidResponse.length - 2] << 8) |
            uidResponse[uidResponse.length - 1];
        if (sw === 0x9000) {
            const uid = uidResponse.subarray(0, -2);
            console.log(`Card UID: ${formatHex(uid)}`);
        }

        // Load default key into slot 0
        console.log('Loading default key...');
        await loadKey(card, 0x00, KEY_A_DEFAULT);

        switch (command) {
            case 'read': {
                const block = parseInt(args[1]) || 4;
                console.log(`\nReading block ${block}...`);

                if (block === 0) {
                    console.log('(Block 0 is manufacturer data)');
                } else if (isSectorTrailer(block)) {
                    console.log(
                        '(This is a sector trailer - Key A will be masked)'
                    );
                }

                // Authenticate to the sector containing this block
                const sector = getSector(block);
                console.log(`Authenticating to sector ${sector}...`);
                await authenticate(card, block, KEY_TYPE_A, 0x00);

                const data = await readBlock(card, block);
                console.log(`Data: ${formatHex(data)}`);

                // Try to interpret the data
                const printable = data
                    .toString('utf8')
                    .replace(/[^\x20-\x7E]/g, '.');
                console.log(`ASCII: ${printable}`);
                break;
            }

            case 'write': {
                const block = parseInt(args[1]) || 4;
                const hexData = args[2];

                if (!hexData) {
                    console.log(
                        'Usage: npx ts-node mifare-read-write.ts write <block> <hex-data>'
                    );
                    console.log(
                        'Example: npx ts-node mifare-read-write.ts write 4 "00112233445566778899AABBCCDDEEFF"'
                    );
                    break;
                }

                if (block === 0) {
                    console.log(
                        'ERROR: Block 0 is read-only (manufacturer data)'
                    );
                    break;
                }

                if (isSectorTrailer(block)) {
                    console.log('WARNING: This is a sector trailer!');
                    console.log(
                        'Writing here can permanently lock the sector.'
                    );
                    console.log(
                        "Aborting for safety. Remove this check if you know what you're doing."
                    );
                    break;
                }

                const data = parseHexData(hexData);
                console.log(`\nWriting to block ${block}...`);
                console.log(`Data: ${formatHex(Buffer.from(data))}`);

                // Authenticate
                const sector = getSector(block);
                console.log(`Authenticating to sector ${sector}...`);
                await authenticate(card, block, KEY_TYPE_A, 0x00);

                await writeBlock(card, block, data);
                console.log('Write successful!');

                // Read back to verify
                const readBack = await readBlock(card, block);
                console.log(`Verify: ${formatHex(readBack)}`);
                break;
            }

            case 'dump': {
                console.log('\nDumping readable blocks...\n');
                console.log('Block | Sector | Data');
                console.log(
                    '------|--------|--------------------------------------------------'
                );

                let lastSector = -1;

                // Try to dump blocks 0-63 (MIFARE 1K)
                for (let block = 0; block < 64; block++) {
                    const sector = getSector(block);

                    try {
                        // Re-authenticate when sector changes
                        if (sector !== lastSector) {
                            await authenticate(card, block, KEY_TYPE_A, 0x00);
                            lastSector = sector;
                        }

                        const data = await readBlock(card, block);
                        const trailer = isSectorTrailer(block)
                            ? ' [trailer]'
                            : '';
                        console.log(
                            `  ${block.toString().padStart(2)}  |   ${sector.toString().padStart(2)}   | ${formatHex(data)}${trailer}`
                        );
                    } catch (err) {
                        console.log(
                            `  ${block.toString().padStart(2)}  |   ${sector.toString().padStart(2)}   | (read failed: ${(err as Error).message})`
                        );
                        lastSector = -1; // Force re-auth on next block
                    }
                }
                break;
            }

            default:
                console.log('Unknown command. Use: read, write, or dump');
        }

        card.disconnect(SCARD_LEAVE_CARD);
    } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
    } finally {
        ctx.close();
    }
}

main().catch(console.error);
