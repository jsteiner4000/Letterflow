const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  hotkey: 'ctrl+win',
  micDeviceId: null,
  smoothing: true,
  smoothingModel: 'auto',
  dictionary: [],
  autostart: true,
};

const HOTKEYS = ['ctrl+win', 'rctrl', 'ctrl+shift'];
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
  } catch {
    return sanitize({});
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
  fs.renameSync(tmp, datei);
  return neu;
}

module.exports = { DEFAULTS, loadSettings, saveSettings };
