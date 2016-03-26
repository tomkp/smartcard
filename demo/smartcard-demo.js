'use strict';

const Devices = require('../lib/devices');

const devices = new Devices();

devices.on('device-activated', function (event) {
    const currentDevices = event.devices;
    var device = event.device;
    console.log(`Device '${device}' activated, devices: ${currentDevices}`);
    for (var prop in currentDevices) {
        console.log("Devices: " + currentDevices[prop]);
    }

    device.on('card-inserted', function (event) {
        console.log(`Card '${event.card.atr()}' inserted into '${event.device}'`);

    });
    device.on('card-removed', function (event) {
        console.log(`Card removed from '${event.device}' `);
    });

});


/*

devices.on('device-deactivated', function (event) {
    console.log(`Device '${event.reader.name}' deactivated, devices: ${devices.listDevices()}`);
});


devices.on('command-issued', function (event) {
    console.log(`Command '${event.command}' issued to '${event.reader.name}' `);
});

devices.on('response-received', function (event) {
    console.log(`Response '${event.response}' received from '${event.reader.name}' in response to '${event.command}'`);
});

devices.on('error', function (event) {
    console.log(`Error '${event.error}' received`);
});

devices.on('card-inserted', function (event) {

    console.log(`List devices: ${devices.listDevices()}`);

    var reader = event.reader;
    console.log(`Card inserted into '${reader.name}' `);

    devices
        .issueCommand(reader, '00A404000E315041592E5359532E4444463031')
        .then(function (response) {
            console.log(`Response '${response.toString('hex')}`);
        }).catch(function (error) {
            console.error(error);
        });
});
*/
