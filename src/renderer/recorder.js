// Mikrofon in einem eigenen, verborgenen Fenster (kein WebGL, keine Animation): der Start konkurriert
// nicht mit dem Aufploppen der Pille. Nach einem Diktat bleibt der Strom kurz offen (warm): das nächste
// Diktat beginnt sofort und bekommt die letzten 300 ms als Vorlauf. Danach wird das Mikrofon geschlossen.
// Audio verlässt das Fenster nur während einer Aufnahme (an den Hauptprozess), nie gespeichert.
const api = window.letterflow.recorder;
const VORLAUF = 4800; // 300 ms bei 16 kHz
const PAKETE_VORLAUF = 4; // Pakete à 100 ms im Ringpuffer : drei volle und beim Start das angefangene

let mik = null; // { strom, ctx, knoten, deviceId }
let aktiv = false; // Pakete gehen an den Hauptprozess
let vorlauf = []; // letzte Pakete, solange warm und nicht aktiv
let kaltTimer = 0;
let startToken = 0;
let warmMs = 15000;

function paket(p) {
  if (aktiv) return api.pcm(p);
  vorlauf.push(p);
  if (vorlauf.length > PAKETE_VORLAUF) vorlauf.shift();
}

async function oeffnen(deviceId) {
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
    ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.sampleRate !== 16000) {
      // Falsche Abtastrate würde unbemerkt falsche Daten liefern: lieber melden.
      const fehler = new Error(`Abtastrate ${ctx.sampleRate} statt 16000`);
      fehler.name = 'SampleRateError';
      throw fehler;
    }
    await ctx.audioWorklet.addModule('recorder-worklet.js');
    const knoten = new AudioWorkletNode(ctx, 'recorder', { numberOfOutputs: 0 });
    knoten.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) paket(e.data);
    };
    ctx.createMediaStreamSource(strom).connect(knoten);
    if (ctx.state !== 'running') await ctx.resume();
    mik = { strom, ctx, knoten, deviceId };
    strom.getAudioTracks().forEach((t) => t.addEventListener('ended', () => spurEnde(strom)));
    document.documentElement.dataset.sampleRate = String(ctx.sampleRate);
  } catch (fehler) {
    if (strom) strom.getTracks().forEach((t) => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    throw fehler;
  }
}

// Angefangenes Paket aus dem Worklet holen (landet über paket()).
function leeren() {
  const a = mik;
  if (!a) return Promise.resolve();
  return new Promise((fertig) => {
    const frist = setTimeout(fertig, 500);
    const vorher = a.knoten.port.onmessage;
    a.knoten.port.onmessage = (e) => {
      if (e.data !== 'flushed') return vorher(e);
      a.knoten.port.onmessage = vorher;
      clearTimeout(frist);
      fertig();
    };
    a.knoten.port.postMessage('flush');
  });
}

async function schliessen() {
  clearTimeout(kaltTimer);
  const a = mik;
  mik = null;
  vorlauf = [];
  if (!a) return;
  delete document.documentElement.dataset.sampleRate;
  a.strom.getTracks().forEach((t) => t.stop());
  a.knoten.disconnect();
  await a.ctx.close().catch(() => {});
}

async function starten({ deviceId = null, warm: ms } = {}) {
  const token = ++startToken;
  clearTimeout(kaltTimer);
  if (Number.isFinite(ms) && ms >= 0) warmMs = ms;
  try {
    const warm = Boolean(mik && mik.deviceId === deviceId);
    if (!warm) {
      await schliessen();
      await oeffnen(deviceId);
    } else await leeren();
    if (token !== startToken) return kaltPlanen(); // inzwischen gestoppt
    api.started(warm);
    if (warm) {
      const alle = new Float32Array(vorlauf.reduce((n, p) => n + p.length, 0));
      vorlauf.reduce((o, p) => (alle.set(p, o), o + p.length), 0);
      api.pcm(alle.slice(-VORLAUF));
    }
    vorlauf = [];
    aktiv = true;
    document.documentElement.dataset.aktiv = '';
  } catch (fehler) {
    await schliessen();
    api.error({ name: fehler && fehler.name });
  }
}

function kaltPlanen() {
  clearTimeout(kaltTimer);
  if (mik) kaltTimer = setTimeout(schliessen, warmMs);
}

// Letztes Paket herausgeben, dann warm halten (oder schließen, wenn warmMs 0 ist).
async function stoppen() {
  startToken++;
  if (aktiv) await leeren();
  aktiv = false;
  vorlauf = [];
  delete document.documentElement.dataset.aktiv;
  kaltPlanen();
  api.stopped();
}

// Gerät abgezogen: während der Aufnahme Rest herausgeben und melden, sonst nur schließen.
async function spurEnde(strom) {
  if (!mik || mik.strom !== strom) return;
  const war = aktiv;
  if (war) await leeren();
  aktiv = false;
  delete document.documentElement.dataset.aktiv;
  await schliessen();
  if (war) api.error({ name: 'TrackEndedError' });
}

api.onStart(starten);
api.onStop(stoppen);
api.ready();
