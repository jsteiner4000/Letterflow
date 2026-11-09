const { test, expect } = require('@playwright/test');
const { launchApp, spawnInstance } = require('./helpers');

const geoeffnet = [];
test.afterEach(async () => {
  while (geoeffnet.length)
    await geoeffnet
      .pop()
      .close()
      .catch(() => {});
});

async function starten(optionen) {
  const instanz = await launchApp(optionen);
  geoeffnet.push(instanz.app);
  return instanz;
}

test('startet mit Taskleisten-Symbol und nur einer Instanz', async () => {
  const { app, dataDir } = await starten();
  expect(await app.evaluate(() => global.__letterflow.trayTooltip())).toBe('Letterflow – bereit');
  const second = spawnInstance(dataDir);
  await expect.poll(() => second.exitCode).toBe(0);
});

test('Über-Dialog zeigt Urheber und Version', async () => {
  const { app } = await starten();
  await app.evaluate(() => global.__letterflow.openAbout());
  const win = await app.firstWindow();
  await expect(win.getByText('Julius Steiner')).toBeVisible();
  await expect(win.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();
  // Layout aus about.css wird wirklich angewendet, das Logo wird geladen.
  const icon = win.locator('img');
  await expect(icon).toHaveCSS('width', '96px');
  await expect(win.locator('h1')).toHaveCSS('font-size', '30px');
  await expect.poll(() => icon.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});
