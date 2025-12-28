#!/usr/bin/env npx ts-node
/**
 * List all available PC/SC readers
 *
 * Usage: npx ts-node list-readers.ts
 */

import { Context, SCARD_STATE_PRESENT } from '../lib';

function main(): void {
    console.log('Creating PC/SC context...');
    const ctx = new Context();

    if (!ctx.isValid) {
        console.error('Failed to create context');
        process.exit(1);
    }

    console.log('Listing readers...\n');

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found.');
            console.log('\nMake sure:');
            console.log(
                '  - A PC/SC compatible reader is connected'
            );
            console.log(
                '  - On Linux: pcscd service is running (sudo systemctl start pcscd)'
            );
        } else {
            console.log(`Found ${readers.length} reader(s):\n`);

            for (const reader of readers) {
                const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;
                console.log(`  Name: ${reader.name}`);
                console.log(`  State: 0x${reader.state.toString(16)}`);
                console.log(`  Card present: ${hasCard ? 'Yes' : 'No'}`);
                if (hasCard && reader.atr) {
                    console.log(`  ATR: ${reader.atr.toString('hex')}`);
                }
                console.log();
            }
        }
    } catch (err) {
        console.error('Error:', (err as Error).message);
    } finally {
        ctx.close();
    }
}

main();
