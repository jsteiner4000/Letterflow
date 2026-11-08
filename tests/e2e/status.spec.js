const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./helpers');
const { startFileServer } = require('../fakes/file-server');

// Alle Dateien liegen schon da (kleine Testdateien mit echten Prüfsummen): Einrichtung ist sofort
// fertig, danach starten die Ersatz-Engines.
const DATEIEN = {
  'parakeet-encoder': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx',
  'parakeet-decoder': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx',
  'parakeet-joiner': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx',
  'parakeet-tokens': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt',
  'llama-gruendlich': 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
};

const geoeffnet = [];
const server = [];
test.afterEach(async () => {
  while (geoeffnet.length)
    await geoeffnet
      .pop()
      .close()
      .catch(() => {});
  while (server.length) await server.pop().stoppen();
});

async function fertigeEinrichtung() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-status-'));
  const katalog = {};
  for (const [id, datei] of Object.entries(DATEIEN)) {
    const inhalt = crypto.randomBytes(2000);
    const ziel = path.join(dataDir, 'models', ...datei.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    katalog[id] = { sha256: crypto.createHash('sha256').update(inhalt).digest('hex'), bytes: 2000 };
  }
  fs.writeFileSync(path.join(dataDir, 'testkatalog.json'), JSON.stringify(katalog));
  const instanz = await launchApp({
    dataDir,
    env: {
      LETTERFLOW_CATALOG_URL_BASE: 'http://127.0.0.1:9',
      LETTERFLOW_CATALOG_FILE: path.join(dataDir, 'testkatalog.json'),
    },
  });
  geoeffnet.push(instanz.app);
  await expect.poll(() => instanz.app.evaluate(() => Boolean(global.__letterflow))).toBe(true);
  await instanz.app.evaluate(() => global.__letterflow.openSettings());
  const win = await instanz.app.firstWindow();
  await expect(win.getByRole('heading', { name: 'System' })).toBeVisible();
  return { ...instanz, win };
}

test('Status zeigt erkannte Hardware und bereite Engines', async () => {
  const { app, win } = await fertigeEinrichtung();
  await expect
    .poll(() => app.evaluate(() => global.__letterflow.status()))
    .toEqual({ backend: 'cpu', tier: 'schnell', engines: 'bereit', rueckfall: false });
  await expect(win.getByText('Spracherkennung: Prozessor')).toBeVisible();
  await expect(win.getByText('Glättung: Schnell (Regeln)')).toBeVisible();
  await expect(win.locator('#status-engine')).toHaveText('Bereit');
});

test('Wechsel auf Gründlich startet llama-server und zeigt es an', async () => {
  const { app, win } = await fertigeEinrichtung();
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('bereit');
  await win.getByRole('radio', { name: /^Gründlich Mit/ }).check();
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().tier)).toBe('gruendlich');
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('bereit');
  await expect(win.getByText('Glättung: Gründlich auf Prozessor')).toBeVisible();
  await win.getByRole('radio', { name: /^Schnell/ }).check();
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().tier)).toBe('schnell');
  await expect(win.getByText('Glättung: Schnell (Regeln)')).toBeVisible();
});

test('gescheiterter Engine-Start zeigt Fehler, ein späterer Erfolg löscht ihn', async () => {
  const { app, win } = await fertigeEinrichtung();
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('bereit');
  await app.evaluate(() => global.__letterflow.enginesNeustart(true));
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('fehler');
  await expect(win.locator('#status-engine')).toContainText('Fehler');
  await app.evaluate(() => global.__letterflow.enginesNeustart(false));
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('bereit');
});

test('Stufenwechsel während der Einrichtung geht nicht verloren', async () => {
  const dateien = Object.fromEntries(
    Object.keys(DATEIEN).map((id) => [id, crypto.randomBytes(40000)]),
  );
  const s = await startFileServer({
    files: Object.fromEntries(Object.keys(dateien).map((id) => [`/${id}`, dateien[id]])),
    optionen: { blockGroesse: 4000, blockPauseMs: 60 },
  });
  server.push(s);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-status-'));
  const katalog = path.join(dataDir, 'testkatalog.json');
  fs.writeFileSync(
    katalog,
    JSON.stringify(
      Object.fromEntries(
        Object.keys(dateien).map((id) => [
          id,
          { sha256: crypto.createHash('sha256').update(dateien[id]).digest('hex'), bytes: 40000 },
        ]),
      ),
    ),
  );
  const { app } = await launchApp({
    dataDir,
    env: { LETTERFLOW_CATALOG_URL_BASE: s.url, LETTERFLOW_CATALOG_FILE: katalog },
  });
  geoeffnet.push(app);
  await app.evaluate(({ BrowserWindow }) => global.__letterflow.openSettings());
  await expect.poll(() => app.windows().some((w) => w.url().includes('settings.html'))).toBe(true);
  const win = app.windows().find((w) => w.url().includes('settings.html'));
  // Einrichtung läuft noch (Parakeet wird geladen), jetzt auf Gründlich umstellen.
  expect(await app.evaluate(() => global.__letterflow.status().engines)).toBe('fehlt');
  await win.getByRole('radio', { name: /^Gründlich Mit/ }).check();
  await expect
    .poll(() => app.evaluate(() => global.__letterflow.status().engines), {
      timeout: 20000,
    })
    .toBe('bereit');
  expect(await app.evaluate(() => global.__letterflow.status().tier)).toBe('gruendlich');
});
