/**
 * T=0 protocol status word handling
 *
 * Handles automatic GET RESPONSE (SW1=61) and Le correction (SW1=6C)
 * for T=0 protocol smart cards.
 */

import type { Card, TransmitOptions } from './types';

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
    } else if (command.length === 5) {
        // Case 2: Le at end, replace it
        const newCmd = Buffer.from(command);
        newCmd[4] = newLe;
        return newCmd;
    } else {
        // Case 3/4: Command with Lc and data, Le at end
        const newCmd = Buffer.from(command);
        newCmd[newCmd.length - 1] = newLe;
        return newCmd;
    }
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

    while (response.length >= 2) {
        const sw1 = response[response.length - 2];
        const sw2 = response[response.length - 1];

        if (sw1 === 0x61) {
            // SW1=61: More data available, send GET RESPONSE
            // Collect any data before the status word
            if (response.length > 2) {
                collectedData.push(response.subarray(0, response.length - 2));
            }

            const getResponseCmd = buildGetResponseCommand(sw2);
            response = await card.transmit(getResponseCmd, options);
        } else if (sw1 === 0x6c) {
            // SW1=6C: Wrong Le, retry with correct value
            const newCmd = correctLeInCommand(cmdBuffer, sw2);
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
