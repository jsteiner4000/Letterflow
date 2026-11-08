const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isAllowed } = require('../../src/main/permissions');

const eigene = pathToFileURL(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'settings.html'),
).href;

test('Mikrofon (Audio) wird für eigene Seiten erlaubt', () => {
  expect(isAllowed('media', eigene, ['audio'])).toBe(true);
  expect(isAllowed('media', eigene, [])).toBe(true);
});

test('Kamera, andere Rechte und fremde Seiten werden verweigert', () => {
  expect(isAllowed('media', eigene, ['audio', 'video'])).toBe(false);
  expect(isAllowed('geolocation', eigene, [])).toBe(false);
  expect(isAllowed('media', 'https://example.com/', ['audio'])).toBe(false);
  expect(isAllowed('media', 'file:///C:/anderes/seite.html', ['audio'])).toBe(false);
  expect(isAllowed('media', undefined, ['audio'])).toBe(false);
});
