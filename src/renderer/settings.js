const api = window.letterflow;
const $ = (id) => document.getElementById(id);

let aktuell = null;

// --- Anzeige -------------------------------------------------------------

function anzeigen(s) {
  aktuell = s;
  for (const r of document.querySelectorAll('input[name="hotkey"]'))
    r.checked = r.value === s.hotkey;
  for (const r of document.querySelectorAll('input[name="smoothingModel"]')) {
    r.checked = r.value === s.smoothingModel;
    r.disabled = !s.smoothing;
  }
  $('modelle').classList.toggle('aus', !s.smoothing);
  $('glaettung').checked = s.smoothing;
  $('autostart').checked = s.autostart;
  $('mikrofon').value = s.micDeviceId ?? '';
  eintraegeAnzeigen(s.dictionary);
}

let eintraegeGezeigt = false;

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
      knopf.textContent = 'Entfernen';
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
for (const r of document.querySelectorAll('input[name="smoothingModel"]')) {
  r.addEventListener('change', () => speichern({ smoothingModel: r.value }));
}
$('glaettung').addEventListener('change', (e) => speichern({ smoothing: e.target.checked }));
$('autostart').addEventListener('change', (e) => speichern({ autostart: e.target.checked }));
$('mikrofon').addEventListener('change', (e) => speichern({ micDeviceId: e.target.value || null }));
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

function statusAnzeigen(st) {
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
  statusAktualisieren();
  setInterval(statusAktualisieren, 3000);
  mikrofoneMitNamen().then(() => anzeigen(aktuell));
  navigator.mediaDevices?.addEventListener('devicechange', () =>
    mikrofoneLaden().then(() => anzeigen(aktuell)),
  );
})();
