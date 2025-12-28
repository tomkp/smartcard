// Load native addon
const addon = require('../../build/Release/smartcard_napi.node') as import('./types').NativeAddon;

// Re-export native classes
export const Context =
    addon.Context as import('./types').ContextConstructor;
export const Reader = addon.Reader;
export const Card = addon.Card;
export const ReaderMonitor =
    addon.ReaderMonitor as import('./types').ReaderMonitorConstructor;

// Re-export constants
export const SCARD_SHARE_EXCLUSIVE = addon.SCARD_SHARE_EXCLUSIVE;
export const SCARD_SHARE_SHARED = addon.SCARD_SHARE_SHARED;
export const SCARD_SHARE_DIRECT = addon.SCARD_SHARE_DIRECT;

export const SCARD_PROTOCOL_T0 = addon.SCARD_PROTOCOL_T0;
export const SCARD_PROTOCOL_T1 = addon.SCARD_PROTOCOL_T1;
export const SCARD_PROTOCOL_RAW = addon.SCARD_PROTOCOL_RAW;
export const SCARD_PROTOCOL_UNDEFINED = addon.SCARD_PROTOCOL_UNDEFINED;

export const SCARD_LEAVE_CARD = addon.SCARD_LEAVE_CARD;
export const SCARD_RESET_CARD = addon.SCARD_RESET_CARD;
export const SCARD_UNPOWER_CARD = addon.SCARD_UNPOWER_CARD;
export const SCARD_EJECT_CARD = addon.SCARD_EJECT_CARD;

export const SCARD_STATE_UNAWARE = addon.SCARD_STATE_UNAWARE;
export const SCARD_STATE_IGNORE = addon.SCARD_STATE_IGNORE;
export const SCARD_STATE_CHANGED = addon.SCARD_STATE_CHANGED;
export const SCARD_STATE_UNKNOWN = addon.SCARD_STATE_UNKNOWN;
export const SCARD_STATE_UNAVAILABLE = addon.SCARD_STATE_UNAVAILABLE;
export const SCARD_STATE_EMPTY = addon.SCARD_STATE_EMPTY;
export const SCARD_STATE_PRESENT = addon.SCARD_STATE_PRESENT;
export const SCARD_STATE_ATRMATCH = addon.SCARD_STATE_ATRMATCH;
export const SCARD_STATE_EXCLUSIVE = addon.SCARD_STATE_EXCLUSIVE;
export const SCARD_STATE_INUSE = addon.SCARD_STATE_INUSE;
export const SCARD_STATE_MUTE = addon.SCARD_STATE_MUTE;

// Import and re-export Devices class
export { Devices } from './devices';

// Import and re-export error classes
export {
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    createPCSCError,
} from './errors';

// Import and re-export control codes
export {
    SCARD_CTL_CODE,
    CM_IOCTL_GET_FEATURE_REQUEST,
    FEATURE_VERIFY_PIN_START,
    FEATURE_VERIFY_PIN_FINISH,
    FEATURE_MODIFY_PIN_START,
    FEATURE_MODIFY_PIN_FINISH,
    FEATURE_GET_KEY_PRESSED,
    FEATURE_VERIFY_PIN_DIRECT,
    FEATURE_MODIFY_PIN_DIRECT,
    FEATURE_MCT_READER_DIRECT,
    FEATURE_MCT_UNIVERSAL,
    FEATURE_IFD_PIN_PROPERTIES,
    FEATURE_ABORT,
    FEATURE_SET_SPE_MESSAGE,
    FEATURE_VERIFY_PIN_DIRECT_APP_ID,
    FEATURE_MODIFY_PIN_DIRECT_APP_ID,
    FEATURE_WRITE_DISPLAY,
    FEATURE_GET_KEY,
    FEATURE_IFD_DISPLAY_PROPERTIES,
    FEATURE_GET_TLV_PROPERTIES,
    FEATURE_CCID_ESC_COMMAND,
    parseFeatures,
} from './control-codes';

// Re-export types
export type {
    ReaderState,
    CardStatus,
    TransmitOptions,
    Card as CardInterface,
    Reader as ReaderInterface,
    Context as ContextInterface,
    MonitorEvent,
    ReaderMonitor as ReaderMonitorInterface,
    DeviceEvents,
} from './types';
