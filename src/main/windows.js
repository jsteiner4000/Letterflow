const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
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
    // Deckender Hintergrund passend zu style.css (--hintergrund), kein Schwarz vor dem ersten Paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1e21' : '#f6f7f8',
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

function openSettings() {
  return openSingle('settings', 'settings.html', {
    width: 960,
    height: 720,
    minWidth: 900,
    minHeight: 520,
    title: 'Letterflow – Einstellungen',
  });
}

function openSetup() {
  return openSingle('setup', 'setup.html', {
    width: 520,
    height: 400,
    resizable: false,
    maximizable: false,
    title: 'Letterflow – Einrichtung',
  });
}

function closeSetup() {
  const win = offen.get('setup');
  if (!win || win.isDestroyed()) return;
  // Ein Fenster, das noch lädt, abzuräumen stürzt Electron ab: erst nach dem Laden schließen.
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', () => !win.isDestroyed() && win.close());
  } else win.close();
}

module.exports = { openAbout, openSettings, openSetup, closeSetup };
