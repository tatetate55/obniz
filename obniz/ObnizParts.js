

const ObnizConnection = require('./ObnizConnection')
const ObnizUtil = require("./libs/utils/util");

let _parts = {};

module.exports = class ObnizParts extends ObnizConnection {

  constructor(id, options) {
    super(id, options)
  }

  static _parts() {
    return _parts;
  }

  static PartsRegistrate (name, obj) {
    _parts[name] = obj;
  }

  static Parts(name) {
    return new _parts[name]();
  }

  wired(partsname) {
    let parts = ObnizParts.Parts(partsname);
    if (!parts) {
      throw new Error("No such a parts [" + partsname + "] found");
      return;
    }
    let args = Array.from(arguments);
    args.shift();
    args.unshift(this); 
    if(parts.keys){
      if(parts.requiredKeys){
        let err = ObnizUtil._requiredKeys(args[1], parts.requiredKeys);
        if (err) {
          throw new Error(partsname + " wired param '" + err + "' required, but not found ");
          return;
        }
      }
      parts.params = ObnizUtil._keyFilter(args[1], parts.keys);
    }
    parts.obniz = this;
    parts.wired.apply(parts, args);
    if(parts.keys || parts.ioKeys){
      let keys = parts.ioKeys || parts.keys;
      let displayPartsName = parts.displayName || partsname;
      let ioNames = {};
      for( let index in keys){
        let pinName = keys[index];
        let io = args[1][pinName];
        if(this.isValidIO(io)) {
          if (parts.displayIoNames && parts.displayIoNames[pinName]) {
            pinName = parts.displayIoNames[pinName];
          }
          ioNames[io] = pinName;
        }
      }
      this.display.setPinNames(displayPartsName,ioNames);
    }
    return parts;
  }
}