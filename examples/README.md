# Examples

Ready-to-run examples for smartcard.

## Prerequisites

Make sure you have built the library first:

```bash
cd ..
npm install
npm run build
```

## Running Examples

Examples are TypeScript files that get compiled to `dist/examples/`. Run them from the project root:

```bash
# From project root
node dist/examples/list-readers.js
```

Or from the dist/examples directory:

```bash
cd dist/examples
node list-readers.js
```

## Examples

### Basic Examples

#### list-readers.ts

List all available PC/SC readers and their status.

```bash
node dist/examples/list-readers.js
```

#### read-card.ts

Connect to a card and read its UID and ATR.

```bash
node dist/examples/read-card.js          # Use first reader
node dist/examples/read-card.js 1        # Use second reader
```

#### monitor-cards.ts

Monitor for card insert/remove events using the high-level Devices API.

```bash
node dist/examples/monitor-cards.js
# Press Ctrl+C to stop
```

#### send-apdu.ts

Send a custom APDU command to a card.

```bash
node dist/examples/send-apdu.js "FF CA 00 00 00"      # Get UID (contactless)
node dist/examples/send-apdu.js "00 A4 04 00"         # Select command
node dist/examples/send-apdu.js "00 B0 00 00 10"      # Read 16 bytes
```

### Advanced Examples

#### error-handling.ts

Demonstrates proper error handling with specific PC/SC error types.

```bash
node dist/examples/error-handling.js
```

Shows how to catch and handle:
- `CardRemovedError` - Card removed during operation
- `TimeoutError` - Operation timed out
- `NoReadersError` - No readers available
- `ServiceNotRunningError` - PC/SC daemon not running
- `SharingViolationError` - Card in use by another app

#### wait-for-card.ts

Wait for a card using the low-level `Context.waitForChange()` API.

```bash
node dist/examples/wait-for-card.js        # Wait indefinitely
node dist/examples/wait-for-card.js 30     # Wait up to 30 seconds
```

This demonstrates the polling-based approach as an alternative to the event-driven `Devices` API.

#### control-command.ts

Send control commands to readers for advanced features.

```bash
node dist/examples/control-command.js
```

Demonstrates:
- Using `card.control()` to send control commands
- Querying reader features with `CM_IOCTL_GET_FEATURE_REQUEST`
- Using `parseFeatures()` to decode TLV responses
- Platform-specific codes with `SCARD_CTL_CODE()`

#### reconnect.ts

Reset or change protocols on a connected card.

```bash
node dist/examples/reconnect.js
```

Demonstrates:
- `card.reconnect()` with different initialization modes
- Switching between T=0 and T=1 protocols
- Upgrading to exclusive access
- Warm reset vs cold reset (unpower)

#### mifare-read-write.ts

Read and write MIFARE Classic cards (1K/4K).

```bash
node dist/examples/mifare-read-write.js read            # Read block 4
node dist/examples/mifare-read-write.js read 8          # Read block 8
node dist/examples/mifare-read-write.js write 4 "00112233445566778899AABBCCDDEEFF"
node dist/examples/mifare-read-write.js dump            # Dump all readable blocks
```

**Warning**: Be careful when writing! Writing to sector trailers (blocks 3, 7, 11, ...) can permanently lock sectors.

## Common APDU Commands

| Command | APDU | Description |
|---------|------|-------------|
| Get UID | `FF CA 00 00 00` | Get card UID (contactless via PC/SC) |
| Get ATS | `FF CA 01 00 00` | Get ATS (contactless) |
| Select by AID | `00 A4 04 00 <len> <AID>` | Select application by AID |
| Read Binary | `00 B0 <P1> <P2> <Le>` | Read data from file |
| Get Challenge | `00 84 00 00 08` | Get 8-byte random challenge |

## MIFARE Classic Commands (via PC/SC)

| Command | APDU | Description |
|---------|------|-------------|
| Load Key | `FF 82 00 <slot> 06 <key>` | Load 6-byte key into reader |
| Authenticate | `FF 86 00 00 05 01 00 <block> <type> <slot>` | Auth with key A (60) or B (61) |
| Read Block | `FF B0 00 <block> 10` | Read 16 bytes |
| Write Block | `FF D6 00 <block> 10 <data>` | Write 16 bytes |

## Response Status Words

| SW | Meaning |
|----|---------|
| 9000 | Success |
| 61XX | XX bytes available (use GET RESPONSE) |
| 6CXX | Wrong Le, retry with Le=XX |
| 6300 | Authentication failed |
| 6A82 | File not found |
| 6A86 | Incorrect P1-P2 |
| 6D00 | Instruction not supported |
| 6E00 | Class not supported |

## Error Classes

```javascript
const {
    PCSCError,           // Base class with error code
    CardRemovedError,    // Card removed (0x80100069)
    TimeoutError,        // Timeout (0x8010000A)
    NoReadersError,      // No readers (0x8010002E)
    ServiceNotRunningError,  // Service down (0x8010001D)
    SharingViolationError,   // Card in use (0x8010000B)
} = require('smartcard');
```
