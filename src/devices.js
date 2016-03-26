'use strict';

import {EventEmitter} from "events";
import pcsclite from "pcsclite";
import hexify from "hexify";


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


function CommandApdu(obj) {

    let size = obj.size;
    let cla = obj.cla;
    let ins = obj.ins;
    let p1 = obj.p1;
    let p2 = obj.p2;
    let data = obj.data;
    let le = obj.le || 0;
    let lc;


    // case 1
    if (!size && !data && !le) {
        //le = -1;
        //console.info('case 1');
        size = 4;
    }
    // case 2
    else if (!size && !data) {
        //console.info('case 2');
        size = 4 + 2;
    }

    // case 3
    else if (!size && !le) {
        //console.info('case 3');
        size = data.length + 5 + 4;
        //le = -1;
    }

    // case 4
    else if (!size) {
        //console.info('case 4');
        size = data.length + 5 + 4;
    }

    // set data
    if (data) {
        lc = data.length;
    } else {
        //lc = 0;
    }

    this.bytes = [];
    this.bytes.push(cla);
    this.bytes.push(ins);
    this.bytes.push(p1);
    this.bytes.push(p2);

    if (data) {
        this.bytes.push(lc);
        this.bytes = this.bytes.concat(data);
    }
    this.bytes.push(le);
}


CommandApdu.prototype.toString = function() {
    return hexify.toHexString(bytes);
};

CommandApdu.prototype.toByteArray = function() {
    return this.bytes;
};

CommandApdu.prototype.toBuffer = function() {
    return new Buffer(this.bytes);
};

CommandApdu.prototype.setLe = function (le) {
    this.bytes.pop();
    this.bytes.push(le);
};



const statusCodes = {
    '^9000$': 'Normal processing',
    '^61(.{2})$': 'Normal processing, (sw2 indicates the number of response bytes still available)',
    '^62(.{2})$': 'Warning processing',
    '^6200$': 'no info',
    '^6281$': 'Part of return data may be corrupted',
    '^6282$': 'end of file/record reached before reading le bytes',
    '^6283$': 'ret data may contain structural info',
    '^6284$': 'selected file is invalidated',
    '^6285$': 'file control info not in required format',
    '^6286$': 'unsuccessful writing',
    '^63(.{2})$': 'Warning processing',
    '^6300$': 'no info',
    '^6381$': 'last write filled up file',
    '^6382$': 'execution successful after retry',
//          c0	least significant nibble is a counter....
//          ..	..valued from 0 to 15
//          cf
    '^64(.{2})$': 'Execution error',
    '^65(.{2})$': 'Execution error',
    '^6500$': 'no info',
    '^6581$': 'memory failure',
    '^66(.{2})$': 'Reserved for future use',
    '^6700$': 'Wrong length',
    '^68(.{2})$': 'Checking error: functions in CLA not supported (see sw2)',
    '^6800$': 'no info',
    '^6881$': 'logical channel not supported',
    '^6882$': 'secure messaging not supported',
    '^69(.{2})$': 'Checking error: command not allowed (see sw2)',
    '^6a(.{2})$': 'Checking error: wrong parameters (p1 or p2)  (see sw2)',
    '^6b(.{2})$': 'Checking error: wrong parameters',
    '^6c(.{2})$': 'Checking error: wrong length (sw2 indicates correct length for le)',
    '^6d(.{2})$': 'Checking error: wrong ins',
    '^6e(.{2})$': 'Checking error: class not supported',
    '^6f(.{2})$': 'Checking error: no precise diagnosis'
};


function ResponseApdu(buffer) {
    this.buffer = buffer;
    this.data = buffer.toString('hex');
}

ResponseApdu.prototype.getStatus = function() {
    const statusCode = this.getStatusCode();
    let meaning = 'Unknown';
    for (let prop in statusCodes) {
        if (statusCodes.hasOwnProperty(prop)) {
            let result = statusCodes[prop];
            if (statusCode.match(prop)) {
                meaning = result;
                break;
            }

        }
    }
    return {
        code: statusCode,
        meaning: meaning
    };
};
ResponseApdu.prototype.getStatusCode = function() {
    return this.data.substr(-4);
};
ResponseApdu.prototype.isOk = function() {
    return this.getStatusCode() === '9000';
};
ResponseApdu.prototype.buffer = function() {
    return this.buffer;
};
ResponseApdu.prototype.hasMoreBytesAvailable = function() {
    return this.data.substr(-4, 2) === '61';
};
ResponseApdu.prototype.numberOfBytesAvailable = function() {
    let hexLength = this.data.substr(-2, 2);
    return parseInt(hexLength, 16);
};
ResponseApdu.prototype.isWrongLength = function() {
    return this.data.substr(-4, 2) === '6c';
};
ResponseApdu.prototype.correctLength = function() {
    let hexLength = this.data.substr(-2, 2);
    return parseInt(hexLength, 16);
};
ResponseApdu.prototype.toString = function() {
    return this.data.toString('hex');
};



const ins = {
    APPEND_RECORD: 0xE2,
    ENVELOPE: 0xC2,
    ERASE_BINARY: 0x0E,
    EXTERNAL_AUTHENTICATE: 0x82,
    GET_CHALLENGE: 0x84,
    GET_DATA: 0xCA,
    GET_RESPONSE: 0xC0,
    INTERNAL_AUTHENTICATE: 0x88,
    MANAGE_CHANNEL: 0x70,
    PUT_DATA: 0xDA,
    READ_BINARY: 0xB0,
    READ_RECORD: 0xB2,
    SELECT_FILE: 0xA4,
    UPDATE_BINARY: 0xD6,
    UPDATE_RECORD: 0xDC,
    VERIFY: 0x20,
    WRITE_BINARY: 0xD0,
    WRITE_RECORD: 0xD2
};


function Iso7816(devices, cardReader) {
    this.devices = devices;
    this.cardReader = cardReader;
}

Iso7816.prototype.issueCommand = function(commandApdu) {
    //console.log(`Iso7816.issueCommand '${commandApdu}' `);
    return this.devices
        .issueCommand(this.cardReader, commandApdu.toBuffer())
        .then(resp => {
            var response = new ResponseApdu(resp);
            //console.log(`status code '${response.statusCode()}'`);
            if (response.hasMoreBytesAvailable()) {
                //console.log(`has '${response.numberOfBytesAvailable()}' more bytes available`);
                return this.getResponse(response.numberOfBytesAvailable());
            } else if (response.isWrongLength()) {
                //console.log(`'le' should be '${response.correctLength()}' bytes`);
                commandApdu.setLe(response.correctLength());
                return this.issueCommand(commandApdu);
            }
            //console.log(`return response '${response}' `);
            return response;
        });
};

Iso7816.prototype.selectFile = function(bytes, p1, p2) {
    //console.log(`Iso7816.selectFile, file='${bytes}'`);
    return this.issueCommand(new CommandApdu({
        cla: 0x00,
        ins: ins.SELECT_FILE,
        p1: p1 || 0x04,
        p2: p2 || 0x00,
        data: bytes
    }));
};

Iso7816.prototype.getResponse = function(length) {
    //console.log(`Iso7816.getResponse, length='${length}'`);
    return this.issueCommand(new CommandApdu({
        cla: 0x00,
        ins: ins.GET_RESPONSE,
        p1: 0x00,
        p2: 0x00,
        le: length
    }));
};

Iso7816.prototype.readRecord = function(sfi, record) {
    //console.log(`Iso7816.readRecord, sfi='${sfi}', record=${record}`);
    return this.issueCommand(new CommandApdu({
        cla: 0x00,
        ins: ins.READ_RECORD,
        p1: record,
        p2: (sfi << 3) + 4,
        le: 0
    }));
};


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

