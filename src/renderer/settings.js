const api = window.letterflow;
const $ = (id) => document.getElementById(id);

let aktuell = null;
let letzterStatus = null;

// Sprechtaste als Tastenkappen: [Strg] rechts · [Strg] + [Win] · [Strg] + [Umschalt]
const KAPPE = {
  rctrl: [['Strg', 'rechts']],
  'ctrl+win': [['Strg'], ['Win']],
  'ctrl+shift': [['Strg'], ['Umschalt']],
};
function kappenZeigen(ziel, hotkey) {
  const teile = [];
  for (const [taste, zusatz] of KAPPE[hotkey] || []) {
    if (teile.length)
      teile.push(
        Object.assign(document.createElement('span'), { className: 'plus', textContent: '+' }),
      );
    teile.push(Object.assign(document.createElement('kbd'), { textContent: taste }));
    if (zusatz) teile.push(Object.assign(document.createElement('small'), { textContent: zusatz }));
  }
  ziel.replaceChildren(...teile);
}

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
  if (tab.id === 'tab-pille' && aktuell) pilleAnzeigen(aktuell.pill); // Breite erst jetzt messbar
  pegelStoppen();
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
  kappenZeigen($('kappe'), s.hotkey);
  $('glaettung').checked = s.smoothing;
  $('autostart').checked = s.autostart;
  pilleAnzeigen(s.pill);
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
      li.className = 'zeile';
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

// --- Pille: Vorschau (gleicher Glas-Code wie das Aufnahme-Fenster, festes Beispielbild) ---------

// Glas-Standard (Zurücksetzen); die Animation bleibt dabei unberührt.
const PILLE_STANDARD = {
  frost: 40,
  opacity: 85,
  refraction: 60,
  tint: 'hell',
  autoDarken: true,
  autoDarkenStrength: 50,
};
const REGLER = ['frost', 'opacity', 'refraction', 'autoDarkenStrength'];
const BILD_B = 640;
const BILD_H = 170;
const BILD_S = 2;
const vorschau = $('vorschau');
const vorschauGlas = window.PilleGlas.erzeugen($('vorschau-glas'));
const beispiel = $('vorschau-bild');
let pilleStand = { ...PILLE_STANDARD };
let beispielHell = null;

function beispielZeichnen() {
  const x = beispiel.getContext('2d');
  x.scale(BILD_S, BILD_S);
  const g = x.createLinearGradient(0, 0, BILD_B, BILD_H);
  g.addColorStop(0, '#c9774e');
  g.addColorStop(0.5, '#3a5f7a');
  g.addColorStop(1, '#1d2b38');
  x.fillStyle = g;
  x.fillRect(0, 0, BILD_B, BILD_H);
  x.fillStyle = '#f3d2b8';
  x.beginPath();
  x.arc(BILD_B * 0.22, BILD_H * 0.55, 56, 0, 7);
  x.fill();
  x.fillStyle = '#fff';
  x.fillRect(BILD_B * 0.44, 0, BILD_B * 0.56, BILD_H); // Pille liegt großteils auf Weiß: Abdunkeln sichtbar
  x.fillStyle = '#222';
  x.font = '600 16px Georgia, serif';
  x.fillText('Hallo Tim, ich schicke dir', BILD_B * 0.53, 52);
  x.fillText('das Recap nach dem Standup.', BILD_B * 0.53, 84);
  x.fillStyle = '#2b579a';
  x.fillRect(BILD_B * 0.53, 112, 90, 26);
  x.fillStyle = '#e8a33d';
  x.fillRect(BILD_B * 0.53 + 102, 112, 70, 26);
  if (vorschauGlas) vorschauGlas.bild(beispiel);
}

// Zeitstrahl mitten im Sprechen: links älter (blendet aus), rechts die neuesten Balken.
for (let i = 0; i < 22; i++) {
  const h = Math.min(1, 0.15 + 0.85 * Math.abs(Math.sin((i + 1) * 0.9) * Math.cos((i + 1) * 0.37)));
  const b = $('vorschau-balken').appendChild(document.createElement('i'));
  b.style.transform = `translateX(${i * 5.5}px) scaleY(${(i < 3 ? 0 : h).toFixed(2)})`;
}

function vorschauAnzeigen() {
  const breite = vorschau.offsetWidth;
  if (!breite) return; // Bereich verborgen: beim Öffnen neu
  const s = BILD_S;
  const ox = Math.round(((BILD_B - breite) / 2) * s);
  const oy = Math.round(((BILD_H - 52) / 2) * s);
  const cfg = { ...pilleStand };
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches) cfg.opacity = 0;
  if (beispielHell === null || beispielHell.breite !== breite) {
    const px = beispiel.getContext('2d').getImageData(ox, oy, Math.round(breite * s), 52 * s);
    beispielHell = {
      breite,
      wert: window.PilleGlas.helligkeit(px.data, px.width, 0, 0, px.width, px.height, false),
    };
  }
  window.PilleGlas.anwenden(vorschau, cfg, beispielHell.wert);
  const echt = Boolean(vorschauGlas) && !matchMedia('(forced-colors: active)').matches;
  if (echt) vorschauGlas.zeichnen({ s, ox, oy, refraction: cfg.refraction });
  vorschau.classList.toggle('echt', echt);
}

const HEX = /^#[0-9a-f]{6}$/i;
function pilleAnzeigen(p) {
  pilleStand = p;
  for (const k of REGLER) {
    $(`p-${k}`).value = p[k];
    $(`w-${k}`).textContent = `${p[k]} %`;
  }
  $('p-autoDarken').checked = p.autoDarken;
  $('p-autoDarkenStrength').disabled = !p.autoDarken;
  $('p-animation').value = p.animation;
  for (const r of document.querySelectorAll('input[name="tint"]')) r.checked = r.value === p.tint;
  const eigene = HEX.test(p.tint);
  $('p-eigen').value = eigene ? p.tint : '#ffffff';
  $('p-eigen').closest('.farbe').classList.toggle('gewaehlt', eigene);
  $('p-eigen')
    .closest('.farbe')
    .style.setProperty('--c', eigene ? p.tint : 'transparent');
  vorschauAnzeigen();
}

beispielZeichnen();

for (const k of REGLER) {
  $(`p-${k}`).addEventListener('input', (e) => {
    pilleStand = { ...pilleStand, [k]: Number(e.target.value) };
    $(`w-${k}`).textContent = `${e.target.value} %`;
    vorschauAnzeigen();
  });
  $(`p-${k}`).addEventListener('change', () =>
    speichern((s) => ({ pill: { ...s.pill, [k]: pilleStand[k] } })),
  );
}
for (const r of document.querySelectorAll('input[name="tint"]'))
  r.addEventListener('change', () => speichern((s) => ({ pill: { ...s.pill, tint: r.value } })));
$('p-eigen').addEventListener('input', (e) => {
  pilleStand = { ...pilleStand, tint: e.target.value };
  pilleAnzeigen(pilleStand);
});
$('p-eigen').addEventListener('change', (e) =>
  speichern((s) => ({ pill: { ...s.pill, tint: e.target.value } })),
);
$('p-autoDarken').addEventListener('change', (e) => {
  pilleAnzeigen({ ...pilleStand, autoDarken: e.target.checked });
  speichern((s) => ({ pill: { ...s.pill, autoDarken: e.target.checked } }));
});
$('p-animation').addEventListener('change', (e) =>
  speichern((s) => ({ pill: { ...s.pill, animation: e.target.value } })),
);
$('pille-zurueck').addEventListener('click', () =>
  speichern((s) => ({ pill: { ...s.pill, ...PILLE_STANDARD } })),
);

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
  if (pegel) pegelStarten(); // laufenden Test mit dem neuen Gerät fortsetzen
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

// Mikrofon nur auf Knopfdruck offen: endet nach 10 s, beim Seitenwechsel, Fensterwechsel oder
// erneutem Klick.
const PEGEL_DAUER_MS = 10000;
let pegel = null; // { strom, ctx, frame, timer }

function pegelStoppen() {
  if (!pegel) return;
  $('pegel-test').textContent = 'Pegel testen';
  clearTimeout(pegel.timer);
  cancelAnimationFrame(pegel.frame);
  pegel.strom?.getTracks().forEach((t) => t.stop());
  pegel.ctx?.close().catch(() => {});
  pegel = null;
  $('pegel').hidden = true;
  for (const b of $('pegel').children) b.classList.remove('an');
}

async function pegelStarten() {
  pegelStoppen();
  const lauf = (pegel = { timer: setTimeout(pegelStoppen, PEGEL_DAUER_MS) });
  $('pegel-test').textContent = 'Test beenden';
  $('pegel').hidden = false;
  const id = aktuell?.micDeviceId;
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({
      audio: id ? { deviceId: { exact: id } } : true,
    });
  } catch {
    if (pegel === lauf) pegelStoppen();
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

$('pegel-test').addEventListener('click', () => (pegel ? pegelStoppen() : pegelStarten()));
window.addEventListener('blur', pegelStoppen);
window.addEventListener('pagehide', pegelStoppen);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') pegelStoppen();
});

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
  // Sichtbar nur der Punkt; der Text steht im Tooltip und für Bildschirmleser in role=status.
  $('ver').dataset.zustand = zustand;
  $('ver').title = STATUSZEILE[zustand];
  $('statuszeile').textContent = STATUSZEILE[zustand];
  const pc = STUFE_TEXT[st.autoTier];
  $('auto-text').textContent = pc ? `Wählt nach deinem PC – hier: ${pc}` : 'Wählt nach deinem PC';
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

// Meldet die Höhe der höchsten Seite, damit das Fenster ohne Scrollen passt.
async function groesseMelden() {
  try {
    await document.fonts.ready;
    const seiten = tabs.map((t) => $(t.getAttribute('aria-controls')));
    const gemerkt = seiten.map((s) => s.hidden);
    const inhalt = document.querySelector('.inhalt');
    const hoehen = seiten.map((s) => {
      seiten.forEach((x) => (x.hidden = x !== s));
      return inhalt.offsetHeight;
    });
    seiten.forEach((s, i) => (s.hidden = gemerkt[i]));
    api.settings.groesse(Math.max(...hoehen) + 80); // 80 = Innenabstand von main
  } catch {
    api.settings.groesse(0);
  }
}

(async () => {
  try {
    aktuell = await api.settings.get();
  } catch {
    hinweis('Einstellungen konnten nicht gelesen werden.');
    return;
  }
  await mikrofoneLaden();
  anzeigen(aktuell);
  groesseMelden();
  api
    .info()
    .then((info) => {
      $('version').textContent = `Version ${info.version}`;
      $('version-zeile').textContent = `Letterflow v${info.version}`;
    })
    .catch(() => {});
  statusAktualisieren();
  setInterval(statusAktualisieren, 3000);
  mikrofoneMitNamen().then(() => anzeigen(aktuell));
  navigator.mediaDevices?.addEventListener('devicechange', () =>
    mikrofoneLaden().then(() => anzeigen(aktuell)),
  );
})();
