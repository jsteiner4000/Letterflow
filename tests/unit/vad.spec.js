const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { decodeWav } = require('../../src/main/wav');
const { createSegmenter } = require('../../src/main/vad');

const RATE = 16000;
const fixtureWav = (name) =>
  decodeWav(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `${name}.wav`)));
// Pakete von 100 ms wie aus der Aufnahme.
function* chunks(pcm, size = 1600) {
  for (let i = 0; i < pcm.length; i += size) yield pcm.subarray(i, i + size);
}
// Deterministisches Rauschen (festes Seed), Effektivwert ca. `rms`.
function rauschen(sekunden, rms) {
  let s = 12345;
  const zufall = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const faktor = rms * Math.sqrt(3); // Gleichverteilung [-a, a] hat RMS a/√3
  return Float32Array.from({ length: Math.round(sekunden * RATE) }, () => zufall() * faktor);
}
const laufen = (pcm) => {
  const seg = createSegmenter({});
  const teile = [...chunks(pcm)].flatMap((c) => seg.push(c));
  return { seg, teile, rest: seg.flush() };
};

test('Pause teilt in zwei Abschnitte', () => {
  const { teile, rest } = laufen(fixtureWav('sprache-pause-sprache'));
  expect(teile.length + (rest ? 1 : 0)).toBe(2);
});

test('nur Stille ergibt keinen Abschnitt', () => {
  const { seg, teile, rest } = laufen(rauschen(3, 0.003));
  expect(teile).toEqual([]);
  expect(rest).toBeNull();
  expect(seg.hadSpeech).toBe(false);
});

test('leises Mikrofon wird trotzdem erkannt', () => {
  const leise = fixtureWav('sprache-pause-sprache').map((v) => v * 0.1);
  const { teile, rest } = laufen(leise);
  expect(teile.length + (rest ? 1 : 0)).toBe(2);
});

test('Dauersprechen wird nach 20 s geteilt', () => {
  const ton = Float32Array.from({ length: 45 * RATE }, (_, i) =>
    Math.fround(0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)),
  );
  const { teile, rest } = laufen(ton);
  const alle = rest ? [...teile, rest] : teile;
  expect(alle.length).toBeGreaterThanOrEqual(3);
  for (const t of alle) expect(t.length).toBeLessThanOrEqual(20 * RATE);
  expect(alle.reduce((n, t) => n + t.length, 0)).toBe(ton.length);
});

test('Pegel steigt bei Sprache und fällt in der Stille', () => {
  const seg = createSegmenter({});
  const pcm = fixtureWav('sprache-pause-sprache');
  let max = 0;
  for (const c of chunks(pcm)) {
    seg.push(c);
    max = Math.max(max, seg.level);
    expect(seg.level).toBeGreaterThanOrEqual(0);
    expect(seg.level).toBeLessThanOrEqual(1);
  }
  expect(max).toBeGreaterThan(0.3);
  seg.push(new Float32Array(RATE));
  expect(seg.level).toBeLessThan(0.05);
});

test('Abschnitte enthalten Vor- und Nachlauf', () => {
  const stille = new Float32Array(RATE);
  const ton = Float32Array.from({ length: RATE }, (_, i) =>
    Math.fround(0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)),
  );
  const pcm = Float32Array.from([...stille, ...ton, ...stille, ...stille]);
  const { teile, rest } = laufen(pcm);
  const alle = rest ? [...teile, rest] : teile;
  expect(alle.length).toBe(1);
  // 1 s Ton + je ca. 200 ms Vor- und Nachlauf (auf 30-ms-Rahmen gerundet)
  expect(alle[0].length).toBeGreaterThan(1.3 * RATE);
  expect(alle[0].length).toBeLessThan(1.55 * RATE);
});
