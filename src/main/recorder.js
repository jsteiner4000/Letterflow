const { BrowserWindow, ipcMain } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const LADE_FRIST_MS = 10000;
const START_FRIST_MS = 10000;
const STOPP_WARTEZEIT_MS = 2000;

// Mikrofon in einem verborgenen Fenster ohne Grafik (AudioContext 16 kHz + AudioWorklet), getrennt von
// der Pille. Die PCM-Pakete kommen als 'pcm' (Float32Array) heraus; 'started' meldet, ob der Strom noch
// warm war (dann mit 300 ms Vorlauf). warmMs: so lange bleibt das Mikrofon nach einem Diktat offen.
function createRecorder({ warmMs = 15000 } = {}) {
  const events = new EventEmitter();
  let win = null;
  let bereit = null;
  let aktiv = false;
  const wartende = new Set(); // Funktionen, die auf 'started'/'stopped'/'error' warten
  events.warm = false; // letzter Start: war das Mikrofon schon offen?

  const vonRecorder = (event) => win && !win.isDestroyed() && event.sender === win.webContents;
  const melden = () => [...wartende].forEach((f) => f());
  const handler = {
    'recorder:ready': (event) => vonRecorder(event) && win.__bereit && win.__bereit(),
    'recorder:pcm': (event, daten) => {
      if (!vonRecorder(event)) return;
      // Vertrauensgrenze: nur ausgerichtete Float32-Daten annehmen, alles andere verwerfen.
      const ok =
        ArrayBuffer.isView(daten) && daten.byteOffset % 4 === 0 && daten.byteLength % 4 === 0;
      if (ok)
        events.emit('pcm', new Float32Array(daten.buffer, daten.byteOffset, daten.byteLength / 4));
    },
    'recorder:started': (event, warm) => {
      if (!vonRecorder(event)) return;
      events.warm = warm === true;
      melden();
    },
    'recorder:stopped': (event) => vonRecorder(event) && melden(),
    'recorder:error': (event, fehler) => {
      if (!vonRecorder(event)) return;
      aktiv = false;
      events.emit('recorder-error', { name: String((fehler && fehler.name) || 'Error') });
      melden();
    },
  };
  for (const [kanal, f] of Object.entries(handler)) ipcMain.on(kanal, f);

  function ensureWindow() {
    if (win && !win.isDestroyed()) return bereit;
    const diese = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      skipTaskbar: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false, // Aufnahme und Warmhalte-Timer dürfen nicht gedrosselt werden
      },
    });
    win = diese;
    diese.on('closed', () => {
      if (win === diese) win = null;
    });
    bereit = new Promise((resolve, reject) => {
      const frist = setTimeout(() => {
        if (win === diese) win = null;
        if (!diese.isDestroyed()) diese.destroy();
        reject(new Error('Mikrofon-Fenster hat nicht rechtzeitig geladen'));
      }, LADE_FRIST_MS);
      diese.__bereit = () => {
        clearTimeout(frist);
        resolve();
      };
    });
    bereit.catch(() => {});
    diese.loadFile(path.join(RENDERER, 'recorder.html'));
    return bereit;
  }

  const abwarten = (frist) =>
    new Promise((resolve) => {
      const fertig = () => {
        clearTimeout(timer);
        wartende.delete(fertig);
        resolve();
      };
      const timer = setTimeout(fertig, frist);
      wartende.add(fertig);
    });

  const senden = (kanal, wert) => {
    if (win && !win.isDestroyed()) win.webContents.send(kanal, wert);
  };

  Object.assign(events, {
    // Fenster vorab laden: der erste Start spart das Laden.
    prepare() {
      ensureWindow().catch(() => {});
    },
    async start(deviceId) {
      await ensureWindow();
      aktiv = true;
      const gemeldet = abwarten(START_FRIST_MS);
      senden('recorder:start', { deviceId: deviceId || null, warm: warmMs });
      await gemeldet;
    },
    async stop() {
      if (!aktiv || !win || win.isDestroyed()) return;
      aktiv = false;
      const gemeldet = abwarten(STOPP_WARTEZEIT_MS);
      senden('recorder:stop');
      await gemeldet;
    },
    destroy() {
      for (const [kanal, f] of Object.entries(handler)) ipcMain.removeListener(kanal, f);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  });
  Object.defineProperty(events, 'window', { get: () => win });
  return events;
}

module.exports = { createRecorder };
