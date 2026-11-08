const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, loadSettings, saveSettings } = require('../../src/main/settings');

let dir;
test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterflow-unit-'));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ohne Datei gelten die Standardwerte', () => {
  expect(loadSettings(dir)).toEqual(DEFAULTS);
});

test('kaputte Datei wird gesichert und ersetzt', () => {
  fs.writeFileSync(path.join(dir, 'settings.json'), '{kaputt');
  expect(loadSettings(dir)).toEqual(DEFAULTS);
  expect(fs.existsSync(path.join(dir, 'settings.json.defekt'))).toBe(true);
});

test('ungültige Werte werden verworfen', () => {
  const s = saveSettings(dir, { hotkey: 'alt+f4', dictionary: ['Kubernetes', 42, ''] });
  expect(s.hotkey).toBe('ctrl+win');
  expect(s.dictionary).toEqual(['Kubernetes']);
});

test('Speichern überlebt Neuladen', () => {
  saveSettings(dir, { smoothing: false });
  expect(loadSettings(dir).smoothing).toBe(false);
});

test('Teil-Änderungen behalten übrige Werte, unbekannte Felder fallen weg', () => {
  saveSettings(dir, { hotkey: 'rctrl', micDeviceId: 'abc' });
  const s = saveSettings(dir, { smoothingModel: 'schnell', fremd: 1 });
  expect(s).toEqual({
    ...DEFAULTS,
    hotkey: 'rctrl',
    micDeviceId: 'abc',
    smoothingModel: 'schnell',
  });
  expect(fs.existsSync(path.join(dir, 'settings.json.tmp'))).toBe(false);
});

test('Lesefehler außer "fehlt" werden weitergegeben, nichts wird überschrieben', () => {
  saveSettings(dir, { hotkey: 'rctrl' });
  const original = fs.readFileSync;
  fs.readFileSync = () => {
    throw Object.assign(new Error('belegt'), { code: 'EBUSY' });
  };
  try {
    expect(() => loadSettings(dir)).toThrow('belegt');
    expect(() => saveSettings(dir, { smoothing: false })).toThrow('belegt');
  } finally {
    fs.readFileSync = original;
  }
  expect(loadSettings(dir).hotkey).toBe('rctrl');
});

test('Umbenennen wird einmal wiederholt', () => {
  const original = fs.renameSync;
  let aufrufe = 0;
  fs.renameSync = (...args) => {
    aufrufe += 1;
    if (aufrufe === 1) throw Object.assign(new Error('gesperrt'), { code: 'EPERM' });
    return original(...args);
  };
  try {
    saveSettings(dir, { smoothing: false });
  } finally {
    fs.renameSync = original;
  }
  expect(aufrufe).toBe(2);
  expect(loadSettings(dir).smoothing).toBe(false);
});

test('dauerhafter Umbenennen-Fehler wirft und lässt die alte Datei unversehrt', () => {
  saveSettings(dir, { hotkey: 'rctrl' });
  const original = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error('gesperrt'), { code: 'EPERM' });
  };
  try {
    expect(() => saveSettings(dir, { hotkey: 'ctrl+shift' })).toThrow('gesperrt');
  } finally {
    fs.renameSync = original;
  }
  expect(loadSettings(dir).hotkey).toBe('rctrl');
});
