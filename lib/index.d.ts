/// <reference types="node" />

import { EventEmitter } from 'events';

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
     * @param command - The command buffer or byte array
     * @returns Promise resolving to the response buffer
     */
    transmit(command: Buffer | number[]): Promise<Buffer>;

    /**
     * Send a control command to the reader
     * @param code - Control code
     * @param data - Optional data buffer
     * @returns Promise resolving to the response buffer
     */
    control(code: number, data?: Buffer | number[]): Promise<Buffer>;

    /**
     * Get the current card status
     * @returns Card status object
     */
    getStatus(): CardStatus;

    /**
     * Disconnect from the card
     * @param disposition - What to do with the card (default: SCARD_LEAVE_CARD)
     */
    disconnect(disposition?: number): void;

    /**
     * Reconnect to the card
     * @param shareMode - Share mode
     * @param protocol - Preferred protocol(s)
     * @param initialization - Initialization action
     * @returns The new active protocol
     */
    reconnect(shareMode?: number, protocol?: number, initialization?: number): number;
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
     * @param shareMode - Share mode (default: SCARD_SHARE_SHARED)
     * @param protocol - Preferred protocol(s) (default: T0 | T1)
     * @returns Promise resolving to a Card object
     */
    connect(shareMode?: number, protocol?: number): Promise<Card>;
}

/**
 * Low-level PC/SC context
 */
export declare class Context {
    constructor();

    /** Whether the context is still valid */
    readonly isValid: boolean;

    /**
     * List available readers
     * @returns Array of Reader objects
     */
    listReaders(): Reader[];

    /**
     * Wait for reader/card state changes
     * @param readers - Optional array of readers to monitor
     * @param timeout - Timeout in milliseconds (default: infinite)
     * @returns Promise resolving to array of reader states
     */
    waitForChange(readers?: Reader[] | ReaderState[], timeout?: number): Promise<ReaderState[] | null>;

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
    type: 'reader-attached' | 'reader-detached' | 'card-inserted' | 'card-removed' | 'error';
    reader: string;
    state: number;
    atr: Buffer | null;
}

/**
 * Native PC/SC event monitor using ThreadSafeFunction
 * Runs monitoring on a background thread for efficiency
 */
export declare class ReaderMonitor {
    constructor();

    /** Whether the monitor is currently running */
    readonly isRunning: boolean;

    /**
     * Start monitoring for reader/card changes
     * @param callback - Function called when events occur
     */
    start(callback: (event: MonitorEvent) => void): void;

    /**
     * Stop monitoring
     */
    stop(): void;
}

/**
 * Event types for Devices class
 */
export interface DeviceEvents {
    'reader-attached': (reader: Reader) => void;
    'reader-detached': (reader: Reader) => void;
    'card-inserted': (event: { reader: Reader; card: Card }) => void;
    'card-removed': (event: { reader: Reader; card: Card | null }) => void;
    'error': (error: Error) => void;
}

/**
 * High-level event-driven API for monitoring PC/SC devices
 */
export declare class Devices extends EventEmitter {
    constructor();

    /**
     * Start monitoring for device changes
     */
    start(): void;

    /**
     * Stop monitoring and release resources
     */
    stop(): void;

    /**
     * List currently known readers
     * @returns Array of Reader objects
     */
    listReaders(): Reader[];

    on<K extends keyof DeviceEvents>(event: K, listener: DeviceEvents[K]): this;
    once<K extends keyof DeviceEvents>(event: K, listener: DeviceEvents[K]): this;
    off<K extends keyof DeviceEvents>(event: K, listener: DeviceEvents[K]): this;
    emit<K extends keyof DeviceEvents>(event: K, ...args: Parameters<DeviceEvents[K]>): boolean;
}

/**
 * Base PC/SC error class
 */
export declare class PCSCError extends Error {
    readonly code: number;
    constructor(message: string, code: number);
}

/**
 * Error thrown when card is removed during operation
 */
export declare class CardRemovedError extends PCSCError {
    constructor(message?: string);
}

/**
 * Error thrown when operation times out
 */
export declare class TimeoutError extends PCSCError {
    constructor(message?: string);
}

/**
 * Error thrown when no readers are available
 */
export declare class NoReadersError extends PCSCError {
    constructor(message?: string);
}

/**
 * Error thrown when PC/SC service is not running
 */
export declare class ServiceNotRunningError extends PCSCError {
    constructor(message?: string);
}

/**
 * Error thrown when there's a sharing violation
 */
export declare class SharingViolationError extends PCSCError {
    constructor(message?: string);
}

/**
 * Factory function to create the appropriate error class based on PC/SC error code
 */
export declare function createPCSCError(message: string, code: number): PCSCError;

// Share modes
export declare const SCARD_SHARE_EXCLUSIVE: number;
export declare const SCARD_SHARE_SHARED: number;
export declare const SCARD_SHARE_DIRECT: number;

// Protocols
export declare const SCARD_PROTOCOL_T0: number;
export declare const SCARD_PROTOCOL_T1: number;
export declare const SCARD_PROTOCOL_RAW: number;
export declare const SCARD_PROTOCOL_UNDEFINED: number;

// Disposition
export declare const SCARD_LEAVE_CARD: number;
export declare const SCARD_RESET_CARD: number;
export declare const SCARD_UNPOWER_CARD: number;
export declare const SCARD_EJECT_CARD: number;

// State flags
export declare const SCARD_STATE_UNAWARE: number;
export declare const SCARD_STATE_IGNORE: number;
export declare const SCARD_STATE_CHANGED: number;
export declare const SCARD_STATE_UNKNOWN: number;
export declare const SCARD_STATE_UNAVAILABLE: number;
export declare const SCARD_STATE_EMPTY: number;
export declare const SCARD_STATE_PRESENT: number;
export declare const SCARD_STATE_ATRMATCH: number;
export declare const SCARD_STATE_EXCLUSIVE: number;
export declare const SCARD_STATE_INUSE: number;
export declare const SCARD_STATE_MUTE: number;
