const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, fertigerDatenOrdner } = require('./helpers');
const { encodeWav } = require('../../src/main/wav');

// Diktat-Ablauf mit Ersatz-Helfer, Ersatz-Engines und einer WAV-Datei als Test-Mikrofon.
const DIKTAT = path.join(__dirname, '..', 'fixtures', 'diktat-kurz.wav');
const TEXTFELD = { hwnd: 42, editable: 'yes', elevated: false };

let app;
let dataDir;
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function starten({ settings, audio = DIKTAT, env, bereit = true } = {}) {
  let fertig;
  ({ dataDir, env: fertig } = fertigerDatenOrdner('letterflow-diktat-'));
  if (settings) fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings));
  ({ app } = await launchApp({
    dataDir,
    env: {
      ...fertig,
      LETTERFLOW_FAKE_AUDIO_FILE: audio,
      LETTERFLOW_FAKE_ASR_TEXT: 'ähm hallo tim',
      LETTERFLOW_FAKE_ASR_LOG: path.join(dataDir, 'asr-aufrufe.log'),
      ...env,
    },
  }));
  if (bereit)
    await expect
      .poll(() => app.evaluate(() => global.__letterflow.status().engines), { timeout: 15000 })
      .toBe('bereit');
}

const helfer = (m) =>
  app.evaluate((_e, nachricht) => global.__letterflow.helper.send(nachricht), m);
const taste = (key, down) => helfer({ cmd: '__emit', msg: { ev: 'key', key, down } });
const fokus = (focus) => helfer({ cmd: '__setFocus', focus });
const druecken = async () => {
  await taste('lctrl', true);
  await taste('lwin', true);
};
const loslassen = async () => {
  await taste('lwin', false);
  await taste('lctrl', false);
};
const lastPaste = () => app.evaluate(() => global.__letterflow.lastPaste);
const zwischenablage = () => app.evaluate(({ clipboard }) => clipboard.readText());
const protokoll = () => {
  try {
    return fs.readFileSync(path.join(dataDir, 'logs', 'letterflow.log'), 'utf8');
  } catch {
    return '';
  }
};
const overlaySeite = async () => {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith('overlay.html'))).toBe(true);
  return app.windows().find((w) => w.url().endsWith('overlay.html'));
};
const pille = async () => (await overlaySeite()).locator('#pille');
const zeile = async (n) => (await overlaySeite()).locator(`#zeile${n}`);

// Kürzel halten, bis das Mikrofon wirklich läuft, dann noch `ms` sprechen und loslassen.
async function diktieren(ms = 1500) {
  await druecken();
  const seite = await overlaySeite();
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000', {
    timeout: 10000,
  });
  await new Promise((r) => setTimeout(r, ms)); // Sprechdauer, kein Warten auf Zustand
  await loslassen();
}

test('Diktat wird regelbasiert geglättet eingefügt und Zwischenablage wiederhergestellt', async () => {
  await starten();
  await app.evaluate(({ clipboard }) => clipboard.writeText('alt'));
  await fokus({ ...TEXTFELD, exe: 'C:/Fake/winword.exe', appName: 'Word' });
  await diktieren();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'Hallo tim.', hwnd: 42 });
  await expect.poll(zwischenablage).toBe('alt');
  await expect(await zeile(1)).toHaveText('Eingefügt in Word');
  await expect(await zeile(2)).toHaveText('2 Wörter');
  await expect(await pille()).not.toHaveClass(/sichtbar/);
  // Protokoll: Dauern ja, diktierter Text nie.
  await expect.poll(protokoll).toMatch(/einfügen \d+ ms, ok/);
  expect(protokoll()).toMatch(/erkennung \d+ ms/);
  expect(protokoll()).toMatch(/glättung \d+ ms/);
  expect(protokoll()).not.toMatch(/hallo|tim\b|ähm/i);
});

test('Stufe gründlich nutzt das Sprachmodell', async () => {
  await starten({ settings: { smoothingModel: 'gruendlich' } });
  await fokus(TEXTFELD);
  await diktieren();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'Hallo Tim.', hwnd: 42 });
});

test('Abbruch fügt nichts ein', async () => {
  await starten();
  await fokus(TEXTFELD);
  await druecken();
  const p = await pille();
  await expect(p).toHaveAttribute('data-kind', 'aufnahme');
  await helfer({ cmd: '__emit', msg: { ev: 'other' } });
  await loslassen();
  await expect(p).not.toHaveClass(/sichtbar/);
  await expect.poll(protokoll).toMatch(/abgebrochen/);
  expect(await lastPaste()).toBeNull();
  expect(fs.existsSync(path.join(dataDir, 'asr-aufrufe.log'))).toBe(false);
});

test('kein Textfeld → Warnung und Text in Zwischenablage', async () => {
  await starten();
  await fokus({ hwnd: 42, editable: 'no', elevated: false });
  await diktieren();
  await expect(await zeile(1)).toHaveText('Kein Textfeld aktiv', { timeout: 10000 });
  await expect(await zeile(2)).toHaveText('Mit Strg V einfügen');
  await expect(await pille()).toHaveAttribute('data-kind', 'warnung');
  expect(await zwischenablage()).toBe('Hallo tim.');
  expect(await lastPaste()).toBeNull();
});

test('Fenster gewechselt → Warnung', async () => {
  await starten();
  await fokus(TEXTFELD);
  await helfer({ cmd: '__setPaste', paste: { ok: false, reason: 'fenster-gewechselt' } });
  await diktieren();
  await expect(await zeile(1)).toHaveText('Fenster gewechselt', { timeout: 10000 });
  expect(await zwischenablage()).toBe('Hallo tim.');
});

test('Glättung aus → Rohtext', async () => {
  await starten({ settings: { smoothing: false } });
  await fokus(TEXTFELD);
  await diktieren();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'ähm hallo tim', hwnd: 42 });
});

test('Engines nicht bereit → Hinweis statt Aufnahme', async () => {
  await starten({ env: { LETTERFLOW_FAKE_ASR_NIE_BEREIT: '1' }, bereit: false });
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('startet');
  await fokus(TEXTFELD);
  await druecken();
  const p = await pille();
  await expect(p).toHaveText('Letterflow lädt noch die Modelle …');
  await expect(p).toHaveAttribute('data-kind', 'info');
  await loslassen();
  await expect(p).not.toHaveClass(/sichtbar/, { timeout: 5000 });
  const seite = await overlaySeite();
  await expect(seite.locator('html')).not.toHaveAttribute('data-sample-rate', /.*/);
  expect(await lastPaste()).toBeNull();
});

test('Engine-Fehler → Kürzel stößt einen Neustart an', async () => {
  await starten();
  await app.evaluate(() => global.__letterflow.enginesNeustart(true));
  expect(await app.evaluate(() => global.__letterflow.status().engines)).toBe('fehler');
  await druecken();
  await expect(await pille()).toHaveText('Letterflow lädt noch die Modelle …');
  await loslassen();
  await expect
    .poll(() => app.evaluate(() => global.__letterflow.status().engines), { timeout: 15000 })
    .toBe('bereit');
});

test('Mikrofon gesperrt → Fehlermeldung', async () => {
  await starten();
  await app.evaluate(() => global.__letterflow.mikrofonSperren());
  await fokus(TEXTFELD);
  await druecken();
  await expect(await zeile(1)).toHaveText('Mikrofon gesperrt', { timeout: 10000 });
  await expect(await zeile(2)).toHaveText(
    'in Windows unter Datenschutz › Mikrofon für Desktop-Apps erlauben',
  );
  await expect(await pille()).toHaveAttribute('data-kind', 'fehler');
  await loslassen();
  expect(await lastPaste()).toBeNull();
});

test('Stille wird verworfen', async () => {
  const stille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-stille-')), 's.wav');
  fs.writeFileSync(stille, encodeWav(new Float32Array(16000 * 3)));
  await starten({ audio: stille });
  await fokus(TEXTFELD);
  await diktieren();
  await expect.poll(protokoll).toMatch(/verworfen/);
  await expect(await pille()).not.toHaveClass(/sichtbar/);
  expect(await lastPaste()).toBeNull();
  expect(fs.existsSync(path.join(dataDir, 'asr-aufrufe.log'))).toBe(false);
});

test('gewähltes Mikrofon fehlt → Windows-Standard', async () => {
  await starten({ settings: { micDeviceId: 'gibt-es-nicht' } });
  await fokus(TEXTFELD);
  await diktieren();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'Hallo tim.', hwnd: 42 });
  expect(protokoll()).toMatch(/OverconstrainedError/);
});

test('Mikrofon während der Aufnahme abgezogen → einmal Windows-Standard', async () => {
  await starten();
  await fokus(TEXTFELD);
  await druecken();
  const seite = await overlaySeite();
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000');
  // Die Spur meldet „ended“, als wäre das Gerät abgezogen worden.
  await seite.evaluate(() => aufnahme.strom.getAudioTracks()[0].dispatchEvent(new Event('ended')));
  await expect.poll(protokoll).toMatch(/Standardgerät/);
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000');
  await new Promise((r) => setTimeout(r, 1500)); // Sprechdauer
  await loslassen();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'Hallo tim.', hwnd: 42 });
});

test('Erkennung scheitert → Fehlermeldung statt stillem Ausblenden', async () => {
  await starten({ env: { LETTERFLOW_FAKE_ASR_FEHLER: '1' } });
  await fokus(TEXTFELD);
  await diktieren();
  await expect(await zeile(1)).toHaveText('Diktat fehlgeschlagen', { timeout: 10000 });
  await expect(await pille()).toHaveAttribute('data-kind', 'fehler');
  expect(await lastPaste()).toBeNull();
});

test('Einfügen wartet, bis das nächste Kürzel losgelassen ist', async () => {
  // „langsame eingabe“ braucht im Ersatz-Sprachmodell 3 s: das zweite Kürzel ist dann schon gedrückt.
  await starten({
    settings: { smoothingModel: 'gruendlich' },
    env: { LETTERFLOW_FAKE_ASR_TEXT: 'langsame eingabe' },
  });
  await fokus(TEXTFELD);
  await diktieren();
  await druecken();
  await expect.poll(protokoll, { timeout: 10000 }).toMatch(/glättung \d+ ms/);
  await new Promise((r) => setTimeout(r, 500)); // Gegenprobe: ohne Warten käme das Einfügen sofort
  expect(await lastPaste()).toBeNull();
  await loslassen();
  await expect.poll(lastPaste).toEqual({ text: 'Langsame Eingabe.', hwnd: 42 });
});

test('Engine-Neustart während der Aufnahme → Erkennung nutzt die neuen Engines', async () => {
  await starten();
  await fokus(TEXTFELD);
  await druecken();
  const seite = await overlaySeite();
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000');
  await app.evaluate(() => global.__letterflow.enginesNeustart(false));
  await expect.poll(() => app.evaluate(() => global.__letterflow.status().engines)).toBe('bereit');
  await new Promise((r) => setTimeout(r, 1500)); // Sprechdauer
  await loslassen();
  await expect.poll(lastPaste, { timeout: 10000 }).toEqual({ text: 'Hallo tim.', hwnd: 42 });
});

test('Taskleisten-Symbol: während der Aufnahme „hört zu“, danach „bereit“', async () => {
  await starten();
  const tooltip = () => app.evaluate(() => global.__letterflow.trayTooltip());
  await fokus({ ...TEXTFELD, exe: 'C:/Fake/winword.exe', appName: 'Word' });
  await druecken();
  await expect.poll(tooltip).toBe('Letterflow – hört zu');
  await loslassen();
  await expect.poll(tooltip).toBe('Letterflow – bereit');
});
