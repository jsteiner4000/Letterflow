const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

let app;
test.beforeEach(async () => {
  ({ app } = await launchApp());
});
test.afterEach(async () => {
  await app.close();
});

const bruecke = (fn, arg) => app.evaluate(fn, arg);
const overlaySeite = async () => {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith('overlay.html'))).toBe(true);
  return app.windows().find((w) => w.url().endsWith('overlay.html'));
};

test('Aufnahme liefert 16-kHz-Pakete mit wechselndem Pegel und schließt das Mikrofon', async () => {
  await bruecke(() => global.__letterflow.aufnahmeStart());
  const seite = await overlaySeite();
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000');
  // Echte Daten abwarten: mindestens ~2,5 s, damit der Piepton des Test-Mikrofons dabei ist.
  await expect
    .poll(() => bruecke(() => global.__letterflow.aufnahmeStand().werte), { timeout: 10000 })
    .toBeGreaterThan(16000 * 2.5);
  await bruecke(() => global.__letterflow.aufnahmeStopp());
  const stand = await bruecke(() => global.__letterflow.aufnahmeStand());
  expect(stand.fehler).toBeNull();
  const volle = stand.pakete;
  expect(volle).toBeGreaterThan(20);
  // Pegel wechselt zwischen Ton und Stille
  expect(Math.max(...stand.rms)).toBeGreaterThan(0.01);
  expect(Math.min(...stand.rms)).toBeLessThan(Math.max(...stand.rms) / 4);
  // Nach dem Stopp kommen keine Pakete mehr, und das Mikrofon ist frei.
  await new Promise((r) => setTimeout(r, 400));
  const spaeter = await bruecke(() => global.__letterflow.aufnahmeStand().pakete);
  expect(spaeter).toBe(volle);
  await expect(seite.locator('html')).not.toHaveAttribute('data-sample-rate', /.*/);
});

test('Pille zeigt Texte und Pegel, blendet weich aus', async () => {
  await bruecke(() => global.__letterflow.overlay.show({ kind: 'aufnahme' }));
  const seite = await overlaySeite();
  await expect(seite.locator('#text')).toHaveText('Ich höre zu …');
  await expect(seite.locator('#pille')).toHaveClass(/sichtbar/);
  await expect(seite.locator('#balken i')).toHaveCount(5);
  await bruecke(() => global.__letterflow.overlay.level(1));
  await expect
    .poll(() =>
      seite
        .locator('#balken i')
        .nth(2)
        .evaluate((e) => e.style.transform),
    )
    .toBe('scaleY(1)');
  // Fokus bleibt unberührt, Fenster klickdurchlässig und transparent
  const eigenschaften = await bruecke(() => {
    const w = global.__letterflow.overlay.window;
    return { fokus: w.isFocusable(), sichtbar: w.isVisible() };
  });
  expect(eigenschaften).toEqual({ fokus: false, sichtbar: true });

  await bruecke(() => global.__letterflow.overlay.show({ kind: 'verarbeitung' }));
  await expect(seite.locator('#text')).toHaveText('Schreibe …');

  await bruecke(() => global.__letterflow.overlay.hide());
  await expect(seite.locator('#pille')).not.toHaveClass(/sichtbar/);
  await expect
    .poll(() => bruecke(() => global.__letterflow.overlay.window.isVisible()))
    .toBe(false);
});

test('Nicht erlaubtes Gerät meldet recorder-error', async () => {
  await bruecke(() => global.__letterflow.aufnahmeStart('gibt-es-nicht'));
  const stand = await bruecke(() => global.__letterflow.aufnahmeStand());
  expect(stand.fehler).toBe('OverconstrainedError');
});
