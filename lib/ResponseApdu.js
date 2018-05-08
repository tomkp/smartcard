'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var statusCodes = {
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

var ResponseApdu = function () {
    function ResponseApdu(buffer) {
        _classCallCheck(this, ResponseApdu);

        this.buffer = buffer;
        this.data = buffer.toString('hex');
    }

    _createClass(ResponseApdu, [{
        key: 'meaning',
        value: function meaning() {
            var statusCode = this.getStatusCode();
            for (var prop in statusCodes) {
                if (statusCodes.hasOwnProperty(prop)) {
                    var result = statusCodes[prop];
                    if (statusCode.match(prop)) {
                        return result;
                    }
                }
            }
            return 'Unknown';
        }
    }, {
        key: 'getStatusCode',
        value: function getStatusCode() {
            return this.data.substr(-4);
        }
    }, {
        key: 'isOk',
        value: function isOk() {
            return this.getStatusCode() === '9000';
        }
    }, {
        key: 'buffer',
        value: function buffer() {
            return this.buffer;
        }
    }, {
        key: 'hasMoreBytesAvailable',
        value: function hasMoreBytesAvailable() {
            return this.data.substr(-4, 2) === '61';
        }
    }, {
        key: 'numberOfBytesAvailable',
        value: function numberOfBytesAvailable() {
            var hexLength = this.data.substr(-2, 2);
            return parseInt(hexLength, 16);
        }
    }, {
        key: 'isWrongLength',
        value: function isWrongLength() {
            return this.data.substr(-4, 2) === '6c';
        }
    }, {
        key: 'correctLength',
        value: function correctLength() {
            var hexLength = this.data.substr(-2, 2);
            return parseInt(hexLength, 16);
        }
    }, {
        key: 'toString',
        value: function toString() {
            return this.data.toString('hex');
        }
    }]);

    return ResponseApdu;
}();

exports.default = ResponseApdu;