const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp } = require('./helpers');

const geoeffnet = [];
test.afterEach(async () => {
  while (geoeffnet.length)
    await geoeffnet
      .pop()
      .close()
      .catch(() => {});
});

async function einstellungenOeffnen(optionen) {
  const instanz = await launchApp(optionen);
  geoeffnet.push(instanz.app);
  await instanz.app.evaluate(() => global.__letterflow.openSettings());
  const win = await instanz.app.firstWindow();
  await expect(win.getByRole('heading', { name: 'Wörterbuch' })).toBeVisible();
  return { ...instanz, win };
}

// Liest die gespeicherte Datei; solange sie noch nicht existiert, gibt es nichts zu prüfen.
const gespeichert = (dataDir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
};

test('Wörterbuch-Eintrag bleibt nach Neustart erhalten', async () => {
  const { app, win, dataDir } = await einstellungenOeffnen();
  await win.getByLabel('Neuer Eintrag').fill('Kubernetes');
  await win.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(win.getByRole('listitem').filter({ hasText: 'Kubernetes' })).toBeVisible();
  await expect.poll(() => gespeichert(dataDir).dictionary).toEqual(['Kubernetes']);
  await app.close();

  const zweite = await einstellungenOeffnen({ dataDir });
  await expect(zweite.win.getByRole('listitem').filter({ hasText: 'Kubernetes' })).toBeVisible();
});

test('Glättung abschalten wird sofort gespeichert', async () => {
  const { win, dataDir } = await einstellungenOeffnen();
  const schalter = win.getByLabel('Text glätten (Füllwörter, Satzzeichen, Schreibweisen)');
  await expect(schalter).toBeChecked();
  await schalter.uncheck();
  await expect.poll(() => gespeichert(dataDir).smoothing).toBe(false);
});

test('Autostart wird gespeichert, ohne im Testmodus zu registrieren', async () => {
  const { app, win, dataDir } = await einstellungenOeffnen();
  const schalter = win.getByLabel('Mit Windows starten');
  await expect(schalter).toBeChecked();
  await schalter.uncheck();
  await expect.poll(() => gespeichert(dataDir).autostart).toBe(false);
  expect(await app.evaluate(() => global.__letterflow.loginItemCalls())).toBe(0);
});

test('System-Abschnitt zeigt Platzhalter-Status', async () => {
  const { win } = await einstellungenOeffnen();
  await expect(win.getByText('Einrichtung nicht abgeschlossen')).toBeVisible();
  await expect(win.getByText('Spracherkennung: Prozessor')).toBeVisible();
});

for (const width of [900, 1300, 1700]) {
  test(`kein waagrechtes Scrollen bei ${width} px`, async () => {
    const { app, win } = await einstellungenOeffnen();
    await app.evaluate(({ BrowserWindow }, w) => {
      BrowserWindow.getAllWindows()[0].setSize(w, 800);
    }, width);
    await expect
      .poll(() => win.evaluate(() => window.innerWidth))
      .toBeGreaterThanOrEqual(width - 40);
    const maße = await win.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(maße.scroll).toBeLessThanOrEqual(maße.client);
  });
}

test('im Vollbild ohne Kopfzeile vollständig bedienbar', async () => {
  const { app, win } = await einstellungenOeffnen();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
    )
    .toBe(true);
  const letzter = win.getByRole('heading', { name: 'System' });
  await letzter.scrollIntoViewIfNeeded();
  await expect(letzter).toBeInViewport();
  const maße = await win.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(maße.scroll).toBeLessThanOrEqual(maße.client);
});
