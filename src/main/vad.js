// Sprechpausen-Erkennung: teilt einen PCM-Strom (16 kHz mono, Float32) an Pausen in Abschnitte.
// Energie-Schwelle adaptiv: Grundrauschen = gleitendes Minimum der Frame-RMS der letzten 1,5 s.

const RAND_MS = 200; // Vor- und Nachlauf je Abschnitt
const RAUSCH_FENSTER_MS = 1500;
const SCHNITT_FENSTER_MS = 2000;
const MIN_SCHWELLE = 0.005; // Brief: 0.01; für 10 %-Pegel-Test (Sprache ~0.013 RMS) gesenkt

function createSegmenter({
  sampleRate = 16000,
  frameMs = 30,
  pauseMs = 700,
  minSpeechMs = 250,
  maxSegmentMs = 20000,
} = {}) {
  const frameLen = Math.round((sampleRate * frameMs) / 1000);
  const randFrames = Math.ceil(RAND_MS / frameMs);
  const pauseFrames = Math.ceil(pauseMs / frameMs);
  const minSpeechFrames = Math.ceil(minSpeechMs / frameMs);
  const maxFrames = Math.floor(maxSegmentMs / frameMs);
  const rauschFrames = Math.round(RAUSCH_FENSTER_MS / frameMs);
  const schnittFrames = Math.round(SCHNITT_FENSTER_MS / frameMs);

  let rest = new Float32Array(0); // noch unvollständiger Rahmen
  const rauschen = []; // RMS der letzten Rahmen (1,5 s)
  let vorlauf = []; // letzte Rahmen vor dem Abschnitt
  let rahmen = []; // aktueller Abschnitt: { pcm, rms, sprache }
  let level = 0;
  let hadSpeech = false;

  const sprachRahmen = () => rahmen.reduce((n, r) => n + (r.sprache ? 1 : 0), 0);
  const verbinden = (liste) => {
    const out = new Float32Array(liste.reduce((n, r) => n + r.pcm.length, 0));
    let pos = 0;
    for (const r of liste) {
      out.set(r.pcm, pos);
      pos += r.pcm.length;
    }
    return out;
  };

  // Abschnitt abschließen: Stille am Ende auf den Nachlauf kürzen, zu kurze Sprache verwerfen.
  function abschliessen() {
    let letzter = -1;
    for (let i = rahmen.length - 1; i >= 0; i--) {
      if (rahmen[i].sprache) {
        letzter = i;
        break;
      }
    }
    const nutzbar = sprachRahmen() >= minSpeechFrames && letzter >= 0;
    const ergebnis = nutzbar ? verbinden(rahmen.slice(0, letzter + 1 + randFrames)) : null;
    vorlauf = rahmen.slice(-randFrames);
    rahmen = [];
    if (nutzbar) hadSpeech = true;
    return ergebnis;
  }

  // Zu langer Abschnitt: an der leisesten Stelle der letzten 2 s schneiden.
  function schneiden() {
    const von = Math.max(0, rahmen.length - schnittFrames);
    let beste = rahmen.length - 1;
    for (let i = rahmen.length - 1; i >= von; i--) {
      if (rahmen[i].rms < rahmen[beste].rms) beste = i;
    }
    const kopf = rahmen.slice(0, beste + 1);
    const ergebnis = sprachRahmen() >= minSpeechFrames ? verbinden(kopf) : null;
    if (ergebnis) hadSpeech = true;
    rahmen = rahmen.slice(beste + 1);
    return ergebnis;
  }

  function verarbeiten(pcm, ausgabe) {
    let sumQuadrat = 0;
    for (let i = 0; i < pcm.length; i++) sumQuadrat += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumQuadrat / pcm.length);
    // Jeder Rahmen zählt (gleitendes Minimum inkl. aktuellem): so wird auch Raumrauschen über
    // der Mindestschwelle als Grundrauschen gelernt und gilt nicht als Dauersprache.
    rauschen.push(rms);
    if (rauschen.length > rauschFrames) rauschen.shift();
    const grundrauschen = Math.min(...rauschen);
    const sprache = rms > Math.max(3 * grundrauschen, MIN_SCHWELLE);
    // Pegel: schneller Anstieg, langsames Abklingen
    level = Math.max(Math.min(1, Math.sqrt(rms / 0.3)), level * 0.85);
    const eintrag = { pcm, rms, sprache };

    if (!rahmen.length && !sprache) {
      vorlauf.push(eintrag);
      if (vorlauf.length > randFrames) vorlauf.shift();
      return;
    }
    if (!rahmen.length) {
      rahmen = vorlauf;
      vorlauf = [];
    }
    rahmen.push(eintrag);

    // Pause nach Sprache?
    let stille = 0;
    for (let i = rahmen.length - 1; i >= 0 && !rahmen[i].sprache; i--) stille++;
    if (stille >= pauseFrames) {
      const teil = abschliessen();
      if (teil) ausgabe.push(teil);
    } else if (rahmen.length >= maxFrames) {
      const teil = schneiden();
      if (teil) ausgabe.push(teil);
    }
  }

  return {
    push(pcm) {
      const ausgabe = [];
      let daten = pcm;
      if (rest.length) {
        daten = new Float32Array(rest.length + pcm.length);
        daten.set(rest);
        daten.set(pcm, rest.length);
      }
      let pos = 0;
      for (; pos + frameLen <= daten.length; pos += frameLen) {
        verarbeiten(daten.slice(pos, pos + frameLen), ausgabe);
      }
      rest = daten.slice(pos);
      return ausgabe;
    },
    flush() {
      // Unvollständigen Rest als letzten Rahmen mitnehmen (ohne Einfluss auf Schwelle).
      if (rest.length && rahmen.length) {
        rahmen.push({ pcm: rest, rms: 0, sprache: false });
      }
      rest = new Float32Array(0);
      const teil = rahmen.length ? abschliessen() : null;
      rahmen = [];
      vorlauf = [];
      return teil;
    },
    get level() {
      return level;
    },
    get hadSpeech() {
      return hadSpeech;
    },
  };
}

module.exports = { createSegmenter };
