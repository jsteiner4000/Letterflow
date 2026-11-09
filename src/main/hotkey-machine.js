// Tastenkürzel-Logik: aus den Tastenereignissen des Helfers wird "down"/"up"/"cancel".
// Modus „halten“: Drücken = down, Loslassen = up. Modus „umschalten“: zweimal schnell antippen = down,
// danach einmal drücken = up; das erste Antippen meldet "tap" (nur zum Maskieren der Win-Taste).
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

const DOPPEL_MS = 400; // Umschalten: beide Druckanfänge höchstens so weit auseinander

function createHotkeyMachine(preset, mode = 'halten') {
  const groups = PRESETS[preset] || PRESETS.rctrl;
  const allowed = new Set(groups.flat());
  const pressed = new Set();
  const umschalten = mode === 'umschalten';
  // idle: wartet · active: Kürzel gehalten · dead: gesperrt, bis alle Tasten losgelassen sind
  // Umschalten: tipp (erstes Antippen gehalten) · luecke (wartet aufs zweite) · laeuft (Diktat an)
  let state = 'idle';
  let erstesAntippen = 0;

  const complete = () => groups.every((g) => g.some((k) => pressed.has(k)));
  const foreign = () => [...pressed].some((k) => !allowed.has(k));

  function feed(ev, now = Date.now()) {
    if (!ev) return null;
    if (ev.ev === 'other' || ev.ev === 'esc') {
      // Während des Diktats wird weiterdiktiert (auch beim Fensterwechsel): nur Esc bricht ab
      if (state === 'active' || state === 'laeuft') {
        if (ev.ev !== 'esc') return null;
        state = pressed.size ? 'dead' : 'idle';
        return 'cancel';
      }
      // Eine normale Taste bei gehaltenem Modifier (z. B. Strg+C) sperrt das Kürzel bis zum Loslassen;
      // Tippen nach dem ersten Antippen verwirft das Doppeltippen.
      if (state !== 'dead' && pressed.size > 0) state = 'dead';
      else if (state === 'luecke') state = 'idle';
      return null;
    }
    if (ev.ev !== 'key') return null;

    const vorher = complete(); // Tastenwiederholung beim Halten ist kein neuer Druck
    if (ev.down) pressed.add(ev.key);
    else pressed.delete(ev.key);
    const neuerDruck = ev.down && !vorher && complete();

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
    if (state === 'laeuft') {
      if (!neuerDruck) return null;
      state = 'dead';
      return 'up';
    }
    if (state === 'tipp') {
      if (foreign()) state = 'dead';
      else if (!complete()) state = 'luecke';
      return null;
    }
    // idle oder luecke
    if (foreign()) {
      state = 'dead';
      return null;
    }
    if (!neuerDruck) return null;
    if (!umschalten) {
      state = 'active';
      return 'down';
    }
    if (state === 'luecke' && now - erstesAntippen <= DOPPEL_MS) {
      state = 'laeuft';
      return 'down';
    }
    state = 'tipp';
    erstesAntippen = now;
    return 'tap';
  }

  // Zurücksetzen (z. B. Helfer abgestürzt): meldet 'cancel', falls das Kürzel gerade gehalten wurde
  function reset() {
    const wasActive = state === 'active' || state === 'laeuft';
    pressed.clear();
    state = 'idle';
    return wasActive ? 'cancel' : null;
  }

  return { feed, reset };
}

module.exports = { createHotkeyMachine };
