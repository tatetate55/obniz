
class ObnizSwitch {
  
  constructor(Obniz) {
    this.Obniz = Obniz;
    this.observers = [];
  }

  addObserver(callback) {
    if(callback) {
      this.observers.push(callback);
    }
  }

  getWait() {
    let self = this;
    return new Promise(function(resolve, reject){
      let obj = {};
      obj["switch"] = "get"
      self.Obniz.send(obj);
      self.addObserver(resolve);
    });
  }

  notified(obj) {
    this.state = obj.state;
    if (this.onchange) {
      this.onchange(this.state);
    }
    const callback = this.observers.shift();
    if (callback) {
      callback(this.state);
    }
  }
}