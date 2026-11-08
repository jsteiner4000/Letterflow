const { app, BrowserWindow, ipcMain } = require('electron');

const testMode = process.env.LETTERFLOW_TEST === '1';
let loginItemCalls = 0; // Zähler für Tests: echte Registrierungen
let trayHandle; // Referenz halten, sonst räumt der GC das Symbol ab

// Testmodus: eigener Daten-Ordner, VOR dem Instanz-Lock setzen, damit zwei Test-Instanzen
// mit gleichem Ordner kollidieren und solche mit verschiedenen Ordnern nicht.
if (testMode && process.env.LETTERFLOW_DATA_DIR) {
  app.setPath('userData', process.env.LETTERFLOW_DATA_DIR);
}

const windows = require('./windows');
const tray = require('./tray');
const { loadSettings, saveSettings } = require('./settings');

if (!app.requestSingleInstanceLock()) {
  // Zweite Instanz: sofort beenden, die erste öffnet die Einstellungen.
  app.exit(0);
} else {
  app.on('second-instance', () => windows.openSettings());

  // Kein Hauptfenster: die App lebt im Infobereich der Taskleiste.
  app.on('window-all-closed', () => {});

  // Autostart mit Windows. Im Testmodus und in der Entwicklung (nicht paketiert) wird nichts
  // registriert, die Einstellung selbst wird trotzdem gespeichert.
  function applyAutostart(settings) {
    if (testMode || !app.isPackaged) return;
    loginItemCalls += 1;
    app.setLoginItemSettings({ openAtLogin: settings.autostart });
  }

  function registerIpc() {
    const dir = app.getPath('userData');
    ipcMain.handle('settings:get', () => loadSettings(dir));
    ipcMain.handle('settings:set', (_event, patch) => {
      let settings;
      try {
        settings = saveSettings(dir, patch);
      } catch (fehler) {
        console.error('Einstellungen nicht gespeichert:', fehler);
        return { error: 'speichern' };
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('settings:changed', settings);
      }
      try {
        applyAutostart(settings);
      } catch (fehler) {
        console.error('Autostart nicht gesetzt:', fehler);
      }
      return settings;
    });
    // Platzhalter bis Task 5 echte Werte liefert.
    ipcMain.handle('status:get', () => ({ backend: null, tier: null, engines: 'fehlt' }));
    try {
      applyAutostart(loadSettings(dir));
    } catch (fehler) {
      console.error('Einstellungen nicht lesbar:', fehler);
    }
  }

  app.whenReady().then(() => {
    registerIpc();
    trayHandle = tray.createTray();
    if (testMode) {
      // Test-Brücke für electronApp.evaluate (wird in späteren Tasks erweitert).
      global.__letterflow = {
        trayTooltip: () => tray.TOOLTIP,
        openAbout: () => windows.openAbout(),
        openSettings: () => windows.openSettings(),
        loginItemCalls: () => loginItemCalls,
      };
    }
  });
}
