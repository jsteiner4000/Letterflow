// Läuft im Electron-Kontext (utilityProcess gibt es nur dort): die App-Test-Brücke baut
// EngineManager mit den Ersatz-Prozessen aus tests/fakes/.
const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp } = require('../e2e/helpers');

let app;
let dataDir;
const fremde = [];

test.beforeEach(async () => {
  ({ app, dataDir } = await launchApp({ env: { LETTERFLOW_FAKE_ASR_TEXT: 'Hallo Welt' } }));
  await expect.poll(() => app.evaluate(() => Boolean(global.__letterflow?.engines))).toBe(true);
});
test.afterEach(async () => {
  await app.evaluate(() => global.__letterflow.engines.alleStoppen()).catch(() => {});
  await app.close().catch(() => {});
  while (fremde.length) {
    try {
      process.kill(fremde.pop());
    } catch {}
  }
});

const E = (fn, arg) => app.evaluate(fn, arg);
const erzeugen = (tier, backend = 'cpu', extra = {}) =>
  E((_e, a) => global.__letterflow.engines.erzeugen(a), { tier, backend, ...extra });
const status = (id) => E((_e, i) => global.__letterflow.engines.status(i), id);

test('schnell startet keinen llama-server', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  expect(await status(id)).toBe('bereit');
  expect(await E((_e, i) => global.__letterflow.engines.llamaUrl(i), id)).toBeNull();
  expect(await E((_e, i) => global.__letterflow.engines.llamaKey(i), id)).toBeNull();
});

test('Engines werden bereit und transkribieren', async () => {
  const id = await erzeugen('gruendlich', 'vulkan');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  expect(await status(id)).toBe('bereit');
  const text = await E((_e, i) => global.__letterflow.engines.transcribe(i, 16000), id);
  expect(text).toBe('Hallo Welt');
  const { url, key } = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(key).toMatch(/^[0-9a-f]{32,}$/);
  // Schlüssel wird verlangt, /health nicht
  expect((await fetch(`${url}/health`)).status).toBe(200);
  expect((await fetch(`${url}/v1/models`)).status).toBe(401);
  expect(
    (await fetch(`${url}/v1/models`, { headers: { authorization: `Bearer ${key}` } })).status,
  ).toBe(200);
  const args = await E((_e, i) => global.__letterflow.engines.llamaArgs(i), id);
  expect(args).toEqual(expect.arrayContaining(['--host', '127.0.0.1', '-c', '4096', '-ngl', '99']));
  expect(args[args.indexOf('--api-key') + 1]).toBe(key);
});

test('auf dem Prozessor kein -ngl', async () => {
  const id = await erzeugen('gruendlich', 'cpu');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  expect(await E((_e, i) => global.__letterflow.engines.llamaArgs(i), id)).not.toContain('-ngl');
});

test('Schlüssel und Port wechseln bei jedem Start', async () => {
  const id = await erzeugen('gruendlich');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  const a = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  await E((_e, i) => global.__letterflow.engines.stop(i), id);
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  const b = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  expect(b.key).not.toBe(a.key);
});

test('abgestürzter Worker wird neu gestartet', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await E((_e, i) => global.__letterflow.engines.kill(i, 'worker'), id);
  await expect.poll(() => status(id)).toBe('startet');
  await expect.poll(() => status(id)).toBe('bereit');
  expect(await E((_e, i) => global.__letterflow.engines.transcribe(i, 16000), id)).toBe(
    'Hallo Welt',
  );
});

test('abgestürzter llama-server wird neu gestartet', async () => {
  const id = await erzeugen('gruendlich');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  const vorher = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  await E((_e, i) => global.__letterflow.engines.kill(i, 'llama'), id);
  await expect.poll(() => status(id)).toBe('startet');
  await expect.poll(() => status(id)).toBe('bereit');
  const nachher = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  expect(nachher.url).not.toBeNull();
  expect(nachher.key).not.toBe(vorher.key);
});

// Stürzt eine Komponente `mal` Mal ab (jeweils erst nach erneutem Bereitwerden).
async function abstuerzen(id, welche, mal) {
  for (let n = 0; n < mal; n++) {
    await expect.poll(() => status(id)).toBe('bereit');
    await E((_e, a) => global.__letterflow.engines.kill(a.id, a.welche), { id, welche });
    await expect.poll(() => E((_e, i) => global.__letterflow.engines.abstuerze(i), id)).toBe(n + 1);
  }
}

test('dritter Absturz binnen 60 s ergibt Fehler', async () => {
  const id = await erzeugen('schnell', 'cpu', { restartDelaysMs: [10, 10, 10] });
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await abstuerzen(id, 'worker', 3);
  await expect.poll(() => status(id)).toBe('fehler');
});

test('llama auf Vulkan fällt nach wiederholten Abstürzen auf den Prozessor zurück', async () => {
  const id = await erzeugen('gruendlich', 'vulkan', { restartDelaysMs: [10, 10, 10] });
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await abstuerzen(id, 'llama', 3);
  await expect.poll(() => E((_e, i) => global.__letterflow.engines.backend(i), id)).toBe('cpu');
  await expect.poll(() => status(id)).toBe('bereit');
  expect(await E((_e, i) => global.__letterflow.engines.llamaArgs(i), id)).not.toContain('-ngl');
  expect(await E((_e, i) => global.__letterflow.engines.fallback(i), id)).toBe(true);
});

test('verwaiste Prozesse werden beim Start beendet', async () => {
  const llama = path.join(__dirname, '..', 'fakes', 'fake-llama.js');
  const kind = spawn(
    await E(() => process.execPath),
    [llama, '--port', '39999', '--host', '127.0.0.1'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' },
  );
  fremde.push(kind.pid);
  const beendet = new Promise((r) => kind.on('exit', r));
  await expect
    .poll(async () => (await fetch('http://127.0.0.1:39999/health').catch(() => null))?.status)
    .toBe(200);
  fs.writeFileSync(path.join(dataDir, 'engines.pid'), String(kind.pid));

  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await beendet;
  expect(kind.exitCode !== null || kind.signalCode !== null).toBe(true);
});

test('stop beendet llama-server und räumt die PID-Datei auf', async () => {
  const id = await erzeugen('gruendlich');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  const pidDatei = path.join(dataDir, 'engines.pid');
  expect(fs.existsSync(pidDatei)).toBe(true);
  const { url } = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  await E((_e, i) => global.__letterflow.engines.stop(i), id);
  expect(fs.existsSync(pidDatei) ? fs.readFileSync(pidDatei, 'utf8').trim() : '').toBe('');
  await expect
    .poll(async () =>
      fetch(`${url}/health`).then(
        () => 'offen',
        () => 'zu',
      ),
    )
    .toBe('zu');
});

test('setTier startet und beendet llama-server, der Worker bleibt', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'gruendlich'), id);
  expect(await status(id)).toBe('bereit');
  const { url } = await E((_e, i) => global.__letterflow.engines.llama(i), id);
  expect((await fetch(`${url}/health`)).status).toBe(200);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'schnell'), id);
  expect(await E((_e, i) => global.__letterflow.engines.llamaUrl(i), id)).toBeNull();
  await expect
    .poll(async () =>
      fetch(`${url}/health`).then(
        () => 'offen',
        () => 'zu',
      ),
    )
    .toBe('zu');
  expect(await E((_e, i) => global.__letterflow.engines.transcribe(i, 16000), id)).toBe(
    'Hallo Welt',
  );
});

test('Zeitüberschreitung bei der Erkennung ergibt einen Fehler', async () => {
  const id = await erzeugen('schnell', 'cpu', { transcribeTimeoutMs: 300 });
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  const meldung = await E((_e, i) => global.__letterflow.engines.transcribeHaengt(i), id);
  expect(meldung).toMatch(/Zeit/);
});

test('stop während des Starts beendet das wartende start()', async () => {
  await app.close();
  ({ app, dataDir } = await launchApp({ env: { LETTERFLOW_FAKE_ASR_NIE_BEREIT: '1' } }));
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.startAsync(i), id);
  await expect.poll(() => status(id)).toBe('startet');
  await E((_e, i) => global.__letterflow.engines.stop(i), id);
  expect(await E((_e, i) => global.__letterflow.engines.ergebnis(i), id)).toMatch(/gestoppt/);
});

test('schnelles Zurückschalten auf schnell überholt das wartende gründlich', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await E((_e, i) => global.__letterflow.engines.setTierAsync(i, 'gruendlich'), id);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'schnell'), id);
  expect(await E((_e, i) => global.__letterflow.engines.ergebnis(i), id)).toBe('ok');
  expect(await E((_e, i) => global.__letterflow.engines.tier(i), id)).toBe('schnell');
  expect(await E((_e, i) => global.__letterflow.engines.llamaUrl(i), id)).toBeNull();
  expect(await status(id)).toBe('bereit');
  expect(await E((_e, i) => global.__letterflow.engines.llamaLaeuft(i), id)).toBe(false);
});

test('stop während des Aufräumens verwaister Prozesse geht nicht verloren', async () => {
  const id = await erzeugen('schnell', 'cpu', { aufraeumVerzoegerungMs: 800 });
  await E((_e, i) => global.__letterflow.engines.startAsync(i), id);
  await E((_e, i) => global.__letterflow.engines.stop(i), id);
  expect(await E((_e, i) => global.__letterflow.engines.ergebnis(i), id)).toMatch(/gestoppt/);
  // Es wurde nichts mehr gestartet: kein Worker, also keine Erkennung möglich.
  await expect(E((_e, i) => global.__letterflow.engines.transcribe(i, 16000), id)).rejects.toThrow(
    /nicht bereit/,
  );
});

test('PID-Datei enthält nach schnellem Umschalten genau den laufenden llama-server', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await E((_e, i) => global.__letterflow.engines.setTierAsync(i, 'gruendlich'), id);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'schnell'), id);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'gruendlich'), id);
  expect(await status(id)).toBe('bereit');
  const pid = await E((_e, i) => global.__letterflow.engines.llamaPid(i), id);
  expect(pid).toBeGreaterThan(0);
  // Der alte Prozess meldet sein Ende womöglich erst jetzt: warten, bis nur noch der neue gelistet ist.
  await expect.poll(() => E((_e, i) => global.__letterflow.engines.pidListe(i), id)).toEqual([pid]);
  expect(fs.readFileSync(path.join(dataDir, 'engines.pid'), 'utf8').trim()).toBe(String(pid));
});

test('nach gescheitertem gründlich-Start ist schnell wieder bereit', async () => {
  const id = await erzeugen('gruendlich', 'cpu', { restartDelaysMs: [10, 10, 10] });
  await E((_e, i) => global.__letterflow.engines.start(i), id);
  await abstuerzen(id, 'llama', 3);
  await expect.poll(() => status(id)).toBe('fehler');
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'schnell'), id);
  expect(await status(id)).toBe('bereit');
});

test('start() endet erst bei finalem Status, auch wenn währenddessen umgeschaltet wird', async () => {
  const id = await erzeugen('schnell');
  await E((_e, i) => global.__letterflow.engines.startAsync(i), id);
  await E((_e, i) => global.__letterflow.engines.setTier(i, 'gruendlich'), id);
  expect(await E((_e, i) => global.__letterflow.engines.ergebnis(i), id)).toBe('ok');
  expect(await status(id)).toBe('bereit');
});
