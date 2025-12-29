import { EventEmitter } from 'events';
import type {
    Card,
    Context,
    ContextConstructor,
    DeviceEvents,
    DevicesOptions,
    MonitorEvent,
    NativeAddon,
    Reader,
    ReaderMonitor,
    ReaderMonitorConstructor,
} from './types';

const addon = require('../../build/Release/smartcard_napi.node') as NativeAddon;

interface ReaderStateInternal {
    hasCard: boolean;
    card: Card | null;
}

/**
 * Check if an error indicates an unresponsive card (SCARD_W_UNRESPONSIVE_CARD).
 * Used to determine if we should fallback to T=0 protocol.
 */
export function isUnresponsiveCardError(err: Error): boolean {
    if (!err || typeof err.message !== 'string') {
        return false;
    }
    return err.message.toLowerCase().includes('unresponsive');
}

/**
 * High-level event-driven API for PC/SC devices
 *
 * Uses native ReaderMonitor for efficient background monitoring
 * with ThreadSafeFunction to emit events from worker thread.
 *
 * Events:
 * - 'reader-attached': Emitted when a reader is attached
 * - 'reader-detached': Emitted when a reader is detached
 * - 'card-inserted': Emitted when a card is inserted
 * - 'card-removed': Emitted when a card is removed
 * - 'error': Emitted on errors
 */
export class Devices extends EventEmitter {
    private _monitor: ReaderMonitor | null = null;
    private _context: Context | null = null;
    private _running = false;
    private _readers = new Map<string, ReaderStateInternal>();
    private _eventQueue: Promise<void> = Promise.resolve();

    // Dependencies (can be injected for testing)
    private _Context: ContextConstructor;
    private _ReaderMonitor: ReaderMonitorConstructor;
    private _SCARD_STATE_PRESENT: number;
    private _SCARD_SHARE_SHARED: number;
    private _SCARD_PROTOCOL_T0: number;
    private _SCARD_PROTOCOL_T1: number;

    /**
     * Create a new Devices instance
     * @param options Optional dependencies for testing
     */
    constructor(options?: DevicesOptions) {
        super();
        this._Context = options?.Context ?? addon.Context;
        this._ReaderMonitor = options?.ReaderMonitor ?? addon.ReaderMonitor;
        this._SCARD_STATE_PRESENT =
            options?.SCARD_STATE_PRESENT ?? addon.SCARD_STATE_PRESENT;
        this._SCARD_SHARE_SHARED =
            options?.SCARD_SHARE_SHARED ?? addon.SCARD_SHARE_SHARED;
        this._SCARD_PROTOCOL_T0 =
            options?.SCARD_PROTOCOL_T0 ?? addon.SCARD_PROTOCOL_T0;
        this._SCARD_PROTOCOL_T1 =
            options?.SCARD_PROTOCOL_T1 ?? addon.SCARD_PROTOCOL_T1;
    }

    /**
     * Start monitoring for device changes
     */
    start(): void {
        if (this._running) {
            return;
        }

        try {
            // Create context for card connections
            this._context = new this._Context();

            // Create native monitor
            this._monitor = new this._ReaderMonitor();
            this._running = true;

            // Start native monitoring with callback
            this._monitor.start((event: MonitorEvent) => {
                this._handleEvent(event);
            });
        } catch (err) {
            this.emit('error', err as Error);
        }
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        this._running = false;

        if (this._monitor) {
            try {
                this._monitor.stop();
            } catch {
                // Ignore stop errors
            }
            this._monitor = null;
        }

        // Disconnect any connected cards
        for (const [, state] of this._readers) {
            if (state.card) {
                try {
                    state.card.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
            }
        }
        this._readers.clear();

        if (this._context) {
            try {
                this._context.close();
            } catch {
                // Ignore close errors
            }
            this._context = null;
        }
    }

    /**
     * List currently known readers
     */
    listReaders(): Reader[] {
        if (!this._context || !this._context.isValid) {
            return [];
        }
        try {
            return this._context.listReaders();
        } catch {
            return [];
        }
    }

    /**
     * Get all currently connected cards
     * @returns Map of reader name to Card object
     */
    getCards(): Map<string, Card> {
        const cards = new Map<string, Card>();
        for (const [readerName, state] of this._readers) {
            if (state.card) {
                cards.set(readerName, state.card);
            }
        }
        return cards;
    }

    /**
     * Get the card connected to a specific reader
     * @param readerName The name of the reader
     * @returns The Card object if connected, or null
     */
    getCard(readerName: string): Card | null {
        const state = this._readers.get(readerName);
        return state?.card ?? null;
    }

    /**
     * Handle events from native monitor
     * Queues events to prevent race conditions when multiple events arrive concurrently
     */
    private _handleEvent(event: MonitorEvent): void {
        // Chain this event onto the queue to serialize processing
        this._eventQueue = this._eventQueue.then(() =>
            this._processEvent(event)
        );
    }

    /**
     * Process a single event (called sequentially via queue)
     */
    private async _processEvent(event: MonitorEvent): Promise<void> {
        if (!this._running) {
            return;
        }

        const { type, reader: readerName, state, atr } = event;

        switch (type) {
            case 'reader-attached':
                await this._handleReaderAttached(readerName, state, atr);
                break;

            case 'reader-detached':
                this._handleReaderDetached(readerName);
                break;

            case 'card-inserted':
                await this._handleCardInserted(readerName, state, atr);
                break;

            case 'card-removed':
                this._handleCardRemoved(readerName);
                break;

            case 'error':
                // readerName contains error message for error events
                this.emit('error', new Error(readerName));
                break;
        }
    }

    /**
     * Handle reader attached
     */
    private async _handleReaderAttached(
        readerName: string,
        state: number,
        atr: Buffer | null
    ): Promise<void> {
        // Initialize reader state
        this._readers.set(readerName, {
            hasCard: false,
            card: null,
        });

        // Create a reader-like object for the event
        const reader = {
            name: readerName,
            state: state,
            atr: atr,
        };

        this.emit('reader-attached', reader);

        // Check if card is already present
        if ((state & this._SCARD_STATE_PRESENT) !== 0) {
            await this._handleCardInserted(readerName, state, atr);
        }
    }

    /**
     * Handle reader detached
     */
    private _handleReaderDetached(readerName: string): void {
        const state = this._readers.get(readerName);

        // If card was connected, emit card-removed first
        if (state && state.hasCard) {
            this._handleCardRemoved(readerName);
        }

        this._readers.delete(readerName);

        const reader = { name: readerName };
        this.emit('reader-detached', reader);
    }

    /**
     * Handle card inserted
     */
    private async _handleCardInserted(
        readerName: string,
        eventState: number,
        atr: Buffer | null
    ): Promise<void> {
        let state = this._readers.get(readerName);
        if (!state) {
            state = { hasCard: false, card: null };
            this._readers.set(readerName, state);
        }

        state.hasCard = true;

        // Try to connect to the card
        try {
            const readers = this._context!.listReaders();
            const reader = readers.find((r) => r.name === readerName);

            if (reader) {
                let card: Card;
                try {
                    // First try with both T=0 and T=1 protocols
                    card = await reader.connect(
                        this._SCARD_SHARE_SHARED,
                        this._SCARD_PROTOCOL_T0 | this._SCARD_PROTOCOL_T1
                    );
                } catch (dualProtocolErr) {
                    // If dual protocol fails with unresponsive card error,
                    // fallback to T=0 only (issue #34)
                    if (isUnresponsiveCardError(dualProtocolErr as Error)) {
                        card = await reader.connect(
                            this._SCARD_SHARE_SHARED,
                            this._SCARD_PROTOCOL_T0
                        );
                    } else {
                        // Re-throw if it's a different error
                        throw dualProtocolErr;
                    }
                }

                state.card = card;

                this.emit('card-inserted', {
                    reader: { name: readerName, state: eventState, atr: atr },
                    card: card,
                });
            }
        } catch (err) {
            // Emit error but don't fail
            this.emit('error', err as Error);
        }
    }

    /**
     * Handle card removed
     */
    private _handleCardRemoved(readerName: string): void {
        const state = this._readers.get(readerName);
        if (!state) {
            return;
        }

        const card = state.card;
        state.hasCard = false;
        state.card = null;

        if (card) {
            try {
                card.disconnect();
            } catch {
                // Ignore - card is already removed
            }
        }

        this.emit('card-removed', {
            reader: { name: readerName },
            card: card,
        });
    }

    // Type-safe event emitter overrides
    on<K extends keyof DeviceEvents>(
        event: K,
        listener: DeviceEvents[K]
    ): this {
        return super.on(event, listener);
    }

    once<K extends keyof DeviceEvents>(
        event: K,
        listener: DeviceEvents[K]
    ): this {
        return super.once(event, listener);
    }

    off<K extends keyof DeviceEvents>(
        event: K,
        listener: DeviceEvents[K]
    ): this {
        return super.off(event, listener);
    }

    addListener<K extends keyof DeviceEvents>(
        event: K,
        listener: DeviceEvents[K]
    ): this {
        return super.addListener(event, listener);
    }

    removeListener<K extends keyof DeviceEvents>(
        event: K,
        listener: DeviceEvents[K]
    ): this {
        return super.removeListener(event, listener);
    }

    emit<K extends keyof DeviceEvents>(
        event: K,
        ...args: Parameters<DeviceEvents[K]>
    ): boolean {
        return super.emit(event, ...args);
    }
}
