// @ts-check
'use strict';

// Load native addon
const addon = require('../build/Release/smartcard_napi.node');

// Re-export native classes
const { Context, Reader, Card, ReaderMonitor } = addon;

// Re-export constants
const SCARD_SHARE_EXCLUSIVE = addon.SCARD_SHARE_EXCLUSIVE;
const SCARD_SHARE_SHARED = addon.SCARD_SHARE_SHARED;
const SCARD_SHARE_DIRECT = addon.SCARD_SHARE_DIRECT;

const SCARD_PROTOCOL_T0 = addon.SCARD_PROTOCOL_T0;
const SCARD_PROTOCOL_T1 = addon.SCARD_PROTOCOL_T1;
const SCARD_PROTOCOL_RAW = addon.SCARD_PROTOCOL_RAW;
const SCARD_PROTOCOL_UNDEFINED = addon.SCARD_PROTOCOL_UNDEFINED;

const SCARD_LEAVE_CARD = addon.SCARD_LEAVE_CARD;
const SCARD_RESET_CARD = addon.SCARD_RESET_CARD;
const SCARD_UNPOWER_CARD = addon.SCARD_UNPOWER_CARD;
const SCARD_EJECT_CARD = addon.SCARD_EJECT_CARD;

const SCARD_STATE_UNAWARE = addon.SCARD_STATE_UNAWARE;
const SCARD_STATE_IGNORE = addon.SCARD_STATE_IGNORE;
const SCARD_STATE_CHANGED = addon.SCARD_STATE_CHANGED;
const SCARD_STATE_UNKNOWN = addon.SCARD_STATE_UNKNOWN;
const SCARD_STATE_UNAVAILABLE = addon.SCARD_STATE_UNAVAILABLE;
const SCARD_STATE_EMPTY = addon.SCARD_STATE_EMPTY;
const SCARD_STATE_PRESENT = addon.SCARD_STATE_PRESENT;
const SCARD_STATE_ATRMATCH = addon.SCARD_STATE_ATRMATCH;
const SCARD_STATE_EXCLUSIVE = addon.SCARD_STATE_EXCLUSIVE;
const SCARD_STATE_INUSE = addon.SCARD_STATE_INUSE;
const SCARD_STATE_MUTE = addon.SCARD_STATE_MUTE;

// Import Devices class
const { Devices } = require('./devices');

// Import error classes
const {
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    createPCSCError,
} = require('./errors');

module.exports = {
    // Classes
    Context,
    Reader,
    Card,
    Devices,
    ReaderMonitor,

    // Error classes
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    createPCSCError,

    // Share modes
    SCARD_SHARE_EXCLUSIVE,
    SCARD_SHARE_SHARED,
    SCARD_SHARE_DIRECT,

    // Protocols
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_PROTOCOL_RAW,
    SCARD_PROTOCOL_UNDEFINED,

    // Disposition
    SCARD_LEAVE_CARD,
    SCARD_RESET_CARD,
    SCARD_UNPOWER_CARD,
    SCARD_EJECT_CARD,

    // State flags
    SCARD_STATE_UNAWARE,
    SCARD_STATE_IGNORE,
    SCARD_STATE_CHANGED,
    SCARD_STATE_UNKNOWN,
    SCARD_STATE_UNAVAILABLE,
    SCARD_STATE_EMPTY,
    SCARD_STATE_PRESENT,
    SCARD_STATE_ATRMATCH,
    SCARD_STATE_EXCLUSIVE,
    SCARD_STATE_INUSE,
    SCARD_STATE_MUTE,
};
