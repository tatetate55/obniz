const WSCommand = require('./libs/wscommand');
const emitter = require('eventemitter3');

const isNode = typeof window === 'undefined';

module.exports = class ObnizConnection {
  constructor(id, options) {
    this.isNode = isNode;
    this.id = id;
    this.socket = null;
    this.socket_local = null;
    this.debugprint = false;
    this.debugprintBinary = false;
    this.debugs = [];
    this.onConnectCalled = false;
    this.bufferdAmoundWarnBytes = 100 * 1000; // 100k bytes
    this.emitter = new emitter();
    this._prepareComponents();

    if (!options) {
      options = {};
    }
    this.options = {
      binary: options.binary === false ? false : true,
      local_connect: options.local_connect === false ? false : true,
      debug_dom_id: options.debug_dom_id || 'obniz-debug',
      auto_connect: options.auto_connect === false ? false : true,
      access_token: options.access_token || null,
      obniz_server: options.obniz_server || 'wss://obniz.io',
      reset_obniz_on_ws_disconnection:
        options.reset_obniz_on_ws_disconnection === false ? false : true,
    };
    if (this.options.binary) {
      this.wscommand = this.constructor.WSCommand;
      let classes = this.constructor.WSCommand.CommandClasses;
      this.wscommands = [];
      for (let class_name in classes) {
        this.wscommands.push(new classes[class_name]());
      }
    }
    if (this.options.auto_connect) {
      this.wsconnect();
    }
  }

  prompt(filled, callback) {
    let obnizid = prompt('Please enter obniz id', filled);
    if (obnizid) {
      callback(obnizid);
    }
  }

  static get version() {
    let packageJson = require('../package.json');
    return packageJson.version;
  }

  wsOnOpen() {
    this.print_debug('ws connected');
    // wait for {ws:{ready:true}} object
    if (typeof this.onopen === 'function') {
      this.onopen(this);
    }
  }

  wsOnMessage(data) {
    if (this.debugprintBinary && typeof data !== 'string') {
      this.print_debug('' + new Uint8Array(data).toString());
    }

    let json;
    if (typeof data === 'string') {
      json = JSON.parse(data);
    } else if (this.wscommands) {
      //binary
      json = this.binary2Json(data);
    }

    if (Array.isArray(json)) {
      for (let i in json) {
        this.notifyToModule(json[i]);
      }
    } else {
      //invalid json
    }
  }

  wsOnClose(event) {
    this.print_debug('closed');
    this.close();
    this.emitter.emit('closed');
    if (typeof this.onclose === 'function' && this.onConnectCalled == true) {
      this.onclose(this);
    }
    this.onConnectCalled = false;
    if (this.options.auto_connect) {
      setTimeout(() => {
        this.wsconnect(); // always connect to mainserver if ws lost
      }, 1000);
    }
  }

  connectWait(option) {
    option = option || {};
    let timeout = option.timeout || null;

    return new Promise((resolve, reject) => {
      if (this.onConnectCalled) {
        resolve(true);
        return;
      }
      this.emitter.once('connected', () => {
        resolve(true);
      });
      if (!this.options.auto_connect) {
        this.emitter.once('closed', () => {
          resolve(false);
        });
      }
      if (timeout) {
        setTimeout(() => {
          resolve(false);
        }, timeout * 1000);
      }
      this.connect();
    });
  }

  wsOnError(event) {
    // console.error(event);
  }

  wsOnUnexpectedResponse(req, res) {
    let reconnectTime = 1000;
    if (res && res.statusCode == 404) {
      this.print_debug('obniz not online');
    } else {
      reconnectTime = 5000; // server error or someting
      this.print_debug('invalid server response ' + res ? res.statusCode : '');
    }
    this.clearSocket(this.socket);
    delete this.socket;
    if (this.options.auto_connect) {
      setTimeout(() => {
        this.wsconnect(); // always connect to mainserver if ws lost
      }, reconnectTime);
    }
  }

  wsconnect(desired_server) {
    let server = this.options.obniz_server;
    if (desired_server) {
      server = '' + desired_server;
    }

    if (this.socket && this.socket.readyState <= 1) {
      this.close();
    }

    let url = server + '/obniz/' + this.id + '/ws/1';

    let query = [];
    if (this.constructor.version) {
      query.push('obnizjs=' + this.constructor.version);
    }
    if (this.options.access_token) {
      query.push('access_token=' + this.options.access_token);
    }
    if (this.wscommand) {
      query.push('accept_binary=true');
    }
    if (query.length > 0) {
      url += '?' + query.join('&');
    }
    this.print_debug('connecting to ' + url);

    let socket;
    if (this.isNode) {
      const wsClient = require('ws');
      socket = new wsClient(url);
      socket.on('open', this.wsOnOpen.bind(this));
      socket.on('message', this.wsOnMessage.bind(this));
      socket.on('close', this.wsOnClose.bind(this));
      socket.on('error', this.wsOnError.bind(this));
      socket.on('unexpected-response', this.wsOnUnexpectedResponse.bind(this));
    } else {
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = this.wsOnOpen.bind(this);
      socket.onmessage = function(event) {
        this.wsOnMessage(event.data);
      }.bind(this);
      socket.onclose = this.wsOnClose.bind(this);
      socket.onerror = this.wsOnError.bind(this);
    }
    this.socket = socket;
  }

  _connectLocal(host) {
    const url = 'ws://' + host;
    this.print_debug('local connect to ' + url);
    let ws;
    if (this.isNode) {
      const wsClient = require('ws');
      ws = new wsClient(url);
      ws.on('open', () => {
        this.print_debug('connected to ' + url);
        this._callOnConnect();
      });
      ws.on('message', data => {
        this.print_debug('recvd via local');
        this.wsOnMessage(data);
      });
      ws.on('close', event => {
        console.log('local websocket closed');
        this._disconnectLocal();
      });
      ws.on('error', err => {
        console.error('local websocket error.', err);
        this._disconnectLocal();
      });
      ws.on('unexpected-response', event => {
        console.log('local websocket closed');
        this._disconnectLocal();
      });
    } else {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.print_debug('connected to ' + url);
        this._callOnConnect();
      };
      ws.onmessage = event => {
        this.print_debug('recvd via local');
        this.wsOnMessage(event.data);
      };
      ws.onclose = event => {
        console.log('local websocket closed');
        this._disconnectLocal();
      };
      ws.onerror = err => {
        console.log('local websocket error.', err);
        this._disconnectLocal();
      };
    }
    this.socket_local = ws;
  }

  _disconnectLocal() {
    if (this.socket_local) {
      if (this.socket.readyState <= 1) {
        this.socket_local.close();
      }
      this.clearSocket(this.socket_local);
      delete this.socket_local;
    }
    if (this._waitForLocalConnectReadyTimer) {
      clearTimeout(this._waitForLocalConnectReadyTimer);
      this._waitForLocalConnectReadyTimer = null;
      this._callOnConnect(); /* should call. onlyl local connect was lost. and waiting. */
    }
  }

  clearSocket(socket) {
    if (!socket) return;
    /* send queue */
    if (this._sendQueueTimer) {
      delete this._sendQueue;
      clearTimeout(this._sendQueueTimer);
      this._sendQueueTimer = null;
    }
    /* unbind */
    if (this.isNode) {
      let shouldRemoveObservers = [
        'open',
        'message',
        'close',
        'error',
        'unexpected-response',
      ];
      for (let i = 0; i < shouldRemoveObservers.length; i++) {
        socket.removeAllListeners(shouldRemoveObservers[i]);
      }
    } else {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
  }

  connect() {
    if (this.socket && this.socket.readyState <= 1) {
      return;
    }
    this.wsconnect();
  }

  close() {
    this._drainQueued();
    this._disconnectLocal();
    if (this.socket) {
      if (this.socket.readyState <= 1) {
        // Connecting & Connected
        this.socket.close(1000, 'close');
      }
      this.clearSocket(this.socket);
      delete this.socket;
    }
  }

  _callOnConnect() {
    let shouldCall = true;
    if (this._waitForLocalConnectReadyTimer) {
      /* obniz.js has wait local_connect */
      clearTimeout(this._waitForLocalConnectReadyTimer);
      this._waitForLocalConnectReadyTimer = null;
    } else {
      /* obniz.js hasn't wait local_connect */
      if (this.socket_local && this.socket_local.readyState === 1) {
        /* delayed connect */
        shouldCall = false;
      } else {
        /* local_connect is not used */
      }
    }

    this.emitter.emit('connected');

    if (shouldCall) {
      if (typeof this.onconnect !== 'function') return;
      const promise = this.onconnect(this);
      if (promise instanceof Promise) {
        promise.catch(err => {
          console.error(err);
        });
      }
      this.onConnectCalled = true;
    }
  }

  print_debug(str) {
    if (this.debugprint) {
      console.log('Obniz: ' + str);
    }
  }

  send(obj, options) {
    if (!obj || typeof obj !== 'object') {
      console.log('obnizjs. didnt send ', obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.send(obj[i]);
      }
      return;
    }
    if (this.sendPool) {
      this.sendPool.push(obj);
      return;
    }

    let sendData = JSON.stringify([obj]);
    if (this.debugprint) {
      this.print_debug('send: ' + sendData);
    }
    /* compress */
    if (
      this.wscommand &&
      (typeof options !== 'object' || options.local_connect !== false)
    ) {
      let compressed;
      try {
        compressed = this.wscommand.compress(
          this.wscommands,
          JSON.parse(sendData)[0]
        );
        if (compressed) {
          sendData = compressed;
          if (this.debugprintBinary) {
            this.print_debug(
              'binalized: ' + new Uint8Array(compressed).toString()
            );
          }
        }
      } catch (e) {
        this.error('------ errored json -------');
        this.error(sendData);
        throw e;
      }
    }

    /* queue sending */
    if (typeof sendData === 'string') {
      this._drainQueued();
      this._sendRouted(sendData);
    } else {
      if (this._sendQueue) {
        this._sendQueue.push(sendData);
      } else {
        this._sendQueue = [sendData];
        this._sendQueueTimer = setTimeout(this._drainQueued.bind(this), 0);
      }
    }
  }

  _sendRouted(data) {
    if (
      this.socket_local &&
      this.socket_local.readyState === 1 &&
      typeof data !== 'string'
    ) {
      this.print_debug('send via local');
      this.print_debug(data);
      this.socket_local.send(data);
      if (this.socket_local.bufferedAmount > this.bufferdAmoundWarnBytes) {
        this.error(
          'Warning: over ' + this.socket_local.bufferedAmount + ' bytes queued'
        );
      }
      return;
    }

    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(data);
      if (this.socket.bufferedAmount > this.bufferdAmoundWarnBytes) {
        this.error(
          'Warning: over ' + this.socket.bufferedAmount + ' bytes queued'
        );
      }
      return;
    }
  }

  _drainQueued() {
    if (!this._sendQueue) return;
    let expectSize = 0;
    for (let i = 0; i < this._sendQueue.length; i++) {
      expectSize += this._sendQueue[i].length;
    }
    let filled = 0;
    let sendData = new Uint8Array(expectSize);
    for (let i = 0; i < this._sendQueue.length; i++) {
      sendData.set(this._sendQueue[i], filled);
      filled += this._sendQueue[i].length;
    }
    this._sendRouted(sendData);
    delete this._sendQueue;
    clearTimeout(this._sendQueueTimer);
    this._sendQueueTimer = null;
  }

  _prepareComponents() {}

  notifyToModule(obj) {
    this.print_debug(JSON.stringify(obj));

    if (obj['ws']) {
      this.handleWSCommand(obj['ws']);
      return;
    }
    if (obj['system']) {
      this.handleSystemCommand(obj['system']);
      return;
    }
  }

  _canConnectToInsecure() {
    if (this.isNode) {
      return true;
    } else {
      return location.protocol != 'https:';
    }
  }

  handleWSCommand(wsObj) {
    if (wsObj.ready) {
      this.firmware_ver = wsObj.obniz.firmware;
      if (this.options.reset_obniz_on_ws_disconnection) {
        this.resetOnDisconnect(true);
      }
      if (
        wsObj.local_connect &&
        wsObj.local_connect.ip &&
        this.wscommand &&
        this.options.local_connect &&
        this._canConnectToInsecure()
      ) {
        this._connectLocal(wsObj.local_connect.ip);
        this._waitForLocalConnectReadyTimer = setTimeout(() => {
          this._callOnConnect();
        }, 3000);
      } else {
        this._callOnConnect();
      }
    }
    if (wsObj.redirect) {
      let server = wsObj.redirect;
      this.print_debug('WS connection changed to ' + server);

      /* close current ws immidiately */
      /*  */
      this.socket.close(1000, 'close');
      this.clearSocket(this.socket);
      delete this.socket;

      /* connect to new server */
      this.wsconnect(server);
    }
  }

  handleSystemCommand(wsObj) {}

  static get WSCommand() {
    return WSCommand;
  }

  binary2Json(binary) {
    let data = new Uint8Array(binary);
    let json = [];
    while (data !== null) {
      const frame = WSCommand.dequeueOne(data);
      if (!frame) break;
      let obj = {};
      for (let i = 0; i < this.wscommands.length; i++) {
        const command = this.wscommands[i];
        if (command.module === frame.module) {
          command.notifyFromBinary(obj, frame.func, frame.payload);
          break;
        }
      }
      json.push(obj);
      data = frame.next;
    }
    return json;
  }

  warning(msg) {
    console.log('warning:' + msg);
  }

  error(msg) {
    console.error('error:' + msg);
  }
};
