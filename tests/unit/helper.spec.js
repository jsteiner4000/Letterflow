const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { Helper } = require('../../src/main/helper');

const FAKE = path.join(__dirname, '..', 'fakes', 'fake-helper.js');

let helper;
test.afterEach(() => {
  if (helper) helper.stop();
  helper = null;
});

function startFake(env) {
  helper = new Helper();
  Object.assign(process.env, { FAKE_HELPER_SILENT: '', ...env });
  helper.start(process.execPath, [FAKE]);
  return helper;
}

const waitEvent = (h, name) => new Promise((resolve) => h.once(name, resolve));

test('Helfer-Protokoll: focus-Anfrage bekommt Antwort', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  const f = await h.focus();
  expect(f).toEqual({ hwnd: 42, editable: 'no', elevated: false });
});

test('paste liefert das Ergebnis des Helfers', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  expect(await h.paste(42)).toEqual({ ok: true, reason: null });
});

test('Helfer antwortet nicht → unknown nach 1 s', async () => {
  const h = startFake({ FAKE_HELPER_SILENT: '1' });
  await waitEvent(h, 'ready');
  const t = Date.now();
  expect(await h.focus()).toEqual({ hwnd: 0, editable: 'unknown', elevated: false });
  expect(Date.now() - t).toBeGreaterThanOrEqual(900);
  expect(await h.paste(1)).toEqual({ ok: false, reason: null });
});

test('Tastenereignisse werden zu hotkey-Ereignissen', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  const seen = [];
  for (const n of ['hotkey-down', 'hotkey-up', 'hotkey-cancel']) h.on(n, () => seen.push(n));
  const emit = (o) => h.send({ cmd: '__emit', msg: o });
  emit({ ev: 'key', key: 'lctrl', down: true });
  emit({ ev: 'key', key: 'lwin', down: true });
  emit({ ev: 'key', key: 'lwin', down: false });
  emit({ ev: 'key', key: 'lctrl', down: false });
  emit({ ev: 'key', key: 'lctrl', down: true });
  emit({ ev: 'key', key: 'lwin', down: true });
  emit({ ev: 'other' });
  await expect
    .poll(() => seen)
    .toEqual(['hotkey-down', 'hotkey-up', 'hotkey-down', 'hotkey-cancel']);
});

test('setPreset wirkt auf die Erkennung', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  h.setPreset('rctrl');
  const seen = [];
  h.on('hotkey-down', () => seen.push('down'));
  h.send({ cmd: '__emit', msg: { ev: 'key', key: 'rctrl', down: true } });
  await expect.poll(() => seen).toEqual(['down']);
});

test('Helfer-Absturz → Neustart', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  const again = waitEvent(h, 'ready');
  h.send({ cmd: '__exit' });
  await again;
  const f = await h.focus();
  expect(f.editable).toBe('no');
});

test('__setFocus ändert die Antwort', async () => {
  const h = startFake({});
  await waitEvent(h, 'ready');
  h.send({ cmd: '__setFocus', focus: { hwnd: 7, editable: 'yes', elevated: true } });
  expect(await h.focus()).toEqual({ hwnd: 7, editable: 'yes', elevated: true });
});
