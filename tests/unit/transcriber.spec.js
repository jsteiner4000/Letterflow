const { test, expect } = require('@playwright/test');
const { createTranscriptQueue, normalizeLevel } = require('../../src/main/transcriber');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const abschnitt = (n = 16000) => new Float32Array(n);
const EINZELN = { maxSamples: 1 }; // jeder Abschnitt eine eigene Gruppe

test('kurze Abschnitte werden gemeinsam erkannt, mit 0,3 s Stille dazwischen', async () => {
  const laengen = [];
  const q = createTranscriptQueue(async (s) => {
    laengen.push(s.length);
    return 'x';
  });
  q.add(abschnitt(16000), true);
  q.add(abschnitt(16000), true);
  q.add(abschnitt(11 * 16000), true); // passt nicht mehr in die 12-s-Gruppe
  expect(await q.finish()).toBe('x x');
  expect(laengen).toEqual([2 * 16000 + 4800, 11 * 16000]);
});

test('Abschnitt ohne Sprache wird nicht erkannt', async () => {
  const calls = [];
  const q = createTranscriptQueue(async (s) => {
    calls.push(s);
    return 'Ja.';
  });
  q.add(abschnitt(), false);
  expect(await q.finish()).toBe('');
  expect(calls.length).toBe(0);
});

test('Abschnitte werden in Reihenfolge verbunden', async () => {
  const antworten = [
    [60, ' Eins. '],
    [1, 'Zwei.'],
  ];
  let i = 0;
  const q = createTranscriptQueue(async () => {
    const [ms, text] = antworten[i++];
    await pause(ms);
    return text;
  }, EINZELN);
  q.add(abschnitt(), true);
  q.add(abschnitt(), true);
  expect(await q.finish()).toBe('Eins. Zwei.');
});

test('nie zwei Erkennungen gleichzeitig, schon während der Aufnahme begonnen', async () => {
  let laufend = 0;
  let maximal = 0;
  let begonnen = 0;
  const q = createTranscriptQueue(async () => {
    begonnen++;
    maximal = Math.max(maximal, ++laufend);
    await pause(20);
    laufend--;
    return 'x';
  }, EINZELN);
  q.add(abschnitt(), true);
  q.add(abschnitt(), true);
  q.add(abschnitt(), true);
  await expect.poll(() => begonnen).toBeGreaterThan(0); // vor finish()
  expect(await q.finish()).toBe('x x x');
  expect(maximal).toBe(1);
});

test('Fehler in einem Abschnitt verliert nicht den Rest', async () => {
  let i = 0;
  const q = createTranscriptQueue(async () => {
    if (i++ === 0) throw new Error('kaputt');
    return 'Zwei.';
  }, EINZELN);
  const log = console.error;
  console.error = () => {};
  try {
    q.add(abschnitt(), true);
    q.add(abschnitt(), true);
    expect(await q.finish()).toBe('Zwei.');
  } finally {
    console.error = log;
  }
});

test('leise Aufnahme wird verstärkt', () => {
  const leise = Float32Array.from([0.02, -0.01, 0]);
  const laut = normalizeLevel(leise);
  expect(Math.max(...laut.map(Math.abs))).toBeCloseTo(0.5, 5);
  expect(laut[1]).toBeCloseTo(-0.25, 5);
  const normal = Float32Array.from([0.6, -0.2]);
  expect(normalizeLevel(normal)).toBe(normal);
  const grenze = Float32Array.from([0.1, -0.05]);
  expect(normalizeLevel(grenze)).toBe(grenze);
  const stille = new Float32Array(4);
  expect(normalizeLevel(stille)).toBe(stille);
});

test('add nach finish ist nicht erlaubt', async () => {
  const q = createTranscriptQueue(async () => 'x');
  await q.finish();
  expect(() => q.add(abschnitt(), true)).toThrow();
});
