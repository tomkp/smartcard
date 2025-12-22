// @ts-check
'use strict';

const EventEmitter = require('events');
const addon = require('../build/Release/smartcard_napi.node');

/**
 * @typedef {import('./index').Reader} Reader
 * @typedef {import('./index').Card} Card
 * @typedef {import('./index').MonitorEvent} MonitorEvent
 * @typedef {import('./index').Context} ContextType
 * @typedef {import('./index').ReaderMonitor} ReaderMonitorType
 */

const { Context, ReaderMonitor } = addon;
const SCARD_STATE_PRESENT = addon.SCARD_STATE_PRESENT;
const SCARD_SHARE_SHARED = addon.SCARD_SHARE_SHARED;
const SCARD_PROTOCOL_T0 = addon.SCARD_PROTOCOL_T0;
const SCARD_PROTOCOL_T1 = addon.SCARD_PROTOCOL_T1;

/**
 * @typedef {Object} ReaderState
 * @property {boolean} hasCard
 * @property {Card|null} card
 */

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
 *
 * @extends EventEmitter
 */
class Devices extends EventEmitter {
    constructor() {
        super();
        /** @type {ReaderMonitorType|null} */
        this._monitor = null;
        /** @type {ContextType|null} */
        this._context = null;
        /** @type {boolean} */
        this._running = false;
        /** @type {Map<string, ReaderState>} */
        this._readers = new Map();
        /** @type {Promise<void>} Event queue to serialize event handling */
        this._eventQueue = Promise.resolve();
    }

    /**
     * Start monitoring for device changes
     */
    start() {
        if (this._running) {
            return;
        }

        try {
            // Create context for card connections
            this._context = new Context();

            // Create native monitor
            this._monitor = new ReaderMonitor();
            this._running = true;

            // Start native monitoring with callback
            this._monitor.start((event) => {
                this._handleEvent(event);
            });
        } catch (err) {
            this.emit('error', err);
        }
    }

    /**
     * Stop monitoring
     */
    stop() {
        this._running = false;

        if (this._monitor) {
            try {
                this._monitor.stop();
            } catch (err) {
                // Ignore stop errors
            }
            this._monitor = null;
        }

        // Disconnect any connected cards
        for (const [name, state] of this._readers) {
            if (state.card) {
                try {
                    state.card.disconnect();
                } catch (err) {
                    // Ignore disconnect errors
                }
            }
        }
        this._readers.clear();

        if (this._context) {
            try {
                this._context.close();
            } catch (err) {
                // Ignore close errors
            }
            this._context = null;
        }
    }

    /**
     * List currently known readers
     * @returns {Reader[]} Array of readers
     */
    listReaders() {
        if (!this._context || !this._context.isValid) {
            return [];
        }
        try {
            return this._context.listReaders();
        } catch (err) {
            return [];
        }
    }

    /**
     * Handle events from native monitor
     * Queues events to prevent race conditions when multiple events arrive concurrently
     * @param {MonitorEvent} event
     */
    _handleEvent(event) {
        // Chain this event onto the queue to serialize processing
        this._eventQueue = this._eventQueue.then(() => this._processEvent(event));
    }

    /**
     * Process a single event (called sequentially via queue)
     * @param {MonitorEvent} event
     * @returns {Promise<void>}
     */
    async _processEvent(event) {
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
     * @param {string} readerName
     * @param {number} state
     * @param {Buffer|null} atr
     * @returns {Promise<void>}
     */
    async _handleReaderAttached(readerName, state, atr) {
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
        if ((state & SCARD_STATE_PRESENT) !== 0) {
            await this._handleCardInserted(readerName, state, atr);
        }
    }

    /**
     * Handle reader detached
     * @param {string} readerName
     */
    _handleReaderDetached(readerName) {
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
     * @param {string} readerName
     * @param {number} eventState
     * @param {Buffer|null} atr
     * @returns {Promise<void>}
     */
    async _handleCardInserted(readerName, eventState, atr) {
        let state = this._readers.get(readerName);
        if (!state) {
            state = { hasCard: false, card: null };
            this._readers.set(readerName, state);
        }

        state.hasCard = true;

        // Try to connect to the card
        try {
            const readers = this._context.listReaders();
            const reader = readers.find(r => r.name === readerName);

            if (reader) {
                let card;
                try {
                    // First try with both T=0 and T=1 protocols
                    card = await reader.connect(
                        SCARD_SHARE_SHARED,
                        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
                    );
                } catch (dualProtocolErr) {
                    // If dual protocol fails (e.g., SCARD_W_UNRESPONSIVE_CARD),
                    // fallback to T=0 only (issue #34)
                    if (dualProtocolErr.message &&
                        dualProtocolErr.message.toLowerCase().includes('unresponsive')) {
                        card = await reader.connect(
                            SCARD_SHARE_SHARED,
                            SCARD_PROTOCOL_T0
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
            this.emit('error', err);
        }
    }

    /**
     * Handle card removed
     * @param {string} readerName
     */
    _handleCardRemoved(readerName) {
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
            } catch (err) {
                // Ignore - card is already removed
            }
        }

        this.emit('card-removed', {
            reader: { name: readerName },
            card: card,
        });
    }
}

module.exports = { Devices };
