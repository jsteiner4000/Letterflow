// Brücke zum nativen Helfer (letterflow-helper.exe): JSON-Zeilen über stdin/stdout.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { createHotkeyMachine } = require('./hotkey-machine');

const TIMEOUT_MS = 1000;
const PASTE_TIMEOUT_MS = 4000; // der Helfer wartet bis zu 3 s, bis die Tasten losgelassen sind
// Wartezeiten vor Neustarts nach Abstürzen; bei MAX_FAILURES Ausfällen binnen einer Minute Aufgabe
const BACKOFF_MS = [300, 1000, 3000, 10000];
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60000;
const FOCUS_FALLBACK = { hwnd: 0, editable: 'unknown', elevated: false, exe: null, appName: null };
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
    this.backoffMs = BACKOFF_MS;
    this.failures = [];
  }

  // env: optional (Tests starten den Ersatz-Helfer mit ELECTRON_RUN_AS_NODE).
  start(cmd, args = [], env = undefined) {
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.stopped = false;
    this.failures = [];
    this._spawn();
  }

  _spawn() {
    const proc = spawn(this.cmd, this.args, {
      env: this.env,
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
      // Stürzt der Helfer bei gehaltenem Kürzel ab, muss die App die Aufnahme abbrechen
      const r = this.machine.reset();
      this.machine = createHotkeyMachine(this.preset);
      this.mask = false;
      if (r) this.emit('hotkey-' + r);
      if (this.stopped) return;
      const now = Date.now();
      this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
      this.failures.push(now);
      if (this.failures.length >= MAX_FAILURES) {
        this.stopped = true;
        this.emit('failed', 'Tastaturhelfer fällt immer wieder aus');
        return;
      }
      const delay = this.backoffMs[Math.min(this.failures.length - 1, this.backoffMs.length - 1)];
      this.restartTimer = setTimeout(() => {
        if (!this.stopped) this._spawn();
      }, delay);
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
      this.emit('ready');
      return;
    }
    const r = this.machine.feed(m);
    if (r) this.emit('hotkey-' + r);
  }

  send(obj) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _request(obj, fallback, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve) => {
      if (!this.proc) return resolve(fallback);
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(fallback);
      }, timeoutMs);
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
    return this._request({ cmd: 'paste', hwnd }, { ...PASTE_FALLBACK }, PASTE_TIMEOUT_MS);
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
