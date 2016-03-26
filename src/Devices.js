'use strict';

import {EventEmitter} from 'events';
import pcsclite from 'pcsclite';
import Device from './Device';


const pcsc = pcsclite();


class Devices extends EventEmitter {
    constructor() {
        super();
        //console.log(`new Devices()`);
        this.pcsc = pcsclite();
        this.devices = {};

        this.pcsc.on('reader', (reader) => {
            const device = new Device(reader);
            this.devices[reader.name] = {};
            this.emit('device-activated', {device, devices: this.listDevices()});
            reader.on('end', () => {
                delete this.devices[reader.name];
                this.emit('device-deactivated', {reader});
            });
            reader.on('error', (error) => {
                this.emit('error', {reader, error});
            });
        });

        this.pcsc.on('error', (error) => {
            this.emit('error', {error});
        });
    }

    listDevices() {
        return Object.keys(this.devices);
    };

    toString() {
        return `Devices(devices:'${this.listDevices()}')`;
    }
}


module.exports = Devices;

