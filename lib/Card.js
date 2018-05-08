'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _hexify = require('hexify');

var _hexify2 = _interopRequireDefault(_hexify);

var _ResponseApdu = require('./ResponseApdu');

var _ResponseApdu2 = _interopRequireDefault(_ResponseApdu);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Card = function (_EventEmitter) {
    _inherits(Card, _EventEmitter);

    function Card(device, atr, protocol) {
        _classCallCheck(this, Card);

        //console.log(`new Card(${device}, ${reader}, ${status})`);
        var _this = _possibleConstructorReturn(this, (Card.__proto__ || Object.getPrototypeOf(Card)).call(this));

        _this.device = device;
        _this.protocol = protocol;
        _this.atr = atr.toString('hex');
        return _this;
    }

    _createClass(Card, [{
        key: 'getAtr',
        value: function getAtr() {
            return this.atr;
        }
    }, {
        key: 'toString',
        value: function toString() {
            return 'Card(atr:\'' + this.atr + '\')';
        }
    }, {
        key: 'issueCommand',
        value: function issueCommand(commandApdu, callback) {
            var _this2 = this;

            var buffer = void 0;
            if (Array.isArray(commandApdu)) {
                buffer = new Buffer(commandApdu);
            } else if (typeof commandApdu === 'string') {
                buffer = new Buffer(_hexify2.default.toByteArray(commandApdu));
            } else if (Buffer.isBuffer(commandApdu)) {
                buffer = commandApdu;
            } else if (typeof commandApdu === 'string') {
                buffer = new Buffer(_hexify2.default.toByteArray(commandApdu));
            } else {
                buffer = commandApdu.toBuffer();
            }

            var protocol = this.protocol;

            this.emit('command-issued', { card: this, command: commandApdu });
            if (callback) {

                this.device.transmit(buffer, 0xFF, protocol, function (err, response) {
                    _this2.emit('response-received', {
                        card: _this2,
                        command: commandApdu,
                        response: new _ResponseApdu2.default(response)
                    });
                    callback(err, response);
                });
            } else {
                return new Promise(function (resolve, reject) {
                    _this2.device.transmit(buffer, 0xFF, protocol, function (err, response) {
                        if (err) reject(err);else {
                            _this2.emit('response-received', {
                                card: _this2,
                                command: commandApdu,
                                response: new _ResponseApdu2.default(response)
                            });
                            resolve(response);
                        }
                    });
                });
            }
        }
    }]);

    return Card;
}(_events.EventEmitter);

exports.default = Card;