const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
const path = require('node:path');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

const offen = new Map();

ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));
ipcMain.handle('app:licenses', () =>
  require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'DRITTANBIETER.md'), 'utf8'),
);
ipcMain.handle('app:about', () => {
  openAbout();
});

// Öffnet das Fenster zu `key` oder holt das bestehende nach vorn.
// zeigen: false → das Fenster bleibt verborgen, bis es selbst gezeigt wird (z. B. nach dem Anpassen der Größe).
function openSingle(key, datei, optionen, zeigen = true) {
  const bestehend = offen.get(key);
  if (bestehend && !bestehend.isDestroyed()) {
    if (bestehend.isMinimized()) bestehend.restore();
    bestehend.show();
    bestehend.focus();
    return bestehend;
  }
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'letterflow.ico'),
    // Deckender Hintergrund passend zu style.css (--bg), kein Schwarz vor dem ersten Paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#252422' : '#ffffff',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
    ...optionen,
  });
  win.removeMenu();
  // Erst anzeigen, wenn der Inhalt bereit ist (kein schwarzes Aufblitzen).
  if (zeigen) win.once('ready-to-show', () => win.show());
  win.on('closed', () => offen.delete(key));
  win.loadFile(path.join(RENDERER, datei));
  offen.set(key, win);
  return win;
}

function openAbout() {
  return openSingle('about', 'about.html', {
    width: 420,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Über Letterflow',
  });
}

const MIN_BREITE = 880;
const MIN_HOEHE = 600;
const WUNSCH_BREITE = 1080;

// Die Seite meldet die Höhe ihrer höchsten Ansicht: Fenster so groß, dass nichts scrollt (höchstens 90 % des Bildschirms).
function einstellungenAnpassen(win, hoehe) {
  if (win.isDestroyed() || win.isVisible()) return;
  const bereich = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const rahmen = win.getSize()[1] - win.getContentSize()[1];
  const h = Math.min(
    Math.max(Number(hoehe) || 0, MIN_HOEHE),
    Math.floor(bereich.height * 0.9) - rahmen,
  );
  const b = Math.max(MIN_BREITE, Math.min(WUNSCH_BREITE, Math.floor(bereich.width * 0.9)));
  win.setContentSize(b, Math.max(h, MIN_HOEHE));
  win.center();
  win.show();
}

ipcMain.on('settings:groesse', (event, hoehe) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) einstellungenAnpassen(win, hoehe);
});

function openSettings() {
  const vorher = offen.get('settings');
  const neu = !vorher || vorher.isDestroyed();
  const win = openSingle(
    'settings',
    'settings.html',
    {
      width: WUNSCH_BREITE,
      height: 700,
      minWidth: MIN_BREITE,
      minHeight: 560,
      title: 'Letterflow – Einstellungen',
    },
    false,
  );
  // Zeigt sich nach der Größenmeldung der Seite; ohne Meldung nach 2 s trotzdem.
  if (neu) setTimeout(() => !win.isDestroyed() && !win.isVisible() && win.show(), 2000);
  return win;
}

function openSetup() {
  return openSingle('setup', 'setup.html', {
    width: 520,
    height: 560,
    resizable: false,
    maximizable: false,
    title: 'Letterflow – Einrichtung',
  });
}

const schliesstGerade = new WeakSet(); // verhindert doppelte Wartezeiten bei mehrfachem Aufruf

function closeSetup() {
  const win = offen.get('setup');
  if (!win || win.isDestroyed()) return;
  // Ein Fenster, das noch lädt, abzuräumen stürzt Electron ab: erst nach dem Laden (oder dem
  // Fehlschlag, oder nach 5 s) schließen.
  if (!win.webContents.isLoadingMainFrame()) return win.close();
  if (schliesstGerade.has(win)) return;
  schliesstGerade.add(win);
  const wc = win.webContents;
  let timer = null;
  const schliessen = () => {
    clearTimeout(timer);
    wc.removeListener('did-finish-load', schliessen);
    wc.removeListener('did-fail-load', schliessen);
    if (!win.isDestroyed()) win.close();
  };
  wc.once('did-finish-load', schliessen);
  wc.once('did-fail-load', schliessen);
  timer = setTimeout(schliessen, 5000);
}

module.exports = { openAbout, openSettings, openSetup, closeSetup };
