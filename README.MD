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

##### Event: 'device-deactivated'
Emitted when a card reader is detached.

#### Methods
The following methods are available within the `devices` object.

##### Constructor
The constructor for a devices object takes no arguments,
```javascript
devices = new Devices();
```
##### `devices.onActivated()`
Returns `Promise` that resolves when a device is activated

##### `devices.onDeactivated()`
Returns `Promise` that resolves when a device is deactivated

##### `devices.listDevices()`
Returns `Object` a list of the different devices attached, each a `device` object

##### `devices.lookup()`
* `name`: The text name of a device
Returns the `device` object corresponding to the provided name.


### Class: Device
An object representing a specific card reader (device).

#### Methods
The following methods are available within the `device` object.

##### `device.getName()`

##### `device.transmit()`
Sends a command to the connected device
* _data_ `Buffer`: data to be transmitted
* _res_len_ `Number`: Maximum length of the expected response, includes the 2 byte response (sw1 and sw2)
* _protocol_ `Number`: Protocol to be used in the transmission
* _cb_ `Function`: Called when transit function completes
  * _error_ `Error`
  * _output_ `Buffer`

#### Events
The `device` object emits the following events

##### Event: 'card-inserted'
Emitted when a smartcard is inserted into a card reader

##### Event: 'card-removed'
Emitted when a smartcard is removed from a card reader

### Class: Card
An object representing an attached smart card.

#### Events
The `card` object emits the following events

##### Event: 'command-issued'
Emitted when a command is sent to the smartcard.

##### Event: 'response-received'
Emitted when a response is received from the card.

##### Event: 'application-selected'
Emitted when a successful reply to a `selectFile()` command is received.


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
