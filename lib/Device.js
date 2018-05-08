'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Card = require('./Card');

var _Card2 = _interopRequireDefault(_Card);

var _events = require('events');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Device = function (_EventEmitter) {
    _inherits(Device, _EventEmitter);

    function Device(reader) {
        _classCallCheck(this, Device);

        //console.log(`new Device(${reader})`);
        var _this = _possibleConstructorReturn(this, (Device.__proto__ || Object.getPrototypeOf(Device)).call(this));

        _this.reader = reader;
        _this.name = reader.name;
        _this.card = null;

        var isCardInserted = function isCardInserted(changes, reader, status) {
            return changes & reader.SCARD_STATE_PRESENT && status.state & reader.SCARD_STATE_PRESENT;
        };

        var isCardRemoved = function isCardRemoved(changes, reader, status) {
            return changes & reader.SCARD_STATE_EMPTY && status.state & reader.SCARD_STATE_EMPTY;
        };

        var cardInserted = function cardInserted(reader, status) {
            reader.connect(function (err, protocol) {
                if (err) {
                    _this.emit('error', err);
                } else {
                    _this.card = new _Card2.default(_this, status.atr, protocol);
                    _this.emit('card-inserted', { device: _this, card: _this.card });
                }
            });
        };

        var cardRemoved = function cardRemoved(reader) {
            var name = reader.name;
            reader.disconnect(reader.SCARD_LEAVE_CARD, function (err) {
                if (err) {
                    _this.emit('error', err);
                } else {
                    _this.emit('card-removed', { name: name, card: _this.card });
                    _this.card = null;
                }
            });
        };

        reader.on('status', function (status) {
            var changes = reader.state ^ status.state;
            if (changes) {
                if (isCardRemoved(changes, reader, status)) {
                    cardRemoved(reader);
                } else if (isCardInserted(changes, reader, status)) {
                    cardInserted(reader, status);
                }
            }
        });
        return _this;
    }

    _createClass(Device, [{
        key: 'transmit',
        value: function transmit(data, res_len, protocol, cb) {
            this.reader.transmit(data, res_len, protocol, cb);
        }
    }, {
        key: 'getName',
        value: function getName() {
            return this.name;
        }
    }, {
        key: 'toString',
        value: function toString() {
            return '' + this.getName();
        }
    }]);

    return Device;
}(_events.EventEmitter);

exports.default = Device;