#!/usr/bin/env node
/**
 * Send control commands to a reader
 *
 * Usage: node control-command.js
 *
 * This example demonstrates:
 * - Using card.control() to send control commands
 * - Querying reader features with CM_IOCTL_GET_FEATURE_REQUEST
 * - Using the parseFeatures() helper
 * - Platform-specific control codes with SCARD_CTL_CODE()
 *
 * Control commands are used for reader-specific features like:
 * - PIN pad input on secure readers
 * - LED control
 * - Buzzer control
 * - Reader firmware queries
 */

'use strict';

const {
    Context,
    SCARD_SHARE_DIRECT,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_PROTOCOL_UNDEFINED,
    SCARD_LEAVE_CARD,
    SCARD_STATE_PRESENT,
    SCARD_CTL_CODE,
    CM_IOCTL_GET_FEATURE_REQUEST,
    FEATURE_VERIFY_PIN_DIRECT,
    FEATURE_MODIFY_PIN_DIRECT,
    FEATURE_IFD_PIN_PROPERTIES,
    FEATURE_GET_TLV_PROPERTIES,
    FEATURE_CCID_ESC_COMMAND,
    parseFeatures,
} = require('../lib');

// Feature tag names for display
const FEATURE_NAMES = {
    0x01: 'VERIFY_PIN_START',
    0x02: 'VERIFY_PIN_FINISH',
    0x03: 'MODIFY_PIN_START',
    0x04: 'MODIFY_PIN_FINISH',
    0x05: 'GET_KEY_PRESSED',
    0x06: 'VERIFY_PIN_DIRECT',
    0x07: 'MODIFY_PIN_DIRECT',
    0x08: 'MCT_READER_DIRECT',
    0x09: 'MCT_UNIVERSAL',
    0x0A: 'IFD_PIN_PROPERTIES',
    0x0B: 'ABORT',
    0x0C: 'SET_SPE_MESSAGE',
    0x0D: 'VERIFY_PIN_DIRECT_APP_ID',
    0x0E: 'MODIFY_PIN_DIRECT_APP_ID',
    0x0F: 'WRITE_DISPLAY',
    0x10: 'GET_KEY',
    0x11: 'IFD_DISPLAY_PROPERTIES',
    0x12: 'GET_TLV_PROPERTIES',
    0x13: 'CCID_ESC_COMMAND',
};

async function main() {
    console.log('Control Command Example');
    console.log('=======================\n');

    const ctx = new Context();

    try {
        const readers = ctx.listReaders();

        if (readers.length === 0) {
            console.log('No readers found.');
            return;
        }

        const reader = readers[0];
        console.log(`Reader: ${reader.name}`);
        console.log();

        // For control commands, we can connect with SCARD_SHARE_DIRECT
        // which doesn't require a card to be present
        let card;
        const hasCard = (reader.state & SCARD_STATE_PRESENT) !== 0;

        if (hasCard) {
            // If card is present, use shared mode
            console.log('Card present, connecting in shared mode...');
            card = await reader.connect(
                SCARD_SHARE_SHARED,
                SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
            );
        } else {
            // No card, try direct mode (reader-only commands)
            console.log('No card present, connecting in direct mode...');
            try {
                card = await reader.connect(
                    SCARD_SHARE_DIRECT,
                    SCARD_PROTOCOL_UNDEFINED
                );
            } catch (err) {
                console.log('Direct mode not supported by this reader.');
                console.log('Insert a card and try again.');
                return;
            }
        }

        console.log('Connected!\n');

        // Query reader features using CM_IOCTL_GET_FEATURE_REQUEST
        console.log('Querying reader features...');
        console.log(`Control code: 0x${CM_IOCTL_GET_FEATURE_REQUEST.toString(16)}\n`);

        try {
            const featureResponse = await card.control(CM_IOCTL_GET_FEATURE_REQUEST);

            if (featureResponse.length === 0) {
                console.log('No features reported by reader.');
            } else {
                console.log(`Raw response: ${featureResponse.toString('hex')}`);
                console.log();

                // Parse the TLV response
                const features = parseFeatures(featureResponse);

                console.log('Supported features:');
                for (const [tag, controlCode] of features) {
                    const name = FEATURE_NAMES[tag] || `UNKNOWN_${tag.toString(16)}`;
                    console.log(`  ${name}: 0x${controlCode.toString(16)}`);
                }
                console.log();

                // Check for specific features
                if (features.has(FEATURE_VERIFY_PIN_DIRECT)) {
                    console.log('This reader supports PIN verification via keypad!');
                }
                if (features.has(FEATURE_MODIFY_PIN_DIRECT)) {
                    console.log('This reader supports PIN modification via keypad!');
                }
            }
        } catch (err) {
            console.log(`Feature query failed: ${err.message}`);
            console.log('(This is normal for many consumer readers)');
        }

        // Example: ACR122U specific commands (if applicable)
        if (reader.name.includes('ACR122')) {
            console.log('\n--- ACR122U Specific Commands ---\n');

            // Get firmware version
            // ACR122U uses pseudo-APDUs through transmit, not control
            if (hasCard) {
                try {
                    const fwCmd = [0xFF, 0x00, 0x48, 0x00, 0x00];
                    const fwResponse = await card.transmit(fwCmd);
                    console.log(`Firmware: ${fwResponse.toString('ascii')}`);
                } catch (err) {
                    // Firmware command not supported
                }
            }

            // LED and buzzer control (pseudo-APDU)
            // FF 00 40 <LED state> 04 <T1> <T2> <repeat> <buzzer>
            // This is just an example structure - actual usage depends on card state
            console.log('LED/Buzzer control available via pseudo-APDUs:');
            console.log('  FF 00 40 XX 04 ... - Control LED and buzzer');
        }

        // Demonstrate SCARD_CTL_CODE for custom codes
        console.log('\n--- Control Code Generation ---\n');
        console.log('Platform-specific control codes using SCARD_CTL_CODE():');
        console.log(`  SCARD_CTL_CODE(1): 0x${SCARD_CTL_CODE(1).toString(16)}`);
        console.log(`  SCARD_CTL_CODE(3400): 0x${SCARD_CTL_CODE(3400).toString(16)}`);
        console.log(`  SCARD_CTL_CODE(3500): 0x${SCARD_CTL_CODE(3500).toString(16)}`);

        card.disconnect(SCARD_LEAVE_CARD);
        console.log('\nDone!');

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        ctx.close();
    }
}

main().catch(console.error);
