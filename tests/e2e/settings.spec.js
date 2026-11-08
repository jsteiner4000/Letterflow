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

test('zwei schnelle Wörterbuch-Einträge gehen beide nicht verloren', async () => {
  const { win, dataDir } = await einstellungenOeffnen();
  await expect(win.getByLabel('Mit Windows starten')).toBeChecked();
  await win.evaluate(() => {
    const eingabe = document.getElementById('neuer-eintrag');
    const form = document.getElementById('woerterbuch-form');
    for (const wort of ['Alpha', 'Beta']) {
      eingabe.value = wort;
      form.requestSubmit();
    }
  });
  await expect.poll(() => gespeichert(dataDir).dictionary).toEqual(['Alpha', 'Beta']);
  await expect(win.getByRole('listitem').filter({ hasText: 'Beta' })).toBeVisible();
});

test('Entfernen lässt andere Einträge unberührt und behält den Fokus', async () => {
  const { win, dataDir } = await einstellungenOeffnen({
    dataDir: require('node:fs').mkdtempSync(
      require('node:path').join(require('node:os').tmpdir(), 'lf-'),
    ),
  });
  for (const wort of ['Alpha', 'Beta', 'Gamma']) {
    await win.getByLabel('Neuer Eintrag').fill(wort);
    await win.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(win.getByRole('listitem').filter({ hasText: wort })).toBeVisible();
  }
  await win.evaluate(() => {
    window.__alpha = document.querySelector('#eintraege li');
  });
  await win.getByRole('button', { name: 'Beta entfernen' }).focus();
  await win.keyboard.press('Enter');
  await expect.poll(() => gespeichert(dataDir).dictionary).toEqual(['Alpha', 'Gamma']);
  // Gleiches Element wie vorher (nicht neu gebaut) und Fokus auf dem Nachbarn.
  expect(await win.evaluate(() => window.__alpha === document.querySelector('#eintraege li'))).toBe(
    true,
  );
  await expect(win.getByRole('button', { name: 'Gamma entfernen' })).toBeFocused();
});

test('Speicherfehler zeigt einen Hinweis und lässt nichts inkonsistent', async () => {
  const { win, dataDir } = await einstellungenOeffnen();
  await expect(win.getByLabel('Mit Windows starten')).toBeChecked();
  // Ein Ordner an Stelle der Datei lässt das Lesen und Speichern scheitern.
  fs.mkdirSync(path.join(dataDir, 'settings.json'));
  await win.getByLabel('Neuer Eintrag').fill('Fehlerfall');
  await win.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(win.getByText('Einstellung konnte nicht gespeichert werden.')).toBeVisible();
  await expect(win.getByRole('listitem').filter({ hasText: 'Fehlerfall' })).toHaveCount(0);
  await expect(win.getByLabel('Neuer Eintrag')).toHaveValue('Fehlerfall');
});
