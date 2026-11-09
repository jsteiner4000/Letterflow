const {
  app: electronApp,
  BrowserWindow,
  ipcMain,
  screen,
  nativeTheme,
  desktopCapturer,
} = require('electron');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const BREITE = 420;
const PILLE_HOEHE = 60;
const BAND = 16; // Rand (DIP) über und unter der Pille im erfassten Streifen; der Renderer kennt ihn auch
const ERFASSEN_ALLE_MS = 750;
const ERFASSEN_FRIST_MS = 400; // länger: gilt als Fehler, die Pille bleibt getönt
const HOEHE = 152; // ganze Gerätepixel bei 125 % (190 px); Platz für Schatten (32 px Weichheit, 12 px nach unten) und den Weg beim Ein-/Ausblenden
const LADE_FRIST_MS = 10000;
const ABSTAND = 60; // zum unteren Rand des Bildschirms

// Aufnahme-Pille: rahmenlos, transparent, klickdurchlässig, nimmt nie den Fokus. Das Fenster bleibt
// nach dem ersten Laden dauerhaft gezeigt (im Ruhezustand völlig durchsichtig, kein Bild, keine
// Timer): ein verborgenes Fenster neu zu zeigen liefert zuerst alte oder gar keine Bilder, das
// Aufploppen wäre unsichtbar.
//
// Echtes Glas: Das Fenster ist von Bildschirmaufnahmen ausgenommen (setContentProtection). Der Streifen
// unter der Pille wird vor dem Erscheinen und danach alle 750 ms erfasst (schnell über den Helfer,
// sonst desktopCapturer) und nur im Speicher an den Renderer gegeben. Nichts wird gespeichert oder gesendet.
function createOverlay({ getSettings = () => ({}), capture = true, grab = null } = {}) {
  const events = new EventEmitter();
  let win = null;
  let bereit = null; // Promise: Renderer ist initialisiert
  let erfassung = null; // { timer } solange die Pille sichtbar ist
  let gezeigt = false; // zwischen show und hide
  let kette = Promise.resolve(); // show/hide nacheinander (show wartet kurz auf den Hintergrund)
  const reihe = (f) =>
    (kette = kette
      .then(f)
      .catch((fehler) => console.error('Aufnahme-Pille nicht angezeigt:', fehler.message)));
  const erfassenAn = () => capture && !nativeTheme.prefersReducedTransparency;
  // Schwacher PC (für „Automatisch“): kein GPU-Compositing oder < 4 Kerne. Bestimmt, sobald der
  // GPU-Prozess sich meldet (vorher meldet Chromium noch Software).
  let schwach = os.availableParallelism() < 4;
  const gpuPruefen = () => {
    const gpu = String(electronApp.getGPUFeatureStatus().gpu_compositing || '');
    schwach = os.availableParallelism() < 4 || !gpu.startsWith('enabled');
  };
  electronApp.on('gpu-info-update', gpuPruefen);
  const vonOverlay = (event) => win && !win.isDestroyed() && event.sender === win.webContents;

  const onReady = (event) => {
    if (vonOverlay(event) && win.__bereit) win.__bereit();
  };
  // Erscheinen ist fertig (Anteil verworfener Bilder oder null).
  const onErschienen = (event, anteil) => {
    if (!vonOverlay(event)) return;
    if (Number.isFinite(anteil) && anteil >= 0 && anteil <= 1) events.emit('animation', anteil);
  };
  ipcMain.on('overlay:ready', onReady);
  ipcMain.on('overlay:erschienen', onErschienen);

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
        backgroundThrottling: false, // dauerhaft gezeigt, aber nie gedrosselt
      },
    });
    win = diese;
    diese.setContentProtection(true);
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
        // Einmal zeigen und gezeigt lassen (Pille noch durchsichtig); showInactive: kein Fokusklau.
        positionieren();
        diese.showInactive();
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

  // Vertrauensgrenze zum Renderer: nur bekannte Felder in erwarteter Form weitergeben.
  const BILD_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const ARTEN = new Set(['aufnahme', 'verarbeitung', 'erfolg', 'warnung', 'fehler', 'info']);
  function zustand(state) {
    const s = { kind: ARTEN.has(state.kind) ? state.kind : 'info' };
    if (typeof state.text === 'string') s.text = state.text.slice(0, 200);
    if (Number.isInteger(state.words) && state.words >= 0) s.words = state.words;
    const app = state.app;
    if (app && typeof app.name === 'string') {
      const bild = app.iconDataUrl;
      const bildOk = typeof bild === 'string' && bild.length <= 64 * 1024 && BILD_URL.test(bild);
      s.app = { name: app.name.slice(0, 80), iconDataUrl: bildOk ? bild : null };
    }
    // Windows „Transparenzeffekte“ aus → Glas deckend
    s.deckend = Boolean(nativeTheme.prefersReducedTransparency);
    const p = getSettings().pill || {};
    s.pille = p;
    s.erfassen = capture && !s.deckend; // Renderer wartet kurz auf den Hintergrund (Wobble)
    // „Automatisch“: aus auf schwachen PCs oder nach gemessenem Ruckeln.
    s.animation =
      p.animation === 'an' || (p.animation !== 'aus' && !p.animationAutoOff && !schwach);
    return s;
  }

  const senden = (kanal, wert) => {
    if (win && !win.isDestroyed()) win.webContents.send(kanal, wert);
  };

  // Streifen unter der Pille erfassen (Bildschirm unter dem Fenster, in Bildpunkten des Bildschirms).
  async function erfassen() {
    const b = win.getBounds();
    const anzeige = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const f = anzeige.scaleFactor;
    const oben = b.y + (HOEHE - PILLE_HOEHE) / 2 - BAND;
    if (grab) {
      // Helfer (GDI, nur dieser Ausschnitt, wenige ms); die Pille selbst ist ausgenommen.
      const r = screen.dipToScreenRect(win, {
        x: b.x,
        y: oben,
        width: b.width,
        height: PILLE_HOEHE + 2 * BAND,
      });
      const g = await grab({ x: r.x, y: r.y, w: r.width, h: r.height });
      if (g) return { width: g.w, height: g.h, scale: f, bgra: g.bgra };
    }
    const quellen = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(anzeige.size.width * f),
        height: Math.round(anzeige.size.height * f),
      },
    });
    const quelle = quellen.find((q) => q.display_id === String(anzeige.id)) || quellen[0];
    if (!quelle || quelle.thumbnail.isEmpty()) throw new Error('keine Aufnahme');
    const bild = quelle.thumbnail.crop({
      x: Math.max(0, Math.round((b.x - anzeige.bounds.x) * f)),
      y: Math.max(0, Math.round((oben - anzeige.bounds.y) * f)),
      width: Math.round(b.width * f),
      height: Math.round((PILLE_HOEHE + 2 * BAND) * f),
    });
    const { width, height } = bild.getSize();
    return { width, height, scale: f, bgra: bild.toBitmap() };
  }

  // Eine Erfassung; null bei Fehler oder Überschreiten der Frist (dann bleibt die Pille getönt).
  async function erfassenEinmal() {
    const t0 = Date.now();
    const ergebnis = await erfassen().catch(() => null);
    const ms = Date.now() - t0;
    events.emit('erfasst', ms);
    return ms > ERFASSEN_FRIST_MS ? null : ergebnis;
  }

  // Auffrischen, solange die Pille sichtbar ist; `sofort`: erste Runde gleich (kein Streifen vorab).
  function erfassenStarten(sofort) {
    if (!erfassenAn() || erfassung) return;
    const lauf = (erfassung = { timer: null });
    const runde = async () => {
      const ergebnis = await erfassenEinmal();
      if (erfassung !== lauf || !win || win.isDestroyed()) return;
      senden('overlay:backdrop', ergebnis); // null: zurück zum getönten Glas, kein weiterer Versuch
      if (!ergebnis) erfassung = null;
      else lauf.timer = setTimeout(runde, ERFASSEN_ALLE_MS);
    };
    lauf.timer = setTimeout(runde, sofort ? 0 : ERFASSEN_ALLE_MS);
  }
  function erfassenStoppen() {
    if (erfassung) clearTimeout(erfassung.timer);
    erfassung = null;
  }

  Object.assign(events, {
    show(state) {
      reihe(async () => {
        await ensureWindow();
        if (!win || win.isDestroyed()) return;
        // Das Fenster bleibt dauerhaft gezeigt; andere Fenster (z. B. nach Bildschirmwechsel oder
        // Vollbild) können sich davorschieben. Daher bei jedem Zeigen wieder ganz nach oben.
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
        let streifen = null;
        if (!gezeigt) {
          gezeigt = true;
          // Größe bleibt fest; während der Anzeige nicht mehr verschieben. Den Hintergrund schnell
          // vorab holen (die Pille ist noch durchsichtig): der Wobble hat ihn ab dem ersten Bild.
          positionieren();
          if (grab && erfassenAn()) streifen = await erfassenEinmal();
        }
        senden('overlay:state', zustand(state));
        if (streifen) senden('overlay:backdrop', streifen);
        erfassenStarten(!streifen);
      });
    },
    // Fenster vorab laden und zeigen, damit schon das erste Kürzel die Pille sofort zeigt.
    prepare() {
      ensureWindow().catch(() => {});
    },
    level(n) {
      senden('overlay:level', Math.max(0, Math.min(1, Number(n) || 0)));
    },
    // Pille verschwindet im Renderer; das Fenster bleibt (durchsichtig) gezeigt.
    hide() {
      reihe(() => {
        if (!win || win.isDestroyed()) return;
        senden('overlay:hide');
        gezeigt = false;
        erfassenStoppen();
      });
    },
    // Räumt Fenster und Handler ab (App-Ende, Tests).
    destroy() {
      erfassenStoppen();
      electronApp.removeListener('gpu-info-update', gpuPruefen);
      ipcMain.removeListener('overlay:ready', onReady);
      ipcMain.removeListener('overlay:erschienen', onErschienen);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  });
  // Getter getrennt definieren: Object.assign würde ihn nur einmal auswerten (null).
  Object.defineProperty(events, 'window', { get: () => win });
  return events;
}

module.exports = { createOverlay };
