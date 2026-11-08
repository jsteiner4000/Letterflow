const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { download, DownloadError } = require('../../src/main/downloader');
const { startFileServer } = require('../fakes/file-server');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const DATEN = crypto.randomBytes(5000);

let dir;
let server;
test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-dl-'));
});
test.afterEach(async () => {
  if (server) await server.stoppen();
  server = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lädt Datei und prüft Prüfsumme', async () => {
  server = await startFileServer({ files: { '/a.bin': DATEN } });
  const dest = path.join(dir, 'unter', 'a.bin');
  const fortschritt = [];
  await download({
    url: `${server.url}/a.bin`,
    sha256: sha(DATEN),
    dest,
    onProgress: (got, total) => fortschritt.push([got, total]),
  });
  expect(fs.readFileSync(dest).equals(DATEN)).toBe(true);
  expect(fs.existsSync(dest + '.part')).toBe(false);
  expect(fortschritt.at(-1)).toEqual([DATEN.length, DATEN.length]);
});

test('setzt abgebrochenen Download fort', async () => {
  server = await startFileServer({ files: { '/a.bin': DATEN }, optionen: { abbruchNach: 1000 } });
  const dest = path.join(dir, 'a.bin');
  const args = { url: `${server.url}/a.bin`, sha256: sha(DATEN), dest };
  const fehler = await download(args).catch((e) => e);
  expect(fehler).toBeInstanceOf(DownloadError);
  expect(fehler.code).toBe('network');
  expect(fs.statSync(dest + '.part').size).toBe(1000);

  server.optionen.abbruchNach = undefined;
  await download(args);
  expect(server.anfragen.at(-1).range).toBe('bytes=1000-');
  expect(fs.readFileSync(dest).equals(DATEN)).toBe(true);
  expect(fs.existsSync(dest + '.part')).toBe(false);
});

test('falsche Prüfsumme löscht Teildatei', async () => {
  server = await startFileServer({ files: { '/a.bin': DATEN } });
  const dest = path.join(dir, 'a.bin');
  const fehler = await download({
    url: `${server.url}/a.bin`,
    sha256: sha(Buffer.from('anders')),
    dest,
  }).catch((e) => e);
  expect(fehler.code).toBe('checksum');
  expect(fs.existsSync(dest)).toBe(false);
  expect(fs.existsSync(dest + '.part')).toBe(false);
});

test('Server ohne Range-Unterstützung lädt von vorn', async () => {
  server = await startFileServer({
    files: { '/a.bin': DATEN },
    optionen: { abbruchNach: 1000, rangeIgnorieren: true },
  });
  const dest = path.join(dir, 'a.bin');
  const args = { url: `${server.url}/a.bin`, sha256: sha(DATEN), dest };
  await download(args).catch(() => {});
  server.optionen.abbruchNach = undefined;
  await download(args);
  expect(server.anfragen.at(-1).range).toBe('bytes=1000-'); // angefragt, aber ignoriert
  expect(fs.readFileSync(dest).equals(DATEN)).toBe(true);
});

test('Server nicht erreichbar ergibt network', async () => {
  server = await startFileServer({ files: {} });
  const url = `${server.url}/x`;
  await server.stoppen();
  server = null;
  const fehler = await download({ url, sha256: sha(DATEN), dest: path.join(dir, 'x') }).catch(
    (e) => e,
  );
  expect(fehler.code).toBe('network');
});

test('zu wenig Speicherplatz ergibt disk, ohne etwas zu laden', async () => {
  server = await startFileServer({ files: { '/a.bin': DATEN } });
  const fehler = await download({
    url: `${server.url}/a.bin`,
    sha256: sha(DATEN),
    dest: path.join(dir, 'a.bin'),
    bytes: Number.MAX_SAFE_INTEGER,
  }).catch((e) => e);
  expect(fehler.code).toBe('disk');
  expect(server.anfragen).toHaveLength(0);
});
