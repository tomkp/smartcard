# smartcard

Smartcard library.

This is a simple wrapper around [Santiago Gimeno's](https://www.npmjs.org/~sgimeno) great [pcsclite](https://github.com/santigimeno/node-pcsclite) library.


## examples


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

devices.on('device-activated', function (event) {
    const currentDevices = event.devices;
    let device = event.device;
    console.log(`Device '${device}' activated, devices: ${currentDevices}`);
    for (let prop in currentDevices) {
        console.log("Devices: " + currentDevices[prop]);
    }

    device.on('card-inserted', function (event) {
        let card = event.card;
        console.log(`Card '${card.getAtr()}' inserted into '${event.device}'`);

        card.on('command-issued', function (event) {
            console.log(`Command '${event.command}' issued to '${event.card}' `);
        });

        card.on('response-received', function (event) {
            console.log(`Response '${event.response}' received from '${event.card}' in response to '${event.command}'`);
        });

        const application = new Iso7816Application(card);
        application.selectFile([0x31, 0x50, 0x41, 0x59, 0x2E, 0x53, 0x59, 0x53, 0x2E, 0x44, 0x44, 0x46, 0x30, 0x31])
            .then(function (response) {
                console.info(`Select PSE Response: '${response}' '${response.meaning()}'`);
            }).catch(function (error) {
                console.error('Error:', error, error.stack);
            });

    });
    device.on('card-removed', function (event) {
        console.log(`Card removed from '${event.name}' `);
    });

});

devices.on('device-deactivated', function (event) {
    console.log(`Device '${event.device}' deactivated, devices: [${event.devices}]`);
});
```