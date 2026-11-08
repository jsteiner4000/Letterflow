const { app, BrowserWindow, ipcMain, session, clipboard } = require('electron');
const path = require('node:path');

const testMode = process.env.LETTERFLOW_TEST === '1';
let loginItemCalls = 0; // Zähler für Tests: echte Registrierungen
let trayHandle; // Referenz halten, sonst räumt der GC das Symbol ab

// Testmodus: eigener Daten-Ordner, VOR dem Instanz-Lock setzen, damit zwei Test-Instanzen
// mit gleichem Ordner kollidieren und solche mit verschiedenen Ordnern nicht.
if (testMode && process.env.LETTERFLOW_DATA_DIR) {
  app.setPath('userData', process.env.LETTERFLOW_DATA_DIR);
}

// Testmodus: Chromium liefert ein künstliches Mikrofon (periodischer Ton), kein echtes Gerät nötig.
if (testMode) app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// Testmodus: eine WAV-Datei als Mikrofon (läuft in Schleife).
if (testMode && process.env.LETTERFLOW_FAKE_AUDIO_FILE)
  app.commandLine.appendSwitch(
    'use-file-for-fake-audio-capture',
    process.env.LETTERFLOW_FAKE_AUDIO_FILE,
  );

const windows = require('./windows');
const { setupPermissions } = require('./permissions');
const { createOverlay } = require('./overlay');
const tray = require('./tray');
const { loadSettings, saveSettings } = require('./settings');
const setup = require('./setup');
const { detectHardware, chooseSmoothingTier, bundledEnginesDir } = require('./hardware');
const { EngineManager } = require('./engines');
const { getDataDir } = require('./catalog');
const { Helper } = require('./helper');
const { Dictation } = require('./dictation');
const { createLog } = require('./log');

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
  let startFehler = false; // Start der Engines ist gescheitert (bis zum nächsten Erfolg)
  let neustart = null; // laufender Neustart der Engines
  let helper = null; // Tastaturhelfer
  let letzteEinstellungen = {}; // zuletzt gelesene Einstellungen (falls die Datei kurz gesperrt ist)

  // engines: 'fehlt' (Einrichtung offen), 'startet', 'bereit' oder 'fehler'.
  function getStatus() {
    return {
      backend: engines ? engines.backend : hardware ? hardware.backend : null,
      tier: engines ? engines.tier : hardware ? hardware.tier : null,
      engines: startFehler
        ? 'fehler'
        : !setup.isComplete()
          ? 'fehlt'
          : engines
            ? engines.status
            : 'startet',
      rueckfall: engines ? engines.fallback : false,
    };
  }

  const aktuelleStufe = (dir) =>
    chooseSmoothingTier(
      hardware.devices,
      hardware.dedicatedVramMiB,
      loadSettings(dir).smoothingModel,
    );

  // Hardware erkennen, Dateien nachladen, Engines starten. Die Stufe wird nach der
  // Einrichtung (die Minuten dauern kann) neu aus den aktuellen Einstellungen bestimmt.
  async function enginesStarten(dir, { testFehler = false } = {}) {
    const dataDir = getDataDir();
    hardware = await detectHardware(loadSettings(dir).smoothingModel, { dataDir });
    if (testFehler) throw new Error('Testfehler beim Start');
    for (;;) {
      hardware.tier = aktuelleStufe(dir);
      await setup.ensureSetup({ backend: hardware.backend, tier: hardware.tier });
      if (aktuelleStufe(dir) === hardware.tier) break;
    }
    const manager = new EngineManager({
      dataDir,
      backend: hardware.backend,
      tier: hardware.tier,
      prepare: ({ backend, tier }) => setup.ensureSetup({ backend, tier }),
    });
    engines = manager;
    await manager.start();
  }

  // Start mit Fehlerstatus: scheitert er, zeigt der Status 'fehler', ein späterer Erfolg löscht ihn.
  async function enginesAnstossen(dir, optionen) {
    try {
      await enginesStarten(dir, optionen);
      startFehler = false;
    } catch (fehler) {
      startFehler = true;
      console.error('Engines nicht gestartet:', fehler);
    }
  }

  // Engines neu starten (z. B. Kürzel bei Status 'fehler'); läuft schon einer, wird er mitgenutzt.
  function enginesNeustarten(optionen) {
    neustart ??= (async () => {
      if (engines) await engines.stop();
      engines = null;
      await enginesAnstossen(app.getPath('userData'), optionen);
    })().finally(() => (neustart = null));
    return neustart;
  }

  function einstellungen() {
    try {
      letzteEinstellungen = loadSettings(app.getPath('userData'));
    } catch (fehler) {
      console.error('Einstellungen nicht lesbar:', fehler);
    }
    return letzteEinstellungen;
  }

  // Ändert sich die Stufe durch die Einstellung "smoothingModel", Engines anpassen.
  // Solange der Manager noch nicht existiert, übernimmt enginesStarten die neue Stufe.
  function stufePruefen(settings) {
    if (!hardware) return;
    const neu = chooseSmoothingTier(
      hardware.devices,
      hardware.dedicatedVramMiB,
      settings.smoothingModel,
    );
    if (!engines) {
      hardware.tier = neu;
      return;
    }
    // setTier lässt eine noch wartende ältere Umschaltung fallen: der letzte Wunsch gewinnt.
    engines.setTier(neu).catch((fehler) => console.error('Stufenwechsel fehlgeschlagen:', fehler));
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
      // Neues Kürzel gilt sofort, ohne Neustart.
      if (helper && settings.hotkey !== helper.preset) helper.setPreset(settings.hotkey);
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
    setupPermissions(session.defaultSession);
    registerIpc();
    trayHandle = tray.createTray();
    enginesAnstossen(app.getPath('userData'));
    const overlay = createOverlay();
    helper = new Helper();
    helper.setPreset(einstellungen().hotkey || 'ctrl+win');
    if (testMode) {
      // Tests drücken nie echte Tasten: Ersatz-Helfer mit gleichem Protokoll.
      const fake = path.join(__dirname, '..', '..', 'tests', 'fakes', 'fake-helper.js');
      helper.start(process.execPath, [fake], { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
    } else {
      helper.start(path.join(bundledEnginesDir(), '..', 'bin', 'letterflow-helper.exe'));
    }
    app.on('will-quit', () => helper.stop());
    const pastes = []; // nur Tests: alle Einfüge-Versuche
    if (testMode) {
      const paste = helper.paste.bind(helper);
      helper.paste = async (hwnd) => {
        pastes.push({ text: await clipboard.readText(), hwnd });
        return paste(hwnd);
      };
    }
    new Dictation({
      helper,
      overlay,
      getEngines: () => engines,
      getStatus,
      getSettings: einstellungen,
      showSetup: () => setup.showSetup(),
      restartEngines: () =>
        enginesNeustarten().catch((fehler) => console.error('Neustart fehlgeschlagen:', fehler)),
      log: createLog(path.join(getDataDir(), 'logs')),
    });
    app.on('before-quit', (event) => {
      if (beendet || !engines) return;
      event.preventDefault();
      beendet = true;
      engines.stop().finally(() => app.quit());
    });
    if (testMode) {
      // Test-Brücke für electronApp.evaluate.
      const aufnahme = { pakete: [] };
      overlay.on('pcm', (pcm) => aufnahme.pakete.push(pcm));
      overlay.on('recorder-error', (e) => (aufnahme.fehler = e.name));
      global.__letterflow = {
        overlay,
        // Test: Aufnahme beginnen/beenden und die gesammelten Pakete als Kennzahlen lesen.
        aufnahmeStart: async (deviceId = null) => {
          aufnahme.pakete = [];
          aufnahme.fehler = null;
          await overlay.startRecording(deviceId);
        },
        aufnahmeStopp: () => overlay.stopRecording(),
        aufnahmeStand: () => ({
          fehler: aufnahme.fehler,
          pakete: aufnahme.pakete.length,
          werte: aufnahme.pakete.reduce((n, p) => n + p.length, 0),
          rms: aufnahme.pakete.map((p) => Math.sqrt(p.reduce((n, v) => n + v * v, 0) / p.length)),
        }),
        trayTooltip: () => tray.TOOLTIP,
        openAbout: () => windows.openAbout(),
        openSettings: () => windows.openSettings(),
        // Test: Einrichtungsfenster öffnen und sofort (mehrfach) schließen, während es noch lädt.
        setupFensterSchnellSchliessen: () => {
          windows.openSetup();
          windows.closeSetup();
          windows.closeSetup();
        },
        loginItemCalls: () => loginItemCalls,
        status: () => getStatus(),
        ensureSetup: (optionen) => setup.ensureSetup(optionen),
        setupAusfallNaechstes: () => setup.testAusfallNaechstes(),
        // Test: Engine-Start erneut anstoßen, wahlweise mit erzwungenem Fehler.
        enginesNeustart: (testFehler = false) => enginesNeustarten({ testFehler }),
        engines: require('./engines-testbruecke'),
        helper,
        pastes,
        get lastPaste() {
          return pastes.at(-1) ?? null;
        },
        // Test: Mikrofon-Zugriff verweigern, als wäre er in Windows gesperrt.
        mikrofonSperren: () =>
          session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) =>
            callback(false),
          ),
      };
    }
  });
}
