const api = window.letterflow;
const $ = (id) => document.getElementById(id);

let aktuell = null;
let letzterStatus = null;

const KAPPEN = {
  'ctrl+win': ['Strg', 'Win'],
  rctrl: ['Rechte Strg'],
  'ctrl+shift': ['Strg', 'Umschalt'],
};

// --- Bereiche (Seitenleiste) ---------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];

function bereichZeigen(tab, fokus = false) {
  for (const t of tabs) {
    const an = t === tab;
    t.setAttribute('aria-selected', String(an));
    t.tabIndex = an ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !an;
  }
  if (fokus) tab.focus();
  pegelPruefen();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => bereichZeigen(tab));
  // Pfeiltasten wechseln den Bereich, Tab springt in den Inhalt.
  tab.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(tab);
    const ziel = {
      ArrowDown: tabs[(i + 1) % tabs.length],
      ArrowUp: tabs[(i - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs.at(-1),
    }[e.key];
    if (!ziel) return;
    e.preventDefault();
    bereichZeigen(ziel, true);
  });
}

// --- Anzeige -------------------------------------------------------------

function anzeigen(s) {
  aktuell = s;
  for (const r of document.querySelectorAll('input[name="hotkey"]'))
    r.checked = r.value === s.hotkey;
  for (const r of document.querySelectorAll('input[name="smoothingModel"]')) {
    r.checked = r.value === s.smoothingModel;
    r.disabled = !s.smoothing;
  }
  $('kappen').replaceChildren(
    ...(KAPPEN[s.hotkey] || []).map((t) =>
      Object.assign(document.createElement('kbd'), { textContent: t }),
    ),
  );
  $('glaettung').checked = s.smoothing;
  $('autostart').checked = s.autostart;
  $('mikrofon').value = s.micDeviceId ?? '';
  eintraegeAnzeigen(s.dictionary);
}

let eintraegeGezeigt = false;
const KREUZ = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// Ändert nur die Chips, die sich wirklich geändert haben (kein Flackern, Fokus bleibt).
function eintraegeAnzeigen(liste) {
  const ul = $('eintraege');
  const vorhanden = new Map([...ul.children].map((li) => [li.dataset.eintrag, li]));
  for (const [eintrag, li] of vorhanden) {
    if (liste.includes(eintrag)) continue;
    if (li.contains(document.activeElement)) {
      const nachbar = li.nextElementSibling || li.previousElementSibling;
      (nachbar ? nachbar.querySelector('button') : $('neuer-eintrag')).focus();
    }
    li.remove();
    vorhanden.delete(eintrag);
  }
  liste.forEach((eintrag, i) => {
    let li = vorhanden.get(eintrag);
    if (!li) {
      li = document.createElement('li');
      li.dataset.eintrag = eintrag;
      if (eintraegeGezeigt) li.classList.add('neu');
      const text = document.createElement('span');
      text.textContent = eintrag;
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.innerHTML = KREUZ;
      knopf.setAttribute('aria-label', `${eintrag} entfernen`);
      knopf.addEventListener('click', () =>
        speichern((s) => ({ dictionary: s.dictionary.filter((e) => e !== eintrag) })),
      );
      li.append(text, knopf);
    }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
  });
  eintraegeGezeigt = true;
}

// --- Speichern -----------------------------------------------------------

// Aktionen laufen nacheinander; jede rechnet gegen den Stand, den die vorige geliefert hat.
let warteschlange = Promise.resolve();

function hinweis(text) {
  $('fehler').textContent = text || '';
  $('fehler').hidden = !text;
}

function speichern(patchOderFunktion) {
  const lauf = warteschlange.then(async () => {
    const patch =
      typeof patchOderFunktion === 'function' ? patchOderFunktion(aktuell) : patchOderFunktion;
    let ergebnis;
    try {
      ergebnis = await api.settings.set(patch);
    } catch {
      ergebnis = { error: 'speichern' };
    }
    if (!ergebnis || ergebnis.error) {
      hinweis('Einstellung konnte nicht gespeichert werden.');
      anzeigen(aktuell); // Bedienelemente auf den tatsächlichen Stand zurücksetzen
      return false;
    }
    hinweis('');
    anzeigen(ergebnis);
    return true;
  });
  warteschlange = lauf.catch(() => {});
  return lauf;
}

// --- Eingaben ------------------------------------------------------------

for (const r of document.querySelectorAll('input[name="hotkey"]')) {
  r.addEventListener('change', () => speichern({ hotkey: r.value }));
}
// Würde die Wahl ein fehlendes Gründlich-Modell (2,5 GB) laden, vorher fragen.
async function stufeWaehlen(wert) {
  let st = letzterStatus;
  try {
    st = await api.status.get();
  } catch {}
  const gruendlich = wert === 'gruendlich' || (wert === 'auto' && st?.autoTier === 'gruendlich');
  if (gruendlich && st?.gruendlichFehlt) {
    const laden = await window.bestaetigen({
      titel: 'Gründliche Glättung laden?',
      text: 'Einmalig 2,5 GB, danach offline.',
      ja: 'Laden',
    });
    if (!laden) return anzeigen(aktuell); // vorige Stufe wieder anzeigen
  }
  speichern({ smoothingModel: wert });
}

for (const r of document.querySelectorAll('input[name="smoothingModel"]')) {
  r.addEventListener('change', () => stufeWaehlen(r.value));
}
$('kuerzel-aendern').addEventListener('click', (e) => {
  const offen = $('kuerzel-wahl').hidden;
  $('kuerzel-wahl').hidden = !offen;
  e.currentTarget.setAttribute('aria-expanded', String(offen));
  if (offen) $('kuerzel-wahl').querySelector('input:checked')?.focus();
});
$('ueber').addEventListener('click', () => api.about());
$('glaettung').addEventListener('change', (e) => speichern({ smoothing: e.target.checked }));
$('autostart').addEventListener('change', (e) => speichern({ autostart: e.target.checked }));
$('mikrofon').addEventListener('change', async (e) => {
  await speichern({ micDeviceId: e.target.value || null });
  pegelPruefen(true);
});
$('woerterbuch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const eingabe = $('neuer-eintrag');
  const wert = eingabe.value.trim();
  if (!wert) return;
  const ok = await speichern((s) =>
    s.dictionary.includes(wert) ? {} : { dictionary: [...s.dictionary, wert] },
  );
  // Erst nach Erfolg leeren, und nur wenn inzwischen nichts Neues getippt wurde.
  if (ok && eingabe.value.trim() === wert) eingabe.value = '';
});

// --- Mikrofone -----------------------------------------------------------

async function mikrofoneLaden() {
  const gewaehlt = aktuell ? aktuell.micDeviceId : null;
  let geraete = [];
  try {
    geraete = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications',
    );
  } catch {}
  const optionen = [new Option('Windows-Standard', '')];
  geraete.forEach((d, i) => optionen.push(new Option(d.label || `Mikrofon ${i + 1}`, d.deviceId)));
  // Gespeichertes, gerade nicht angeschlossenes Gerät sichtbar lassen.
  if (gewaehlt && !geraete.some((d) => d.deviceId === gewaehlt)) {
    optionen.push(new Option('Gewähltes Mikrofon (nicht angeschlossen)', gewaehlt));
  }
  $('mikrofon').replaceChildren(...optionen);
  $('mikrofon').value = gewaehlt ?? '';
  return geraete;
}

async function mikrofoneMitNamen() {
  const geraete = await mikrofoneLaden();
  // Ohne Berechtigung liefert Windows keine Namen; einmal kurz anfragen und neu lesen.
  if (geraete.length && geraete.every((d) => !d.label)) {
    try {
      const strom = await navigator.mediaDevices.getUserMedia({ audio: true });
      strom.getTracks().forEach((t) => t.stop());
      await mikrofoneLaden();
    } catch {}
  }
}

// --- Pegel ---------------------------------------------------------------

// Mikrofon nur offen, solange „Diktieren“ sichtbar ist; sonst sofort schließen.
let pegel = null; // { strom, ctx, frame }

function pegelStoppen() {
  if (!pegel) return;
  cancelAnimationFrame(pegel.frame);
  pegel.strom?.getTracks().forEach((t) => t.stop());
  pegel.ctx?.close().catch(() => {});
  pegel = null;
  for (const b of $('pegel').children) b.classList.remove('an');
}

async function pegelStarten() {
  const lauf = (pegel = {});
  const id = aktuell?.micDeviceId;
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({
      audio: id ? { deviceId: { exact: id } } : true,
    });
  } catch {
    if (pegel === lauf) pegel = null;
    return;
  }
  if (pegel !== lauf) return strom.getTracks().forEach((t) => t.stop()); // inzwischen gestoppt
  const ctx = new AudioContext();
  const analyse = ctx.createAnalyser();
  analyse.fftSize = 1024;
  ctx.createMediaStreamSource(strom).connect(analyse);
  const daten = new Float32Array(analyse.fftSize);
  const balken = [...$('pegel').children];
  Object.assign(lauf, { strom, ctx });
  const zeichnen = () => {
    analyse.getFloatTimeDomainData(daten);
    const rms = Math.sqrt(daten.reduce((n, v) => n + v * v, 0) / daten.length);
    // -60 dB → kein Balken, -10 dB → alle fünf
    const n = Math.max(0, Math.min(5, Math.round((20 * Math.log10(rms + 1e-9) + 60) / 10)));
    balken.forEach((b, i) => b.classList.toggle('an', i < n));
    lauf.frame = requestAnimationFrame(zeichnen);
  };
  zeichnen();
}

function pegelPruefen(neu = false) {
  const sichtbar = !$('seite-diktieren').hidden && document.visibilityState === 'visible';
  if (!sichtbar || neu) pegelStoppen();
  if (sichtbar && !pegel && aktuell) pegelStarten();
}

document.addEventListener('visibilitychange', () => pegelPruefen());

// --- System --------------------------------------------------------------

const ENGINE_TEXT = {
  bereit: 'Bereit',
  startet: 'Startet …',
  fehler: 'Fehler – bitte Letterflow neu starten',
  fehlt: 'Einrichtung nicht abgeschlossen',
};
const BACKEND_TEXT = {
  cuda: 'Grafikkarte (CUDA)',
  vulkan: 'Grafikkarte (Vulkan)',
  cpu: 'Prozessor',
};

const STATUSZEILE = {
  bereit: 'Bereit · alles lokal',
  startet: 'Startet …',
  fehler: 'Fehler – wird neu gestartet',
  fehlt: 'Einrichtung nicht abgeschlossen',
};
const STUFE_TEXT = { schnell: 'Schnell', gruendlich: 'Gründlich' };

function statusAnzeigen(st) {
  letzterStatus = st;
  const zustand = STATUSZEILE[st.engines] ? st.engines : 'fehlt';
  $('statuszeile').dataset.zustand = zustand;
  $('statuszeile-text').textContent = STATUSZEILE[zustand];
  const pc = STUFE_TEXT[st.autoTier];
  $('auf-diesem-pc').hidden = !pc;
  $('auf-diesem-pc').textContent = pc ? `Auf diesem PC: ${pc}` : '';
  $('status-glaettung').textContent =
    st.tier === 'gruendlich'
      ? `Glättung: Gründlich auf ${BACKEND_TEXT[st.backend] || 'Prozessor'}${st.rueckfall ? ' (Rückfall, Grafikkarte nicht nutzbar)' : ''}`
      : 'Glättung: Schnell (Regeln)';
  $('status-engine').textContent = ENGINE_TEXT[st.engines] || ENGINE_TEXT.fehlt;
}

async function statusAktualisieren() {
  try {
    statusAnzeigen(await api.status.get());
  } catch {}
}

// --- Start ---------------------------------------------------------------

api.settings.onChanged((s) => {
  anzeigen(s);
  statusAktualisieren();
});

(async () => {
  try {
    aktuell = await api.settings.get();
  } catch {
    hinweis('Einstellungen konnten nicht gelesen werden.');
    return;
  }
  await mikrofoneLaden();
  anzeigen(aktuell);
  pegelPruefen();
  api
    .info()
    .then((info) => ($('version').textContent = `Version ${info.version}`))
    .catch(() => {});
  statusAktualisieren();
  setInterval(statusAktualisieren, 3000);
  mikrofoneMitNamen().then(() => anzeigen(aktuell));
  navigator.mediaDevices?.addEventListener('devicechange', () =>
    mikrofoneLaden().then(() => anzeigen(aktuell)),
  );
})();
