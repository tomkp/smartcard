/**
 * Card wrapper that adds autoGetResponse support to card.transmit()
 *
 * Wraps the native Card object to intercept transmit() calls and
 * automatically handle T=0 protocol status words when autoGetResponse is set.
 */

import type { Card, CardStatus, TransmitOptions } from './types';
import { transmitWithAutoResponse } from './t0-handler';
// Only called at reconnect time, so the import cycle with devices is harmless
import { isUnresponsiveCardError } from './devices';

/**
 * Wraps a native Card to add autoGetResponse support to transmit()
 */
export class CardWrapper implements Card {
    private _nativeCard: Card;

    constructor(nativeCard: Card) {
        this._nativeCard = nativeCard;
    }

    get protocol(): number {
        return this._nativeCard.protocol;
    }

    get connected(): boolean {
        return this._nativeCard.connected;
    }

    get atr(): Buffer | null {
        return this._nativeCard.atr;
    }

    async transmit(
        command: Buffer | number[],
        options?: TransmitOptions
    ): Promise<Buffer> {
        if (options?.autoGetResponse) {
            // Delegate to transmitWithAutoResponse for T=0 handling
            return transmitWithAutoResponse(this._nativeCard, command, options);
        }
        // Pass through to native transmit
        return this._nativeCard.transmit(command, options);
    }

    control(code: number, data?: Buffer | number[]): Promise<Buffer> {
        return this._nativeCard.control(code, data);
    }

    getStatus(): CardStatus {
        return this._nativeCard.getStatus();
    }

    disconnect(disposition?: number): void {
        return this._nativeCard.disconnect(disposition);
    }

    async reconnect(
        shareMode?: number,
        protocol?: number,
        initialization?: number
    ): Promise<number> {
        const active = this._nativeCard.protocol;
        try {
            return await this._nativeCard.reconnect(
                shareMode,
                protocol,
                initialization
            );
        } catch (err) {
            // Some readers report a T=0-only card as unresponsive when T=1 is
            // offered too - the quirk Devices works around on connect (issue
            // #34). Offering T=0|T=1 (also the default) hits it on reconnect,
            // so retry once with the protocol the card is already using.
            if (
                active &&
                protocol !== active &&
                isUnresponsiveCardError(err as Error)
            ) {
                return this._nativeCard.reconnect(
                    shareMode,
                    active,
                    initialization
                );
            }
            throw err;
        }
    }
}

/**
 * Wrap a native card with autoGetResponse support
 */
export function wrapCard(nativeCard: Card): Card {
    return new CardWrapper(nativeCard);
}
