'use strict';

import {EventEmitter} from 'events';
import hexify from 'hexify';
import CommandApdu from './CommandApdu';
import ResponseApdu from './ResponseApdu';
import Device from './Device';


class Card extends EventEmitter {

    constructor(device, reader, status, protocol) {
        super();
        //console.log(`new Card(${device}, ${reader}, ${status})`);
        this.device = device;
        this.reader = reader;
        this.status = status;
        this.protocol = protocol;
    }

    atr() {
        return this.status.atr.toString('hex');
    }

    toString() {
        return `Card(atr:'${this.atr()}')`;
    }

    issueCommand(command, callback) {

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

        const protocol = this.protocol;

        this.emit('command-issued', {card: this, command: commandBuffer});
        if (callback) {
            this.reader.transmit(commandBuffer, 0xFF, protocol, (err, response) => {
                this.emit('response-received', {
                    card: this,
                    command: commandBuffer,
                    response: new ResponseApdu(response)
                });
                callback(err, response);
            });
        } else {
            return new Promise((resolve, reject) => {
                this.reader.transmit(commandBuffer, 0xFF, protocol, (err, response) => {
                    if (err) reject(err);
                    else {
                        this.emit('response-received', {
                            card: this,
                            command: commandBuffer,
                            response: new ResponseApdu(response)
                        });
                        resolve(response);
                    }
                });
            });
        }
    };
}

export default Card;