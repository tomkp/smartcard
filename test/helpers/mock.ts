/**
 * Mock PC/SC implementation for testing without hardware
 */

import { EventEmitter } from 'events';
import type {
    Card,
    CardStatus,
    Context,
    MonitorEvent,
    Reader,
    ReaderMonitor,
    TransmitOptions,
} from '../../lib/types';

export interface MockCardResponse {
    command: Buffer | number[];
    response: Buffer | number[];
}

interface MockCardOptions {
    transmitDelay?: number;
    controlDelay?: number;
}

export class MockCard implements Card {
    readonly protocol: number;
    private _atr: Buffer;
    private _responses: MockCardResponse[];
    private _connected = true;
    private _transmitDelay: number;
    private _controlDelay: number;
    private _transmitCount = 0;
    private _controlCount = 0;
    _lastTransmitOptions: TransmitOptions = {};

    constructor(
        protocol: number,
        atr: Buffer,
        responses: MockCardResponse[] = [],
        options: MockCardOptions = {}
    ) {
        this.protocol = protocol;
        this._atr = atr;
        this._responses = responses;
        this._transmitDelay = options.transmitDelay || 0;
        this._controlDelay = options.controlDelay || 0;
    }

    get transmitCount(): number {
        return this._transmitCount;
    }

    get controlCount(): number {
        return this._controlCount;
    }

    get connected(): boolean {
        return this._connected;
    }

    get atr(): Buffer | null {
        return this._connected ? this._atr : null;
    }

    async transmit(
        command: Buffer | number[],
        options: TransmitOptions = {}
    ): Promise<Buffer> {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }

        this._transmitCount++;

        // Store options for testing
        this._lastTransmitOptions = options;

        // Simulate delay if configured
        if (this._transmitDelay > 0) {
            await new Promise((resolve) =>
                setTimeout(resolve, this._transmitDelay)
            );
        }

        const cmdBuffer = Buffer.isBuffer(command)
            ? command
            : Buffer.from(command);

        // Find matching response
        for (const { command: cmd, response } of this._responses) {
            const cmdMatch = Buffer.isBuffer(cmd) ? cmd : Buffer.from(cmd);
            if (cmdBuffer.equals(cmdMatch)) {
                return Buffer.isBuffer(response)
                    ? response
                    : Buffer.from(response);
            }
        }

        // Default: return success status (90 00)
        return Buffer.from([0x90, 0x00]);
    }

    async control(_code: number, _data?: Buffer | number[]): Promise<Buffer> {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }

        this._controlCount++;

        // Simulate delay if configured
        if (this._controlDelay > 0) {
            await new Promise((resolve) =>
                setTimeout(resolve, this._controlDelay)
            );
        }

        return Buffer.from([0x90, 0x00]);
    }

    getStatus(): CardStatus {
        if (!this._connected) {
            throw new Error('Card is not connected');
        }
        return {
            state: 0x34, // SCARD_STATE_PRESENT | SCARD_STATE_POWERED | SCARD_STATE_SPECIFIC
            protocol: this.protocol,
            atr: this._atr,
        };
    }

    disconnect(): void {
        this._connected = false;
    }

    async reconnect(
        _shareMode?: number,
        _protocol?: number,
        _init?: number
    ): Promise<number> {
        this._connected = true;
        return this.protocol;
    }
}

export class MockReader implements Reader {
    readonly name: string;
    protected _card: MockCard | null;
    protected _state: number;
    protected _connectAttempts = 0;

    constructor(name: string, card: MockCard | null = null) {
        this.name = name;
        this._card = card;
        this._state = card ? 0x122 : 0x12; // PRESENT or EMPTY
    }

    get state(): number {
        return this._state;
    }

    get atr(): Buffer | null {
        return this._card ? this._card.atr : null;
    }

    get connectAttempts(): number {
        return this._connectAttempts;
    }

    async connect(
        _shareMode?: number,
        _protocol?: number
    ): Promise<MockCard> {
        this._connectAttempts++;
        if (!this._card) {
            throw new Error('No card in reader');
        }
        return this._card;
    }

    insertCard(card: MockCard): void {
        this._card = card;
        this._state = 0x122;
    }

    removeCard(): void {
        if (this._card) {
            this._card.disconnect();
        }
        this._card = null;
        this._state = 0x12;
    }
}

export class MockContext implements Context {
    private _readers: MockReader[] = [];
    private _valid = true;

    get isValid(): boolean {
        return this._valid;
    }

    listReaders(): MockReader[] {
        if (!this._valid) {
            throw new Error('Context is not valid');
        }
        return [...this._readers];
    }

    async waitForChange(
        _readers?: Reader[],
        _timeout?: number
    ): Promise<null> {
        // In mock, just return null (no changes)
        return null;
    }

    cancel(): void {
        // No-op in mock
    }

    close(): void {
        this._valid = false;
    }

    addReader(reader: MockReader): void {
        this._readers.push(reader);
    }

    removeReader(name: string): void {
        this._readers = this._readers.filter((r) => r.name !== name);
    }
}

export class MockReaderMonitor implements ReaderMonitor {
    private _running = false;
    private _callback: ((event: MonitorEvent) => void) | null = null;
    private _readers: MockReader[] = [];

    get isRunning(): boolean {
        return this._running;
    }

    start(callback: (event: MonitorEvent) => void): void {
        if (this._running) {
            throw new Error('Monitor is already running');
        }
        this._callback = callback;
        this._running = true;

        // Emit events for existing readers
        for (const reader of this._readers) {
            this._emitEvent(
                'reader-attached',
                reader.name,
                reader.state,
                reader.atr
            );
        }
    }

    stop(): void {
        this._running = false;
        this._callback = null;
    }

    private _emitEvent(
        type: MonitorEvent['type'],
        readerName: string,
        state: number,
        atr: Buffer | null
    ): void {
        if (this._callback) {
            this._callback({ type, reader: readerName, state, atr });
        }
    }

    attachReader(reader: MockReader): void {
        this._readers.push(reader);
        if (this._running) {
            this._emitEvent(
                'reader-attached',
                reader.name,
                reader.state,
                reader.atr
            );
        }
    }

    detachReader(name: string): void {
        this._readers = this._readers.filter((r) => r.name !== name);
        if (this._running) {
            this._emitEvent('reader-detached', name, 0, null);
        }
    }

    insertCard(readerName: string, card: MockCard): void {
        const reader = this._readers.find((r) => r.name === readerName);
        if (reader) {
            reader.insertCard(card);
            if (this._running) {
                this._emitEvent(
                    'card-inserted',
                    readerName,
                    reader.state,
                    card.atr
                );
            }
        }
    }

    removeCard(readerName: string): void {
        const reader = this._readers.find((r) => r.name === readerName);
        if (reader) {
            reader.removeCard();
            if (this._running) {
                this._emitEvent('card-removed', readerName, reader.state, null);
            }
        }
    }
}

interface MockAddon {
    Context: new () => MockContext;
    ReaderMonitor: new () => MockReaderMonitor;
}

/**
 * Create a mock-enabled Devices class
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockDevices(mockAddon: MockAddon): any {
    const { Context, ReaderMonitor } = mockAddon;
    const SCARD_STATE_PRESENT = 0x20;
    const SCARD_SHARE_SHARED = 2;
    const SCARD_PROTOCOL_T0 = 1;
    const SCARD_PROTOCOL_T1 = 2;

    interface ReaderStateInternal {
        hasCard: boolean;
        card: Card | null;
    }

    class MockDevices extends EventEmitter {
        private _monitor: MockReaderMonitor | null = null;
        private _context: MockContext | null = null;
        private _running = false;
        private _readers = new Map<string, ReaderStateInternal>();
        private _eventQueue: Promise<void> = Promise.resolve();

        start(): void {
            if (this._running) return;

            try {
                this._context = new Context();
                this._monitor = new ReaderMonitor();
                this._running = true;
                this._monitor.start((event: MonitorEvent) =>
                    this._handleEvent(event)
                );
            } catch (err) {
                this.emit('error', err);
            }
        }

        stop(): void {
            this._running = false;
            if (this._monitor) {
                try {
                    this._monitor.stop();
                } catch {
                    // Ignore
                }
                this._monitor = null;
            }
            for (const [, state] of this._readers) {
                if (state.card) {
                    try {
                        state.card.disconnect();
                    } catch {
                        // Ignore
                    }
                }
            }
            this._readers.clear();
            if (this._context) {
                try {
                    this._context.close();
                } catch {
                    // Ignore
                }
                this._context = null;
            }
        }

        listReaders(): MockReader[] {
            if (!this._context || !this._context.isValid) return [];
            try {
                return this._context.listReaders();
            } catch {
                return [];
            }
        }

        private _handleEvent(event: MonitorEvent): void {
            this._eventQueue = this._eventQueue.then(() =>
                this._processEvent(event)
            );
        }

        private async _processEvent(event: MonitorEvent): Promise<void> {
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

        private async _handleReaderAttached(
            readerName: string,
            state: number,
            atr: Buffer | null
        ): Promise<void> {
            this._readers.set(readerName, { hasCard: false, card: null });
            this.emit('reader-attached', { name: readerName, state, atr });
            if ((state & SCARD_STATE_PRESENT) !== 0) {
                await this._handleCardInserted(readerName, state, atr);
            }
        }

        private _handleReaderDetached(readerName: string): void {
            const state = this._readers.get(readerName);
            if (state?.hasCard) this._handleCardRemoved(readerName);
            this._readers.delete(readerName);
            this.emit('reader-detached', { name: readerName });
        }

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

            try {
                const readers = this._context!.listReaders();
                const reader = readers.find((r) => r.name === readerName);
                if (reader) {
                    let card: Card;
                    try {
                        // First try with both T=0 and T=1 protocols
                        card = await reader.connect(
                            SCARD_SHARE_SHARED,
                            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
                        );
                    } catch (dualProtocolErr) {
                        // If dual protocol fails with "unresponsive", fallback to T=0 only
                        const err = dualProtocolErr as Error;
                        if (
                            err.message &&
                            err.message.toLowerCase().includes('unresponsive')
                        ) {
                            card = await reader.connect(
                                SCARD_SHARE_SHARED,
                                SCARD_PROTOCOL_T0
                            );
                        } else {
                            throw dualProtocolErr;
                        }
                    }
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

        private _handleCardRemoved(readerName: string): void {
            const state = this._readers.get(readerName);
            if (!state) return;
            const card = state.card;
            state.hasCard = false;
            state.card = null;
            if (card) {
                try {
                    card.disconnect();
                } catch {
                    // Ignore
                }
            }
            this.emit('card-removed', { reader: { name: readerName }, card });
        }

        get _mockMonitor(): MockReaderMonitor | null {
            return this._monitor;
        }
    }

    return MockDevices;
}

// Protocol constants for testing
export const SCARD_PROTOCOL_T0 = 1;
export const SCARD_PROTOCOL_T1 = 2;

/**
 * A mock reader that fails with "unresponsive" error on dual protocol (T0|T1)
 * but succeeds when connecting with T0 only (simulates issue #34 fallback)
 */
export class UnresponsiveDualProtocolReader extends MockReader {
    async connect(
        _shareMode?: number,
        protocol?: number
    ): Promise<MockCard> {
        this._connectAttempts++;
        if (!this._card) {
            throw new Error('No card in reader');
        }
        // If trying to connect with both protocols, fail with unresponsive
        if (protocol === (SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1)) {
            throw new Error('Card is unresponsive');
        }
        // T0 only should succeed
        return this._card;
    }
}

/**
 * A mock reader that always fails to connect with a non-unresponsive error
 */
export class FailingMockReader extends MockReader {
    private _errorMessage: string;

    constructor(
        name: string,
        card: MockCard | null = null,
        errorMessage = 'Connection failed'
    ) {
        super(name, card);
        this._errorMessage = errorMessage;
    }

    async connect(
        _shareMode?: number,
        _protocol?: number
    ): Promise<MockCard> {
        this._connectAttempts++;
        throw new Error(this._errorMessage);
    }
}

/**
 * A mock reader that delays before connecting (for testing timing scenarios)
 */
export class SlowMockReader extends MockReader {
    private _delay: number;

    constructor(name: string, card: MockCard | null = null, delay = 100) {
        super(name, card);
        this._delay = delay;
    }

    async connect(
        _shareMode?: number,
        _protocol?: number
    ): Promise<MockCard> {
        this._connectAttempts++;
        if (!this._card) {
            throw new Error('No card in reader');
        }
        await new Promise((resolve) => setTimeout(resolve, this._delay));
        return this._card;
    }
}

/**
 * A mock reader that fails on the first N connect attempts, then succeeds
 * Useful for testing retry logic
 */
export class IntermittentFailureMockReader extends MockReader {
    private _failureCount: number;
    private _errorMessage: string;

    constructor(
        name: string,
        card: MockCard | null = null,
        failureCount = 1,
        errorMessage = 'Temporary failure'
    ) {
        super(name, card);
        this._failureCount = failureCount;
        this._errorMessage = errorMessage;
    }

    async connect(
        _shareMode?: number,
        _protocol?: number
    ): Promise<MockCard> {
        this._connectAttempts++;
        if (!this._card) {
            throw new Error('No card in reader');
        }
        if (this._connectAttempts <= this._failureCount) {
            throw new Error(this._errorMessage);
        }
        return this._card;
    }
}

/**
 * A mock card that fails transmit after a certain number of commands
 * Simulates card removal during operation
 */
export class UnstableMockCard extends MockCard {
    private _failAfter: number;

    constructor(
        protocol: number,
        atr: Buffer,
        responses: MockCardResponse[] = [],
        failAfter = 3
    ) {
        super(protocol, atr, responses);
        this._failAfter = failAfter;
    }

    async transmit(
        command: Buffer | number[],
        options: TransmitOptions = {}
    ): Promise<Buffer> {
        if (!this.connected) {
            throw new Error('Card is not connected');
        }

        // Check before incrementing (parent will increment)
        if (this.transmitCount >= this._failAfter) {
            // Access parent's private _transmitCount via increment
            this.disconnect();
            throw new Error('Card was removed');
        }

        return super.transmit(command, options);
    }
}
