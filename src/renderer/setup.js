const api = window.letterflow;
const $ = (id) => document.getElementById(id);

const TEXTE = {
  network: 'Download unterbrochen – bitte Internetverbindung prüfen.',
  checksum: 'Datei beschädigt – wird neu geladen.',
  disk: 'Nicht genug Speicherplatz.',
  entpacken: 'Entpacken fehlgeschlagen.',
};

const empfangen = new Map(); // id -> bisher geladene Bytes
let gesamt = 0;

const gb = (bytes) => (bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function fortschrittAnzeigen() {
  let geladen = 0;
  for (const v of empfangen.values()) geladen += v;
  const prozent = gesamt ? Math.min(100, Math.floor((geladen / gesamt) * 100)) : 0;
  $('balken').value = prozent;
  $('fortschritt-text').textContent = `${gb(geladen)} von ${gb(gesamt)} GB · ${prozent} %`;
}

function fehlerAnzeigen(code, auto = false) {
  const meldung = code ? TEXTE[code] || TEXTE.network : '';
  $('fehler').textContent = meldung;
  $('fehler').hidden = !code;
  // Bei beschädigter Datei lädt die App von selbst neu, sonst entscheidet die Person.
  $('erneut').hidden = !code || auto;
  if (code && !auto) $('erneut').focus();
}

api.setup.onProgress(({ id, received }) => {
  empfangen.set(id, received);
  fortschrittAnzeigen();
});
api.setup.onError(({ code, auto }) => fehlerAnzeigen(code, auto));
$('erneut').addEventListener('click', () => {
  $('erneut').hidden = true;
  api.setup.retry();
});

function planAnzeigen(plan) {
  if (!plan) return;
  if (plan.frage) {
    // Die zum PC passende Stufe ist vorgewählt und als empfohlen markiert.
    const empfohlen = document.querySelector(`input[name=stufe][value="${plan.empfohlen}"]`);
    if (empfohlen && !$('wahl').querySelector('.empfohlen')) {
      empfohlen.checked = true;
      empfohlen.parentElement.querySelector('b').append(
        Object.assign(document.createElement('span'), {
          className: 'empfohlen',
          textContent: ' (empfohlen)',
        }),
      );
    }
    $('wahl').hidden = false;
    return;
  }
  $('wahl').hidden = true;
  $('intro').hidden = false;
  $('laden').hidden = false;
  gesamt = plan.totalBytes;
  for (const f of plan.files) if (!empfangen.has(f.id)) empfangen.set(f.id, f.received);
  $('intro').textContent =
    `Letterflow lädt einmalig die Sprachmodelle herunter (ca. ${gb(gesamt)} GB). Danach funktioniert alles offline.`;
  fortschrittAnzeigen();
  if (plan.error) fehlerAnzeigen(plan.error.code, plan.error.auto);
}

$('weiter').addEventListener('click', () => {
  $('weiter').disabled = true;
  api.setup.waehlen(document.querySelector('input[name=stufe]:checked').value);
});
api.setup.onPlan(planAnzeigen);
api.setup.plan().then(planAnzeigen);
