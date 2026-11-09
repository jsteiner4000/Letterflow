const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  hotkey: 'rctrl',
  micDeviceId: null,
  smoothing: true,
  smoothingModel: 'auto',
  dictionary: [],
  autostart: true,
};

const HOTKEYS = ['rctrl', 'ctrl+win', 'ctrl+shift'];
const MODELS = ['auto', 'schnell', 'gruendlich'];

// Prüft je Feld; ungültige Werte ergeben undefined (= Standardwert).
const VALIDATORS = {
  hotkey: (v) => (HOTKEYS.includes(v) ? v : undefined),
  micDeviceId: (v) => (v === null || (typeof v === 'string' && v !== '') ? v : undefined),
  smoothing: (v) => (typeof v === 'boolean' ? v : undefined),
  smoothingModel: (v) => (MODELS.includes(v) ? v : undefined),
  dictionary: (v) =>
    Array.isArray(v)
      ? [
          ...new Set(
            v
              .filter((e) => typeof e === 'string')
              .map((e) => e.trim())
              .filter(Boolean),
          ),
        ]
      : undefined,
  autostart: (v) => (typeof v === 'boolean' ? v : undefined),
};

function sanitize(raw) {
  const quelle = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const wert = VALIDATORS[key](quelle[key]);
    out[key] = wert === undefined ? structuredClone(DEFAULTS[key]) : wert;
  }
  return out;
}

const dateiPfad = (dir) => path.join(dir, 'settings.json');

function loadSettings(dir) {
  const datei = dateiPfad(dir);
  let text;
  try {
    text = fs.readFileSync(datei, 'utf8');
  } catch (fehler) {
    // Nur "Datei fehlt" bedeutet Standardwerte. Alles andere (z. B. EBUSY) weitergeben,
    // damit ein späteres Speichern die echten Einstellungen nicht überschreibt.
    if (fehler.code === 'ENOENT') return sanitize({});
    throw fehler;
  }
  try {
    return sanitize(JSON.parse(text));
  } catch {
    // Kaputte Datei sichern, damit nichts stillschweigend verloren geht.
    try {
      fs.copyFileSync(datei, datei + '.defekt');
    } catch {}
    return sanitize({});
  }
}

// Virenscanner halten die Datei kurz fest (EPERM/EBUSY): einmal nach kurzer Pause wiederholen.
function umbenennen(von, nach) {
  try {
    fs.renameSync(von, nach);
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    fs.renameSync(von, nach);
  }
}

function saveSettings(dir, patch) {
  const aktuell = loadSettings(dir);
  const neu = sanitize({ ...aktuell, ...(patch && typeof patch === 'object' ? patch : {}) });
  // Ein ungültiger Patch-Wert fällt auf den Standard zurück, nicht auf den alten Wert.
  for (const key of Object.keys(patch || {})) {
    if (key in DEFAULTS && VALIDATORS[key](patch[key]) === undefined) {
      neu[key] = structuredClone(DEFAULTS[key]);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const datei = dateiPfad(dir);
  const tmp = datei + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(neu, null, 2));
  umbenennen(tmp, datei);
  return neu;
}

module.exports = { DEFAULTS, loadSettings, saveSettings };
