// Tastenkürzel-Logik: aus den Tastenereignissen des Helfers wird "down"/"up"/"cancel".
// Je Preset gilt eine Liste von Tastengruppen; aus jeder Gruppe muss mindestens eine Taste gedrückt sein.
const PRESETS = {
  'ctrl+win': [
    ['lctrl', 'rctrl'],
    ['lwin', 'rwin'],
  ],
  rctrl: [['rctrl']],
  'ctrl+shift': [
    ['lctrl', 'rctrl'],
    ['lshift', 'rshift'],
  ],
};

function createHotkeyMachine(preset) {
  const groups = PRESETS[preset] || PRESETS.rctrl;
  const allowed = new Set(groups.flat());
  const pressed = new Set();
  // idle: wartet · active: Kürzel gehalten · dead: gesperrt, bis alle Tasten losgelassen sind
  let state = 'idle';

  const complete = () => groups.every((g) => g.some((k) => pressed.has(k)));
  const foreign = () => [...pressed].some((k) => !allowed.has(k));

  function feed(ev) {
    if (!ev) return null;
    if (ev.ev === 'other' || ev.ev === 'esc') {
      // Gehalten wird weiterdiktiert (auch beim Fensterwechsel): nur Esc bricht ab
      if (state === 'active') {
        if (ev.ev !== 'esc') return null;
        state = 'dead';
        return 'cancel';
      }
      // Eine normale Taste bei gehaltenem Modifier (z. B. Strg+C) sperrt das Kürzel bis zum Loslassen
      if (state === 'idle' && pressed.size > 0) state = 'dead';
      return null;
    }
    if (ev.ev !== 'key') return null;

    if (ev.down) pressed.add(ev.key);
    else pressed.delete(ev.key);

    if (state === 'dead') {
      if (pressed.size === 0) state = 'idle';
      return null;
    }
    if (state === 'active') {
      if (!complete()) {
        state = pressed.size === 0 ? 'idle' : 'dead';
        return 'up';
      }
      return null;
    }
    // idle
    if (foreign()) {
      state = 'dead';
      return null;
    }
    if (ev.down && complete()) {
      state = 'active';
      return 'down';
    }
    return null;
  }

  // Zurücksetzen (z. B. Helfer abgestürzt): meldet 'cancel', falls das Kürzel gerade gehalten wurde
  function reset() {
    const wasActive = state === 'active';
    pressed.clear();
    state = 'idle';
    return wasActive ? 'cancel' : null;
  }

  return { feed, reset };
}

module.exports = { createHotkeyMachine };
