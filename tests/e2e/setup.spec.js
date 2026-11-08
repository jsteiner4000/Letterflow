const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./helpers');
const { startFileServer } = require('../fakes/file-server');

const IDS = ['parakeet-encoder', 'parakeet-decoder', 'parakeet-joiner', 'parakeet-tokens'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Kleine Testdateien mit echten Prüfsummen statt der mehrere hundert MB großen Modelle.
const dateien = Object.fromEntries(IDS.map((id) => [id, crypto.randomBytes(40000)]));
const serverDateien = Object.fromEntries(IDS.map((id) => [`/${id}`, dateien[id]]));

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

// Startet die App im Testmodus mit Testkatalog; liefert Fenster und Daten-Ordner.
async function einrichtungStarten(baseUrl) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-setup-'));
  const katalog = path.join(dataDir, 'testkatalog.json');
  fs.writeFileSync(
    katalog,
    JSON.stringify(
      Object.fromEntries(IDS.map((id) => [id, { sha256: sha(dateien[id]), bytes: 40000 }])),
    ),
  );
  const instanz = await launchApp({
    dataDir,
    env: { LETTERFLOW_CATALOG_URL_BASE: baseUrl, LETTERFLOW_CATALOG_FILE: katalog },
  });
  geoeffnet.push(instanz.app);
  const win = await instanz.app.firstWindow();
  return { ...instanz, win };
}

const fensterAnzahl = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test('Erststart zeigt Fortschritt und schließt sich danach', async () => {
  const s = await startFileServer({
    files: serverDateien,
    optionen: { blockGroesse: 4000, blockPauseMs: 40 },
  });
  server.push(s);
  const { app, win, dataDir } = await einrichtungStarten(s.url);

  await expect(win.getByRole('heading', { name: 'Willkommen bei Letterflow' })).toBeVisible();
  await expect(
    win.getByText(/Letterflow lädt einmalig die Sprachmodelle herunter \(ca\./),
  ).toBeVisible();
  await expect(win.getByRole('progressbar')).toBeVisible();
  await expect(win.locator('#fortschritt-text')).toContainText('%');

  await expect.poll(() => fensterAnzahl(app)).toBe(0);
  expect(await app.evaluate(() => global.__letterflow.status().engines)).not.toBe('fehlt');
  for (const id of IDS) {
    const datei = path.join(
      dataDir,
      'models',
      'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
      id === 'parakeet-tokens' ? 'tokens.txt' : `${id.replace('parakeet-', '')}.int8.onnx`,
    );
    expect(fs.readFileSync(datei).equals(dateien[id])).toBe(true);
  }
});

test('Netzwerkfehler zeigt Meldung mit "Erneut versuchen"', async () => {
  // Port reservieren und den Server wieder abschalten: Verbindung wird verweigert.
  const erster = await startFileServer({ files: serverDateien });
  const port = erster.port;
  await erster.stoppen();

  const { app, win } = await einrichtungStarten(`http://127.0.0.1:${port}`);
  await expect(
    win.getByText('Download unterbrochen – bitte Internetverbindung prüfen.'),
  ).toBeVisible();
  const knopf = win.getByRole('button', { name: 'Erneut versuchen' });
  await expect(knopf).toBeVisible();

  server.push(await startFileServer({ files: serverDateien, port }));
  await knopf.click();
  await expect.poll(() => fensterAnzahl(app)).toBe(0);
  expect(await app.evaluate(() => global.__letterflow.status().engines)).not.toBe('fehlt');
});
