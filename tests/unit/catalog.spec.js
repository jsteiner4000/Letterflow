const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requiredFiles, missingFiles } = require('../../src/main/catalog');

const ids = (liste) => liste.map((f) => f.id);

test('CUDA + gründlich verlangt Modell und CUDA-Engine', () => {
  const liste = requiredFiles({ backend: 'cuda', tier: 'gruendlich', dataDir: 'D:\\data' });
  expect(ids(liste)).toEqual(
    expect.arrayContaining(['parakeet-encoder', 'llama-gruendlich', 'cuda-llama', 'cuda-cudart']),
  );
  for (const id of ['cuda-llama', 'cuda-cudart'])
    expect(liste.find((f) => f.id === id).unzipTo).toBe(
      path.join('D:\\data', 'engines', 'cuda', 'llama'),
    );
});

test('schnell lädt nur Parakeet', () => {
  expect(ids(requiredFiles({ backend: 'cuda', tier: 'schnell' })).sort()).toEqual([
    'parakeet-decoder',
    'parakeet-encoder',
    'parakeet-joiner',
    'parakeet-tokens',
  ]);
});

test('gründlich ohne CUDA braucht keine CUDA-Engine', () => {
  const liste = ids(requiredFiles({ backend: 'vulkan', tier: 'gruendlich' }));
  expect(liste).toContain('llama-gruendlich');
  expect(liste).not.toContain('cuda-llama');
});

test('Einträge haben Pfad, Adresse, Prüfsumme und Größe', () => {
  const liste = requiredFiles({ backend: 'cpu', tier: 'schnell', dataDir: 'D:\\data' });
  const enc = liste.find((f) => f.id === 'parakeet-encoder');
  expect(enc.dest).toBe(
    path.join(
      'D:\\data',
      'models',
      'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
      'encoder.int8.onnx',
    ),
  );
  expect(enc.url).toMatch(/^https:\/\//);
  expect(enc.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(enc.bytes).toBe(652282294);
});

test('missingFiles liefert nur fehlende oder unvollständige Dateien', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-cat-'));
  try {
    const liste = requiredFiles({ backend: 'cpu', tier: 'schnell', dataDir: dir });
    expect(missingFiles(dir, liste)).toHaveLength(4);
    const tokens = liste.find((f) => f.id === 'parakeet-tokens');
    fs.mkdirSync(path.dirname(tokens.dest), { recursive: true });
    fs.writeFileSync(tokens.dest, Buffer.alloc(tokens.bytes));
    const decoder = liste.find((f) => f.id === 'parakeet-decoder');
    fs.writeFileSync(decoder.dest, Buffer.alloc(5)); // falsche Größe
    expect(ids(missingFiles(dir, liste)).sort()).toEqual([
      'parakeet-decoder',
      'parakeet-encoder',
      'parakeet-joiner',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Archiv ohne Entpack-Markierung gilt als unvollständig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-cat-'));
  try {
    const eintrag = requiredFiles({ backend: 'cuda', tier: 'gruendlich', dataDir: dir }).find(
      (f) => f.id === 'cuda-cudart',
    );
    fs.mkdirSync(path.dirname(eintrag.dest), { recursive: true });
    fs.writeFileSync(eintrag.dest, Buffer.alloc(eintrag.bytes));
    expect(ids(missingFiles(dir, [eintrag]))).toEqual(['cuda-cudart']);
    fs.writeFileSync(eintrag.dest + '.entpackt', '');
    expect(missingFiles(dir, [eintrag])).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Testkatalog ersetzt Adresse, Prüfsumme und Größe', () => {
  const liste = requiredFiles({
    backend: 'cpu',
    tier: 'schnell',
    dataDir: 'D:\\data',
    urlBase: 'http://127.0.0.1:1',
    overrides: { 'parakeet-tokens': { sha256: 'ab', bytes: 7 } },
  });
  const tokens = liste.find((f) => f.id === 'parakeet-tokens');
  expect(tokens).toMatchObject({
    url: 'http://127.0.0.1:1/parakeet-tokens',
    sha256: 'ab',
    bytes: 7,
  });
});
