const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

let app;
test.beforeEach(async () => {
  // Mikrofon bleibt nach der Aufnahme 2 s warm (statt 15 s), damit das Schließen prüfbar ist.
  ({ app } = await launchApp({ env: { LETTERFLOW_MIK_WARM_MS: '2000' } }));
});
test.afterEach(async () => {
  await app.close();
});

const bruecke = (fn, arg) => app.evaluate(fn, arg);
const seiteVon = async (datei) => {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith(datei))).toBe(true);
  return app.windows().find((w) => w.url().endsWith(datei));
};
const overlaySeite = () => seiteVon('overlay.html');

test('Aufnahme liefert 16-kHz-Pakete, hält das Mikrofon kurz warm (mit Vorlauf) und schließt es', async () => {
  await bruecke(() => global.__letterflow.aufnahmeStart());
  const seite = await seiteVon('recorder.html');
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
  expect(stand.warm).toBe(false);
  // Nach dem Stopp kommen keine Pakete mehr; das Mikrofon bleibt warm.
  await new Promise((r) => setTimeout(r, 400));
  const spaeter = await bruecke(() => global.__letterflow.aufnahmeStand().pakete);
  expect(spaeter).toBe(volle);
  await expect(seite.locator('html')).toHaveAttribute('data-sample-rate', '16000');
  // Warm: sofortiger Start, das erste Paket sind die letzten 300 ms vor dem Kürzel.
  await new Promise((r) => setTimeout(r, 600)); // Ringpuffer füllt sich
  await bruecke(() => global.__letterflow.aufnahmeStart());
  const warm = await bruecke(() => global.__letterflow.aufnahmeStand());
  expect([warm.warm, warm.erstes]).toEqual([true, 4800]);
  await bruecke(() => global.__letterflow.aufnahmeStopp());
  // Nach der Warmhaltezeit ist das Mikrofon frei.
  await expect(seite.locator('html')).not.toHaveAttribute('data-sample-rate', /.*/);
});

test('Pille zeigt Texte und Pegel, blendet weich aus', async () => {
  await bruecke(() => global.__letterflow.overlay.show({ kind: 'aufnahme' }));
  const seite = await overlaySeite();
  await expect(seite.locator('#pille')).toHaveAttribute('data-kind', 'aufnahme');
  await expect(seite.locator('#zeile1')).toHaveText(''); // kein Programmname in der Pille
  await expect(seite.locator('#pille')).toHaveClass(/sichtbar/);
  // Zeitstrahl: bei Stille nur Punkte (3 px), beim Sprechen laufen hohe Balken ein.
  const hoechster = () =>
    seite.$$eval('#balken i', (bs) => Math.max(...bs.map((b) => parseFloat(b.style.height) || 0)));
  expect(await hoechster()).toBe(3);
  await bruecke(() => global.__letterflow.overlay.level(1));
  await expect.poll(hoechster).toBeGreaterThan(20);
  // Fokus bleibt unberührt, Fenster klickdurchlässig und transparent; es bleibt dauerhaft gezeigt
  const eigenschaften = await bruecke(() => {
    const w = global.__letterflow.overlay.window;
    return { fokus: w.isFocusable(), sichtbar: w.isVisible() };
  });
  expect(eigenschaften).toEqual({ fokus: false, sichtbar: true });

  // Hintergrund wie aus der Erfassung: die Linse ist an (`echt`)
  await bruecke(() =>
    global.__letterflow.overlay.window.webContents.send('overlay:backdrop', {
      width: 2,
      height: 2,
      scale: 1,
      bgra: new Uint8Array(16),
    }),
  );
  await bruecke(() => global.__letterflow.overlay.show({ kind: 'verarbeitung' }));
  await expect(seite.locator('#pille')).toHaveAttribute('data-kind', 'verarbeitung');

  await bruecke(() => global.__letterflow.overlay.hide());
  await expect(seite.locator('#pille')).not.toHaveClass(/sichtbar/);
  // Das Verschwinden läuft bis zum Ende (früher brach es ohne Streifen ab, der nächste Tropfen stand still).
  await expect.poll(() => seite.evaluate(() => popFeder.x)).toBe(0);
  expect(await bruecke(() => global.__letterflow.overlay.window.isVisible())).toBe(true);
  // Wieder zeigen: der Tropfen läuft ganz ab (Federn ruhen), statt sofort fertig dazustehen.
  await seite.evaluate(() => (window.tropfenZeiten = null));
  await bruecke(() => global.__letterflow.overlay.show({ kind: 'aufnahme' }));
  await expect
    .poll(() => seite.evaluate(() => window.tropfenZeiten?.length ?? 0))
    .toBeGreaterThan(10);
});

test('Nicht erlaubtes Gerät meldet recorder-error', async () => {
  await bruecke(() => global.__letterflow.aufnahmeStart('gibt-es-nicht'));
  const stand = await bruecke(() => global.__letterflow.aufnahmeStand());
  expect(stand.fehler).toBe('OverconstrainedError');
});

test('ungültige PCM-Nutzdaten werden verworfen, gültige angenommen', async () => {
  await bruecke(() => global.__letterflow.recorder.prepare());
  const seite = await seiteVon('recorder.html');
  await bruecke(() => {
    global.__pakete = [];
    global.__letterflow.recorder.on('pcm', (p) => global.__pakete.push(p.length));
  });
  await seite.evaluate(() => {
    window.letterflow.recorder.pcm(new Uint8Array(3)); // Länge nicht durch 4 teilbar
    window.letterflow.recorder.pcm(new Float32Array(buffer8(), 0, 0)); // leer, gültig
    window.letterflow.recorder.pcm(new Float32Array(4));
    function buffer8() {
      return new ArrayBuffer(8);
    }
  });
  // Nur die zwei gültigen Pakete (Länge 0 und 4) kommen an; das ungültige wurde verworfen.
  await expect.poll(() => bruecke(() => global.__pakete)).toEqual([0, 4]);
});
