const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

const offen = new Map();

ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));

// Öffnet das Fenster zu `key` oder holt das bestehende nach vorn.
function openSingle(key, datei, optionen) {
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
    backgroundColor: '#00000000',
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
  win.once('ready-to-show', () => win.show());
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

// Platzhalter, wird in Task 3 durch das Einstellungsfenster ersetzt.
function openSettings() {}

module.exports = { openAbout, openSettings };
