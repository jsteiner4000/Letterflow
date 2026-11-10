// Spracherkennung der Abschnitte: zu Gruppen verbinden, Pegel anheben, der Reihe nach erkennen.

const LEISE_GRENZE = 0.1;
const ZIELSPITZE = 0.5;

// Parakeet-Model-Card: sehr leise Eingabe vorher normalisieren. Lautere Aufnahmen bleiben unverändert.
function normalizeLevel(samples) {
  let spitze = 0;
  for (const s of samples) spitze = Math.max(spitze, Math.abs(s));
  if (spitze === 0 || spitze >= LEISE_GRENZE) return samples;
  const faktor = ZIELSPITZE / spitze;
  return samples.map((s) => s * faktor);
}

// Abschnitte (an Sprechpausen geschnitten) werden zu Gruppen bis ~12 s verbunden und gemeinsam erkannt:
// einzeln erkannt setzt Parakeet an jeder Pause einen Punkt und verhört Wörter am Schnitt (docs/messungen.md).
// Volle Gruppen werden schon während der Aufnahme erkannt, die letzte bei finish(); nie parallel.
// Eine Warteschlange je Diktat: add() nach finish() ist nicht erlaubt.
const SR = 16000;
const GRUPPE_MAX = 12 * SR;
// Stille zwischen den Abschnitten einer Gruppe. Jeder Abschnitt bringt schon 200 ms Vor- und Nachlauf mit;
// mehr Stille liest Parakeet als Pause und setzt dort ein Komma.
const LUECKE = new Float32Array(0.1 * SR);

function createTranscriptQueue(transcribeFn, { maxSamples = GRUPPE_MAX } = {}) {
  let kette = Promise.resolve();
  const texte = [];
  let gruppe = [];
  let beendet = false;
  function erkennen() {
    if (!gruppe.length) return;
    const teile = gruppe.flatMap((g, i) => (i ? [LUECKE, g] : [g]));
    gruppe = [];
    const samples = new Float32Array(teile.reduce((n, t) => n + t.length, 0));
    teile.reduce((pos, t) => (samples.set(t, pos), pos + t.length), 0);
    const platz = texte.push('') - 1; // Reihenfolge bleibt auch bei Fehlern erhalten
    kette = kette.then(async () => {
      try {
        texte[platz] = String((await transcribeFn(normalizeLevel(samples))) ?? '').trim();
      } catch (e) {
        console.error('Abschnitt nicht erkannt:', e && e.message ? e.message : e);
      }
    });
  }
  return {
    add(samples, hadSpeech) {
      if (beendet) throw new Error('add() nach finish() ist nicht erlaubt.');
      if (!hadSpeech) return;
      const laenge = gruppe.reduce((n, g) => n + g.length, 0);
      if (laenge && laenge + samples.length > maxSamples) erkennen();
      gruppe.push(samples);
    },
    async finish() {
      beendet = true;
      erkennen();
      await kette;
      return texte.filter(Boolean).join(' ');
    },
  };
}

module.exports = { normalizeLevel, createTranscriptQueue };
