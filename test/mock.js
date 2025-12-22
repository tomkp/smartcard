// @ts-check
'use strict';

/**
 * Mock PC/SC implementation for testing without hardware
 */

/**
 * @typedef {Object} MockReaderConfig
 * @property {string} name - Reader name
 * @property {boolean} [hasCard] - Whether a card is present
 * @property {Buffer} [atr] - Card ATR if present
 * @property {number} [protocol] - Card protocol (1=T0, 2=T1)
 */

/**
 * @typedef {Object} MockCardResponse
 * @property {Buffer|number[]} command - APDU command to match
 * @property {Buffer|number[]} response - Response to return
 */

class MockCard {
    /**
     * @param {number} protocol
     * @param {Buffer} atr
     * @param {MockCardResponse[]} responses
     */
    constructor(protocol, atr, responses = []) {
        this.protocol = protocol;
        this._atr = atr;
        this._responses = responses;
        this._connected = true;
    }

    get connected() {
        return this._connected;
    }

    get atr() {
        return this._connected ? this._atr : null;
    }

    /**
     * @param {Buffer|number[]} command
     * @returns {Promise<Buffer>}
     */
    async transmit(command) {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }

        const cmdBuffer = Buffer.isBuffer(command) ? command : Buffer.from(command);

        // Find matching response
        for (const { command: cmd, response } of this._responses) {
            const cmdMatch = Buffer.isBuffer(cmd) ? cmd : Buffer.from(cmd);
            if (cmdBuffer.equals(cmdMatch)) {
                return Buffer.isBuffer(response) ? response : Buffer.from(response);
            }
        }

        // Default: return success status (90 00)
        return Buffer.from([0x90, 0x00]);
    }

    /**
     * @param {number} code
     * @param {Buffer} [data]
     * @returns {Promise<Buffer>}
     */
    async control(code, data) {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }
        return Buffer.from([0x90, 0x00]);
    }

    getStatus() {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }
        return {
            state: 0x34, // SCARD_STATE_PRESENT | SCARD_STATE_POWERED | SCARD_STATE_SPECIFIC
            protocol: this.protocol,
            atr: this._atr,
        };
    }

    disconnect() {
        this._connected = false;
    }

    /**
     * @param {number} [shareMode]
     * @param {number} [protocol]
     * @param {number} [init]
     */
    reconnect(shareMode, protocol, init) {
        this._connected = true;
        return this.protocol;
    }
}

class MockReader {
    /**
     * @param {string} name
     * @param {MockCard|null} card
     */
    constructor(name, card = null) {
        this.name = name;
        this._card = card;
        this._state = card ? 0x122 : 0x12; // PRESENT or EMPTY
    }

    get state() {
        return this._state;
    }

    get atr() {
        return this._card ? this._card.atr : null;
    }

    /**
     * @param {number} [shareMode]
     * @param {number} [protocol]
     * @returns {Promise<MockCard>}
     */
    async connect(shareMode, protocol) {
        if (!this._card) {
            throw new Error('No card in reader');
        }
        return this._card;
    }

    /**
     * Insert a card into the reader
     * @param {MockCard} card
     */
    insertCard(card) {
        this._card = card;
        this._state = 0x122;
    }

    /**
     * Remove the card from the reader
     */
    removeCard() {
        if (this._card) {
            this._card.disconnect();
        }
        this._card = null;
        this._state = 0x12;
    }
}

class MockContext {
    constructor() {
        /** @type {MockReader[]} */
        this._readers = [];
        this._valid = true;
    }

    get isValid() {
        return this._valid;
    }

    /**
     * @returns {MockReader[]}
     */
    listReaders() {
        if (!this._valid) {
            throw new Error('Context is not valid');
        }
        return [...this._readers];
    }

    /**
     * @param {MockReader[]} [readers]
     * @param {number} [timeout]
     * @returns {Promise<Object[]|null>}
     */
    async waitForChange(readers, timeout) {
        // In mock, just return empty (no changes)
        return [];
    }

    cancel() {
        // No-op in mock
    }

    close() {
        this._valid = false;
    }

    /**
     * Add a reader to the mock context
     * @param {MockReader} reader
     */
    addReader(reader) {
        this._readers.push(reader);
    }

    /**
     * Remove a reader from the mock context
     * @param {string} name
     */
    removeReader(name) {
        this._readers = this._readers.filter(r => r.name !== name);
    }
}

class MockReaderMonitor {
    constructor() {
        this._running = false;
        this._callback = null;
        /** @type {MockReader[]} */
        this._readers = [];
    }

    get isRunning() {
        return this._running;
    }

    /**
     * @param {Function} callback
     */
    start(callback) {
        if (this._running) {
            throw new Error('Monitor is already running');
        }
        this._callback = callback;
        this._running = true;

        // Emit events for existing readers
        for (const reader of this._readers) {
            this._emitEvent('reader-attached', reader.name, reader.state, reader.atr);
        }
    }

    stop() {
        this._running = false;
        this._callback = null;
    }

    /**
     * @param {string} type
     * @param {string} readerName
     * @param {number} state
     * @param {Buffer|null} atr
     */
    _emitEvent(type, readerName, state, atr) {
        if (this._callback) {
            this._callback({ type, reader: readerName, state, atr });
        }
    }

    /**
     * Simulate attaching a reader
     * @param {MockReader} reader
     */
    attachReader(reader) {
        this._readers.push(reader);
        if (this._running) {
            this._emitEvent('reader-attached', reader.name, reader.state, reader.atr);
        }
    }

    /**
     * Simulate detaching a reader
     * @param {string} name
     */
    detachReader(name) {
        this._readers = this._readers.filter(r => r.name !== name);
        if (this._running) {
            this._emitEvent('reader-detached', name, 0, null);
        }
    }

    /**
     * Simulate inserting a card
     * @param {string} readerName
     * @param {MockCard} card
     */
    insertCard(readerName, card) {
        const reader = this._readers.find(r => r.name === readerName);
        if (reader) {
            reader.insertCard(card);
            if (this._running) {
                this._emitEvent('card-inserted', readerName, reader.state, card.atr);
            }
        }
    }

    /**
     * Simulate removing a card
     * @param {string} readerName
     */
    removeCard(readerName) {
        const reader = this._readers.find(r => r.name === readerName);
        if (reader) {
            reader.removeCard();
            if (this._running) {
                this._emitEvent('card-removed', readerName, reader.state, null);
            }
        }
    }
}

/**
 * Create a mock-enabled Devices class
 * @param {Object} mockAddon - Mock addon with Context and ReaderMonitor
 * @returns {typeof import('../lib/devices').Devices}
 */
function createMockDevices(mockAddon) {
    const EventEmitter = require('events');

    const { Context, ReaderMonitor } = mockAddon;
    const SCARD_STATE_PRESENT = 0x20;
    const SCARD_SHARE_SHARED = 2;
    const SCARD_PROTOCOL_T0 = 1;
    const SCARD_PROTOCOL_T1 = 2;

    class MockDevices extends EventEmitter {
        constructor() {
            super();
            this._monitor = null;
            this._context = null;
            this._running = false;
            this._readers = new Map();
            this._eventQueue = Promise.resolve();
        }

        start() {
            if (this._running) return;

            try {
                this._context = new Context();
                this._monitor = new ReaderMonitor();
                this._running = true;
                this._monitor.start((event) => this._handleEvent(event));
            } catch (err) {
                this.emit('error', err);
            }
        }

        stop() {
            this._running = false;
            if (this._monitor) {
                try { this._monitor.stop(); } catch (e) {}
                this._monitor = null;
            }
            for (const [, state] of this._readers) {
                if (state.card) {
                    try { state.card.disconnect(); } catch (e) {}
                }
            }
            this._readers.clear();
            if (this._context) {
                try { this._context.close(); } catch (e) {}
                this._context = null;
            }
        }

        listReaders() {
            if (!this._context || !this._context.isValid) return [];
            try { return this._context.listReaders(); } catch (e) { return []; }
        }

        _handleEvent(event) {
            this._eventQueue = this._eventQueue.then(() => this._processEvent(event));
        }

        async _processEvent(event) {
            if (!this._running) return;
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
                    this.emit('error', new Error(readerName));
                    break;
            }
        }

        async _handleReaderAttached(readerName, state, atr) {
            this._readers.set(readerName, { hasCard: false, card: null });
            this.emit('reader-attached', { name: readerName, state, atr });
            if ((state & SCARD_STATE_PRESENT) !== 0) {
                await this._handleCardInserted(readerName, state, atr);
            }
        }

        _handleReaderDetached(readerName) {
            const state = this._readers.get(readerName);
            if (state?.hasCard) this._handleCardRemoved(readerName);
            this._readers.delete(readerName);
            this.emit('reader-detached', { name: readerName });
        }

        async _handleCardInserted(readerName, eventState, atr) {
            let state = this._readers.get(readerName);
            if (!state) {
                state = { hasCard: false, card: null };
                this._readers.set(readerName, state);
            }
            state.hasCard = true;

            try {
                const readers = this._context.listReaders();
                const reader = readers.find(r => r.name === readerName);
                if (reader) {
                    const card = await reader.connect(SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1);
                    state.card = card;
                    this.emit('card-inserted', {
                        reader: { name: readerName, state: eventState, atr },
                        card,
                    });
                }
            } catch (err) {
                this.emit('error', err);
            }
        }

        _handleCardRemoved(readerName) {
            const state = this._readers.get(readerName);
            if (!state) return;
            const card = state.card;
            state.hasCard = false;
            state.card = null;
            if (card) try { card.disconnect(); } catch (e) {}
            this.emit('card-removed', { reader: { name: readerName }, card });
        }

        /** @returns {MockReaderMonitor|null} */
        get _mockMonitor() {
            return this._monitor;
        }
    }

    return MockDevices;
}

module.exports = {
    MockCard,
    MockReader,
    MockContext,
    MockReaderMonitor,
    createMockDevices,
};
