// Brücke zum nativen Helfer (letterflow-helper.exe): JSON-Zeilen über stdin/stdout.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { createHotkeyMachine } = require('./hotkey-machine');

const TIMEOUT_MS = 1000;
const RESTART_DELAY_MS = 300;
const FOCUS_FALLBACK = { hwnd: 0, editable: 'unknown', elevated: false };
const PASTE_FALLBACK = { ok: false, reason: null };

class Helper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = true;
    this.nextId = 1;
    this.pending = new Map();
    this.machine = createHotkeyMachine('ctrl+win');
    this.preset = 'ctrl+win';
    this.mask = false;
  }

  start(cmd, args = []) {
    this.cmd = cmd;
    this.args = args;
    this.stopped = false;
    this._spawn();
  }

  _spawn() {
    const proc = spawn(this.cmd, this.args, {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.proc = proc;
    proc.stdin.on('error', () => {});
    readline.createInterface({ input: proc.stdout }).on('line', (l) => this._onLine(l));
    proc.on('error', () => {});
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this._resolveAll();
      this.machine = createHotkeyMachine(this.preset);
      if (!this.stopped) {
        this.restartTimer = setTimeout(() => {
          if (!this.stopped) this._spawn();
        }, RESTART_DELAY_MS);
      }
    });
  }

  _resolveAll() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(p.fallback);
    }
    this.pending.clear();
  }

  _onLine(line) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m.focus || m.paste || p.fallback);
      return;
    }
    if (m.ev === 'ready') {
      // Nach einem Neustart den Maskenzustand erneut setzen
      if (this.mask) this.send({ cmd: 'mask', on: true });
      this.emit('ready');
      return;
    }
    const r = this.machine.feed(m);
    if (r) this.emit('hotkey-' + r);
  }

  send(obj) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _request(obj, fallback) {
    return new Promise((resolve) => {
      if (!this.proc) return resolve(fallback);
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(fallback);
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, timer, fallback });
      this.send({ id, ...obj });
    });
  }

  setPreset(preset) {
    this.preset = preset;
    this.machine = createHotkeyMachine(preset);
  }

  focus() {
    return this._request({ cmd: 'focus' }, { ...FOCUS_FALLBACK });
  }

  paste(hwnd) {
    return this._request({ cmd: 'paste', hwnd }, { ...PASTE_FALLBACK });
  }

  setMask(on) {
    this.mask = !!on;
    this.send({ cmd: 'mask', on: !!on });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    const proc = this.proc;
    this.proc = null;
    this._resolveAll();
    if (proc) proc.kill();
  }
}

module.exports = { Helper };
