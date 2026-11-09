const pille = document.getElementById('pille');
const symbol = document.getElementById('symbol');
const bild = document.getElementById('bild');
const zeile1 = document.getElementById('zeile1');
const zeile2 = document.getElementById('zeile2');
const ansage = document.getElementById('ansage');
const balken = [...document.querySelectorAll('#balken i')];

const ARIA = { aufnahme: 'Ich höre zu', verarbeitung: 'Text wird aufbereitet' };
const BAND = 16; // wie in main/overlay.js: Rand (DIP) des erfassten Streifens über der Pille
const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const kontrast = () => matchMedia('(forced-colors: active)').matches;

// --- Wellenform: 22 Balken, logarithmischer Pegel, Ansprechen ~40 ms, Abklingen ~180 ms ----------
const PROFIL = balken.map(
  (_, i) => 0.45 + 0.55 * Math.abs(Math.sin(i * 0.9 + 1) * Math.cos(i * 0.37)),
);
const MIN_HOEHE = 0.18;
const glatt = new Float32Array(balken.length).fill(MIN_HOEHE);
let ziel = 0;
let lauf = 0;
let letzte = 0;

// Hauptprozess liefert sqrt(rms / 0.3); zurück auf rms, dann dB: −58 dB (leise) … −8 dB (laut)
function dbNormiert(n) {
  const rms = 0.3 * n * n;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-5) + 58) / 50));
}

function takt(t) {
  const dt = Math.min(64, t - (letzte || t - 16));
  letzte = t;
  balken.forEach((b, i) => {
    const form = ruhig() ? 1 : PROFIL[i] * (0.82 + 0.18 * Math.sin(t / 130 + i * 1.7));
    const z = MIN_HOEHE + (1 - MIN_HOEHE) * Math.min(1, ziel * form * 1.1);
    glatt[i] += (z - glatt[i]) * (1 - Math.exp(-dt / (z > glatt[i] ? 40 : 180)));
    b.style.transform = `scaleY(${glatt[i].toFixed(3)})`;
  });
  const weiter = pille.dataset.kind === 'aufnahme' && pille.classList.contains('sichtbar');
  lauf = weiter ? requestAnimationFrame(takt) : 0;
}

function taktStarten() {
  if (lauf) return;
  letzte = 0;
  lauf = requestAnimationFrame(takt);
}

function pegelSetzen(n) {
  ziel = dbNormiert(Math.max(0, Math.min(1, Number(n) || 0)));
  if (pille.dataset.kind === 'aufnahme') taktStarten();
}

function zeile2Setzen(state) {
  if (state.kind === 'warnung') {
    const taste = (t) => Object.assign(document.createElement('kbd'), { textContent: t });
    zeile2.replaceChildren('Mit ', taste('Strg'), ' ', taste('V'), ' einfügen');
  } else if (state.kind === 'erfolg') {
    zeile2.textContent = state.words === 1 ? '1 Wort' : `${state.words || 0} Wörter`;
  } else zeile2.textContent = state.zweit || '';
}

function inhaltSetzen(state) {
  const app = state.app;
  pille.dataset.kind = state.kind;
  if (state.kind === 'warnung' || state.kind === 'fehler') symbol.dataset.art = 'warn';
  else if (app && app.iconDataUrl) symbol.dataset.art = 'bild';
  else symbol.dataset.art = 'mono';
  if (symbol.dataset.art === 'bild') bild.src = app.iconDataUrl;
  else bild.removeAttribute('src');
  if (state.kind === 'erfolg') zeile1.textContent = 'Eingefügt';
  else zeile1.textContent = ARIA[state.kind] ? '' : state.text || '';
  zeile2Setzen(state);
  pille.setAttribute('aria-label', ARIA[state.kind] || '');
  // Erfolg, Hinweise und Fehler werden angesagt (die Pille nimmt nie den Fokus).
  const ansagen = ['erfolg', 'warnung', 'fehler'].includes(state.kind);
  ansage.textContent = ansagen ? [zeile1.textContent, zeile2.textContent].join('. ') : '';
}

// --- Glas: Linse über dem erfassten Streifen, sonst getöntes Glas -------------------------------

const glas = window.PilleGlas.erzeugen(document.getElementById('glas'));
let einstellung = { frost: 40, opacity: 85, refraction: 60, tint: 'hell' };
let deckend = false;
let streifen = null; // { w, h, scale, daten }
let lum = null;
let breite = 217;

const ursprungX = (s) => Math.round(((window.innerWidth - breite) / 2) * s);

function glasAnwenden() {
  const cfg = { ...einstellung, opacity: deckend ? 0 : einstellung.opacity };
  const echt = Boolean(glas && streifen && !deckend && !kontrast());
  window.PilleGlas.anwenden(pille, cfg, echt ? lum : null);
  if (echt) {
    const s = streifen.scale;
    glas.zeichnen({
      breite,
      hoehe: 52,
      s,
      ox: ursprungX(s),
      oy: Math.round(BAND * s),
      refraction: cfg.refraction,
    });
  }
  pille.classList.toggle('echt', echt);
}

window.letterflow.overlay.onBackdrop((b) => {
  streifen =
    b && glas ? { w: b.width, h: b.height, scale: b.scale, daten: new Uint8Array(b.bgra) } : null;
  if (streifen) {
    glas.bild({ daten: streifen.daten, w: streifen.w, h: streifen.h });
    const s = streifen.scale;
    const x = Math.max(0, ursprungX(s));
    lum = window.PilleGlas.helligkeit(
      streifen.daten,
      streifen.w,
      x,
      Math.round(BAND * s),
      Math.min(Math.round(breite * s), streifen.w - x),
      Math.round(52 * s),
      true,
    );
  }
  glasAnwenden();
});

window.letterflow.overlay.onState((raw) => {
  // Lange Meldungen „A – B“ zweizeilig, damit bei 340 px möglichst wenig gekürzt wird.
  const [text, zweit] = String(raw.text || '').split(' – ');
  const state = { ...raw, text, zweit };
  einstellung = raw.pille || einstellung;
  deckend = Boolean(raw.deckend);
  const sichtbar = pille.classList.contains('sichtbar');
  const alt = pille.offsetWidth;
  pille.style.width = '';
  inhaltSetzen(state);
  const neu = pille.offsetWidth;
  breite = neu;
  if (state.kind !== 'aufnahme') {
    ziel = 0;
    balken.forEach((b) => (b.style.transform = `scaleY(${MIN_HOEHE})`));
    glatt.fill(MIN_HOEHE);
  }
  if (sichtbar && !ruhig()) {
    // Zustandswechsel: Inhalt überblenden, Breite gleitet vom alten auf den neuen Wert.
    pille.classList.remove('wechsel');
    pille.style.width = `${alt}px`;
    void pille.offsetWidth;
    pille.style.width = `${neu}px`;
    pille.classList.add('wechsel');
  }
  glasAnwenden();
  pille.classList.remove('weg');
  pille.classList.add('sichtbar');
  if (state.kind === 'aufnahme') taktStarten();
});
window.letterflow.overlay.onLevel(pegelSetzen);
window.letterflow.overlay.onHide(() => {
  pille.classList.remove('sichtbar', 'wechsel');
  pille.classList.add('weg'); // Liquid-Drop rückwärts
  streifen = null;
});

// --- Aufnahme: nur während der Aufnahme ist das Mikrofon geöffnet ---------

let aufnahme = null; // { strom, ctx, knoten }
let startToken = 0;

async function aufnahmeStarten(deviceId) {
  await aufnahmeBeenden(false);
  const token = ++startToken;
  let strom = null;
  let ctx = null;
  try {
    strom = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    strom.getAudioTracks().forEach((t) => t.addEventListener('ended', () => spurBeendet(strom)));
    ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.sampleRate !== 16000) {
      // Falsche Abtastrate würde unbemerkt falsche Daten liefern: lieber melden.
      const fehler = new Error(`Abtastrate ${ctx.sampleRate} statt 16000`);
      fehler.name = 'SampleRateError';
      throw fehler;
    }
    await ctx.audioWorklet.addModule('recorder-worklet.js');
    const quelle = ctx.createMediaStreamSource(strom);
    const knoten = new AudioWorkletNode(ctx, 'recorder', { numberOfOutputs: 0 });
    knoten.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) window.letterflow.overlay.pcm(e.data);
    };
    quelle.connect(knoten);
    if (ctx.state !== 'running') await ctx.resume();
    document.documentElement.dataset.sampleRate = String(ctx.sampleRate);
    aufnahme = { strom, ctx, knoten };
    if (token !== startToken) {
      // Zwischenzeitlich gestoppt: sofort wieder schließen.
      await aufnahmeBeenden(false);
      return;
    }
    window.letterflow.overlay.started();
  } catch (fehler) {
    if (strom) strom.getTracks().forEach((t) => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    window.letterflow.overlay.recorderError({ name: fehler && fehler.name });
  }
}

// Gerät mitten in der Aufnahme abgezogen: Rest herausgeben, aufräumen und melden.
async function spurBeendet(strom) {
  if (!aufnahme || aufnahme.strom !== strom) return;
  await aufnahmeBeenden(false);
  window.letterflow.overlay.recorderError({ name: 'TrackEndedError' });
}

// Letztes Paket herausgeben, dann Mikrofon und Audiokontext freigeben.
async function aufnahmeBeenden(melden) {
  startToken++;
  const a = aufnahme;
  aufnahme = null;
  if (a) {
    await new Promise((fertig) => {
      const frist = setTimeout(fertig, 500);
      const vorher = a.knoten.port.onmessage;
      a.knoten.port.onmessage = (e) => {
        if (e.data === 'flushed') {
          clearTimeout(frist);
          fertig();
        } else vorher(e);
      };
      a.knoten.port.postMessage('flush');
    });
    a.strom.getTracks().forEach((t) => t.stop());
    a.knoten.disconnect();
    await a.ctx.close().catch(() => {});
    delete document.documentElement.dataset.sampleRate;
  }
  if (melden) window.letterflow.overlay.stopped();
}

window.letterflow.overlay.onRecordStart(aufnahmeStarten);
window.letterflow.overlay.onRecordStop(() => aufnahmeBeenden(true));
window.letterflow.overlay.ready();
