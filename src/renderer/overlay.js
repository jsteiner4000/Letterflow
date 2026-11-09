const pille = document.getElementById('pille');
const symbol = document.getElementById('symbol');
const bild = document.getElementById('bild');
const zeile1 = document.getElementById('zeile1');
const zeile2 = document.getElementById('zeile2');
const ansage = document.getElementById('ansage');
const spur = document.getElementById('balken');
const pegelBalken = document.getElementById('pegelbalken');
const schatten = document.getElementById('schatten');
const PILLE = 60; // Höhe in CSS-Pixeln, wie in pille.css und main/overlay.js

const ARIA = { aufnahme: 'Ich höre zu', verarbeitung: 'Text wird aufbereitet' };
const BAND = 16; // wie in main/overlay.js: Rand (DIP) des erfassten Streifens über der Pille
const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const kontrast = () => matchMedia('(forced-colors: active)').matches;
const aufPixel = (v) => Math.round(v * devicePixelRatio) / devicePixelRatio; // ganze Gerätepixel

// --- Wellenform als Zeitstrahl: alle 90 ms ein Balken rechts, gleitet nach links und blendet aus. --
// Höhe = Sprachpegel in diesem Moment, symmetrisch um die Mitte (3 px … 34 px, normales Sprechen
// 60–90 %). Stille = kleine runde Punkte, die mitlaufen. Reduzierte Bewegung: ruhiger Pegelbalken.
const TAKT_MS = 90;
const ABSTAND = 5.5; // 3 px Balken + 2,5 px Lücke: 61 px/s
const HOCH = 34;
const balken = Array.from({ length: 24 }, () => spur.appendChild(document.createElement('i')));
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

// Balken Nr. nr (Element nr % 24) bekommt seine Höhe einmal; danach bewegt er sich nur per transform.
function balkenSetzen(nr, v) {
  const h = v < 0.04 ? 3 : 3 + (HOCH - 3) * v;
  const b = balken[nr % balken.length];
  b.style.height = `${h.toFixed(1)}px`;
  b.style.top = `${((HOCH - h) / 2).toFixed(2)}px`;
  b.style.opacity = v < 0.04 ? '0.35' : '1';
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
    gezeigt = Math.max(gezeigt, n - balken.length);
    for (; gezeigt < n; gezeigt++) balkenSetzen(gezeigt + 1, (pegel - 0.1) / 0.6);
    const breite = spur.clientWidth;
    balken.forEach((b, j) => {
      const k = (((n - j) % balken.length) + balken.length) % balken.length; // Alter in Takten
      const x = breite - 3 - ABSTAND * (k + (zeit - n) - 1);
      b.style.transform = `translateX(${x.toFixed(2)}px)`;
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
  balken.forEach((b, j) => balkenSetzen(j, 0));
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
const streifenOben = () => (window.innerHeight - PILLE) / 2 - BAND;

let bulge = 1; // Faktor auf die Brechung (Tropfen-Wobble), sonst 1

function linse() {
  if (!pille.classList.contains('echt')) return;
  const s = streifen.scale;
  glas.zeichnen({
    s,
    ox: Math.round(links() * s),
    oy: Math.round((oben() - streifenOben()) * s),
    refraction: einstellung.refraction * bulge,
  });
}

function glasAnwenden() {
  const cfg = { ...einstellung, opacity: deckend ? 0 : einstellung.opacity };
  const echt = Boolean(glas && streifen && !deckend && !kontrast());
  window.PilleGlas.anwenden(pille, cfg, echt ? lum : null);
  pille.classList.toggle('echt', echt);
  linse();
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
      Math.round(PILLE * s),
      true,
    );
  }
  glasAnwenden();
});

// --- Erscheinen/Verschwinden: Tropfen mit Linsen-Wobble ----------------------------------------------
// Je Eigenschaft eine gedämpfte Feder (echtes dt, feine Teilschritte): `pop` (Größe 0,5 → 1) und
// `breit` (Kreis → Pille, mit Überschwingen). Der Überschwinger treibt Dehnung (Volumen bleibt:
// scaleY = scaleX^−0,35), Glanz, Brechung (2,5× → 1× mit Wobble) und Schatten. Nur transform,
// opacity, clip-path und ein Uniform; kein Layout. Der Inhalt kommt, wenn die Form fast ruht.
// Verschwinden: kritisch gedämpft, kein Wobble. „schlicht“: CSS-Einblenden.

const feder = () => ({ x: 0, v: 0, w: 1, z: 1, ziel: 0 });
function federSchritt(f, dt) {
  for (let r = dt; r > 0; r -= 0.004) {
    const h = Math.min(r, 0.004);
    f.v += (f.w * f.w * (f.ziel - f.x) - 2 * f.z * f.w * f.v) * h;
    f.x += f.v * h;
  }
}
const popFeder = feder();
const breitFeder = feder();
const klemme = (v) => Math.max(0, Math.min(1, v));
const SPIEL_MAX = 0.4; // s: Erscheinen endet spätestens hier
const WEG_MAX = 0.18;
const glanzEl = [pille.querySelector('.spec'), pille.querySelector('.rim')];
const inhaltEl = [symbol, zeile1.parentElement, spur.parentElement];

let erscheint = 0;
let anim = null;
let erfassenErwartet = false;
let stateZeit = 0;

function formSetzen(rein, mitBulge, inhaltT) {
  const b = parseFloat(pille.style.width) || pille.offsetWidth;
  const e = breitFeder.x;
  const p = Math.max(0, popFeder.x);
  const anteil = PILLE / b + (1 - PILLE / b) * klemme(e);
  const rand = ((1 - anteil) * b) / 2;
  const dehnung = 1 + 0.06 * Math.sin(Math.PI * klemme(e)) + Math.max(0, e - 1) * 0.8;
  const gr = 0.5 + 0.5 * p;
  const sx = gr * dehnung;
  const sy = gr * dehnung ** -0.35; // flüssig: breiter = flacher
  const d = 1 - e;
  bulge = mitBulge ? Math.max(0.3, 1 + (d > 0 ? 1.5 * d : 4 * d)) : 1;
  const spitze = klemme((bulge - 1) / 1.5);
  const alpha = klemme(p * 3).toFixed(3);
  const form = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  const st = pille.style;
  st.transform = form;
  st.clipPath = `inset(0 ${rand.toFixed(2)}px round ${PILLE / 2}px)`;
  st.opacity = alpha;
  // Glanz und innere Spiegelung folgen der Verformung, kurz heller beim stärksten Wölben
  const hell = `brightness(${(1 + 0.5 * spitze).toFixed(3)})`;
  for (const el of glanzEl) el.style.filter = hell;
  glanzEl[0].style.transform = `translateX(${(-(1 - klemme(e)) * b * 0.05).toFixed(2)}px) scaleY(${(1 + 0.4 * spitze).toFixed(3)})`;
  // Schatten gehört zur Form: klein und eng, wächst und wird weicher beim Landen
  const g = klemme(p) * (0.4 + 0.6 * klemme(e));
  const ss = schatten.style;
  ss.width = `${(anteil * b).toFixed(2)}px`;
  ss.left = `${(links() + rand).toFixed(2)}px`;
  ss.top = `${oben()}px`;
  ss.transform = form;
  ss.opacity = alpha;
  ss.boxShadow = `0 ${(2 + 5 * g).toFixed(1)}px ${(5 + 17 * g).toFixed(1)}px rgba(0, 0, 0, ${(0.1 + 0.14 * g).toFixed(3)})`;
  if (rein) {
    // Symbol, dann Welle: je 70 ms, 2 px Aufstieg
    const stufe = (ms) => {
      const a = klemme(ms / 70);
      const w = a * (2 - a);
      return [w.toFixed(3), `translateY(${((1 - w) * 2).toFixed(2)}px)`];
    };
    inhaltEl.forEach((el, i) => {
      [el.style.opacity, el.style.transform] = stufe(inhaltT - (i ? 40 : 0));
    });
  }
  linse();
}

function formLoesen() {
  const st = pille.style;
  st.transform = st.clipPath = st.opacity = '';
  for (const el of glanzEl) el.style.filter = el.style.transform = '';
  for (const el of inhaltEl) el.style.opacity = el.style.transform = '';
  schatten.style.transform = '';
  schatten.style.left = st.left;
  schatten.style.width = st.width;
  bulge = 1;
  linse();
}

function federLauf(rein, mitBulge) {
  if (anim) cancelAnimationFrame(anim.id);
  const a = (anim = { t0: 0, last: 0, ruhe: 0, zeiten: [], id: 0 });
  const [pw, pz, bw, bz] = rein ? [0.26, 0.7, 0.32, 0.65] : [0.12, 1, 0.12, 1];
  Object.assign(popFeder, { w: (2 * Math.PI) / pw, z: pz, ziel: rein ? 1 : 0 });
  Object.assign(breitFeder, { w: (2 * Math.PI) / bw, z: bz, ziel: rein ? 1 : 0 });
  const schritt = (t) => {
    if (anim !== a) return;
    if (!a.t0) a.t0 = a.last = t;
    const dt = Math.min(0.05, (t - a.last) / 1000);
    const s = (t - a.t0) / 1000;
    a.last = t;
    a.zeiten.push(t);
    federSchritt(popFeder, dt);
    if (!rein || s >= 0.05) federSchritt(breitFeder, dt); // Breite setzt kurz nach dem Pop ein
    if (rein && !a.ruhe && breitFeder.x >= 0.85) a.ruhe = t;
    formSetzen(rein, mitBulge, a.ruhe ? t - a.ruhe : -1e3);
    const fertig = rein
      ? s >= SPIEL_MAX
      : s >= WEG_MAX || (popFeder.x < 0.52 && breitFeder.x < 0.02);
    if (!fertig) {
      a.id = requestAnimationFrame(schritt);
      return;
    }
    anim = null;
    Object.assign(popFeder, { x: rein ? 1 : 0, v: 0 });
    Object.assign(breitFeder, { x: rein ? 1 : 0, v: 0 });
    if (rein) {
      formLoesen();
      window.tropfenZeiten = a.zeiten; // Bildzeiten (Messung, Prüfung)
      pille.classList.remove('tropf');
      window.letterflow.overlay.erschienen(verworfen(a.zeiten));
    } else {
      pille.style.opacity = schatten.style.opacity = '0';
    }
  };
  formSetzen(rein, mitBulge, rein ? -1e3 : 0); // Form schon vor dem ersten Bild gesetzt
  a.id = requestAnimationFrame(schritt);
}

// Anteil verworfener Bilder: Lücken, gemessen am kürzesten Bildabstand (= Bildwiederholrate).
function verworfen(zeiten) {
  const abst = zeiten.slice(1).map((t, i) => t - zeiten[i]);
  if (abst.length < 2) return null;
  const f = Math.max(4, Math.min(...abst));
  const fehlend = abst.reduce((n, d) => n + Math.max(0, Math.round(d / f) - 1), 0);
  return fehlend / (fehlend + abst.length);
}

// Beginnt mit dem ersten Bild des sichtbaren Fensters. Die Erfassung läuft seit `show` und bekommt
// 120 ms: ist sie da, wobbelt die Linse über dem echten Hintergrund, sonst gibt es den einfachen Tropfen.
function erscheinen() {
  erscheint = 0;
  const schlicht = pille.classList.contains('schlicht');
  if (erfassenErwartet && !streifen && performance.now() - stateZeit < 120) {
    erscheint = requestAnimationFrame(erscheinen);
    return;
  }
  pille.classList.remove('weg');
  if (schlicht) {
    formLoesen();
    schatten.style.opacity = '';
    schatten.classList.add('an');
    pille.classList.add('sichtbar');
  } else {
    federLauf(true, Boolean(streifen)); // setzt die Form, bevor `sichtbar` greift
    pille.classList.add('sichtbar');
  }
}

pille.addEventListener('animationend', (e) => {
  // nur das schlichte Einblenden (der Tropfen ist federgetrieben)
  if (
    e.target === pille &&
    pille.classList.contains('schlicht') &&
    pille.classList.contains('sichtbar')
  )
    window.letterflow.overlay.erschienen(null);
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
  pille.style.top = `${aufPixel((window.innerHeight - PILLE) / 2)}px`;
  if (!sichtbar && !erscheint) {
    const schlicht = !raw.animation || ruhig();
    pille.classList.toggle('schlicht', schlicht);
    pille.classList.toggle('tropf', !schlicht);
    erfassenErwartet = Boolean(raw.erfassen) && !schlicht && !deckend;
    stateZeit = performance.now();
    erscheint = requestAnimationFrame(() => (erscheint = requestAnimationFrame(erscheinen)));
  }
  if (!anim) {
    schatten.style.left = pille.style.left;
    schatten.style.top = pille.style.top;
    schatten.style.width = pille.style.width;
  }
  glasAnwenden();
  if (state.kind === 'aufnahme') taktStarten();
});
window.letterflow.overlay.onLevel(pegelSetzen);
window.letterflow.overlay.onHide(() => {
  cancelAnimationFrame(erscheint);
  erscheint = 0;
  aktiv = false;
  const schlicht = pille.classList.contains('schlicht');
  const war = pille.classList.contains('sichtbar');
  pille.classList.remove('sichtbar', 'wechsel', 'tropf');
  streifen = null;
  if (schlicht) {
    pille.classList.add('weg'); // Einblenden rückwärts
    schatten.classList.remove('an');
  } else if (war) {
    federLauf(false, false);
  } else if (anim) {
    cancelAnimationFrame(anim.id);
    anim = null;
  }
});

// Aufwärmen: Shader und erste Zeichnung im verborgenen Fenster, damit schon das erste Aufploppen ruckelfrei läuft.
if (glas) {
  glas.bild({ daten: new Uint8Array(4), w: 1, h: 1 });
  glas.zeichnen({ s: 1, ox: 0, oy: 0, refraction: 60 });
}

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
