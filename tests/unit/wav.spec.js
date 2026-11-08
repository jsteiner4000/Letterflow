const { test, expect } = require('@playwright/test');
const { encodeWav, decodeWav } = require('../../src/main/wav');

const sine = (hz, sekunden, rate = 16000) =>
  Float32Array.from({ length: Math.round(sekunden * rate) }, (_, i) =>
    Math.fround(0.5 * Math.sin((2 * Math.PI * hz * i) / rate)),
  );
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test('WAV hin und zurück', () => {
  const pcm = sine(440, 1);
  const zurueck = decodeWav(encodeWav(pcm));
  expect(zurueck.length).toBe(pcm.length);
  expect(maxDiff(zurueck, pcm)).toBeLessThan(1e-4);
});

test('WAV-Kopf: RIFF, 16 kHz, mono, 16 Bit', () => {
  const buf = encodeWav(new Float32Array(160));
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  expect(buf.readUInt16LE(22)).toBe(1); // Kanäle
  expect(buf.readUInt32LE(24)).toBe(16000);
  expect(buf.readUInt16LE(34)).toBe(16);
  expect(buf.length).toBe(44 + 160 * 2);
});

test('Werte außerhalb von [-1, 1] werden begrenzt', () => {
  const zurueck = decodeWav(encodeWav(Float32Array.from([2, -2, 0.5])));
  expect(zurueck[0]).toBeCloseTo(1, 3);
  expect(zurueck[1]).toBeCloseTo(-1, 3);
  expect(zurueck[2]).toBeCloseTo(0.5, 3);
});

test('decodeWav lehnt Unbekanntes ab', () => {
  expect(() => decodeWav(Buffer.from('kein wav'))).toThrow();
});
