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
import { wrapCard } from './card-wrapper';
import {
    createPCSCError,
    isUnresponsiveCardError,
    toPCSCError,
} from './errors';

const addon = require('../../build/Release/smartcard_napi.node') as NativeAddon;

interface ReaderStateInternal {
    hasCard: boolean;
    card: Card | null;
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
    private _generation = 0;

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

            // A rejected queue from a previous session must not block this one
            this._eventQueue = Promise.resolve();

            // Create native monitor
            this._monitor = new this._ReaderMonitor();

            // Start native monitoring with callback. Events carry this
            // session's generation: a stopped monitor can still deliver
            // events it had queued, and after a same-tick stop()/start()
            // they would otherwise land in the new session.
            const generation = this._generation;
            this._monitor.start((event: MonitorEvent) => {
                if (generation === this._generation) {
                    this._handleEvent(event, generation);
                }
            });

            // Set only after everything succeeded, so a partial failure
            // leaves start() retryable. Events queue as microtasks, so none
            // is processed before this line runs.
            this._running = true;
        } catch (err) {
            // Roll back whatever was created so a later start() can succeed
            if (this._monitor) {
                try {
                    this._monitor.stop();
                } catch {
                    // Monitor never started
                }
                this._monitor = null;
            }
            if (this._context) {
                try {
                    this._context.close();
                } catch {
                    // Ignore close errors
                }
                this._context = null;
            }

            const error = toPCSCError(err);
            if (this.listenerCount('error') > 0) {
                this.emit('error', error);
            } else {
                // No listener: fail loudly to the caller instead of
                // silently doing nothing - but only after the rollback above
                throw error;
            }
        }
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        this._running = false;
        // Invalidate in-flight handlers parked on an await: a handler that
        // resumes after this stop (or a later restart) must not touch state
        this._generation++;

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
        try {
            return this._ensureContext()?.listReaders() ?? [];
        } catch {
            return [];
        }
    }

    /**
     * Get all currently connected cards
     * @returns ReadonlyMap of reader name to Card object
     */
    getCards(): ReadonlyMap<string, Card> {
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
    private _handleEvent(event: MonitorEvent, generation: number): void {
        // Chain this event onto the queue to serialize processing. The catch
        // keeps the chain alive: a rejected link would otherwise silently
        // stop all future event processing.
        this._eventQueue = this._eventQueue
            .then(() => this._processEvent(event, generation))
            .catch((err) => this._safeEmitError(err));
    }

    /**
     * Emit an error without killing the event pump: with no 'error' listener
     * EventEmitter throws, which would reject the event queue and stop all
     * future event processing.
     */
    private _safeEmitError(err: unknown): void {
        if (this.listenerCount('error') > 0) {
            this.emit('error', toPCSCError(err));
        }
    }

    /**
     * Process a single event (called sequentially via queue)
     */
    private async _processEvent(
        event: MonitorEvent,
        generation: number
    ): Promise<void> {
        // Dropped once monitoring stopped, even if it has started again:
        // the event belongs to the earlier session
        if (!this._isCurrent(generation)) {
            return;
        }

        const { type, reader: readerName, state, atr, code } = event;

        switch (type) {
            case 'reader-attached':
                await this._handleReaderAttached(readerName, state, atr, generation);
                break;

            case 'reader-detached':
                this._handleReaderDetached(readerName);
                break;

            case 'card-inserted':
                await this._handleCardInserted(readerName, state, atr, generation);
                break;

            case 'card-removed':
                this._handleCardRemoved(readerName);
                break;

            case 'monitor-recovered':
                // The native monitor re-established its PC/SC context after a
                // service restart; ours died with the same restart - replace it.
                this._recreateContext();
                break;

            case 'error':
                // readerName contains error message for error events
                this._safeEmitError(
                    code !== undefined
                        ? createPCSCError(readerName, code)
                        : new Error(readerName)
                );
                break;
        }
    }

    /**
     * Replace the PC/SC context after the native monitor recovered from a
     * service restart (the old handle is dead).
     */
    private _recreateContext(): void {
        if (this._context) {
            try {
                this._context.close();
            } catch {
                // Dead context - nothing left to release
            }
        }
        this._context = null;
        try {
            this._ensureContext();
        } catch (err) {
            // _ensureContext() tries again when a context is next needed
            this._safeEmitError(err);
        }
    }

    /**
     * The context for listing readers and connecting cards, created here
     * if replacing it after a service outage failed: one failure must not
     * leave Devices without a context until it is restarted. None while
     * not running, so a handler that outlives its session can't open one.
     */
    private _ensureContext(): Context | null {
        if (!this._running) {
            return null;
        }
        if (!this._context) {
            this._context = new this._Context();
        }
        return this._context;
    }

    /**
     * Whether an event of this generation still belongs to the running
     * session. A listener can stop (and restart) Devices while a handler
     * is part-way through, so handlers check again after every emit and
     * await.
     */
    private _isCurrent(generation: number): boolean {
        return this._running && this._generation === generation;
    }

    /**
     * Handle reader attached
     */
    private async _handleReaderAttached(
        readerName: string,
        state: number,
        atr: Buffer | null,
        generation: number
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
            await this._handleCardInserted(readerName, state, atr, generation);
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
        atr: Buffer | null,
        generation: number
    ): Promise<void> {
        // A 'reader-attached' listener may have stopped Devices
        if (!this._isCurrent(generation)) {
            return;
        }

        let state = this._readers.get(readerName);
        if (!state) {
            state = { hasCard: false, card: null };
            this._readers.set(readerName, state);
        }

        state.hasCard = true;

        // Try to connect to the card
        try {
            // The reader list can lag the monitor event during PnP churn -
            // retry briefly before giving up (Issue #117)
            let reader: Reader | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    // Bail if monitoring stopped or restarted while we slept
                    if (!this._isCurrent(generation)) {
                        return;
                    }
                }
                const readers = this._ensureContext()?.listReaders() ?? [];
                reader = readers.find((r) => r.name === readerName);
                if (reader) {
                    break;
                }
            }

            if (!reader) {
                // Reader vanished mid-churn: leave no half-state behind - the
                // queued reader-detached will finish the cleanup
                state.hasCard = false;
                return;
            }

            let nativeCard: Card;
            try {
                // First try with both T=0 and T=1 protocols
                nativeCard = await reader.connect(
                    this._SCARD_SHARE_SHARED,
                    this._SCARD_PROTOCOL_T0 | this._SCARD_PROTOCOL_T1
                );
            } catch (dualProtocolErr) {
                // If dual protocol fails with unresponsive card error,
                // fallback to T=0 only (issue #34)
                if (isUnresponsiveCardError(dualProtocolErr as Error)) {
                    nativeCard = await reader.connect(
                        this._SCARD_SHARE_SHARED,
                        this._SCARD_PROTOCOL_T0
                    );
                } else {
                    // Re-throw if it's a different error
                    throw dualProtocolErr;
                }
            }

            if (!this._isCurrent(generation)) {
                // stop() ran while connect was in flight - it cannot see this
                // card, so release the handle here
                try {
                    nativeCard.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
                return;
            }

            // Wrap the native card to add autoGetResponse support
            const card = wrapCard(nativeCard);
            state.card = card;

            this.emit('card-inserted', {
                reader: { name: readerName, state: eventState, atr: atr },
                card: card,
            });
        } catch (err) {
            // Emit error but don't fail
            this._safeEmitError(err);
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
