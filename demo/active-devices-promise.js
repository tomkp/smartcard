'use strict';

const api = require('../lib/index');
const Devices = api.Devices;
const devices = new Devices();


devices.onActivated().then(event => {
    console.log(`Device '${event.device}' activated`);
    event.devices.map((device, index) => {
        console.log(`Device #${index + 1}: ${device.name}`);
    });
});