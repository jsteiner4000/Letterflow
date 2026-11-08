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
const setup = require('./setup');
const { detectHardware, chooseSmoothingTier } = require('./hardware');
const { EngineManager } = require('./engines');
const { getDataDir } = require('./catalog');

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

  let hardware = null; // Ergebnis von detectHardware
  let engines = null; // EngineManager, sobald die Einrichtung abgeschlossen ist
  let beendet = false;
  let tierKette = Promise.resolve(); // Stufenwechsel nacheinander ausführen

  // engines: 'fehlt' (Einrichtung offen), 'startet', 'bereit' oder 'fehler'.
  function getStatus() {
    return {
      backend: engines ? engines.backend : hardware ? hardware.backend : null,
      tier: engines ? engines.tier : hardware ? hardware.tier : null,
      engines: !setup.isComplete() ? 'fehlt' : engines ? engines.status : 'startet',
      rueckfall: engines ? engines.fallback : false,
    };
  }

  // Hardware erkennen, Dateien nachladen, Engines starten.
  async function enginesStarten(dir) {
    const dataDir = getDataDir();
    hardware = await detectHardware(loadSettings(dir).smoothingModel, { dataDir });
    await setup.ensureSetup({ backend: hardware.backend, tier: hardware.tier });
    const manager = new EngineManager({
      dataDir,
      backend: hardware.backend,
      tier: hardware.tier,
      prepare: ({ backend, tier }) => setup.ensureSetup({ backend, tier }),
    });
    engines = manager;
    await manager.start();
  }

  // Ändert sich die Stufe durch die Einstellung "smoothingModel", Engines anpassen.
  function stufePruefen(settings) {
    if (!hardware || !engines) return;
    const neu = chooseSmoothingTier(
      hardware.devices,
      hardware.dedicatedVramMiB,
      settings.smoothingModel,
    );
    tierKette = tierKette
      .then(() => (neu !== engines.tier ? engines.setTier(neu) : undefined))
      .catch((fehler) => console.error('Stufenwechsel fehlgeschlagen:', fehler));
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
      stufePruefen(settings);
      try {
        applyAutostart(settings);
      } catch (fehler) {
        console.error('Autostart nicht gesetzt:', fehler);
      }
      return settings;
    });
    ipcMain.handle('status:get', () => getStatus());
    try {
      applyAutostart(loadSettings(dir));
    } catch (fehler) {
      console.error('Einstellungen nicht lesbar:', fehler);
    }
  }

  app.whenReady().then(() => {
    registerIpc();
    trayHandle = tray.createTray();
    enginesStarten(app.getPath('userData')).catch((fehler) => {
      console.error('Engines nicht gestartet:', fehler);
    });
    app.on('before-quit', (event) => {
      if (beendet || !engines) return;
      event.preventDefault();
      beendet = true;
      engines.stop().finally(() => app.quit());
    });
    if (testMode) {
      // Test-Brücke für electronApp.evaluate (wird in späteren Tasks erweitert).
      global.__letterflow = {
        trayTooltip: () => tray.TOOLTIP,
        openAbout: () => windows.openAbout(),
        openSettings: () => windows.openSettings(),
        loginItemCalls: () => loginItemCalls,
        status: () => getStatus(),
        ensureSetup: (optionen) => setup.ensureSetup(optionen),
        setupAusfallNaechstes: () => setup.testAusfallNaechstes(),
        engines: require('./engines-testbruecke'),
      };
    }
  });
}
