'use strict';

import {EventEmitter} from 'events';
import hexify from 'hexify';
import ResponseApdu from './ResponseApdu';


class Card extends EventEmitter {

    constructor(device, reader, status, protocol) {
        super();
        //console.log(`new Card(${device}, ${reader}, ${status})`);
        this.device = device;
        this.reader = reader;

        this.protocol = protocol;
        this.atr = status.atr.toString('hex');
    }

    getAtr() {
        return this.atr;
    }

    toString() {
        return `Card(atr:'${this.getAtr()}')`;
    }

    issueCommand(commandApdu, callback) {

        let buffer;
        if (Array.isArray(commandApdu)) {
            buffer = new Buffer(commandApdu);
        } else if (typeof commandApdu === 'string') {
            buffer = new Buffer(hexify.toByteArray(commandApdu));
        } else if (Buffer.isBuffer(commandApdu)) {
            buffer = commandApdu;
        } else if (typeof commandApdu === 'string') {
            buffer = new Buffer(hexify.toByteArray(commandApdu));
        } else {
            buffer = commandApdu.toBuffer();
        }

        const protocol = this.protocol;

        this.emit('command-issued', {card: this, command: commandApdu});
        if (callback) {

            this.reader.transmit(buffer, 0xFF, protocol, (err, response) => {
                this.emit('response-received', {
                    card: this,
                    command: commandApdu,
                    response: new ResponseApdu(response)
                });
                callback(err, response);
            });
        } else {
            return new Promise((resolve, reject) => {
                this.reader.transmit(buffer, 0xFF, protocol, (err, response) => {
                    if (err) reject(err);
                    else {
                        this.emit('response-received', {
                            card: this,
                            command: commandApdu,
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