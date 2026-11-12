const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../../src/main/updater');

const fake = () =>
  Object.assign(new EventEmitter(), {
    geladen: 0,
    installiert: 0,
    checkForUpdates: async () => {},
    async downloadUpdate() {
      this.geladen += 1;
    },
    quitAndInstall() {
      this.installiert += 1;
    },
  });
const warten = () => new Promise((r) => setImmediate(r));

test('Windows-Start: „Später“ lädt und installiert nichts', async () => {
  const f = fake();
  const u = createUpdater({ autoUpdater: f, fragen: async () => false });
  expect([f.autoDownload, f.autoInstallOnAppQuit]).toEqual([false, false]);
  f.emit('update-available', { version: '9.9.9' });
  await warten();
  expect(f.geladen).toBe(0);
  expect(u.stand().phase).toBe('leer');
});

test('Windows-Start: „Jetzt aktualisieren“ lädt und installiert sofort', async () => {
  const f = fake();
  createUpdater({ autoUpdater: f, fragen: async () => true });
  f.emit('update-available', { version: '9.9.9' });
  await warten();
  expect(f.geladen).toBe(1);
  f.emit('update-downloaded', { version: '9.9.9' });
  expect(f.installiert).toBe(1);
});
