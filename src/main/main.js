const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  clipboard,
  screen,
  nativeImage,
  Notification,
  dialog,
} = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const testMode = process.env.LETTERFLOW_TEST === '1';
let loginItemCalls = 0; // Zähler für Tests: echte Registrierungen
let trayHandle; // Referenz halten, sonst räumt der GC das Symbol ab

// Testmodus: eigener Daten-Ordner, VOR dem Instanz-Lock setzen, damit zwei Test-Instanzen
// mit gleichem Ordner kollidieren und solche mit verschiedenen Ordnern nicht.
if (testMode && process.env.LETTERFLOW_DATA_DIR) {
  app.setPath('userData', process.env.LETTERFLOW_DATA_DIR);
}

// Testmodus: Chromium liefert ein künstliches Mikrofon (Pegeltest der Einstellungen); das Diktat-Mikrofon
// liefert der Ersatz-Helfer.
if (testMode) app.commandLine.appendSwitch('use-fake-device-for-media-stream');

const windows = require('./windows');
const { setupPermissions } = require('./permissions');
const { createOverlay } = require('./overlay');
const { createRecorder } = require('./recorder');
const tray = require('./tray');
const { loadSettings, saveSettings } = require('./settings');
const setup = require('./setup');
const { detectHardware, chooseSmoothingTier, bundledEnginesDir } = require('./hardware');
const { EngineManager } = require('./engines');
const { getDataDir } = require('./catalog');
const { Helper } = require('./helper');
const { Dictation } = require('./dictation');
const { createAppInfo } = require('./app-info');
const { createLog } = require('./log');
const { createUpdater } = require('./updater');

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
    // --autostart: beim Windows-Start nach Updates fragen statt still zu installieren.
    app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ['--autostart'] });
  }
  const amWindowsStart = process.argv.includes('--autostart');

  let hardware = null; // Ergebnis von detectHardware
  let engines = null; // EngineManager, sobald die Einrichtung abgeschlossen ist
  let beendet = false;
  // Updates nur in der installierten App; Tests steuern einen Ersatz mit denselben Ereignissen.
  const updateFake = testMode
    ? Object.assign(new EventEmitter(), { checkForUpdates: async () => {}, quitAndInstall() {} })
    : null;
  const updater = createUpdater({
    autoUpdater: testMode
      ? updateFake
      : app.isPackaged
        ? require('electron-updater').autoUpdater
        : null,
    gefunden: (version) => {
      if (testMode || !Notification.isSupported()) return;
      const n = new Notification({
        title: 'Letterflow wird aktualisiert',
        body: `Version ${version} wird im Hintergrund geladen. Zum Zuschauen hier klicken.`,
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      });
      n.on('click', () => windows.openSettings('allgemein'));
      n.show();
    },
    fragen: amWindowsStart
      ? async (version) =>
          (
            await dialog.showMessageBox({
              type: 'question',
              title: 'Letterflow',
              message: `Version ${version} ist da`,
              detail: 'Jetzt laden und installieren? Letterflow startet danach kurz neu.',
              buttons: ['Jetzt aktualisieren', 'Später'],
              defaultId: 0,
              cancelId: 1,
              icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
            })
          ).response === 0
      : null,
    log: (z) => console.log(z),
  });
  updater.on('stand', (stand) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed()) w.webContents.send('update:stand', stand);
  });
  let startFehler = false; // Start der Engines ist gescheitert (bis zum nächsten Erfolg)
  let neustart = null; // laufender Neustart der Engines
  let helper = null; // Tastaturhelfer
  let letzteEinstellungen = {}; // zuletzt gelesene Einstellungen (falls die Datei kurz gesperrt ist)

  // engines: 'fehlt' (Einrichtung offen), 'startet', 'bereit' oder 'fehler'.
  // Solange die Hardware-Erkennung läuft, ist die Einrichtung noch nicht geprüft: 'startet'.
  function getStatus() {
    return {
      backend: engines ? engines.backend : hardware ? hardware.backend : null,
      tier: engines ? engines.tier : hardware ? hardware.tier : null,
      engines: startFehler
        ? 'fehler'
        : !hardware
          ? 'startet'
          : !setup.isComplete()
            ? 'fehlt'
            : engines
              ? engines.status
              : 'startet',
      rueckfall: engines ? engines.fallback : false,
      // Für die Stufenwahl: was „Automatisch“ hier wählt und ob Gründlich erst laden müsste.
      autoTier: hardware
        ? chooseSmoothingTier(hardware.devices, hardware.dedicatedVramMiB, 'auto', hardware)
        : null,
      gruendlichFehlt: setup.stufeFehlt(hardware ? hardware.backend : 'cpu', 'gruendlich'),
      ausgewogenFehlt: setup.stufeFehlt('cpu', 'ausgewogen'),
    };
  }

  const aktuelleStufe = (dir) =>
    chooseSmoothingTier(
      hardware.devices,
      hardware.dedicatedVramMiB,
      loadSettings(dir).smoothingModel,
      hardware,
    );

  // Hardware erkennen, Dateien nachladen, Engines starten. Die Stufe wird nach der
  // Einrichtung (die Minuten dauern kann) neu aus den aktuellen Einstellungen bestimmt.
  async function enginesStarten(dir, { testFehler = false } = {}) {
    const dataDir = getDataDir();
    hardware = await detectHardware(loadSettings(dir).smoothingModel, { dataDir });
    if (testFehler) throw new Error('Testfehler beim Start');
    await setup.ersteWahl({
      aktuell: () => loadSettings(dir).smoothingModel,
      speichern: (patch) => saveSettings(dir, patch),
      auto: chooseSmoothingTier(hardware.devices, hardware.dedicatedVramMiB, 'auto', hardware),
    });
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
      hardware,
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
      if (helper && (settings.hotkey !== helper.preset || settings.hotkeyMode !== helper.mode))
        helper.setPreset(settings.hotkey, settings.hotkeyMode);
      try {
        applyAutostart(settings);
      } catch (fehler) {
        console.error('Autostart nicht gesetzt:', fehler);
      }
      return settings;
    });
    ipcMain.handle('status:get', () => getStatus());
    ipcMain.handle('update:stand', () => updater.stand());
    ipcMain.handle('update:suchen', () => updater.suchen());
    ipcMain.handle('update:installieren', () => updater.installieren());
    try {
      applyAutostart(loadSettings(dir));
    } catch (fehler) {
      console.error('Einstellungen nicht lesbar:', fehler);
    }
  }

  app.whenReady().then(() => {
    // Gleiche Kennung wie die Verknüpfung des Installers: sonst zeigt Windows keine Benachrichtigungen.
    app.setAppUserModelId('de.letterflow.app');
    setupPermissions(session.defaultSession);
    registerIpc();
    trayHandle = tray.createTray();
    enginesAnstossen(app.getPath('userData'));
    const overlay = createOverlay({
      getSettings: einstellungen,
      capture: !testMode,
      grab: (bereich) => helper.grab(bereich),
      vollbild: () => helper.vollbild(),
    });
    // „Automatisch“ schaltet die Animation ab, wenn sie zweimal hintereinander > 30 % Bilder verwirft.
    let ruckler = 0;
    overlay.on('animation', (anteil) => {
      ruckler = anteil > 0.3 ? ruckler + 1 : 0;
      const p = einstellungen().pill;
      if (ruckler < 2 || p.animation !== 'auto' || p.animationAutoOff) return;
      try {
        const neu = saveSettings(app.getPath('userData'), {
          pill: { ...p, animationAutoOff: true },
        });
        for (const w of BrowserWindow.getAllWindows())
          if (!w.isDestroyed()) w.webContents.send('settings:changed', neu);
      } catch (fehler) {
        console.error('Einstellungen nicht gespeichert:', fehler);
      }
    });
    // Tests prüfen das erste Fenster: dort die Pille nicht vorab laden.
    if (!testMode) overlay.prepare();
    updater.starten();
    helper = new Helper();
    const recorder = createRecorder(helper);
    helper.setPreset(einstellungen().hotkey || 'rctrl', einstellungen().hotkeyMode);
    if (testMode) {
      // Tests drücken nie echte Tasten: Ersatz-Helfer mit gleichem Protokoll.
      const fake = path.join(__dirname, '..', '..', 'tests', 'fakes', 'fake-helper.js');
      helper.start(process.execPath, [fake], { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
    } else {
      helper.start(path.join(bundledEnginesDir(), '..', 'bin', 'letterflow-helper.exe'));
    }
    app.on('will-quit', () => helper.stop());
    const pastes = []; // nur Tests: alle Einfüge-Versuche
    const befehle = []; // nur Tests: alle Befehle an den Helfer
    if (testMode) {
      const send = helper.send.bind(helper);
      helper.send = (obj) => {
        befehle.push(obj.cmd);
        send(obj);
      };
      const paste = helper.paste.bind(helper);
      helper.paste = async (hwnd, restore) => {
        pastes.push({ text: await clipboard.readText(), hwnd });
        return paste(hwnd, restore);
      };
    }
    new Dictation({
      helper,
      overlay,
      recorder,
      getEngines: () => engines,
      getAppInfo: createAppInfo({
        getFileIcon: (exe, opts) => app.getFileIcon(exe, opts),
        loadImage: (p) => nativeImage.createFromPath(p),
        scale: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor,
      }),
      getStatus,
      getSettings: einstellungen,
      showSetup: () => setup.showSetup(),
      restartEngines: () =>
        enginesNeustarten().catch((fehler) => console.error('Neustart fehlgeschlagen:', fehler)),
      log: createLog(path.join(getDataDir(), 'logs')),
      setTrayState: tray.setState,
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
      recorder.on('pcm', (pcm) => aufnahme.pakete.push(pcm));
      recorder.on('recorder-error', (e) => (aufnahme.fehler = e.name));
      global.__letterflow = {
        overlay,
        recorder,
        // Test: Aufnahme beginnen/beenden und die gesammelten Pakete als Kennzahlen lesen.
        aufnahmeStart: async (deviceId = null) => {
          aufnahme.pakete = [];
          aufnahme.fehler = null;
          await recorder.start(deviceId);
        },
        aufnahmeStopp: () => recorder.stop(),
        aufnahmeStand: () => ({
          fehler: aufnahme.fehler,
          warm: recorder.warm,
          erstes: aufnahme.pakete.length ? aufnahme.pakete[0].length : null,
          pakete: aufnahme.pakete.length,
          werte: aufnahme.pakete.reduce((n, p) => n + p.length, 0),
          rms: aufnahme.pakete.map((p) => Math.sqrt(p.reduce((n, v) => n + v * v, 0) / p.length)),
        }),
        trayTooltip: () => tray.tooltip(),
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
        befehle,
        // Test: Mikrofon-Zugriff verweigern, als wäre er in Windows gesperrt.
        updateFake,
        mikrofonSperren: () => helper.send({ cmd: '__micFehler', name: 'NotAllowedError' }),
      };
    }
  });
}
