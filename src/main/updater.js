// Automatische Updates über GitHub-Releases (electron-updater). Sucht beim Start und alle 4 Stunden;
// eine neue Version lädt sofort im Hintergrund, die Einstellungen zeigen den Fortschritt. Installiert wird
// beim nächsten Beenden oder sofort über „Neu starten“. Beim Windows-Start wird stattdessen erst gefragt.
const { EventEmitter } = require('node:events');

const INTERVALL_MS = 4 * 60 * 60 * 1000;

// autoUpdater: electron-updater oder null (Entwicklung, Tests: Updates aus).
// gefunden(version): einmal je neuer Version, z. B. für eine Windows-Benachrichtigung.
// fragen(version) → Promise<boolean>: gesetzt (Windows-Start), wird nichts ungefragt geladen oder
// installiert; bei Ja wird geladen und sofort installiert.
function createUpdater({ autoUpdater, gefunden = () => {}, fragen = null, log = () => {} }) {
  const e = new EventEmitter();
  let stand = { phase: autoUpdater ? 'leer' : 'aus' };
  let gemeldet = null;
  let abgelehnt = false; // „Später“: keine Suche mehr nach Zeitplan, nur noch von Hand
  let sofort = false;
  const setzen = (neu) => {
    stand = { ...stand, ...neu };
    e.emit('stand', stand);
  };
  if (autoUpdater) {
    autoUpdater.autoDownload = !fragen;
    autoUpdater.autoInstallOnAppQuit = !fragen;
    autoUpdater.on('checking-for-update', () => setzen({ phase: 'suche' }));
    autoUpdater.on('update-not-available', () => setzen({ phase: 'aktuell' }));
    autoUpdater.on('update-available', async (i) => {
      if (fragen) {
        if (!(await fragen(i.version))) {
          abgelehnt = true;
          return setzen({ phase: 'leer' }); // „Nach Updates suchen“ fragt erneut
        }
        sofort = true;
      } else if (gemeldet !== i.version) gefunden(i.version);
      gemeldet = i.version;
      setzen({ phase: 'laedt', version: i.version, prozent: 0, uebertragen: 0, gesamt: 0 });
      if (fragen) autoUpdater.downloadUpdate().catch(() => {}); // Fehler kommen auch als 'error'
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
    autoUpdater.on('update-downloaded', (i) => {
      setzen({ phase: 'fertig', version: i.version });
      if (sofort) autoUpdater.quitAndInstall(true, true);
    });
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
      setInterval(() => abgelehnt || suchen(), INTERVALL_MS).unref?.();
    },
    installieren() {
      // still installieren, danach Letterflow wieder starten
      if (stand.phase === 'fertig') autoUpdater.quitAndInstall(true, true);
    },
  });
}

module.exports = { createUpdater };
