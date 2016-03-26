'use strict';

import {EventEmitter} from "events";
import pcsclite from "pcsclite";


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

        this.pcsc.on('error', (err) => {
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


class Device extends EventEmitter {
    constructor(reader) {
        super();
        //console.log(`new Device(${reader})`);
        this.reader = reader;
        //this.

        const isCardInserted = (changes, reader, status) => {
            return (changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT);
        };

        const isCardRemoved = (changes, reader, status) => {
            return (changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY);
        };

        const cardInserted = (reader, status) => {
            reader.connect((err, protocol) => {
                if (err) {
                    this.emit('error', err);
                } else {
                    //devices[reader.name] = { reader, protocol};
                    this.emit('debug', `Device '${reader.name}' has protocol '${protocol}'`);
                    //events.emit('card-inserted', {reader, status, protocol});
                    var card = new Card(this, reader, status, protocol);

                    this.emit('card-inserted', {device: this, card});
                }
            });
        };


        const cardRemoved = (reader) => {
            const name = reader.name;
            reader.disconnect(reader.SCARD_LEAVE_CARD, (err) => {
                if (err) {
                    this.emit('error', err);
                } else {
                    //devices[reader.name] = {};
                    this.emit('card-removed', {name});
                }
            });

        };

        reader.on('status', (status) => {
            var changes = reader.state ^ status.state;
            if (changes) {
                if (isCardRemoved(changes, reader, status)) {
                    cardRemoved(reader);
                } else if (isCardInserted(changes, reader, status)) {
                    cardInserted(reader, status);
                }
            }
        });
    }

    name() {
        return this.reader.name;
    }

    toString() {
        return `Device(name:'${this.reader.name}')`;
    }

}

class Card extends EventEmitter {
    constructor(device, reader, status) {
        super();
        //console.log(`new Card(${device}, ${reader}, ${status})`);
        this.device = device;
        this.status = status;
        this.status = status;
    }

    atr() {
        return this.status.atr.toString('hex');
    }

    toString() {
        return `Card(atr:'${this.atr()}')`;
    }
}


/*




 events.issueCommand = (reader, command, callback) => {

 let commandBuffer;
 if (Array.isArray(command)) {
 commandBuffer = new Buffer(command);
 } else if (typeof command === 'string') {
 commandBuffer = new Buffer(hexify.toByteArray(command));
 } else if (Buffer.isBuffer(command)) {
 commandBuffer = command;
 } else {
 throw 'Unable to recognise command type (' + typeof command + ')';
 }


 const protocol = devices[reader.name].protocol;

 events.emit('command-issued', {reader, command: commandBuffer});
 if (callback) {
 reader.transmit(commandBuffer, 0xFF, protocol, (err, response) => {
 events.emit('response-received', {reader, command: commandBuffer, response: new Buffer(response.toString('hex'))});
 callback(err, response);
 });
 } else {
 return new Promise((resolve, reject) => {
 reader.transmit(commandBuffer, 0xFF, protocol, (err, response) => {
 if (err) reject(err);
 else {
 events.emit('response-received', {reader, command: commandBuffer, response: new Buffer(response.toString('hex'))});
 resolve(response);
 }
 });
 });
 }
 };
 */


module.exports = Devices;

