/**
 * Card wrapper that adds autoGetResponse support to card.transmit()
 *
 * Wraps the native Card object to intercept transmit() calls and
 * automatically handle T=0 protocol status words when autoGetResponse is set.
 * Also upgrades native rejections (plain Errors carrying a numeric `code`)
 * into the typed PCSCError hierarchy.
 */

import type { Card, CardStatus, TransmitOptions } from './types';
import { transmitWithAutoResponse } from './t0-handler';
import { toPCSCError } from './errors';

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
        try {
            if (options?.autoGetResponse) {
                // Delegate to transmitWithAutoResponse for T=0 handling
                return await transmitWithAutoResponse(
                    this._nativeCard,
                    command,
                    options
                );
            }
            // Pass through to native transmit
            return await this._nativeCard.transmit(command, options);
        } catch (err) {
            throw toPCSCError(err);
        }
    }

    async control(code: number, data?: Buffer | number[]): Promise<Buffer> {
        try {
            return await this._nativeCard.control(code, data);
        } catch (err) {
            throw toPCSCError(err);
        }
    }

    getStatus(): CardStatus {
        try {
            return this._nativeCard.getStatus();
        } catch (err) {
            throw toPCSCError(err);
        }
    }

    disconnect(disposition?: number): void {
        try {
            return this._nativeCard.disconnect(disposition);
        } catch (err) {
            throw toPCSCError(err);
        }
    }

    async reconnect(
        shareMode?: number,
        protocol?: number,
        initialization?: number
    ): Promise<number> {
        try {
            return await this._nativeCard.reconnect(
                shareMode,
                protocol,
                initialization
            );
        } catch (err) {
            throw toPCSCError(err);
        }
    }
}

/**
 * Wrap a native card with autoGetResponse support
 */
export function wrapCard(nativeCard: Card): Card {
    return new CardWrapper(nativeCard);
}
