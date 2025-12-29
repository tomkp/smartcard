/**
 * T=0 protocol status word handling
 *
 * Handles automatic GET RESPONSE (SW1=61) and Le correction (SW1=6C)
 * for T=0 protocol smart cards.
 */

import type { Card, TransmitOptions } from './types';

/**
 * GET RESPONSE command template (00 C0 00 00 XX)
 */
const GET_RESPONSE_CLA = 0x00;
const GET_RESPONSE_INS = 0xc0;
const GET_RESPONSE_P1 = 0x00;
const GET_RESPONSE_P2 = 0x00;

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

    while (response.length >= 2) {
        const sw1 = response[response.length - 2];
        const sw2 = response[response.length - 1];

        if (sw1 === 0x61) {
            // SW1=61: More data available, send GET RESPONSE
            const bytesAvailable = sw2;

            // Collect any data before the status word
            if (response.length > 2) {
                collectedData.push(response.subarray(0, response.length - 2));
            }

            // Send GET RESPONSE
            const getResponseCmd = Buffer.from([
                GET_RESPONSE_CLA,
                GET_RESPONSE_INS,
                GET_RESPONSE_P1,
                GET_RESPONSE_P2,
                bytesAvailable,
            ]);
            response = await card.transmit(getResponseCmd, options);
        } else if (sw1 === 0x6c) {
            // SW1=6C: Wrong Le, retry with correct value
            const correctLe = sw2;

            // Build new command with corrected Le
            let newCmd: Buffer;
            if (cmdBuffer.length === 4) {
                // Case 1: No Le in original, append it
                newCmd = Buffer.concat([cmdBuffer, Buffer.from([correctLe])]);
            } else if (cmdBuffer.length === 5) {
                // Case 2: Le at end, replace it
                newCmd = Buffer.from(cmdBuffer);
                newCmd[4] = correctLe;
            } else {
                // Case 3/4: Command with Lc and data, Le at end
                newCmd = Buffer.from(cmdBuffer);
                newCmd[newCmd.length - 1] = correctLe;
            }

            response = await card.transmit(newCmd, options);
        } else {
            // Not a special status word, we're done
            break;
        }
    }

    // If we collected data from chained responses, concatenate it with final response
    if (collectedData.length > 0) {
        collectedData.push(response);
        return Buffer.concat(collectedData);
    }

    return response;
}
