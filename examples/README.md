# Examples

Ready-to-run examples for smartcard.

## Prerequisites

Make sure you have built the library first:

```bash
cd ..
npm install
```

## Examples

### Basic Examples

#### list-readers.js

List all available PC/SC readers and their status.

```bash
node list-readers.js
```

#### read-card.js

Connect to a card and read its UID and ATR.

```bash
node read-card.js          # Use first reader
node read-card.js 1        # Use second reader
```

#### monitor-cards.js

Monitor for card insert/remove events using the high-level Devices API.

```bash
node monitor-cards.js
# Press Ctrl+C to stop
```

#### send-apdu.js

Send a custom APDU command to a card.

```bash
node send-apdu.js "FF CA 00 00 00"      # Get UID (contactless)
node send-apdu.js "00 A4 04 00"         # Select command
node send-apdu.js "00 B0 00 00 10"      # Read 16 bytes
```

### Advanced Examples

#### error-handling.js

Demonstrates proper error handling with specific PC/SC error types.

```bash
node error-handling.js
```

Shows how to catch and handle:
- `CardRemovedError` - Card removed during operation
- `TimeoutError` - Operation timed out
- `NoReadersError` - No readers available
- `ServiceNotRunningError` - PC/SC daemon not running
- `SharingViolationError` - Card in use by another app

#### wait-for-card.js

Wait for a card using the low-level `Context.waitForChange()` API.

```bash
node wait-for-card.js        # Wait indefinitely
node wait-for-card.js 30     # Wait up to 30 seconds
```

This demonstrates the polling-based approach as an alternative to the event-driven `Devices` API.

#### control-command.js

Send control commands to readers for advanced features.

```bash
node control-command.js
```

Demonstrates:
- Using `card.control()` to send control commands
- Querying reader features with `CM_IOCTL_GET_FEATURE_REQUEST`
- Using `parseFeatures()` to decode TLV responses
- Platform-specific codes with `SCARD_CTL_CODE()`

#### reconnect.js

Reset or change protocols on a connected card.

```bash
node reconnect.js
```

Demonstrates:
- `card.reconnect()` with different initialization modes
- Switching between T=0 and T=1 protocols
- Upgrading to exclusive access
- Warm reset vs cold reset (unpower)

#### mifare-read-write.js

Read and write MIFARE Classic cards (1K/4K).

```bash
node mifare-read-write.js read            # Read block 4
node mifare-read-write.js read 8          # Read block 8
node mifare-read-write.js write 4 "00112233445566778899AABBCCDDEEFF"
node mifare-read-write.js dump            # Dump all readable blocks
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
