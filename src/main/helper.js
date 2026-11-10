// Brücke zum nativen Helfer (letterflow-helper.exe): JSON-Zeilen über stdin/stdout.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { createHotkeyMachine } = require('./hotkey-machine');

const TIMEOUT_MS = 1000;
const GRAB_TIMEOUT_MS = 150;
const VOLLBILD_TIMEOUT_MS = 150;
const PASTE_TIMEOUT_MS = 5000; // bis zu 3 s auf losgelassene Tasten, dazu Fensterwechsel und Rückkehr
// Wartezeiten vor Neustarts nach Abstürzen; bei MAX_FAILURES Ausfällen binnen einer Minute Aufgabe
const BACKOFF_MS = [300, 1000, 3000, 10000];
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60000;
const FOCUS_FALLBACK = { hwnd: 0, editable: 'unknown', elevated: false, exe: null, appName: null };
const PASTE_FALLBACK = { ok: false, reason: null };

// Vertrauensgrenze: Base64 aus dem Helfer → Float32Array (16 kHz mono); alles andere wird verworfen.
function pcmLesen(b64) {
  if (typeof b64 !== 'string') return null;
  const roh = Buffer.from(b64, 'base64');
  if (roh.length % 4) return null;
  const pcm = new Float32Array(roh.length / 4);
  new Uint8Array(pcm.buffer).set(roh); // kopieren: Buffer ist nicht immer auf 4 Byte ausgerichtet
  return pcm;
}

class Helper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = true;
    this.nextId = 1;
    this.pending = new Map();
    this.machine = createHotkeyMachine('rctrl');
    this.preset = 'rctrl';
    this.mode = 'halten';
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
      this.machine = createHotkeyMachine(this.preset, this.mode);
      this.mask = false;
      if (r) this.emit('hotkey-' + r);
      this.emit('mic', { error: 'Error', stopped: true }); // laufende Aufnahme ist mit dem Helfer weg
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
      p.resolve(m.focus || m.paste || m.grab || m.vollbild || p.fallback);
      return;
    }
    if (m.ev === 'ready') {
      this.emit('ready');
      return;
    }
    if (m.ev === 'pcm') {
      const pcm = pcmLesen(m.b);
      if (pcm) this.emit('pcm', pcm);
      return;
    }
    if (m.ev === 'mic') {
      const error = typeof m.error === 'string' ? m.error.slice(0, 40) : null;
      this.emit('mic', {
        started: m.started === true,
        warm: m.warm === true,
        stopped: m.stopped === true,
        error,
      });
      return;
    }
    if (m.ev === 'vordergrund') {
      const text = (v) => (typeof v === 'string' && v.length < 1024 ? v : null);
      this.emit('vordergrund', { exe: text(m.exe), appName: text(m.appName), icon: text(m.icon) });
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

  setPreset(preset, mode = 'halten') {
    this.preset = preset;
    this.mode = mode;
    this.machine = createHotkeyMachine(preset, mode);
  }

  focus() {
    return this._request({ cmd: 'focus' }, { ...FOCUS_FALLBACK });
  }

  // restore: Ist das Zielfenster nicht mehr vorn, holt der Helfer es nach vorn, fügt ein und kehrt zurück.
  // Antwort: { ok, reason } mit reason 'tasten-gehalten' | 'fenster-gewechselt' (weg, erhöht oder nicht aktivierbar).
  paste(hwnd, restore = true) {
    return this._request({ cmd: 'paste', hwnd, restore }, { ...PASTE_FALLBACK }, PASTE_TIMEOUT_MS);
  }

  // Bildschirmausschnitt in Gerätepixeln: { w, h, bgra (Buffer) } oder null.
  async grab({ x, y, w, h }) {
    const r = await this._request({ cmd: 'grab', x, y, w, h }, null, GRAB_TIMEOUT_MS);
    const ok = r && r.w === w && r.h === h && typeof r.bgra === 'string';
    const bgra = ok && Buffer.from(r.bgra, 'base64');
    return bgra && bgra.length === w * h * 4 ? { w, h, bgra } : null;
  }

  // Mikrofon an (Gerätename oder null = Windows-Standard) oder aus; Antworten kommen als 'mic'/'pcm'.
  // warmMs: so lange bleibt das Gerät nach dem Aus geöffnet, aber gestoppt (kein Ton, kein Mikrofon-Symbol).
  mic(on, device = null, warmMs = 0) {
    this.send({ cmd: 'mic', on: !!on, device: on ? device : null, warm: warmMs });
  }

  // Läuft ein Vollbildprogramm (Spiel, Video, Präsentation)? Im Zweifel nein.
  vollbild() {
    return this._request({ cmd: 'vollbild' }, false, VOLLBILD_TIMEOUT_MS);
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

module.exports = { Helper, pcmLesen };
