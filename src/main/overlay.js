const { BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const BREITE = 420;
const PILLE_HOEHE = 44;
const HOEHE = 96; // Platz für Schatten (ca. 20 px) rundum, damit nichts hart abgeschnitten wird
const LADE_FRIST_MS = 10000;
const ABSTAND = 60; // zum unteren Rand des Bildschirms
const AUSBLEND_MS = 200; // etwas länger als der Fade im Renderer (180 ms)
const STOPP_WARTEZEIT_MS = 2000;

// Aufnahme-Pille: rahmenlos, transparent, nimmt nie den Fokus. Das Mikrofon läuft im Renderer
// (AudioContext 16 kHz + AudioWorklet), die PCM-Pakete kommen als 'pcm' (Float32Array) heraus.
function createOverlay() {
  const events = new EventEmitter();
  let win = null;
  let bereit = null; // Promise: Renderer ist initialisiert
  let ausblendTimer = null;
  let aufnahmeAktiv = false;
  const wartende = new Set(); // Funktionen, die auf 'gestartet'/'gestoppt' warten

  const vonOverlay = (event) => win && !win.isDestroyed() && event.sender === win.webContents;

  const onReady = (event) => {
    if (vonOverlay(event) && win.__bereit) win.__bereit();
  };
  const onPcm = (event, daten) => {
    if (!vonOverlay(event)) return;
    // Vertrauensgrenze: nur ausgerichtete Float32-Daten annehmen, alles andere verwerfen.
    const ok =
      ArrayBuffer.isView(daten) && daten.byteOffset % 4 === 0 && daten.byteLength % 4 === 0;
    if (!ok) return;
    events.emit('pcm', new Float32Array(daten.buffer, daten.byteOffset, daten.byteLength / 4));
  };
  const onFehler = (event, fehler) => {
    if (!vonOverlay(event)) return;
    aufnahmeAktiv = false;
    events.emit('recorder-error', { name: String((fehler && fehler.name) || 'Error') });
    for (const f of [...wartende]) f();
  };
  const onGemeldet = (event) => {
    if (vonOverlay(event)) for (const f of [...wartende]) f();
  };
  ipcMain.on('overlay:ready', onReady);
  ipcMain.on('overlay:pcm', onPcm);
  ipcMain.on('overlay:recorder-error', onFehler);
  ipcMain.on('overlay:started', onGemeldet);
  ipcMain.on('overlay:stopped', onGemeldet);

  function ensureWindow() {
    if (win && !win.isDestroyed()) return bereit;
    const diese = new BrowserWindow({
      width: BREITE,
      height: HOEHE,
      show: false,
      frame: false,
      transparent: true, // einzige Ausnahme von "deckender Hintergrund": die Pille schwebt frei
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false, // Aufnahme darf nicht gedrosselt werden
      },
    });
    win = diese;
    diese.setAlwaysOnTop(true, 'screen-saver');
    diese.setIgnoreMouseEvents(true);
    diese.on('closed', () => {
      if (win === diese) win = null;
    });
    bereit = new Promise((resolve, reject) => {
      const frist = setTimeout(() => {
        // Seite lädt nicht: Fenster verwerfen, damit ein neuer Versuch frisch beginnt.
        if (win === diese) win = null;
        if (!diese.isDestroyed()) diese.destroy();
        reject(new Error('Aufnahme-Fenster hat nicht rechtzeitig geladen'));
      }, LADE_FRIST_MS);
      diese.__bereit = () => {
        clearTimeout(frist);
        resolve();
      };
    });
    bereit.catch(() => {}); // Fehler wird von den Aufrufern behandelt
    diese.loadFile(path.join(RENDERER, 'overlay.html'));
    return bereit;
  }

  function positionieren() {
    const anzeige = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const a = anzeige.workArea;
    win.setBounds({
      x: Math.round(a.x + (a.width - BREITE) / 2),
      y: Math.round(a.y + a.height - ABSTAND - (HOEHE + PILLE_HOEHE) / 2),
      width: BREITE,
      height: HOEHE,
    });
  }

  const senden = (kanal, wert) => {
    if (win && !win.isDestroyed()) win.webContents.send(kanal, wert);
  };

  // Wartet auf eine Rückmeldung des Renderers (oder die Frist).
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

  Object.assign(events, {
    show(state) {
      ensureWindow()
        .then(() => {
          if (!win || win.isDestroyed()) return;
          clearTimeout(ausblendTimer);
          senden('overlay:state', { kind: state.kind, text: state.text });
          positionieren();
          // showInactive: kein Fokusklau; der Renderer blendet den fertigen Inhalt weich ein.
          if (!win.isVisible()) win.showInactive();
        })
        .catch(() => {}); // Pille bleibt aus, wenn das Fenster nicht lädt
    },
    level(n) {
      senden('overlay:level', Math.max(0, Math.min(1, Number(n) || 0)));
    },
    hide() {
      if (!win || win.isDestroyed()) return;
      senden('overlay:hide');
      clearTimeout(ausblendTimer);
      const diese = win;
      ausblendTimer = setTimeout(() => {
        if (!diese.isDestroyed()) diese.hide();
      }, AUSBLEND_MS);
    },
    async startRecording(deviceId) {
      await ensureWindow();
      aufnahmeAktiv = true;
      const gemeldet = abwarten(10000);
      senden('overlay:record-start', deviceId || null);
      await gemeldet;
    },
    async stopRecording() {
      if (!aufnahmeAktiv || !win || win.isDestroyed()) return;
      aufnahmeAktiv = false;
      const gemeldet = abwarten(STOPP_WARTEZEIT_MS);
      senden('overlay:record-stop');
      await gemeldet;
    },
    // Räumt Fenster und Handler ab (App-Ende, Tests).
    destroy() {
      clearTimeout(ausblendTimer);
      ipcMain.removeListener('overlay:ready', onReady);
      ipcMain.removeListener('overlay:pcm', onPcm);
      ipcMain.removeListener('overlay:recorder-error', onFehler);
      ipcMain.removeListener('overlay:started', onGemeldet);
      ipcMain.removeListener('overlay:stopped', onGemeldet);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  });
  // Getter getrennt definieren: Object.assign würde ihn nur einmal auswerten (null).
  Object.defineProperty(events, 'window', { get: () => win });
  return events;
}

module.exports = { createOverlay };
