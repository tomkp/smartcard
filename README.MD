# smartcard


Smartcard library.

This is a simple wrapper around [Santiago Gimeno's](https://www.npmjs.org/~sgimeno) great [pcsclite](https://github.com/santigimeno/node-pcsclite) library.

Used by [Card Spy](http://card-spy.surge.sh)

## API

The following objects are defined by the `smartcard` library, each contains its own set of methods and events.

### Class: Devices
A general object that provides access to all smartcard related devices.

#### Events
The `devices` object emits the following events

##### Event: 'device-activated'
Emitted when a card reader is attached.
Returns:
* `Object`
  * `Device`
  * `Array`: List of all devices, returned via `devices.listDevices()`

##### Event: 'device-deactivated'
Emitted when a card reader is detached.
Returns:
* `Object`
  * `Device`
  * `Array`: List of all devices, returned via `devices.listDevices()`

##### Event: 'error'
Emitted when an error occurs
Returns `Object`:
* _error_ `Error`

#### Methods
The following methods are available within the `devices` class.

##### Constructor
The constructor for a devices object takes no arguments,
```javascript
devices = new Devices();
```
##### `devices.onActivated()`
Returns `Promise`
* Resolves with activation _event_

##### `devices.onDeactivated()`
Returns `Promise`
* Resolves with deactivation _event_

##### `devices.listDevices()`
Returns `Object` a list of the different devices attached, each a `device` object

##### `devices.lookup(name)`
* _name_ `String`: The text name of a device

* Returns `Device`



### Class: Device
An object representing a specific card reader (device).

#### Methods
The following methods are available within the `device` class.

##### `device.getName()`
Returns the name of the attached device.

##### `device.transmit(data, res_len, protocol, cb)`
Sends a command to the connected device
* _data_ `Buffer`: data to be transmitted
* _res_len_ `Number`: Maximum length of the expected response, includes the 2 byte response (sw1 and sw2)
* _protocol_ `Number`: Protocol to be used in the transmission
* _cb(error,response)_ `Function`: Called when transmit function completes
  * _error_ `Error`
  * _output_ `Buffer`

#### Events
The `device` object emits the following events

##### Event: 'card-inserted'
Emitted when a smartcard is inserted into a card reader

Returns `Object`:
* _device_ `Device`
* _card_ `Card`

##### Event: 'card-removed'
Emitted when a smartcard is removed from a card reader

Returns `Object`:
* _name_ `String`
* _card_ `Card`

### Class: Card
An object representing an attached smart card.

#### Methods
The following methods are available within the `card` class.

##### `card.getAtr()`
Returns `String` containing the atr of the card

##### `card.issueCommand(commandApdu, callback)`
Sends a command to the card
* _commandApdu_: The command to be sent to the card
  * `String`
  * `Buffer`
  * `Array`
  * `CommandApdu`
* _callback(error,response)_: (optional) Function to call upon completion of the command
  * _error_ `Error`
  * _response_ `Buffer`

Returns `Promise`
  * Resolves with _response_ `Buffer`
  * Rejects with _error_ `Error`

If no callback is specified, returns a `Promise`
*
#### Events
The `card` object emits the following events

##### Event: 'command-issued'
Emitted when a command is sent to the smartcard.

Returns `Object`:
* _card_ `Card`
* _command_ `Buffer`

##### Event: 'response-received'
Emitted when a response is received from the card.

Returns `Object`:
* _card_ `Card`
* _command_ `Buffer`
* _response_ `ResponseApdu`

### Class: CommandApdu
An object representing a command to send to a smart card

#### Methods
The `CommandApdu` class has the following methods.

##### Constructor `CommandApdu(obj)`
Creates a new instance and sets the appropriate items
* _obj_ `Object`
  * _cla_ `Number`: The class of the command, typically 0
  * _ins_ `Number`: The instruction
  * _p1_ `Number`: The value of p1
  * _p2_ `Number`: The value of p2
  * _data_ `Array` (optional): The value of data
  * _le_ `Number` (optional): The value of le

OR
* _obj_ `Array`: Byte array representing the whole command

##### `CommandApdu.toBuffer()`
Converts the command to a Buffer
* Returns `Buffer`

##### `CommandApdu.toString()`
Converts the command to a hex string
* Returns `String`

##### `CommandApdu.toByteArray()`
Converts the command to a byte array
* Returns `Array`

##### `CommandApdu.setLe(le)`
Updates the le value of the command
* _le_ `Number`: The new le value

### Class: ResponseApdu
Class representing a response from the card

#### Methods
The `ResponseApdu` class has the following methods.

##### Constructor

##### `ResponseApdu.meaning()`
Interprets the return code and attempts to provide a text translation.
* Returns `String`

##### `ResponseApdu.getDataOnly()`
Returns the response data without including the status code
* Returns `String`

##### `ResponseApdu.getStatusCode()`
Returns only the status code
* Returns `String`

##### `ResponseApdu.isOk()`
Check if the status code is 9000
* Returns `Boolean`

##### `ResponseApdu.buffer()`
Returns the whole buffer, status code and data
* Returns `Buffer`

##### `ResponseApdu.hasMoreBytesAvailable()`
Reads the status code and looks for a 61 as sw1, meaning more data is available
* Returns `Boolean`

##### `ResponseApdu.numberOfBytesAvailable()`
Reads sw2 staus code to return number of bytes left, when sw1 is 61. A value of 0 means there are more than 256 bytes remaining.
* Returns `Number`

##### `ResponseApdu.isWrongLength()`
Checks status code for 6c as sw1
* Returns `Boolean`

##### `ResponseApdu.correctLength()`
If sw1 is 6c, returns the correct length from sw2. A value of 0 means there are more than 256 bytes remaining.
* Returns `Number`

### Class: Iso7816Application
An object offering general commands to most ISO7816 compliant smart cards.

#### Methods

##### Constructor `Iso7816Application(card)`
Sets up the `Iso7816Application` object
* _card_ `Card`: The card to communicate with using ISO7816 standards

##### `Iso7816Application.issueCommand(commandApdu)`
Sends the provided command to the card. Automatically retrieve the full response, even if it requires multiple GET_RESPONSE commands
* _commandApdu_ `CommandApdu`: Command to send to the card

Returns
* `ResponseApdu` Complete response from card

##### `Iso7816Application.selectFile(bytes, p1, p2)`
Sends the SELECT command to the card, often called selecting an application
* _bytes_ `Buffer`: The resource locater (AID, etc)
* _p1_ `Number`: Value to specify as the p1 value
* _p2_ `Number`: Value to specify as the p2 value

Returns
* `ResponseApdu` Complete response from card

##### `Iso7816Application.getResponse(length)`
Sends a single GET_RESPONSE command to the card
* _length_ `Number`: The length of the response expected, maximum is 0xFF

Returns
* `ResponseApdu` Complete response from card

##### `Iso7816Application.getResponse(sfi,record)`
Sends a READ_RECORD command to the card
* _sfi_ `Number`: The sfi
* _record_ `Number`: The record

Returns
* `ResponseApdu` Complete response from card

##### `Iso7816Application.getData(p1, p2)`
Sends a GET_DATA command to the card
* _p1_ `Number`: Value to specify as the p1 value
* _p2_ `Number`: Value to specify as the p2 value

Returns
* `ResponseApdu` Complete response from card

#### Events
The `Iso7816Application` class emits the following events

##### Event: 'application-selected'
Emitted when a successful reply to a `selectFile()` command is received.

Returns `Object`:
* _application_ `String`

## Examples


### With event emitter

```javascript
'use strict';

const smartcard = require('smartcard');
const Devices = smartcard.Devices;
const devices = new Devices();


devices.on('device-activated', (event => {
    console.log(`Device '${event.device}' activated`);
    event.devices.map((device, index) => {
        console.log(`Device #${index + 1}: '${device.name}'`);
    });
}));
```


### Using promises

```javascript
'use strict';

const smartcard = require('smartcard');
const Devices = smartcard.Devices;
const devices = new Devices();


devices.onActivated().then(event => {
    console.log(`Device '${event.device}' activated`);
    event.devices.map((device, index) => {
        console.log(`Device #${index + 1}: '${device.name}'`);
    });
});
```


### Selecting the Payment Systems Environment on an EMV (Chip & Pin) card


```javascript
'use strict';

const smartcard = require('smartcard');
const Devices = smartcard.Devices;
const Iso7816Application = smartcard.Iso7816Application;

const devices = new Devices();

devices.on('device-activated', event => {
    const currentDevices = event.devices;
    let device = event.device;
    console.log(`Device '${device}' activated, devices: ${currentDevices}`);
    for (let prop in currentDevices) {
        console.log("Devices: " + currentDevices[prop]);
    }

    device.on('card-inserted', event => {
        let card = event.card;
        console.log(`Card '${card.getAtr()}' inserted into '${event.device}'`);

        card.on('command-issued', event => {
            console.log(`Command '${event.command}' issued to '${event.card}' `);
        });

        card.on('response-received', event => {
            console.log(`Response '${event.response}' received from '${event.card}' in response to '${event.command}'`);
        });

        const application = new Iso7816Application(card);
        application.selectFile([0x31, 0x50, 0x41, 0x59, 0x2E, 0x53, 0x59, 0x53, 0x2E, 0x44, 0x44, 0x46, 0x30, 0x31])
            .then(response => {
                console.info(`Select PSE Response: '${response}' '${response.meaning()}'`);
            }).catch(error => {
                console.error('Error:', error, error.stack);
            });

    });
    device.on('card-removed', event => {
        console.log(`Card removed from '${event.name}' `);
    });

});

devices.on('device-deactivated', event => {
    console.log(`Device '${event.device}' deactivated, devices: [${event.devices}]`);
});
```
