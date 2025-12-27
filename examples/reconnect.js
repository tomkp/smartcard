#!/usr/bin/env node
/**
 * Demonstrates card.reconnect() for resetting or changing protocols
 *
 * Usage: node reconnect.js
 *
 * The reconnect() method is useful when you need to:
 * - Reset the card to a known state
 * - Change the communication protocol (T=0 <-> T=1)
 * - Recover from errors without releasing the card handle
 */

'use strict';

const {
    Context,
    SCARD_SHARE_SHARED,
    SCARD_SHARE_EXCLUSIVE,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD,
    SCARD_RESET_CARD,
    SCARD_UNPOWER_CARD,
    SCARD_STATE_PRESENT,
} = require('../lib');

function protocolName(protocol) {
    if (protocol === SCARD_PROTOCOL_T0) return 'T=0';
    if (protocol === SCARD_PROTOCOL_T1) return 'T=1';
    return `Unknown (${protocol})`;
}

async function main() {
    console.log('Reconnect Example');
    console.log('=================\n');

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
            console.log('No card in reader. Please insert a card.');
            return;
        }

        // Initial connection
        console.log('\n--- Initial Connection ---');
        const card = await reader.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );

        let status = card.getStatus();
        console.log(`Protocol: ${protocolName(card.protocol)}`);
        console.log(`ATR: ${status.atr.toString('hex')}`);

        // Send a test command
        try {
            const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
            console.log(`Test command response: ${response.toString('hex')}`);
        } catch (err) {
            console.log(`Test command failed: ${err.message}`);
        }

        // Reconnect with reset
        console.log('\n--- Reconnect with RESET ---');
        console.log('Resetting card...');

        const newProtocol = await card.reconnect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
            SCARD_RESET_CARD
        );

        console.log(`New protocol: ${protocolName(newProtocol)}`);

        status = card.getStatus();
        console.log(`ATR after reset: ${status.atr.toString('hex')}`);

        // The card should be in a fresh state now
        try {
            const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
            console.log(`Command after reset: ${response.toString('hex')}`);
        } catch (err) {
            console.log(`Command failed: ${err.message}`);
        }

        // Try to force a specific protocol (if supported)
        console.log('\n--- Reconnect with T=0 only ---');
        try {
            const t0Protocol = await card.reconnect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0,
                SCARD_RESET_CARD
            );
            console.log(`Protocol: ${protocolName(t0Protocol)}`);
        } catch (err) {
            console.log(`T=0 not supported: ${err.message}`);
        }

        // Try T=1 only
        console.log('\n--- Reconnect with T=1 only ---');
        try {
            const t1Protocol = await card.reconnect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T1,
                SCARD_RESET_CARD
            );
            console.log(`Protocol: ${protocolName(t1Protocol)}`);
        } catch (err) {
            console.log(`T=1 not supported: ${err.message}`);
        }

        // Reconnect with unpower (cold reset)
        console.log('\n--- Reconnect with UNPOWER (cold reset) ---');
        console.log('Power cycling card...');

        try {
            const unpowerProtocol = await card.reconnect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
                SCARD_UNPOWER_CARD
            );
            console.log(`Protocol after power cycle: ${protocolName(unpowerProtocol)}`);

            status = card.getStatus();
            console.log(`ATR: ${status.atr.toString('hex')}`);
        } catch (err) {
            console.log(`Cold reset failed: ${err.message}`);
        }

        // Upgrade to exclusive mode
        console.log('\n--- Reconnect with EXCLUSIVE mode ---');
        try {
            const exclusiveProtocol = await card.reconnect(
                SCARD_SHARE_EXCLUSIVE,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
                SCARD_LEAVE_CARD
            );
            console.log(`Got exclusive access! Protocol: ${protocolName(exclusiveProtocol)}`);

            // Do something that requires exclusive access...
            console.log('Performing exclusive operation...');

            // Downgrade back to shared mode
            await card.reconnect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1,
                SCARD_LEAVE_CARD
            );
            console.log('Released exclusive access.');
        } catch (err) {
            console.log(`Exclusive mode failed: ${err.message}`);
        }

        card.disconnect(SCARD_LEAVE_CARD);
        console.log('\nDone!');

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        ctx.close();
    }
}

main().catch(console.error);
