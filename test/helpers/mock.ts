/**
 * Mock PC/SC implementation for testing without hardware
 */

import { Devices } from '../../lib/devices';
import type {
    Card,
    CardStatus,
    Context,
    ContextConstructor,
    MonitorEvent,
    Reader,
    ReaderMonitor,
    ReaderMonitorConstructor,
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
    private _protocol: number;
    private _atr: Buffer;
    private _responses: MockCardResponse[];
    private _connected = true;
    private _transmitDelay: number;
    private _controlDelay: number;
    private _transmitCount = 0;
    private _controlCount = 0;
    private _reconnectProtocol: number | null = null;
    _lastTransmitOptions: TransmitOptions = {};

    constructor(
        protocol: number,
        atr: Buffer,
        responses: MockCardResponse[] = [],
        options: MockCardOptions = {}
    ) {
        this._protocol = protocol;
        this._atr = atr;
        this._responses = responses;
        this._transmitDelay = options.transmitDelay || 0;
        this._controlDelay = options.controlDelay || 0;
    }

    get protocol(): number {
        return this._protocol;
    }

    /**
     * Set the protocol that will be returned on next reconnect
     */
    setReconnectProtocol(protocol: number): void {
        this._reconnectProtocol = protocol;
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
        // If a reconnect protocol was set, use it and update the card's protocol
        if (this._reconnectProtocol !== null) {
            this._protocol = this._reconnectProtocol;
            this._reconnectProtocol = null;
        }
        return this._protocol;
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
export function createMockDevices(mockAddon: MockAddon): typeof Devices {
    const { Context, ReaderMonitor } = mockAddon;

    /**
     * Creates a Devices class that uses the provided mock addon.
     * This is a subclass that exposes the internal monitor for testing.
     */
    class MockDevices extends Devices {
        constructor() {
            super({
                Context: Context as unknown as ContextConstructor,
                ReaderMonitor: ReaderMonitor as unknown as ReaderMonitorConstructor,
                SCARD_STATE_PRESENT: 0x20,
                SCARD_SHARE_SHARED: 2,
                SCARD_PROTOCOL_T0: 1,
                SCARD_PROTOCOL_T1: 2,
            });
        }
    }

    return MockDevices;
}

// Protocol constants for testing
export const SCARD_PROTOCOL_T0 = 1;
export const SCARD_PROTOCOL_T1 = 2;

export interface TestSetup {
    devices: InstanceType<typeof Devices>;
    context: MockContext;
    monitor: MockReaderMonitor;
    reader: MockReader;
    card: MockCard;
}

export interface TestSetupOptions {
    readerName?: string;
    cardProtocol?: number;
    cardAtr?: Buffer;
    cardResponses?: MockCardResponse[];
    ReaderClass?: new (name: string, card: MockCard | null) => MockReader;
}

/**
 * Create a complete test setup with mock devices, context, monitor, reader, and card.
 * Reduces boilerplate in unit tests.
 */
export function createTestSetup(options: TestSetupOptions = {}): TestSetup {
    const {
        readerName = 'Test Reader',
        cardProtocol = SCARD_PROTOCOL_T0,
        cardAtr = Buffer.from([0x3b, 0x8f]),
        cardResponses = [],
        ReaderClass = MockReader,
    } = options;

    const card = new MockCard(cardProtocol, cardAtr, cardResponses);
    const reader = new ReaderClass(readerName, card);
    const context = new MockContext();
    const monitor = new MockReaderMonitor();

    context.addReader(reader);
    monitor.attachReader(reader);

    const MockDevicesClass = createMockDevices({
        Context: function () {
            return context;
        } as unknown as new () => MockContext,
        ReaderMonitor: function () {
            return monitor;
        } as unknown as new () => MockReaderMonitor,
    });

    const devices = new MockDevicesClass();

    return { devices, context, monitor, reader, card };
}

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
