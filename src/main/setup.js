// Einrichtung beim ersten Start: fehlende Modelle und Engines laden, Fenster mit Fortschritt zeigen.
const { BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const windows = require('./windows');
const { requiredFiles, missingFiles, getDataDir, markerFuer } = require('./catalog');
const { download, DownloadError, checkDiskSpace } = require('./downloader');

const testMode = process.env.LETTERFLOW_TEST === '1';
const MAX_AUTO_WIEDERHOLUNGEN = 2; // bei beschädigter Datei: so oft automatisch neu laden
const PROGRESS_INTERVALL_MS = 100;

let phase = 'unbekannt'; // 'unbekannt' | 'laeuft' | 'fertig'
let laufend = null; // Promise der laufenden Einrichtung
let plan = null; // { files: [{ id, bytes, received }], totalBytes, error }
let testAusfall = false; // nur Tests: der nächste Lauf scheitert unerwartet
let wiederholen = null; // löst die Wartezeit nach einem Fehler auf

// Sendet an alle Fenster (nur das Einrichtungsfenster hört zu).
function senden(kanal, daten) {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send(kanal, daten);
}

// auto: die App versucht es von selbst weiter, der Knopf bleibt dann verborgen.
function fehlerMelden(code, auto = false) {
  if (plan) plan.error = code ? { code, auto } : null;
  senden('setup:error', { code, auto });
}

ipcMain.handle('setup:plan', () => plan);
ipcMain.handle('setup:retry', () => {
  if (wiederholen) wiederholen();
});

// Test-Katalog: Adresse und Prüfsummen kleiner Testdateien statt der echten Modelle.
function katalogOptionen() {
  const urlBase = process.env.LETTERFLOW_CATALOG_URL_BASE;
  if (!testMode || !urlBase) return {};
  const datei = process.env.LETTERFLOW_CATALOG_FILE;
  const overrides = datei ? JSON.parse(fs.readFileSync(datei, 'utf8')) : {};
  return { urlBase, overrides };
}

// Entpackt ein ZIP mit dem Windows-eigenen tar.exe (Git-Bash-tar kommt mit C:-Pfaden nicht klar).
async function entpacken(eintrag) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  fs.mkdirSync(eintrag.unzipTo, { recursive: true });
  try {
    await promisify(execFile)(tar, ['-xf', eintrag.dest, '-C', eintrag.unzipTo]);
  } catch (e) {
    throw new DownloadError('entpacken', `Entpacken fehlgeschlagen: ${e.message}`, e);
  }
  fs.writeFileSync(markerFuer(eintrag), '');
}

async function eintragLaden(eintrag) {
  const eintragPlan = plan.files.find((f) => f.id === eintrag.id);
  let zuletzt = 0;
  const vorhanden = (() => {
    try {
      return fs.statSync(eintrag.dest).size === eintrag.bytes;
    } catch {
      return false;
    }
  })();
  if (!vorhanden) {
    await download({
      url: eintrag.url,
      sha256: eintrag.sha256,
      dest: eintrag.dest,
      bytes: eintrag.bytes,
      onProgress: (received, total) => {
        eintragPlan.received = received;
        const jetzt = Date.now();
        if (received < total && jetzt - zuletzt < PROGRESS_INTERVALL_MS) return;
        zuletzt = jetzt;
        senden('setup:progress', { id: eintrag.id, received, total });
      },
    });
  }
  eintragPlan.received = eintrag.bytes;
  senden('setup:progress', { id: eintrag.id, received: eintrag.bytes, total: eintrag.bytes });
  if (eintrag.unzipTo) await entpacken(eintrag);
}

async function ausfuehren(fehlend) {
  if (testAusfall) {
    testAusfall = false;
    throw new Error('Testausfall');
  }
  const versuche = new Map();
  // Platz für alles Fehlende vorab prüfen (angefangene Teildateien zählen nicht doppelt).
  for (;;) {
    try {
      await checkDiskSpace(getDataDir(), plan.totalBytes);
      break;
    } catch (e) {
      fehlerMelden(e.code || 'disk');
      await new Promise((r) => (wiederholen = r));
      fehlerMelden(null);
    }
  }
  for (const eintrag of fehlend) {
    for (;;) {
      try {
        await eintragLaden(eintrag);
        break;
      } catch (e) {
        const code = e instanceof DownloadError ? e.code : 'network';
        if (!(e instanceof DownloadError)) console.error('Einrichtung:', e);
        const n = (versuche.get(eintrag.id) || 0) + 1;
        versuche.set(eintrag.id, n);
        const auto = code === 'checksum' && n <= MAX_AUTO_WIEDERHOLUNGEN;
        fehlerMelden(code, auto);
        if (auto) {
          await new Promise((r) => setTimeout(r, 1500)); // Meldung kurz lesbar lassen
        } else {
          await new Promise((r) => (wiederholen = r));
        }
        wiederholen = null;
        fehlerMelden(null);
      }
    }
  }
}

// Löst auf, wenn alle nötigen Dateien da sind. Zeigt bei Bedarf das Einrichtungsfenster.
async function ensureSetup({ backend, tier }) {
  // Tests ohne Testkatalog sollen weder Fenster noch Downloads auslösen.
  if (testMode && !process.env.LETTERFLOW_CATALOG_URL_BASE) return;
  if (laufend) return laufend;

  const dataDir = getDataDir();
  const fehlend = missingFiles(
    dataDir,
    requiredFiles({ backend, tier, dataDir, ...katalogOptionen() }),
  );
  if (!fehlend.length) {
    phase = 'fertig';
    return;
  }
  phase = 'laeuft';
  plan = {
    files: fehlend.map((f) => ({ id: f.id, bytes: f.bytes, received: 0 })),
    totalBytes: fehlend.reduce((summe, f) => summe + f.bytes, 0),
    error: null,
  };
  laufend = ausfuehren(fehlend)
    .then(() => {
      phase = 'fertig';
    })
    .finally(() => {
      // Auch nach einem Fehler zurücksetzen, damit ein neuer Aufruf neu startet.
      laufend = null;
      plan = null;
      windows.closeSetup();
    });
  windows.openSetup();
  return laufend;
}

// Öffnet das Fenster erneut, falls die Einrichtung noch läuft (z. B. beim nächsten Diktat-Versuch).
function showSetup() {
  if (laufend) windows.openSetup();
}

const testAusfallNaechstes = () => {
  testAusfall = true;
};

const isComplete = () => phase === 'fertig';

module.exports = { ensureSetup, showSetup, isComplete, testAusfallNaechstes };
