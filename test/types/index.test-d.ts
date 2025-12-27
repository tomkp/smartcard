import { expectType, expectError, expectAssignable } from 'tsd';
import {
    Context,
    Devices,
    ReaderMonitor,
    Card,
    Reader,
    ReaderState,
    CardStatus,
    MonitorEvent,
    TransmitOptions,
    PCSCError,
    CardRemovedError,
    TimeoutError,
    NoReadersError,
    ServiceNotRunningError,
    SharingViolationError,
    createPCSCError,
    SCARD_SHARE_SHARED,
    SCARD_SHARE_EXCLUSIVE,
    SCARD_SHARE_DIRECT,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_PROTOCOL_RAW,
    SCARD_LEAVE_CARD,
    SCARD_STATE_PRESENT,
    SCARD_CTL_CODE,
    CM_IOCTL_GET_FEATURE_REQUEST,
    FEATURE_VERIFY_PIN_DIRECT,
    parseFeatures,
} from '../../lib';

// ============================================================================
// Context Tests
// ============================================================================

const ctx = new Context();
expectType<boolean>(ctx.isValid);
expectType<Reader[]>(ctx.listReaders());
expectType<void>(ctx.cancel());
expectType<void>(ctx.close());

// waitForChange returns ReaderState[] | null
const changeResult = ctx.waitForChange();
expectType<Promise<ReaderState[] | null>>(changeResult);

// ============================================================================
// Reader Tests
// ============================================================================

declare const reader: Reader;
expectType<string>(reader.name);
expectType<number>(reader.state);
expectType<Buffer | null>(reader.atr);

// connect returns Promise<Card>
const connectResult = reader.connect();
expectType<Promise<Card>>(connectResult);

// connect with parameters
const connectWithParams = reader.connect(SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1);
expectType<Promise<Card>>(connectWithParams);

// ============================================================================
// Card Tests
// ============================================================================

declare const card: Card;
expectType<number>(card.protocol);
expectType<boolean>(card.connected);
expectType<Buffer | null>(card.atr);

// transmit returns Promise<Buffer>
const transmitResult = card.transmit(Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]));
expectType<Promise<Buffer>>(transmitResult);

// transmit with array
const transmitArrayResult = card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
expectType<Promise<Buffer>>(transmitArrayResult);

// transmit with options
const transmitWithOptions = card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00], { maxRecvLength: 65536 });
expectType<Promise<Buffer>>(transmitWithOptions);

// control returns Promise<Buffer>
const controlResult = card.control(SCARD_CTL_CODE(3400));
expectType<Promise<Buffer>>(controlResult);

// getStatus returns CardStatus
expectType<CardStatus>(card.getStatus());

// disconnect
expectType<void>(card.disconnect());
expectType<void>(card.disconnect(SCARD_LEAVE_CARD));

// reconnect returns Promise<number>
const reconnectResult = card.reconnect();
expectType<Promise<number>>(reconnectResult);

// ============================================================================
// CardStatus Tests
// ============================================================================

declare const status: CardStatus;
expectType<number>(status.state);
expectType<number>(status.protocol);
expectType<Buffer>(status.atr);

// ============================================================================
// ReaderState Tests
// ============================================================================

declare const readerState: ReaderState;
expectType<string>(readerState.name);
expectType<number>(readerState.state);
expectType<boolean>(readerState.changed);
expectType<Buffer | null>(readerState.atr);

// ============================================================================
// TransmitOptions Tests
// ============================================================================

const options: TransmitOptions = { maxRecvLength: 1024 };
expectType<number | undefined>(options.maxRecvLength);

// ============================================================================
// ReaderMonitor Tests
// ============================================================================

const monitor = new ReaderMonitor();
expectType<boolean>(monitor.isRunning);
expectType<void>(monitor.stop());

// start with callback
monitor.start((event: MonitorEvent) => {
    expectType<'reader-attached' | 'reader-detached' | 'card-inserted' | 'card-removed' | 'error'>(event.type);
    expectType<string>(event.reader);
    expectType<number>(event.state);
    expectType<Buffer | null>(event.atr);
});

// ============================================================================
// Devices Tests
// ============================================================================

const devices = new Devices();
expectType<void>(devices.start());
expectType<void>(devices.stop());
expectType<Reader[]>(devices.listReaders());

// Event handlers
devices.on('reader-attached', (r) => {
    expectType<Reader>(r);
});

devices.on('reader-detached', (r) => {
    expectType<Reader>(r);
});

devices.on('card-inserted', ({ reader: r, card: c }) => {
    expectType<Reader>(r);
    expectType<Card>(c);
});

devices.on('card-removed', ({ reader: r, card: c }) => {
    expectType<Reader>(r);
    expectType<Card | null>(c);
});

devices.on('error', (err) => {
    expectType<Error>(err);
});

// ============================================================================
// Error Class Tests
// ============================================================================

const pcscError = new PCSCError('Test error', 0x80100001);
expectType<number>(pcscError.code);
expectType<string>(pcscError.message);

const cardRemovedError = new CardRemovedError();
expectAssignable<PCSCError>(cardRemovedError);

const timeoutError = new TimeoutError();
expectAssignable<PCSCError>(timeoutError);

const noReadersError = new NoReadersError();
expectAssignable<PCSCError>(noReadersError);

const serviceNotRunningError = new ServiceNotRunningError();
expectAssignable<PCSCError>(serviceNotRunningError);

const sharingViolationError = new SharingViolationError();
expectAssignable<PCSCError>(sharingViolationError);

// createPCSCError returns PCSCError
const createdError = createPCSCError('Error', 0x80100069);
expectType<PCSCError>(createdError);

// ============================================================================
// Constants Tests
// ============================================================================

expectType<number>(SCARD_SHARE_SHARED);
expectType<number>(SCARD_SHARE_EXCLUSIVE);
expectType<number>(SCARD_SHARE_DIRECT);
expectType<number>(SCARD_PROTOCOL_T0);
expectType<number>(SCARD_PROTOCOL_T1);
expectType<number>(SCARD_PROTOCOL_RAW);
expectType<number>(SCARD_LEAVE_CARD);
expectType<number>(SCARD_STATE_PRESENT);
expectType<number>(CM_IOCTL_GET_FEATURE_REQUEST);
expectType<number>(FEATURE_VERIFY_PIN_DIRECT);

// SCARD_CTL_CODE returns number
expectType<number>(SCARD_CTL_CODE(3400));

// ============================================================================
// parseFeatures Tests
// ============================================================================

const features = parseFeatures(Buffer.from([0x06, 0x04, 0x00, 0x00, 0x00, 0x01]));
expectType<Map<number, number>>(features);
