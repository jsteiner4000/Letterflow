const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  hotkey: 'rctrl',
  micDeviceId: null,
  smoothing: true,
  smoothingModel: 'auto',
  dictionary: [],
  autostart: true,
  pill: {
    frost: 40,
    opacity: 85,
    refraction: 60,
    tint: 'hell',
    autoDarken: true,
    autoDarkenStrength: 50,
    animation: 'auto',
    animationAutoOff: false, // intern: „Automatisch“ hat auf diesem PC ruckelnde Animationen gemessen
  },
};

const HOTKEYS = ['rctrl', 'ctrl+win', 'ctrl+shift'];
const MODELS = ['auto', 'schnell', 'gruendlich'];
const TINTS = ['hell', 'neutral', 'dunkel', 'warm', 'petrol'];
const ANIMATIONS = ['auto', 'an', 'aus'];

// Glas der Pille: Regler 0–100 (ungültig → Standard), Tönung Name oder eigene Farbe #rrggbb,
// Abdunkeln über hellem Grund, Animation beim Erscheinen.
function pill(v) {
  const q = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const d = DEFAULTS.pill;
  const regler = (k) =>
    Number.isFinite(q[k]) ? Math.round(Math.min(100, Math.max(0, q[k]))) : d[k];
  const ok =
    TINTS.includes(q.tint) || (typeof q.tint === 'string' && /^#[0-9a-f]{6}$/i.test(q.tint));
  return {
    frost: regler('frost'),
    opacity: regler('opacity'),
    refraction: regler('refraction'),
    tint: ok ? q.tint.toLowerCase() : d.tint,
    autoDarken: typeof q.autoDarken === 'boolean' ? q.autoDarken : d.autoDarken,
    autoDarkenStrength: regler('autoDarkenStrength'),
    animation: ANIMATIONS.includes(q.animation) ? q.animation : d.animation,
    animationAutoOff: typeof q.animationAutoOff === 'boolean' ? q.animationAutoOff : false,
  };
}

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
  pill,
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
