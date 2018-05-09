'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _hexify = require('hexify');

var _hexify2 = _interopRequireDefault(_hexify);

var _CommandApdu = require('./CommandApdu');

var _CommandApdu2 = _interopRequireDefault(_CommandApdu);

var _ResponseApdu = require('./ResponseApdu');

var _ResponseApdu2 = _interopRequireDefault(_ResponseApdu);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var ins = {
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

var Iso7816Application = function (_EventEmitter) {
    _inherits(Iso7816Application, _EventEmitter);

    function Iso7816Application(card) {
        _classCallCheck(this, Iso7816Application);

        var _this = _possibleConstructorReturn(this, (Iso7816Application.__proto__ || Object.getPrototypeOf(Iso7816Application)).call(this));

        _this.card = card;
        return _this;
    }

    _createClass(Iso7816Application, [{
        key: 'issueCommand',
        value: function issueCommand(commandApdu) {
            var _this2 = this;

            //console.log(`Iso7816Application.issueCommand '${commandApdu}' `);
            return this.card.issueCommand(commandApdu).then(function (resp) {
                var response = new _ResponseApdu2.default(resp);
                //console.log(`status code '${response.statusCode()}'`);
                if (response.hasMoreBytesAvailable()) {
                    //console.log(`has '${response.data.length}' more bytes available`);
                    return _this2.getResponse(response.numberOfBytesAvailable()).then(function (resp) {
                        var resp = new _ResponseApdu2.default(resp);
                        return new _ResponseApdu2.default(response.getDataOnly() + resp.data);
                    });
                } else if (response.isWrongLength()) {
                    //TODO: Fix to properly work recursivaly
                    //console.log(`'le' should be '${response.correctLength()}' bytes`);
                    commandApdu.setLe(response.correctLength());
                    return _this2.issueCommand(commandApdu).then(function (resp) {
                        var resp = new _ResponseApdu2.default(resp);
                        return new _ResponseApdu2.default(response.getDataOnly() + resp.data);
                    });
                }
                //console.log(`return response '${response}' `);
                //console.log(response)
                return response;
            });
        }
    }, {
        key: 'selectFile',
        value: function selectFile(bytes, p1, p2) {
            var _this3 = this;

            //console.log(`Iso7816Application.selectFile, file='${bytes}'`);
            var commandApdu = new _CommandApdu2.default({
                cla: 0x00,
                ins: ins.SELECT_FILE,
                p1: p1 || 0x04,
                p2: p2 || 0x00,
                data: bytes
            });
            return this.issueCommand(commandApdu).then(function (response) {
                if (response.isOk()) {
                    _this3.emit('application-selected', {
                        application: _hexify2.default.toHexString(bytes)
                    });
                }
                return response;
            });
        }
    }, {
        key: 'getResponse',
        value: function getResponse(length) {
            //When response is over 254 bytes long, I get buffer size errors
            if (length > 0xfd || length == 0x00) length = 0xfd;
            //console.log(`Iso7816Application.getResponse, length='${length}'`);
            return this.issueCommand(new _CommandApdu2.default({
                cla: 0x00,
                ins: ins.GET_RESPONSE,
                p1: 0x00,
                p2: 0x00,
                le: length
            }));
        }
    }, {
        key: 'readRecord',
        value: function readRecord(sfi, record) {
            //console.log(`Iso7816Application.readRecord, sfi='${sfi}', record=${record}`);
            return this.issueCommand(new _CommandApdu2.default({
                cla: 0x00,
                ins: ins.READ_RECORD,
                p1: record,
                p2: (sfi << 3) + 4,
                le: 0
            }));
        }
    }, {
        key: 'getData',
        value: function getData(p1, p2) {
            //console.log(`Iso7816Application.getData, p1='${p1}', p2=${p2}`);
            return this.issueCommand(new _CommandApdu2.default({
                cla: 0x00,
                ins: ins.GET_DATA,
                p1: p1,
                p2: p2,
                le: 0
            }));
        }
    }]);

    return Iso7816Application;
}(_events.EventEmitter);

module.exports = Iso7816Application;