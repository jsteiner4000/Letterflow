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
const BREITE = 500; // breiteste Pille (408) plus Platz für den Schatten
const PILLE_HOEHE = 72;
const BAND = 16; // Rand (DIP) über und unter der Pille im erfassten Streifen; der Renderer kennt ihn auch
const ERFASSEN_ALLE_MS = 750;
const ERFASSEN_FRIST_MS = 400; // länger: gilt als Fehler, die Pille bleibt getönt
const HOEHE = 168; // ganze Gerätepixel bei 125 % (210 px); Platz für Schatten (32 px Weichheit, 12 px nach unten) und den Weg beim Ein-/Ausblenden
const LADE_FRIST_MS = 10000;
const ABSTAND = 60; // zum unteren Rand des Bildschirms
const BILD_FRIST_MS = 200; // so lange höchstens auf die ersten Bilder des gezeigten Fensters warten
const WEG_FRIST_MS = 1000; // Rückfall, falls der Renderer das Ende des Verschwindens nicht meldet

// Aufnahme-Pille: rahmenlos, transparent, klickdurchlässig, nimmt nie den Fokus. Das Fenster ist nur
// beim Diktieren gezeigt; der Renderer bleibt geladen. Gegen alte Bilder und unsichtbares Aufploppen:
// Verborgen wird erst, wenn die Pille ganz verschwunden und dieses leere Bild gezeichnet ist (der
// Renderer meldet 'overlay:weg'); beim Zeigen beginnt das Aufploppen erst, wenn das Fenster Bilder
// liefert (Antwort 'overlay:gezeigt' nach zwei Bildern).
//
// Vollbild (Spiel, Video, Präsentation): keine Pille und keine Erfassung; das Diktat läuft trotzdem.
//
// Echtes Glas: Das Fenster ist von Bildschirmaufnahmen ausgenommen (setContentProtection). Der Streifen
// unter der Pille wird vor dem Erscheinen und danach alle 750 ms erfasst (schnell über den Helfer,
// sonst desktopCapturer) und nur im Speicher an den Renderer gegeben. Nichts wird gespeichert oder gesendet.
function createOverlay({
  getSettings = () => ({}),
  capture = true,
  grab = null,
  vollbild = async () => false,
} = {}) {
  const events = new EventEmitter();
  let win = null;
  let bereit = null; // Promise: Renderer ist initialisiert
  let erfassung = null; // { timer } solange die Pille sichtbar ist
  let gezeigt = false; // zwischen show und hide
  let unterdrueckt = false; // Vollbild beim Erscheinen: bis zum nächsten hide nichts zeigen
  let bildWarten = null; // Funktion, die das Warten auf 'overlay:gezeigt' beendet
  let wegTimer = null;
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
  const onGezeigt = (event) => vonOverlay(event) && bildWarten && bildWarten();
  // Pille ist verschwunden und das leere Bild gezeichnet: jetzt verbergen (außer sie kommt gerade wieder).
  const verbergen = () => {
    clearTimeout(wegTimer);
    if (!gezeigt && win && !win.isDestroyed() && win.isVisible()) win.hide();
  };
  const onWeg = (event) => vonOverlay(event) && verbergen();
  ipcMain.on('overlay:ready', onReady);
  ipcMain.on('overlay:erschienen', onErschienen);
  ipcMain.on('overlay:gezeigt', onGezeigt);
  ipcMain.on('overlay:weg', onWeg);

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
      if (app.laedt === true) s.app.laedt = true; // Symbol lädt noch: neutraler Platzhalter
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
    if (await vollbild()) throw new Error('Vollbild'); // nie über einem Vollbildprogramm erfassen
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
        if (!win || win.isDestroyed() || unterdrueckt) return;
        let streifen = null;
        if (!gezeigt) {
          // Ein Helfer-Aufruf (wenige ms): läuft ein Vollbildprogramm, bleibt die Pille aus.
          if (await vollbild()) {
            unterdrueckt = true;
            return;
          }
          gezeigt = true;
          clearTimeout(wegTimer);
          // Größe bleibt fest; während der Anzeige nicht mehr verschieben. Den Hintergrund schnell
          // vorab holen (Fenster noch verborgen): der Wobble hat ihn ab dem ersten Bild.
          if (!win.isVisible()) positionieren();
          if (grab && erfassenAn()) streifen = await erfassenEinmal();
          if (!win || win.isDestroyed()) return;
          // Bei jedem Zeigen wieder ganz nach oben (andere oberste Fenster schieben sich sonst davor).
          win.setAlwaysOnTop(true, 'screen-saver');
          win.showInactive(); // kein Fokusklau
          win.moveTop();
          // Erst aufploppen, wenn das Fenster Bilder liefert; sonst fehlen die ersten Bilder.
          await new Promise((resolve) => {
            const fertig = () => {
              clearTimeout(t);
              bildWarten = null;
              resolve();
            };
            const t = setTimeout(fertig, BILD_FRIST_MS);
            bildWarten = fertig;
            senden('overlay:zeigen');
          });
        }
        senden('overlay:state', zustand(state));
        if (streifen) senden('overlay:backdrop', streifen);
        erfassenStarten(!streifen);
      });
    },
    // Fenster vorab laden (verborgen), damit schon das erste Kürzel die Pille sofort zeigt.
    prepare() {
      ensureWindow().catch(() => {});
    },
    level(n) {
      senden('overlay:level', Math.max(0, Math.min(1, Number(n) || 0)));
    },
    // Pille verschwindet im Renderer; danach wird das Fenster verborgen ('overlay:weg').
    hide() {
      reihe(() => {
        unterdrueckt = false;
        if (!win || win.isDestroyed()) return;
        senden('overlay:hide');
        gezeigt = false;
        erfassenStoppen();
        clearTimeout(wegTimer);
        wegTimer = setTimeout(verbergen, WEG_FRIST_MS);
      });
    },
    // Räumt Fenster und Handler ab (App-Ende, Tests).
    destroy() {
      erfassenStoppen();
      electronApp.removeListener('gpu-info-update', gpuPruefen);
      ipcMain.removeListener('overlay:ready', onReady);
      ipcMain.removeListener('overlay:erschienen', onErschienen);
      ipcMain.removeListener('overlay:gezeigt', onGezeigt);
      ipcMain.removeListener('overlay:weg', onWeg);
      clearTimeout(wegTimer);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  });
  // Getter getrennt definieren: Object.assign würde ihn nur einmal auswerten (null).
  Object.defineProperty(events, 'window', { get: () => win });
  return events;
}

module.exports = { createOverlay };
