# smartcard

```
╭────────────────────────────────────────╮
│                                        │
│   ╭───────────╮                        │
│   │ ▄▄▄ ▄▄▄▄▄ │                        │
│   │ ███ ▄▄▄▄▄ │                        │
│   │ ▀▀▀ ▀▀▀▀▀ │                        │
│   ╰───────────╯                        │
│                                        │
│                          ░░░░░░░░░░░░  │
│                          ░░░░░░░░░░░░  │
╰────────────────────────────────────────╯
```

Stable PC/SC smart card bindings for Node.js.

Works with Node.js 18+ without recompilation. Built on N-API for long-term stability.

## Getting Started

### 1. Install the package

```bash
npm install smartcard
```

### 2. Platform setup

**macOS/Windows**: Ready to go - no additional setup needed.

**Linux**:
```bash
# Install PC/SC libraries
sudo apt-get install libpcsclite-dev pcscd   # Debian/Ubuntu
sudo dnf install pcsc-lite-devel pcsc-lite   # Fedora/RHEL

# Start the daemon
sudo systemctl start pcscd
```

### 3. Connect a reader and run your first script

```javascript
const { Devices } = require('smartcard');

const devices = new Devices();

devices.on('card-inserted', async ({ reader, card }) => {
    console.log(`Card detected in ${reader.name}`);
    console.log(`ATR: ${card.atr.toString('hex')}`);

    // Get card UID (works with most contactless cards)
    const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
    console.log(`UID: ${response.slice(0, -2).toString('hex')}`);
});

devices.on('error', (err) => console.error(err.message));

devices.start();
```

Run it:
```bash
node app.js
# Tap a card on your reader...
# Card detected in ACS ACR122U
# ATR: 3b8f8001804f0ca0000003060300030000000068
# UID: 04a23b7a
```

## Recommended Hardware

### Readers

| Reader | Type | Notes |
|--------|------|-------|
| **ACR122U** | USB contactless | Affordable, widely available. Great for getting started. |
| **ACR1252U** | USB dual-interface | Supports both contactless and contact cards. |
| **SCM SCR35xx** | USB contact | Tested with SCR35xx v2.0. Good for contact smart cards. |
| **HID Omnikey 5427** | USB contactless | Enterprise-grade, faster reads. |
| **Identiv uTrust 3700F** | USB contactless | Compact, reliable. |

Any PC/SC compatible reader should work. The library uses standard PC/SC APIs.

### Cards

| Card Type | Interface | Notes |
|-----------|-----------|-------|
| MIFARE Classic 1K/4K | Contactless | Most common NFC cards |
| MIFARE Ultralight / NTAG | Contactless | Stickers, wristbands, keyfobs |
| MIFARE DESFire | Contactless | Higher security applications |
| ISO 14443-4 | Contactless | Generic contactless smart cards |
| ISO 7816 | Contact | Standard contact smart cards (SIM, bank cards, ID cards) |

## Features

- **ABI Stable**: Works across Node.js versions without recompilation
- **Async/Promise-based**: Non-blocking card operations
- **Event-driven API**: High-level `Devices` class with EventEmitter
- **TypeScript support**: Full type definitions included
- **Cross-platform**: Windows, macOS, and Linux

## More Examples

### High-Level API (Event-Driven)

```javascript
const { Devices } = require('smartcard');

const devices = new Devices();

devices.on('reader-attached', (reader) => {
    console.log(`Reader attached: ${reader.name}`);
});

devices.on('reader-detached', (reader) => {
    console.log(`Reader detached: ${reader.name}`);
});

devices.on('card-inserted', async ({ reader, card }) => {
    console.log(`Card inserted in ${reader.name}`);
    console.log(`  ATR: ${card.atr.toString('hex')}`);

    // Send APDU command
    try {
        const response = await card.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00]);
        console.log(`  UID: ${response.slice(0, -2).toString('hex')}`);
    } catch (err) {
        console.error('Transmit error:', err.message);
    }
});

devices.on('card-removed', ({ reader }) => {
    console.log(`Card removed from ${reader.name}`);
});

devices.on('error', (err) => {
    console.error('Error:', err.message);
});

// Start monitoring
devices.start();

// Stop on exit
process.on('SIGINT', () => {
    devices.stop();
    process.exit();
});
```

### Low-Level API (Direct PC/SC)

```javascript
const {
    Context,
    SCARD_SHARE_SHARED,
    SCARD_PROTOCOL_T0,
    SCARD_PROTOCOL_T1,
    SCARD_LEAVE_CARD
} = require('smartcard');

async function main() {
    // Create PC/SC context
    const ctx = new Context();
    console.log('Context valid:', ctx.isValid);

    // List readers
    const readers = ctx.listReaders();
    console.log('Readers:', readers.map(r => r.name));

    if (readers.length === 0) {
        console.log('No readers found');
        ctx.close();
        return;
    }

    const reader = readers[0];
    console.log(`Using reader: ${reader.name}`);
    console.log(`  State: ${reader.state}`);

    // Connect to card
    try {
        const card = await reader.connect(
            SCARD_SHARE_SHARED,
            SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1
        );
        console.log(`Connected, protocol: ${card.protocol}`);

        // Get card status
        const status = card.getStatus();
        console.log(`  ATR: ${status.atr.toString('hex')}`);

        // Send APDU (Get UID for contactless cards)
        const response = await card.transmit(Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]));
        console.log(`  Response: ${response.toString('hex')}`);

        // Disconnect
        card.disconnect(SCARD_LEAVE_CARD);
    } catch (err) {
        console.error('Card error:', err.message);
    }

    // Close context
    ctx.close();
}

main();
```

### Waiting for Card Changes

```javascript
const { Context } = require('smartcard');

async function waitForCard() {
    const ctx = new Context();
    const readers = ctx.listReaders();

    if (readers.length === 0) {
        console.log('No readers found');
        ctx.close();
        return;
    }

    console.log('Waiting for card...');

    // Wait for state change (timeout: 30 seconds)
    const changes = await ctx.waitForChange(readers, 30000);

    if (changes === null) {
        console.log('Cancelled');
    } else if (changes.length === 0) {
        console.log('Timeout');
    } else {
        for (const change of changes) {
            if (change.changed) {
                console.log(`${change.name}: state changed to ${change.state}`);
                if (change.atr) {
                    console.log(`  ATR: ${change.atr.toString('hex')}`);
                }
            }
        }
    }

    ctx.close();
}

waitForCard();
```

## API Reference

### Context

The low-level PC/SC context.

```typescript
class Context {
    constructor();
    readonly isValid: boolean;
    listReaders(): Reader[];
    waitForChange(readers?: Reader[], timeout?: number): Promise<ReaderState[] | null>;
    cancel(): void;
    close(): void;
}
```

### Reader

Represents a smart card reader.

```typescript
interface Reader {
    readonly name: string;
    readonly state: number;
    readonly atr: Buffer | null;
    connect(shareMode?: number, protocol?: number): Promise<Card>;
}
```

### Card

Represents a connected smart card.

```typescript
interface Card {
    readonly protocol: number;
    readonly connected: boolean;
    readonly atr: Buffer | null;
    transmit(command: Buffer | number[], options?: { maxRecvLength?: number; autoGetResponse?: boolean }): Promise<Buffer>;
    control(code: number, data?: Buffer): Promise<Buffer>;
    getStatus(): { state: number; protocol: number; atr: Buffer };
    disconnect(disposition?: number): void;
    reconnect(shareMode?: number, protocol?: number, init?: number): Promise<number>;
}
```

### Devices

High-level event-driven API.

```typescript
class Devices extends EventEmitter {
    start(): void;
    stop(): void;
    listReaders(): Reader[];
    getCards(): ReadonlyMap<string, Card>;  // Get all connected cards by reader name
    getCard(readerName: string): Card | null;  // Get card for specific reader

    on(event: 'reader-attached', listener: (reader: Reader) => void): this;
    on(event: 'reader-detached', listener: (reader: Reader) => void): this;
    on(event: 'card-inserted', listener: (event: { reader: Reader; card: Card }) => void): this;
    on(event: 'card-removed', listener: (event: { reader: Reader; card: Card | null }) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
}
```

### Auto GET RESPONSE (T=0 Protocol)

For T=0 protocol cards, you can automatically handle status words by passing the `autoGetResponse` option:
- `SW1=61`: Sends GET RESPONSE to retrieve remaining data
- `SW1=6C`: Retries with corrected Le value

```javascript
// Without auto-response (raw)
const raw = await card.transmit([0x00, 0xA4, 0x04, 0x00, 0x0E, ...aid]);
// Returns: 61 1C (meaning 28 more bytes available)

// With auto-response - handles 61 XX automatically
const response = await card.transmit([0x00, 0xA4, 0x04, 0x00, 0x0E, ...aid], {
    autoGetResponse: true
});
// Returns: full response data + 90 00
```

The `transmitWithAutoResponse()` helper function is also available for low-level API usage:

```javascript
const { transmitWithAutoResponse } = require('smartcard');

const response = await transmitWithAutoResponse(card, [0x00, 0xA4, 0x04, 0x00, 0x0E, ...aid], {
    autoGetResponse: true
});
```

### Control Codes

Utilities for reader control commands (e.g., PIN verification on pinpad readers).

```javascript
const {
    SCARD_CTL_CODE,
    CM_IOCTL_GET_FEATURE_REQUEST,
    parseFeatures,
    FEATURE_VERIFY_PIN_DIRECT,
    FEATURE_MODIFY_PIN_DIRECT
} = require('smartcard');

// Get supported features from reader
const featureResponse = await card.control(CM_IOCTL_GET_FEATURE_REQUEST);
const features = parseFeatures(featureResponse);

if (features.has(FEATURE_VERIFY_PIN_DIRECT)) {
    const pinVerifyCode = features.get(FEATURE_VERIFY_PIN_DIRECT);
    // Use pinVerifyCode with card.control() for PIN verification
}

// Generate platform-specific control code
const customCode = SCARD_CTL_CODE(3500);
```

### Constants

```javascript
// Share modes
SCARD_SHARE_EXCLUSIVE  // Exclusive access
SCARD_SHARE_SHARED     // Shared access (default)
SCARD_SHARE_DIRECT     // Direct access to reader

// Protocols
SCARD_PROTOCOL_T0      // T=0 protocol
SCARD_PROTOCOL_T1      // T=1 protocol
SCARD_PROTOCOL_RAW     // Raw protocol

// Disposition (for disconnect)
SCARD_LEAVE_CARD       // Leave card as-is
SCARD_RESET_CARD       // Reset the card
SCARD_UNPOWER_CARD     // Power down the card
SCARD_EJECT_CARD       // Eject the card

// State flags
SCARD_STATE_PRESENT    // Card is present
SCARD_STATE_EMPTY      // No card in reader
SCARD_STATE_CHANGED    // State has changed
// ... and more

// CCID Feature constants
FEATURE_VERIFY_PIN_START      // 0x01
FEATURE_VERIFY_PIN_FINISH     // 0x02
FEATURE_MODIFY_PIN_START      // 0x03
FEATURE_MODIFY_PIN_FINISH     // 0x04
FEATURE_GET_KEY_PRESSED       // 0x05
FEATURE_VERIFY_PIN_DIRECT     // 0x06
FEATURE_MODIFY_PIN_DIRECT     // 0x07
// ... and more
```

## Common APDU Commands

```javascript
// Get UID (for contactless cards via PC/SC pseudo-APDU)
const GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00];

// Select by AID
const SELECT_AID = [0x00, 0xA4, 0x04, 0x00, /* length */, /* AID bytes */];

// Read binary
const READ_BINARY = [0x00, 0xB0, /* P1: offset high */, /* P2: offset low */, /* Le */];
```

## Error Handling

```javascript
const { PCSCError, CardRemovedError, TimeoutError } = require('smartcard');

try {
    const response = await card.transmit([0x00, 0xA4, 0x04, 0x00]);
} catch (err) {
    if (err instanceof CardRemovedError) {
        console.log('Card was removed');
    } else if (err instanceof TimeoutError) {
        console.log('Operation timed out');
    } else if (err instanceof PCSCError) {
        console.log(`PC/SC error: ${err.message} (code: ${err.code})`);
    } else {
        throw err;
    }
}
```

## Troubleshooting

### "No readers available"
- Ensure a PC/SC compatible reader is connected
- On Linux, ensure `pcscd` service is running: `sudo systemctl status pcscd`

### "PC/SC service not running"
- Linux: `sudo systemctl start pcscd`
- Windows: Check "Smart Card" service is running

### "Sharing violation"
- Another application has exclusive access to the card
- Close other smart card applications

### Build errors on Linux
- Install development headers: `sudo apt-get install libpcsclite-dev`

## Migrating from v1.x

Version 2.0 is a complete rewrite using N-API for stability across Node.js versions.

### Breaking Changes

| v1.x | v2.x |
|------|------|
| `device-activated` event | `reader-attached` event |
| `device-deactivated` event | `reader-detached` event |
| `event.device` | `reader` (passed directly) |
| `device.on('card-inserted')` | `devices.on('card-inserted')` |
| `card.issueCommand()` | `card.transmit()` |

### Migration Example

**v1.x:**
```javascript
const { Devices } = require('smartcard');
const devices = new Devices();

devices.on('device-activated', event => {
    const device = event.device;
    device.on('card-inserted', event => {
        const card = event.card;
        card.issueCommand(new CommandApdu({...}));
    });
});
```

**v2.x:**
```javascript
const { Devices } = require('smartcard');
const devices = new Devices();

devices.on('reader-attached', reader => {
    console.log('Reader:', reader.name);
});

devices.on('card-inserted', ({ reader, card }) => {
    const response = await card.transmit([0x00, 0xA4, 0x04, 0x00]);
});

devices.start();
```

### Key Improvements in v2.x/v3.x
- Works on Node.js 18+ without recompilation (v3.x requires Node.js 18+)
- Native N-API bindings (no more NAN compatibility issues)
- Simpler flat event model
- Full TypeScript definitions
- Promise-based async API

## License

MIT

## Related Projects

- [nfc-pcsc](https://www.npmjs.com/package/nfc-pcsc) - NFC library built on smartcard
- [emv](https://github.com/tomkp/emv) - EMV (Europay, MasterCard, Visa) parsing library for payment card applications. Use it alongside smartcard to parse TLV data, handle application selection, and build payment terminal applications.
