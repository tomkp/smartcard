'use strict';

import {EventEmitter} from 'events';
import hexify from 'hexify';
import CommandApdu from './CommandApdu';
import ResponseApdu from './ResponseApdu';


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


class Iso7816Application extends EventEmitter {

    constructor(card) {
        super();
        this.card = card;
    }

    issueCommand(commandApdu) {
        //console.log(`Iso7816Application.issueCommand '${commandApdu}' `);
        return this.card
            .issueCommand(commandApdu)
            .then(resp => {
                var response = new ResponseApdu(resp);
                //console.log(`status code '${response.statusCode()}'`);
                if (response.hasMoreBytesAvailable()) {
                    //console.log(`has '${response.data.length}' more bytes available`);
                    return this.getResponse(response.numberOfBytesAvailable()).then((resp) => {
                      var resp = new ResponseApdu(resp);
                      return new ResponseApdu(response.getDataOnly() + resp.data);
                    });
                } else if (response.isWrongLength()) {
                  //TODO: Fix to properly work recursivaly
                  //console.log(`'le' should be '${response.correctLength()}' bytes`);
                  commandApdu.setLe(response.correctLength());
                  return this.issueCommand(commandApdu).then((resp) => {
                    var resp = new ResponseApdu(resp);
                    return new ResponseApdu(response.getDataOnly() + resp.data);
                  });
                }
                //console.log(`return response '${response}' `);
                //console.log(response)
                return response;
            });
    };

    selectFile(bytes, p1, p2) {
        //console.log(`Iso7816Application.selectFile, file='${bytes}'`);
        var commandApdu = new CommandApdu({
            cla: 0x00,
            ins: ins.SELECT_FILE,
            p1: p1 || 0x04,
            p2: p2 || 0x00,
            data: bytes
        });
        return this.issueCommand(commandApdu).then((response) => {
            if (response.isOk()) {
                this.emit('application-selected', {
                    application: hexify.toHexString(bytes)
                });
            }
            return response;
        });

    };

    getResponse(length) {
	      //When response is over 254 bytes long, I get buffer size errors
        if(length > 0xfd || length == 0x00) length=0xfd;
        //console.log(`Iso7816Application.getResponse, length='${length}'`);
        return this.issueCommand(new CommandApdu({
            cla: 0x00,
            ins: ins.GET_RESPONSE,
            p1: 0x00,
            p2: 0x00,
            le: length
        }));
    };

    readRecord(sfi, record) {
        //console.log(`Iso7816Application.readRecord, sfi='${sfi}', record=${record}`);
        return this.issueCommand(new CommandApdu({
            cla: 0x00,
            ins: ins.READ_RECORD,
            p1: record,
            p2: (sfi << 3) + 4,
            le: 0
        }));
    };

    getData(p1, p2) {
        //console.log(`Iso7816Application.getData, p1='${p1}', p2=${p2}`);
        return this.issueCommand(new CommandApdu({
            cla: 0x00,
            ins: ins.GET_DATA,
            p1: p1,
            p2: p2,
            le: 0
        }));
};
}


module.exports = Iso7816Application;
