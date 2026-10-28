/**
 * Card wrapper that adds autoGetResponse support to card.transmit()
 *
 * Wraps the native Card object to intercept transmit() calls and
 * automatically handle T=0 protocol status words when autoGetResponse is set.
 */

import type { Card, CardStatus, TransmitOptions } from './types';
import { transmitWithAutoResponse } from './t0-handler';

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
        return this._nativeCard.reconnect(shareMode, protocol, initialization);
    }
}

/**
 * Wrap a native card with autoGetResponse support
 */
export function wrapCard(nativeCard: Card): Card {
    return new CardWrapper(nativeCard);
}
