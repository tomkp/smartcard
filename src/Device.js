'use strict';

import Card from './Card';
import {EventEmitter} from 'events';


class Device extends EventEmitter {
    constructor(reader) {
        super();
        //console.log(`new Device(${reader})`);
        this.reader = reader;
        this.card = null;

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
                    this.card = new Card(this, reader, status, protocol);
                    this.emit('card-inserted', {device: this, card: this.card});
                }
            });
        };

        const cardRemoved = (reader) => {
            const name = reader.name;
            reader.disconnect(reader.SCARD_LEAVE_CARD, (err) => {
                if (err) {
                    this.emit('error', err);
                } else {
                    this.emit('card-removed', {name});
                    this.card = null;
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

export default Device;