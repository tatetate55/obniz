class Grove_Button {

  public static info() {
    return {
      name: "Grove_Button",
    };
  }

  public keys: any;
  public requiredKeys: any;
  public onChangeForStateWait: any;
  public io_signal: any;
  public params: any;
  public io_vcc: any;
  public io_supply: any;
  public isPressed: any;
  public onchange: any;

  constructor() {
    this.keys = ["signal", "gnd", "vcc"];
    this.requiredKeys = ["signal"];

    this.onChangeForStateWait = () => {
    };
  }

  public wired(obniz: any) {
    this.io_signal = obniz.getIO(this.params.signal);

    if (obniz.isValidIO(this.params.vcc)) {
      this.io_vcc = obniz.getIO(this.params.vcc);
      this.io_vcc.output(true);
    }

    if (obniz.isValidIO(this.params.gnd)) {
      this.io_supply = obniz.getIO(this.params.gnd);
      this.io_supply.output(false);
    }

    this.io_signal.pull("5v");

    const self: any = this;
    this.io_signal.input((value: any) => {
      self.isPressed = value;
      if (self.onchange) {
        self.onchange(value);
      }
      self.onChangeForStateWait(value);
    });
  }

  public async isPressedWait() {
    const ret: any = await this.io_signal.inputWait();
    return ret;
  }

  public stateWait(isPressed: any) {
    return new Promise((resolve, reject) => {
      this.onChangeForStateWait = (pressed) => {
        if (isPressed === pressed) {
          this.onChangeForStateWait = () => {
          };
          resolve();
        }
      };
    });
  }
}

if (typeof module === "object") {
  module.exports = Grove_Button;
}
