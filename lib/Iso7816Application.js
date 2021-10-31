'use strict';

function _typeof(obj) { "@babel/helpers - typeof"; if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

var _events = require("events");

var _hexify = _interopRequireDefault(require("hexify"));

var _CommandApdu = _interopRequireDefault(require("./CommandApdu"));

var _ResponseApdu = _interopRequireDefault(require("./ResponseApdu"));

var _pino = _interopRequireDefault(require("pino"));

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

var logger = (0, _pino["default"])({
  name: 'Iso7816Application'
});
var ins = {
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
  WRITE_RECORD: 0xd2
};

var Iso7816Application = /*#__PURE__*/function (_EventEmitter) {
  _inherits(Iso7816Application, _EventEmitter);

  var _super = _createSuper(Iso7816Application);

  function Iso7816Application(card) {
    var _this;

    _classCallCheck(this, Iso7816Application);

    _this = _super.call(this);
    _this.card = card;
    return _this;
  }

  _createClass(Iso7816Application, [{
    key: "issueCommand",
    value: function issueCommand(commandApdu) {
      var _this2 = this;

      logger.debug("issueCommand '".concat(commandApdu, "' "));
      return this.card.issueCommand(commandApdu).then(function (resp) {
        var response = new _ResponseApdu["default"](resp);
        logger.debug("status code '".concat(response.statusCode, "'"));

        if (response.hasMoreBytesAvailable()) {
          logger.debug("has '".concat(response.data.length, "' more bytes available"));
          return _this2.getResponse(response.numberOfBytesAvailable()).then(function (resp) {
            var responseApdu = new _ResponseApdu["default"](resp);
            return new _ResponseApdu["default"](response.getDataOnly() + responseApdu.data);
          });
        } else if (response.isWrongLength()) {
          logger.debug("'le' should be '".concat(response.correctLength(), "' bytes"));
          commandApdu.setLe(response.correctLength());
          return _this2.issueCommand(commandApdu).then(function (resp) {
            var responseApdu = new _ResponseApdu["default"](resp);
            return new _ResponseApdu["default"](response.getDataOnly() + responseApdu.data);
          });
        }

        logger.debug("return response '".concat(response, "' "));
        return response;
      });
    }
  }, {
    key: "selectFile",
    value: function selectFile(bytes, p1, p2) {
      var _this3 = this;

      logger.debug("selectFile, file='".concat(bytes, "'"));
      var commandApdu = new _CommandApdu["default"]({
        cla: 0x00,
        ins: ins.SELECT_FILE,
        p1: p1 || 0x04,
        p2: p2 || 0x00,
        data: bytes
      });
      return this.issueCommand(commandApdu).then(function (response) {
        if (response.isOk()) {
          _this3.emit('application-selected', {
            application: _hexify["default"].toHexString(bytes)
          });
        }

        return response;
      });
    }
  }, {
    key: "getResponse",
    value: function getResponse(length) {
      logger.debug("getResponse, length='".concat(length, "'"));
      return this.issueCommand(new _CommandApdu["default"]({
        cla: 0x00,
        ins: ins.GET_RESPONSE,
        p1: 0x00,
        p2: 0x00,
        le: length
      }));
    }
  }, {
    key: "readRecord",
    value: function readRecord(sfi, record) {
      logger.debug("readRecord, sfi='".concat(sfi, "', record=").concat(record));
      return this.issueCommand(new _CommandApdu["default"]({
        cla: 0x00,
        ins: ins.READ_RECORD,
        p1: record,
        p2: (sfi << 3) + 4,
        le: 0
      }));
    }
  }, {
    key: "getData",
    value: function getData(p1, p2) {
      logger.debug("getData, p1='".concat(p1, "', p2=").concat(p2));
      return this.issueCommand(new _CommandApdu["default"]({
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