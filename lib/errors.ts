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
 * Error thrown when PC/SC service is not running (SCARD_E_NO_SERVICE), or
 * stopped while in use (SCARD_E_SERVICE_STOPPED)
 */
export class ServiceNotRunningError extends PCSCError {
    constructor(message = 'PC/SC service not running', code = 0x8010001d) {
        super(message, code);
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

type PCSCErrorConstructor = new (message?: string, code?: number) => PCSCError;

export const SCARD_W_UNRESPONSIVE_CARD = 0x80100066;

/**
 * PC/SC error codes mapped to specific error classes
 */
const ERROR_CODE_MAP = new Map<number, PCSCErrorConstructor>([
    [0x80100069, CardRemovedError], // SCARD_W_REMOVED_CARD
    [0x8010000a, TimeoutError], // SCARD_E_TIMEOUT
    [0x8010002e, NoReadersError], // SCARD_E_NO_READERS_AVAILABLE
    [0x8010001d, ServiceNotRunningError], // SCARD_E_NO_SERVICE
    [0x8010001e, ServiceNotRunningError], // SCARD_E_SERVICE_STOPPED
    [0x8010000b, SharingViolationError], // SCARD_E_SHARING_VIOLATION
]);

/**
 * Factory function to create the appropriate error class based on PC/SC error code
 */
export function createPCSCError(message: string, code: number): PCSCError {
    // Accept codes as either signed or unsigned 32-bit values
    const ucode = code >>> 0;
    const ErrorClass = ERROR_CODE_MAP.get(ucode);
    if (ErrorClass) {
        return new ErrorClass(message, ucode);
    }
    return new PCSCError(message, ucode);
}

/**
 * The PC/SC error code an error carries, as an unsigned value, or undefined
 * if it has none. Only codes in the PC/SC facility (0x8010xxxx) count: other
 * libraries' errors (DOMException, gRPC, ...) also have numeric codes.
 */
export function getPCSCErrorCode(err: unknown): number | undefined {
    if (!(err instanceof Error)) {
        return undefined;
    }
    const code = (err as Error & { code?: unknown }).code;
    if (typeof code !== 'number' || !Number.isInteger(code) || code >>> 16 !== 0x8010) {
        return undefined;
    }
    return code >>> 0;
}

/**
 * Normalize an error into the typed hierarchy.
 *
 * The native layer already throws typed errors; this upgrades any other
 * Error carrying a PC/SC `code` and wraps non-Error values. Everything else
 * passes through unchanged.
 */
export function toPCSCError(err: unknown): Error {
    if (err instanceof PCSCError) {
        return err;
    }
    const code = getPCSCErrorCode(err);
    if (code !== undefined) {
        return createPCSCError((err as Error).message, code);
    }
    return err instanceof Error ? err : new Error(String(err));
}
