'use strict';

import { EventEmitter } from 'events';
import hexify from 'hexify';
import CommandApdu from './CommandApdu';
import ResponseApdu from './ResponseApdu';
import pino from 'pino';
const logger = pino({ name: 'Iso7816Application' });
const ins = {
  APPEND_RECORD: 0xe2,
  ENVELOPE: 0xc2,
  ERASE_BINARY: 0x0e,
  EXTERNAL_AUTHENTICATE: 0x82,
  GET_CHALLENGE: 0x84,
  GET_DATA: 0xca,
  GET_RESPONSE: 0xc0,
  INTERNAL_AUTHENTICATE: 0x88,
  MANAGE_CHANNEL: 0x70,
  PUT_DATA: 0xda,
  READ_BINARY: 0xb0,
  READ_RECORD: 0xb2,
  SELECT_FILE: 0xa4,
  UPDATE_BINARY: 0xd6,
  UPDATE_RECORD: 0xdc,
  VERIFY: 0x20,
  WRITE_BINARY: 0xd0,
  WRITE_RECORD: 0xd2,
};

class Iso7816Application extends EventEmitter {
  constructor(card) {
    super();
    this.card = card;
  }

  issueCommand(commandApdu) {
    logger.debug(`issueCommand '${commandApdu}' `);
    return this.card.issueCommand(commandApdu).then((resp) => {
      const response = new ResponseApdu(resp);
      logger.debug(`status code '${response.statusCode}'`);
      if (response.hasMoreBytesAvailable()) {
        logger.debug(`has '${response.data.length}' more bytes available`);
        return this.getResponse(response.numberOfBytesAvailable()).then(
          (resp) => {
            const responseApdu = new ResponseApdu(resp);
            return new ResponseApdu(response.getDataOnly() + responseApdu.data);
          }
        );
      } else if (response.isWrongLength()) {
        logger.debug(`'le' should be '${response.correctLength()}' bytes`);
        commandApdu.setLe(response.correctLength());
        return this.issueCommand(commandApdu).then((resp) => {
          const responseApdu = new ResponseApdu(resp);
          return new ResponseApdu(response.getDataOnly() + responseApdu.data);
        });
      }
      logger.debug(`return response '${response}' `);
      return response;
    });
  }

  selectFile(bytes, p1, p2) {
    logger.debug(`selectFile, file='${bytes}'`);
    const commandApdu = new CommandApdu({
      cla: 0x00,
      ins: ins.SELECT_FILE,
      p1: p1 || 0x04,
      p2: p2 || 0x00,
      data: bytes,
    });
    return this.issueCommand(commandApdu).then((response) => {
      if (response.isOk()) {
        this.emit('application-selected', {
          application: hexify.toHexString(bytes),
        });
      }
      return response;
    });
  }

  getResponse(length) {
    logger.debug(`getResponse, length='${length}'`);
    return this.issueCommand(
      new CommandApdu({
        cla: 0x00,
        ins: ins.GET_RESPONSE,
        p1: 0x00,
        p2: 0x00,
        le: length,
      })
    );
  }

  readRecord(sfi, record) {
    logger.debug(`readRecord, sfi='${sfi}', record=${record}`);
    return this.issueCommand(
      new CommandApdu({
        cla: 0x00,
        ins: ins.READ_RECORD,
        p1: record,
        p2: (sfi << 3) + 4,
        le: 0,
      })
    );
  }

  getData(p1, p2) {
    logger.debug(`getData, p1='${p1}', p2=${p2}`);
    return this.issueCommand(
      new CommandApdu({
        cla: 0x00,
        ins: ins.GET_DATA,
        p1: p1,
        p2: p2,
        le: 0,
      })
    );
  }
}

module.exports = Iso7816Application;
