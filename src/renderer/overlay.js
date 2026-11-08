const pille = document.getElementById('pille');
const textFeld = document.getElementById('text');
const balken = [...document.querySelectorAll('#balken i')];

const STANDARD_TEXT = { aufnahme: 'Ich höre zu …', verarbeitung: 'Schreibe …' };
// Mittlere Balken schlagen stärker aus als die äußeren.
const PROFIL = [0.55, 0.8, 1, 0.8, 0.55];
const MIN_HOEHE = 0.18;

function pegelSetzen(n) {
  const pegel = Math.max(0, Math.min(1, Number(n) || 0));
  balken.forEach((b, i) => {
    b.style.transform = `scaleY(${(MIN_HOEHE + (1 - MIN_HOEHE) * pegel * PROFIL[i]).toFixed(3)})`;
  });
}

window.letterflow.overlay.onState((state) => {
  pille.dataset.kind = state.kind;
  textFeld.textContent = state.text || STANDARD_TEXT[state.kind] || '';
  if (state.kind !== 'aufnahme') pegelSetzen(0);
  pille.classList.add('sichtbar');
});
window.letterflow.overlay.onLevel(pegelSetzen);
window.letterflow.overlay.onHide(() => pille.classList.remove('sichtbar'));

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
