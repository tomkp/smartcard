/**
 * T=0 protocol status word handling
 *
 * Handles automatic GET RESPONSE (SW1=61) and Le correction (SW1=6C)
 * for T=0 protocol smart cards.
 */

import type { Card, TransmitOptions } from './types';

/**
 * Most data a 61xx chain may collect: no response APDU can carry more than
 * 65536 bytes, however small the chunks a card returns them in.
 */
const MAX_T0_RESPONSE_BYTES = 65536;

/**
 * Most consecutive round-trips that collect no data (bare 61xx, or 6Cxx
 * corrections), so a card stuck repeating a status word fails instead of
 * looping forever.
 */
const MAX_T0_IDLE_ROUND_TRIPS = 16;

/**
 * Build a GET RESPONSE APDU command (00 C0 00 00 Le)
 *
 * @param bytesAvailable Number of bytes to retrieve (Le value)
 * @returns GET RESPONSE command buffer
 */
export function buildGetResponseCommand(bytesAvailable: number): Buffer {
    return Buffer.from([0x00, 0xc0, 0x00, 0x00, bytesAvailable]);
}

/**
 * Correct the Le value in an APDU command
 *
 * @param command Original command buffer
 * @param newLe Corrected Le value from SW2
 * @returns New command buffer with corrected Le
 */
export function correctLeInCommand(command: Buffer, newLe: number): Buffer {
    if (command.length === 4) {
        // Case 1: No Le in original, append it
        return Buffer.concat([command, Buffer.from([newLe])]);
    }
    if (command.length === 5) {
        // Case 2: Le at end, replace it
        const newCmd = Buffer.from(command);
        newCmd[4] = newLe;
        return newCmd;
    }
    // Longer commands carry Lc + data, but only Case 4 also ends in Le.
    // Parse Lc to tell the cases apart - a length check alone would overwrite
    // the last data byte of a Case 3 command. T=0 carries short APDUs only,
    // so Lc is the single byte at offset 4.
    const lc = command[4];
    if (command.length === 5 + lc) {
        // Case 3: header + data, no Le - append it
        return Buffer.concat([command, Buffer.from([newLe])]);
    }
    if (command.length === 5 + lc + 1) {
        // Case 4: header + data + Le - replace it
        const newCmd = Buffer.from(command);
        newCmd[newCmd.length - 1] = newLe;
        return newCmd;
    }
    // Structure matches no short-APDU case (extended-length or malformed):
    // don't guess at which byte is Le
    return Buffer.from(command);
}

/**
 * Transmit an APDU with optional automatic T=0 status word handling
 *
 * @param card The card to transmit to
 * @param command The APDU command
 * @param options Transmit options including autoGetResponse
 * @returns The response data
 */
export async function transmitWithAutoResponse(
    card: Card,
    command: Buffer | number[],
    options: TransmitOptions = {}
): Promise<Buffer> {
    const cmdBuffer = Buffer.isBuffer(command) ? command : Buffer.from(command);

    // Transmit the initial command
    let response = await card.transmit(cmdBuffer, options);

    // If autoGetResponse is not enabled, return raw response
    if (!options.autoGetResponse) {
        return response;
    }

    // Handle T=0 special status words
    const collectedData: Buffer[] = [];

    // 6C corrects the command actually on the wire - after a GET RESPONSE
    // that is the GET RESPONSE itself, not the original command
    let lastCommand = cmdBuffer;
    let collectedBytes = 0;
    let idleRoundTrips = 0;

    while (response.length >= 2) {
        const sw1 = response[response.length - 2];
        const sw2 = response[response.length - 1];

        if (sw1 !== 0x61 && sw1 !== 0x6c) {
            // Not a special status word, we're done
            break;
        }

        let nextCommand: Buffer;
        if (sw1 === 0x61) {
            // SW1=61: More data available, send GET RESPONSE
            // Collect any data before the status word
            if (response.length > 2) {
                collectedData.push(response.subarray(0, response.length - 2));
                collectedBytes += response.length - 2;
                idleRoundTrips = 0;
            } else {
                idleRoundTrips++;
            }
            if (collectedBytes > MAX_T0_RESPONSE_BYTES) {
                throw new Error(
                    `T=0 response chain exceeded ${MAX_T0_RESPONSE_BYTES} bytes`
                );
            }
            nextCommand = buildGetResponseCommand(sw2);
        } else {
            // SW1=6C: Wrong Le, retry the last command with the correct value
            nextCommand = correctLeInCommand(lastCommand, sw2);
            if (nextCommand.equals(lastCommand)) {
                // Nothing to correct (extended-length or malformed command,
                // or the card asked for the Le it already had): resending
                // would only repeat the 6Cxx, so return it to the caller
                break;
            }
            idleRoundTrips++;
        }

        if (idleRoundTrips > MAX_T0_IDLE_ROUND_TRIPS) {
            throw new Error(
                `T=0 response chain made no progress in ${MAX_T0_IDLE_ROUND_TRIPS} ` +
                    `round-trips (card keeps returning SW1=${sw1.toString(16)})`
            );
        }

        lastCommand = nextCommand;
        response = await card.transmit(lastCommand, options);
    }

    // If we collected data from chained responses, concatenate it with final response
    if (collectedData.length > 0) {
        collectedData.push(response);
        return Buffer.concat(collectedData);
    }

    return response;
}
