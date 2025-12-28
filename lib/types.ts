/**
 * Type definitions for the native PC/SC addon
 */

/**
 * Reader state information returned from waitForChange
 */
export interface ReaderState {
    name: string;
    state: number;
    changed: boolean;
    atr: Buffer | null;
}

/**
 * Card status information
 */
export interface CardStatus {
    state: number;
    protocol: number;
    atr: Buffer;
}

/**
 * Options for card.transmit()
 */
export interface TransmitOptions {
    /**
     * Maximum receive buffer size in bytes.
     * Default: 258 (standard APDU: 256 data + 2 status bytes)
     * Maximum: 262144 (256KB for extended APDUs)
     */
    maxRecvLength?: number;
}

/**
 * Represents a connected smart card
 */
export interface Card {
    /** The active protocol (T0, T1, or RAW) */
    readonly protocol: number;
    /** Whether the card is still connected */
    readonly connected: boolean;
    /** The card's ATR (Answer To Reset) */
    readonly atr: Buffer | null;

    /**
     * Transmit an APDU command to the card
     */
    transmit(
        command: Buffer | number[],
        options?: TransmitOptions
    ): Promise<Buffer>;

    /**
     * Send a control command to the reader
     */
    control(code: number, data?: Buffer | number[]): Promise<Buffer>;

    /**
     * Get the current card status
     */
    getStatus(): CardStatus;

    /**
     * Disconnect from the card
     */
    disconnect(disposition?: number): void;

    /**
     * Reconnect to the card (async)
     */
    reconnect(
        shareMode?: number,
        protocol?: number,
        initialization?: number
    ): Promise<number>;
}

/**
 * Represents a smart card reader
 */
export interface Reader {
    /** The reader name */
    readonly name: string;
    /** Current reader state flags */
    readonly state: number;
    /** ATR of the card if present */
    readonly atr: Buffer | null;

    /**
     * Connect to a card in the reader
     */
    connect(shareMode?: number, protocol?: number): Promise<Card>;
}

/**
 * Low-level PC/SC context
 */
export interface Context {
    /** Whether the context is still valid */
    readonly isValid: boolean;

    /**
     * List available readers
     */
    listReaders(): Reader[];

    /**
     * Wait for reader/card state changes
     */
    waitForChange(
        readers?: Reader[] | ReaderState[],
        timeout?: number
    ): Promise<ReaderState[] | null>;

    /**
     * Cancel a pending waitForChange call
     */
    cancel(): void;

    /**
     * Close the context and release resources
     */
    close(): void;
}

/**
 * Monitor event from native ReaderMonitor
 */
export interface MonitorEvent {
    type:
        | 'reader-attached'
        | 'reader-detached'
        | 'card-inserted'
        | 'card-removed'
        | 'error';
    reader: string;
    state: number;
    atr: Buffer | null;
}

/**
 * Native PC/SC event monitor using ThreadSafeFunction
 * Runs monitoring on a background thread for efficiency
 */
export interface ReaderMonitor {
    /** Whether the monitor is currently running */
    readonly isRunning: boolean;

    /**
     * Start monitoring for reader/card changes
     */
    start(callback: (event: MonitorEvent) => void): void;

    /**
     * Stop monitoring
     */
    stop(): void;
}

/**
 * Partial reader info emitted in device events
 */
export interface ReaderEventInfo {
    name: string;
    state?: number;
    atr?: Buffer | null;
}

/**
 * Event types for Devices class
 */
export interface DeviceEvents {
    'reader-attached': (reader: ReaderEventInfo) => void;
    'reader-detached': (reader: ReaderEventInfo) => void;
    'card-inserted': (event: { reader: ReaderEventInfo; card: Card }) => void;
    'card-removed': (event: {
        reader: ReaderEventInfo;
        card: Card | null;
    }) => void;
    error: (error: Error) => void;
}

/**
 * Constructor interfaces for native classes
 */
export interface ContextConstructor {
    new (): Context;
}

export interface ReaderMonitorConstructor {
    new (): ReaderMonitor;
}

/**
 * Native addon interface
 */
export interface NativeAddon {
    Context: ContextConstructor;
    Reader: unknown;
    Card: unknown;
    ReaderMonitor: ReaderMonitorConstructor;
    SCARD_SHARE_EXCLUSIVE: number;
    SCARD_SHARE_SHARED: number;
    SCARD_SHARE_DIRECT: number;
    SCARD_PROTOCOL_T0: number;
    SCARD_PROTOCOL_T1: number;
    SCARD_PROTOCOL_RAW: number;
    SCARD_PROTOCOL_UNDEFINED: number;
    SCARD_LEAVE_CARD: number;
    SCARD_RESET_CARD: number;
    SCARD_UNPOWER_CARD: number;
    SCARD_EJECT_CARD: number;
    SCARD_STATE_UNAWARE: number;
    SCARD_STATE_IGNORE: number;
    SCARD_STATE_CHANGED: number;
    SCARD_STATE_UNKNOWN: number;
    SCARD_STATE_UNAVAILABLE: number;
    SCARD_STATE_EMPTY: number;
    SCARD_STATE_PRESENT: number;
    SCARD_STATE_ATRMATCH: number;
    SCARD_STATE_EXCLUSIVE: number;
    SCARD_STATE_INUSE: number;
    SCARD_STATE_MUTE: number;
}
