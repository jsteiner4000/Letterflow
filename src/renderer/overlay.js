const pille = document.getElementById('pille');
const symbol = document.getElementById('symbol');
const bild = document.getElementById('bild');
const zeile1 = document.getElementById('zeile1');
const zeile2 = document.getElementById('zeile2');
const ansage = document.getElementById('ansage');
const spur = document.getElementById('balken');
const pegelBalken = document.getElementById('pegelbalken');

const ARIA = { aufnahme: 'Ich höre zu', verarbeitung: 'Text wird aufbereitet' };
const BAND = 16; // wie in main/overlay.js: Rand (DIP) des erfassten Streifens über der Pille
const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const kontrast = () => matchMedia('(forced-colors: active)').matches;
const aufPixel = (v) => Math.round(v * devicePixelRatio) / devicePixelRatio; // ganze Gerätepixel

// --- Wellenform als Zeitstrahl: alle 45 ms ein Balken rechts, gleitet nach links und blendet aus. --
// Höhe = Sprachpegel in diesem Moment (logarithmisch, Ansprechen ~40 ms, Abklingen ~180 ms).
// Stille = keine Balken. Reduzierte Bewegung: ein ruhiger Pegelbalken statt Zeitstrahl.
const TAKT_MS = 45;
const ABSTAND = 5.5; // 3 px Balken + 2,5 px Lücke
const balken = Array.from({ length: 24 }, () => spur.appendChild(document.createElement('i')));
const hoehen = new Float32Array(balken.length); // Ringpuffer, hoehen[n % länge] = Balken Nr. n
let pegel = 0;
let ziel = 0;
let lauf = 0;
let letzte = 0;
let start = 0;
let gezeigt = -1; // Nummer des neuesten Balkens

// Hauptprozess liefert sqrt(rms / 0.3); zurück auf rms, dann dB: −58 dB (leise) … −8 dB (laut)
function dbNormiert(n) {
  const rms = 0.3 * n * n;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-5) + 58) / 50));
}

function takt(t) {
  const dt = Math.min(64, t - (letzte || t - 16));
  letzte = t;
  if (!start) start = t;
  pegel += (ziel - pegel) * (1 - Math.exp(-dt / (ziel > pegel ? 40 : 180)));
  if (ruhig()) {
    pegelBalken.style.transform = `scaleX(${pegel.toFixed(3)})`;
  } else {
    const zeit = (t - start) / TAKT_MS;
    const n = Math.floor(zeit);
    gezeigt = Math.max(gezeigt, n - hoehen.length);
    for (; gezeigt < n; gezeigt++) {
      // Rauschen unter ~12 % zeigt nichts: Stille bleibt leer (auch keine hauchdünnen Striche).
      const h = (pegel - 0.12) / 0.88;
      hoehen[(gezeigt + 1) % hoehen.length] = h < 0.04 ? 0 : h;
    }
    const breite = spur.clientWidth;
    balken.forEach((b, k) => {
      const nr = n - k; // k = Alter in Takten
      const h = nr >= 0 ? hoehen[nr % hoehen.length] : 0;
      const x = breite - 3 - ABSTAND * (k + (zeit - n) - 1);
      b.style.transform = `translateX(${x.toFixed(2)}px) scaleY(${h.toFixed(3)})`;
    });
  }
  lauf = aktiv && pille.dataset.kind === 'aufnahme' ? requestAnimationFrame(takt) : 0;
}

function taktStarten() {
  if (lauf) return;
  letzte = 0;
  lauf = requestAnimationFrame(takt);
}

function wellenformLeeren() {
  ziel = pegel = 0;
  start = 0;
  gezeigt = -1;
  hoehen.fill(0);
  balken.forEach((b) => (b.style.transform = 'scaleY(0)'));
  pegelBalken.style.transform = 'scaleX(0)';
}
wellenformLeeren();

function pegelSetzen(n) {
  ziel = dbNormiert(Math.max(0, Math.min(1, Number(n) || 0)));
  if (aktiv && pille.dataset.kind === 'aufnahme') taktStarten();
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
let aktiv = false; // zwischen Zustand und Ausblenden

// Lage der Pille im Fenster (CSS-Pixel); der Streifen beginnt BAND über der mittig gedachten Pille.
const links = () => parseFloat(pille.style.left) || 0;
const oben = () => parseFloat(pille.style.top) || 0;
const streifenOben = () => (window.innerHeight - 52) / 2 - BAND;

function glasAnwenden() {
  const cfg = { ...einstellung, opacity: deckend ? 0 : einstellung.opacity };
  const echt = Boolean(glas && streifen && !deckend && !kontrast());
  window.PilleGlas.anwenden(pille, cfg, echt ? lum : null);
  if (echt) {
    const s = streifen.scale;
    glas.zeichnen({
      s,
      ox: Math.round(links() * s),
      oy: Math.round((oben() - streifenOben()) * s),
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
    const x = Math.max(0, Math.round(links() * s));
    lum = window.PilleGlas.helligkeit(
      streifen.daten,
      streifen.w,
      x,
      Math.max(0, Math.round((oben() - streifenOben()) * s)),
      Math.min(Math.round(pille.offsetWidth * s), streifen.w - x),
      Math.round(52 * s),
      true,
    );
  }
  glasAnwenden();
});

// --- Erscheinen: Liquid-Drop (nur transform, opacity, clip-path) oder schlichtes Einblenden ---------
// Beginnt erst mit dem ersten Bild des sichtbaren Fensters; die Bildzeiten werden gemessen, damit
// „Automatisch“ auf langsamen PCs abschalten kann. Danach darf der Hauptprozess erfassen.

let erscheint = 0;
let messung = null;

function erscheinen() {
  erscheint = 0;
  messung = pille.classList.contains('schlicht') ? null : [];
  pille.classList.remove('weg');
  pille.classList.add('sichtbar');
  if (messung) {
    const mitschreiben = (t) => {
      if (!messung) return;
      messung.push(t);
      requestAnimationFrame(mitschreiben);
    };
    requestAnimationFrame(mitschreiben);
  }
}

// Anteil verworfener Bilder: Lücken, gemessen am kürzesten Bildabstand (= Bildwiederholrate).
function verworfen(zeiten) {
  const abst = zeiten.slice(1).map((t, i) => t - zeiten[i]);
  if (abst.length < 2) return null;
  const f = Math.max(4, Math.min(...abst));
  const fehlend = abst.reduce((n, d) => n + Math.max(0, Math.round(d / f) - 1), 0);
  return fehlend / (fehlend + abst.length);
}

pille.addEventListener('animationend', (e) => {
  if (e.target !== pille || !pille.classList.contains('sichtbar')) return;
  const anteil = messung ? verworfen(messung) : null;
  messung = null;
  window.letterflow.overlay.erschienen(anteil);
});

window.letterflow.overlay.onState((raw) => {
  // Lange Meldungen „A – B“ zweizeilig, damit bei 340 px möglichst wenig gekürzt wird.
  const [text, zweit] = String(raw.text || '').split(' – ');
  const state = { ...raw, text, zweit };
  einstellung = raw.pille || einstellung;
  deckend = Boolean(raw.deckend);
  aktiv = true;
  const sichtbar = pille.classList.contains('sichtbar');
  const wechsel = sichtbar && pille.dataset.kind !== state.kind && !ruhig();
  const alt = [pille.style.width, pille.style.left];
  pille.style.width = '';
  pille.style.left = '0px'; // volle Fensterbreite zum Messen
  inhaltSetzen(state);
  // Breite und Lage auf ganze Gerätepixel, damit Rand und Lichtkante scharf bleiben.
  // (berechnete Breite: unabhängig von einer laufenden Skalierung)
  const roh = parseFloat(getComputedStyle(pille).width);
  const neu = Math.ceil(roh * devicePixelRatio - 0.01) / devicePixelRatio;
  if (state.kind !== 'aufnahme' || (!sichtbar && !erscheint)) wellenformLeeren();
  if (wechsel) {
    // Zustandswechsel: Inhalt überblenden, Breite gleitet vom alten auf den neuen Wert.
    pille.classList.remove('wechsel');
    [pille.style.width, pille.style.left] = alt;
    void pille.offsetWidth;
    pille.classList.add('wechsel');
  }
  pille.style.width = `${neu}px`;
  pille.style.left = `${aufPixel((window.innerWidth - neu) / 2)}px`;
  pille.style.top = `${aufPixel((window.innerHeight - 52) / 2)}px`;
  if (!sichtbar && !erscheint) {
    pille.classList.toggle('schlicht', !raw.animation || ruhig());
    erscheint = requestAnimationFrame(() => (erscheint = requestAnimationFrame(erscheinen)));
  }
  glasAnwenden();
  if (state.kind === 'aufnahme') taktStarten();
});
window.letterflow.overlay.onLevel(pegelSetzen);
window.letterflow.overlay.onHide(() => {
  cancelAnimationFrame(erscheint);
  erscheint = 0;
  messung = null;
  aktiv = false;
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
