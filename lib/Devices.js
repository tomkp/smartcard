'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _pcsclite = require('pcsclite');

var _pcsclite2 = _interopRequireDefault(_pcsclite);

var _Device = require('./Device');

var _Device2 = _interopRequireDefault(_Device);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var pcsc = (0, _pcsclite2.default)();

var Devices = function (_EventEmitter) {
    _inherits(Devices, _EventEmitter);

    function Devices() {
        _classCallCheck(this, Devices);

        //console.log(`new Devices()`);
        var _this = _possibleConstructorReturn(this, (Devices.__proto__ || Object.getPrototypeOf(Devices)).call(this));

        _this.pcsc = (0, _pcsclite2.default)();
        _this.devices = {};

        _this.pcsc.on('reader', function (reader) {
            var device = new _Device2.default(reader);
            _this.devices[reader.name] = device;
            _this.emit('device-activated', { device: device, devices: _this.listDevices() });
            reader.on('end', function () {
                delete _this.devices[reader.name];
                _this.emit('device-deactivated', { device: device, devices: _this.listDevices() });
            });
            reader.on('error', function (error) {
                _this.emit('error', { reader: reader, error: error });
            });
        });

        _this.pcsc.on('error', function (error) {
            _this.emit('error', { error: error });
        });
        return _this;
    }

    _createClass(Devices, [{
        key: 'onActivated',
        value: function onActivated() {
            var _this2 = this;

            return new Promise(function (resolve, reject) {
                _this2.on('device-activated', function (event) {
                    return resolve(event);
                });
            });
        }
    }, {
        key: 'onDeactivated',
        value: function onDeactivated() {
            var _this3 = this;

            return new Promise(function (resolve, reject) {
                _this3.on('device-deactivated', function (event) {
                    return resolve(event);
                });
            });
        }
    }, {
        key: 'listDevices',
        value: function listDevices() {
            var _this4 = this;

            return Object.keys(this.devices).map(function (k) {
                return _this4.devices[k];
            });
        }
    }, {
        key: 'lookup',
        value: function lookup(name) {
            return this.devices[name];
        }
    }, {
        key: 'toString',
        value: function toString() {
            return 'Devices(\'' + this.listDevices() + '\')';
        }
    }]);

    return Devices;
}(_events.EventEmitter);

module.exports = Devices;