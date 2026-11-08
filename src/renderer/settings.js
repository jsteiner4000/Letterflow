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

function eintraegeAnzeigen(liste) {
  const ul = $('eintraege');
  ul.replaceChildren();
  for (const eintrag of liste) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = eintrag;
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = 'Entfernen';
    knopf.setAttribute('aria-label', `${eintrag} entfernen`);
    knopf.addEventListener('click', () =>
      api.settings.set({ dictionary: aktuell.dictionary.filter((e) => e !== eintrag) }),
    );
    li.append(text, knopf);
    ul.append(li);
  }
}

// --- Eingaben ------------------------------------------------------------

for (const r of document.querySelectorAll('input[name="hotkey"]')) {
  r.addEventListener('change', () => api.settings.set({ hotkey: r.value }));
}
for (const r of document.querySelectorAll('input[name="smoothingModel"]')) {
  r.addEventListener('change', () => api.settings.set({ smoothingModel: r.value }));
}
$('glaettung').addEventListener('change', (e) => api.settings.set({ smoothing: e.target.checked }));
$('autostart').addEventListener('change', (e) => api.settings.set({ autostart: e.target.checked }));
$('mikrofon').addEventListener('change', (e) =>
  api.settings.set({ micDeviceId: e.target.value || null }),
);
$('woerterbuch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const eingabe = $('neuer-eintrag');
  const wert = eingabe.value.trim();
  if (!wert) return;
  eingabe.value = '';
  api.settings.set({ dictionary: [...aktuell.dictionary, wert] });
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
  fehler: 'Fehler – wird neu gestartet',
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
      ? `Glättung: Gründlich auf ${BACKEND_TEXT[st.backend] || 'Prozessor'}`
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
  aktuell = await api.settings.get();
  await mikrofoneLaden();
  anzeigen(aktuell);
  statusAktualisieren();
  setInterval(statusAktualisieren, 3000);
  mikrofoneMitNamen().then(() => anzeigen(aktuell));
  navigator.mediaDevices?.addEventListener('devicechange', () =>
    mikrofoneLaden().then(() => anzeigen(aktuell)),
  );
})();
