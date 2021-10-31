'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _events = require("events");

var _hexify = _interopRequireDefault(require("hexify"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

/*
CASE    COMMAND     RESPONSE
1       NO DATA     NO DATA
2       DATA        NO DATA
3       NO DATA     DATA
4       DATA        DATA
*/
var CommandApdu = /*#__PURE__*/function () {
  function CommandApdu(obj) {
    _classCallCheck(this, CommandApdu);

    if (obj.bytes) {
      this.bytes = obj.bytes;
    } else {
      var size = obj.size;
      var cla = obj.cla;
      var ins = obj.ins;
      var p1 = obj.p1;
      var p2 = obj.p2;
      var data = obj.data;
      var le = obj.le || 0;
      var lc; // case 1

      if (!size && !data && !le) {
        //le = -1;
        //console.info('case 1');
        size = 4;
      } // case 2
      else if (!size && !data) {
          //console.info('case 2');
          size = 4 + 2;
        } // case 3
        else if (!size && !le) {
            //console.info('case 3');
            size = data.length + 5 + 4; //le = -1;
          } // case 4
          else if (!size) {
              //console.info('case 4');
              size = data.length + 5 + 4;
            } // set data


      if (data) {
        lc = data.length;
      } else {//lc = 0;
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
  }

  _createClass(CommandApdu, [{
    key: "toString",
    value: function toString() {
      return _hexify["default"].toHexString(this.bytes);
    }
  }, {
    key: "toByteArray",
    value: function toByteArray() {
      return this.bytes;
    }
  }, {
    key: "toBuffer",
    value: function toBuffer() {
      return new Buffer(this.bytes);
    }
  }, {
    key: "setLe",
    value: function setLe(le) {
      this.bytes.pop();
      this.bytes.push(le);
    }
  }]);

  return CommandApdu;
}();

var _default = CommandApdu;
exports["default"] = _default;