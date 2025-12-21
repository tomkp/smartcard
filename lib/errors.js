// @ts-check
'use strict';

/**
 * Base error class for PC/SC errors
 */
class PCSCError extends Error {
    /**
     * @param {string} message
     * @param {number} code
     */
    constructor(message, code) {
        super(message);
        this.name = 'PCSCError';
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error thrown when a card is removed during an operation
 */
class CardRemovedError extends PCSCError {
    constructor(message = 'Card was removed') {
        super(message, 0x80100069);
        this.name = 'CardRemovedError';
    }
}

/**
 * Error thrown when an operation times out
 */
class TimeoutError extends PCSCError {
    constructor(message = 'Operation timed out') {
        super(message, 0x8010000A);
        this.name = 'TimeoutError';
    }
}

/**
 * Error thrown when no readers are available
 */
class NoReadersError extends PCSCError {
    constructor(message = 'No readers available') {
        super(message, 0x8010002E);
        this.name = 'NoReadersError';
    }
}

/**
 * Error thrown when PC/SC service is not running
 */
class ServiceNotRunningError extends PCSCError {
    constructor(message = 'PC/SC service not running') {
        super(message, 0x8010001D);
        this.name = 'ServiceNotRunningError';
    }
}

/**
 * Error thrown when there's a sharing violation
 */
class SharingViolationError extends PCSCError {
    constructor(message = 'Sharing violation - card is in use') {
        super(message, 0x8010000B);
        this.name = 'SharingViolationError';
    }
}

module.exports = {
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
};
