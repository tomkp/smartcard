'use strict';

function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

var _pino = _interopRequireDefault(require("pino"));

var _events = require("events");

var _Device = _interopRequireDefault(require("./Device"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, writable: true, configurable: true } }); if (superClass) _setPrototypeOf(subClass, superClass); }

function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }

function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal() { var Super = _getPrototypeOf(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = _getPrototypeOf(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }

function _possibleConstructorReturn(self, call) { if (call && (_typeof(call) === "object" || typeof call === "function")) { return call; } return _assertThisInitialized(self); }

function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

function _isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Date.prototype.toString.call(Reflect.construct(Date, [], function () {})); return true; } catch (e) { return false; } }

function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }

var pcsclite = require('@pokusew/pcsclite');

var logger = (0, _pino["default"])({
  name: 'Devices'
});

var Devices = /*#__PURE__*/function (_EventEmitter) {
  _inherits(Devices, _EventEmitter);

  var _super = _createSuper(Devices);

  function Devices() {
    var _this;

    _classCallCheck(this, Devices);

    _this = _super.call(this);
    logger.debug("new Devices()");
    _this.pcsc = pcsclite();
    _this.devices = {};

    _this.pcsc.on('reader', function (reader) {
      var device = new _Device["default"](reader);
      _this.devices[reader.name] = device;

      _this.emit('device-activated', {
        device: device,
        devices: _this.listDevices()
      });

      reader.on('end', function () {
        delete _this.devices[reader.name];

        _this.emit('device-deactivated', {
          device: device,
          devices: _this.listDevices()
        });
      });
      reader.on('error', function (error) {
        _this.emit('error', {
          reader: reader,
          error: error
        });
      });
    });

    _this.pcsc.on('error', function (error) {
      _this.emit('error', {
        error: error
      });
    });

    return _this;
  }

  _createClass(Devices, [{
    key: "onActivated",
    value: function onActivated() {
      var _this2 = this;

      return new Promise(function (resolve, reject) {
        _this2.on('device-activated', function (event) {
          return resolve(event);
        });
      });
    }
  }, {
    key: "onDeactivated",
    value: function onDeactivated() {
      var _this3 = this;

      return new Promise(function (resolve, reject) {
        _this3.on('device-deactivated', function (event) {
          return resolve(event);
        });
      });
    }
  }, {
    key: "listDevices",
    value: function listDevices() {
      var _this4 = this;

      return Object.keys(this.devices).map(function (k) {
        return _this4.devices[k];
      });
    }
  }, {
    key: "lookup",
    value: function lookup(name) {
      return this.devices[name];
    }
  }, {
    key: "toString",
    value: function toString() {
      return "Devices('".concat(this.listDevices(), "')");
    }
  }]);

  return Devices;
}(_events.EventEmitter);

module.exports = Devices;