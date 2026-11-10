// Automatische Updates über GitHub-Releases (electron-updater). Sucht beim Start und alle 4 Stunden;
// eine neue Version lädt sofort im Hintergrund, die Einstellungen zeigen den Fortschritt. Installiert wird
// beim nächsten Beenden oder sofort über „Neu starten“.
const { EventEmitter } = require('node:events');

const INTERVALL_MS = 4 * 60 * 60 * 1000;

// autoUpdater: electron-updater oder null (Entwicklung, Tests: Updates aus).
// gefunden(version): einmal je neuer Version, z. B. für eine Windows-Benachrichtigung.
function createUpdater({ autoUpdater, gefunden = () => {}, log = () => {} }) {
  const e = new EventEmitter();
  let stand = { phase: autoUpdater ? 'leer' : 'aus' };
  let gemeldet = null;
  const setzen = (neu) => {
    stand = { ...stand, ...neu };
    e.emit('stand', stand);
  };
  if (autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => setzen({ phase: 'suche' }));
    autoUpdater.on('update-not-available', () => setzen({ phase: 'aktuell' }));
    autoUpdater.on('update-available', (i) => {
      setzen({ phase: 'laedt', version: i.version, prozent: 0, uebertragen: 0, gesamt: 0 });
      if (gemeldet !== i.version) gefunden(i.version);
      gemeldet = i.version;
    });
    autoUpdater.on('download-progress', (p) =>
      setzen({
        phase: 'laedt',
        prozent: p.percent,
        uebertragen: p.transferred,
        gesamt: p.total,
        tempo: p.bytesPerSecond,
      }),
    );
    autoUpdater.on('update-downloaded', (i) => setzen({ phase: 'fertig', version: i.version }));
    autoUpdater.on('error', (fehler) => {
      log(`update: fehler ${fehler?.message || fehler}`);
      // Ein fertig geladenes Update bleibt gültig, auch wenn eine spätere Suche scheitert.
      // Erneut melden, damit „Neu starten“ nach einem gescheiterten Installieren wieder klickbar wird.
      setzen(stand.phase === 'fertig' ? {} : { phase: 'fehler' });
    });
  }
  function suchen() {
    if (!autoUpdater || stand.phase === 'laedt' || stand.phase === 'fertig') return;
    autoUpdater.checkForUpdates().catch(() => {}); // Fehler kommen auch als 'error'
  }
  return Object.assign(e, {
    stand: () => stand,
    suchen,
    starten() {
      suchen();
      setInterval(suchen, INTERVALL_MS).unref?.();
    },
    installieren() {
      // still installieren, danach Letterflow wieder starten
      if (stand.phase === 'fertig') autoUpdater.quitAndInstall(true, true);
    },
  });
}

module.exports = { createUpdater };
