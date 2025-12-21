# Examples

Ready-to-run examples for pcsclite-napi.

## Prerequisites

Make sure you have built the library first:

```bash
cd ..
npm install
```

## Examples

### list-readers.js

List all available PC/SC readers and their status.

```bash
node list-readers.js
```

### read-card.js

Connect to a card and read its UID and ATR.

```bash
node read-card.js          # Use first reader
node read-card.js 1        # Use second reader
```

### monitor-cards.js

Monitor for card insert/remove events using the high-level Devices API.

```bash
node monitor-cards.js
# Press Ctrl+C to stop
```

### send-apdu.js

Send a custom APDU command to a card.

```bash
node send-apdu.js "FF CA 00 00 00"      # Get UID (contactless)
node send-apdu.js "00 A4 04 00"         # Select command
node send-apdu.js "00 B0 00 00 10"      # Read 16 bytes
```

## Common APDU Commands

| Command | APDU | Description |
|---------|------|-------------|
| Get UID | `FF CA 00 00 00` | Get card UID (contactless via PC/SC) |
| Get ATS | `FF CA 01 00 00` | Get ATS (contactless) |
| Select by AID | `00 A4 04 00 <len> <AID>` | Select application by AID |
| Read Binary | `00 B0 <P1> <P2> <Le>` | Read data from file |
| Get Challenge | `00 84 00 00 08` | Get 8-byte random challenge |

## Response Status Words

| SW | Meaning |
|----|---------|
| 9000 | Success |
| 61XX | XX bytes available (use GET RESPONSE) |
| 6CXX | Wrong Le, retry with Le=XX |
| 6A82 | File not found |
| 6A86 | Incorrect P1-P2 |
| 6D00 | Instruction not supported |
| 6E00 | Class not supported |
