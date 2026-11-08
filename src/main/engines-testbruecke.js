// Nur Testmodus: lässt Tests (über electronApp.evaluate) eigene EngineManager anlegen und steuern.
const { EngineManager } = require('./engines');

const manager = new Map();
let zaehler = 0;
const ergebnisse = new Map();
const m = (id) => manager.get(id);

module.exports = {
  erzeugen: ({ tier, backend, restartDelaysMs, transcribeTimeoutMs }) => {
    const id = ++zaehler;
    const dataDir = require('./catalog').getDataDir();
    manager.set(
      id,
      new EngineManager({ dataDir, backend, tier, restartDelaysMs, transcribeTimeoutMs }),
    );
    return id;
  },
  start: (id) => m(id).start(),
  stop: (id) => m(id).stop(),
  // Start/Umschaltung ohne zu warten; das Ergebnis (Text) holt man mit ergebnis().
  startAsync: (id) => {
    ergebnisse.set(
      id,
      m(id)
        .start()
        .then(
          () => 'ok',
          (e) => e.message,
        ),
    );
  },
  setTierAsync: (id, tier) => {
    ergebnisse.set(
      id,
      m(id)
        .setTier(tier)
        .then(
          () => 'ok',
          (e) => e.message,
        ),
    );
  },
  ergebnis: (id) => ergebnisse.get(id),
  setTier: (id, tier) => m(id).setTier(tier),
  status: (id) => m(id).status,
  backend: (id) => m(id).backend,
  tier: (id) => m(id).tier,
  llamaLaeuft: (id) => m(id)._llama !== null,
  fallback: (id) => m(id).fallback,
  abstuerze: (id) => m(id).abstuerze,
  llamaUrl: (id) => m(id).llamaUrl,
  llamaKey: (id) => m(id).llamaKey,
  llama: (id) => ({ url: m(id).llamaUrl, key: m(id).llamaKey }),
  llamaArgs: (id) => m(id).llamaArgs,
  transcribe: (id, anzahl) => m(id).transcribe(new Float32Array(anzahl)),
  // Der Ersatz-Worker antwortet auf leere Eingabe nie.
  transcribeHaengt: (id) =>
    m(id)
      .transcribe(new Float32Array(0))
      .then(
        () => 'unerwartet beantwortet',
        (e) => e.message,
      ),
  kill: (id, welche) => {
    if (welche === 'worker') m(id)._worker.kill();
    else m(id)._llama.child.kill();
  },
  alleStoppen: () => Promise.all([...manager.values()].map((e) => e.stop())),
};
