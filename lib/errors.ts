/**
 * Base error class for PC/SC errors
 */
export class PCSCError extends Error {
    readonly code: number;

    constructor(message: string, code: number) {
        super(message);
        this.name = 'PCSCError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error thrown when a card is removed during an operation
 */
export class CardRemovedError extends PCSCError {
    constructor(message = 'Card was removed') {
        super(message, 0x80100069);
        this.name = 'CardRemovedError';
    }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends PCSCError {
    constructor(message = 'Operation timed out') {
        super(message, 0x8010000a);
        this.name = 'TimeoutError';
    }
}

/**
 * Error thrown when no readers are available
 */
export class NoReadersError extends PCSCError {
    constructor(message = 'No readers available') {
        super(message, 0x8010002e);
        this.name = 'NoReadersError';
    }
}

/**
 * Error thrown when PC/SC service is not running
 */
export class ServiceNotRunningError extends PCSCError {
    constructor(message = 'PC/SC service not running') {
        super(message, 0x8010001d);
        this.name = 'ServiceNotRunningError';
    }
}

/**
 * Error thrown when there's a sharing violation
 */
export class SharingViolationError extends PCSCError {
    constructor(message = 'Sharing violation - card is in use') {
        super(message, 0x8010000b);
        this.name = 'SharingViolationError';
    }
}

type PCSCErrorConstructor = new (message?: string) => PCSCError;

/**
 * PC/SC error codes mapped to specific error classes
 */
const ERROR_CODE_MAP = new Map<number, PCSCErrorConstructor>([
    [0x80100069, CardRemovedError], // SCARD_W_REMOVED_CARD
    [0x8010000a, TimeoutError], // SCARD_E_TIMEOUT
    [0x8010002e, NoReadersError], // SCARD_E_NO_READERS_AVAILABLE
    [0x8010001d, ServiceNotRunningError], // SCARD_E_NO_SERVICE
    [0x8010000b, SharingViolationError], // SCARD_E_SHARING_VIOLATION
]);

/**
 * Factory function to create the appropriate error class based on PC/SC error code
 */
export function createPCSCError(message: string, code: number): PCSCError {
    const ErrorClass = ERROR_CODE_MAP.get(code);
    if (ErrorClass) {
        return new ErrorClass(message);
    }
    return new PCSCError(message, code);
}
