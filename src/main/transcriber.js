// Spracherkennung der Abschnitte: Pegel anheben und Abschnitte der Reihe nach erkennen.

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

// Erkennt Abschnitte nacheinander (nie parallel), sobald sie eintreffen; finish() liefert den Gesamttext.
// Eine Warteschlange je Diktat: add() nach finish() ist nicht erlaubt.
function createTranscriptQueue(transcribeFn) {
  let kette = Promise.resolve();
  const texte = [];
  let beendet = false;
  return {
    add(samples, hadSpeech) {
      if (beendet) throw new Error('add() nach finish() ist nicht erlaubt.');
      if (!hadSpeech) return;
      const platz = texte.push('') - 1; // Reihenfolge bleibt auch bei Fehlern erhalten
      kette = kette.then(async () => {
        try {
          texte[platz] = String((await transcribeFn(samples)) ?? '').trim();
        } catch (e) {
          console.error('Abschnitt nicht erkannt:', e && e.message ? e.message : e);
        }
      });
    },
    async finish() {
      beendet = true;
      await kette;
      return texte.filter(Boolean).join(' ');
    },
  };
}

module.exports = { normalizeLevel, createTranscriptQueue };
