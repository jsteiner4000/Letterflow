// Auswertung des Testsatzes: npx electron scripts/eval.js [--tier schnell,ausgewogen,gruendlich|beide]
//   [--cpu] (Grafikkarte nicht nutzen) [--modell <gguf>] (anderes Modell für „ausgewogen“) [--aus <datei.md>]
// Liest testdata/stimme/<id>.wav, schreibt Abschnitt 13 in docs/messungen.md (oder nach --aus).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { EngineManager } = require('../src/main/engines');
const { polish } = require('../src/main/smoother');
const { decodeWav } = require('../src/main/wav');
const { detectHardware } = require('../src/main/hardware');
const { getDataDir } = require('../src/main/catalog');

const root = path.join(__dirname, '..');
const i = process.argv.indexOf('--tier');
const wahl = i >= 0 ? process.argv[i + 1] : 'beide';
const option = (name) => {
  const k = process.argv.indexOf(name);
  return k >= 0 ? process.argv[k + 1] : undefined;
};
const KORREKTUR = new Set(['16', '19', '20']); // Selbstkorrektur: bei „schnell“ nicht in der WER-Mitte
const wavPfad = (id) => path.join(root, 'testdata', 'stimme', id + '.wav');

const woerter = (t) =>
  t
    .toLowerCase()
    .replace(/-/g, ' ') // Bindestriche zählen nicht als Fehler; Listenstriche verschwinden damit ebenfalls
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
// Streng: Groß-/Kleinschreibung und Satzzeichen zählen mit (Satzzeichen als eigene Wörter).
const streng = (t) =>
  t
    .replace(/([.,!?;:])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
function wer(erw, ist, zerlegen = woerter) {
  const a = zerlegen(erw);
  const b = zerlegen(ist);
  let d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let x = 1; x <= a.length; x++) {
    const neu = [x];
    for (let y = 1; y <= b.length; y++)
      neu[y] = Math.min(d[y] + 1, neu[y - 1] + 1, d[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    d = neu;
  }
  return d[b.length] / (a.length || 1);
}
const mittel = (l) => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : NaN);
const median = (l) => {
  const s = [...l].sort((p, q) => p - q);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pr = (v) => (Number.isNaN(v) ? '–' : (v * 100).toFixed(1) + ' %');
const sek = (ms) => (ms / 1000).toFixed(2) + ' s';
const zelle = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, '<br>');

async function lauf() {
  const satz = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'testset.json'), 'utf8'));
  const da = satz.filter((s) => fs.existsSync(wavPfad(s.id)));
  if (!da.length) {
    console.log(
      'keine Aufnahmen gefunden (testdata/stimme/*.wav). Erst: npx electron scripts/record-testset.js',
    );
    return;
  }
  if (da.length < satz.length)
    console.log(`Hinweis: ${satz.length - da.length} Sätze ohne Aufnahme übersprungen.`);
  const tiers = wahl === 'beide' ? ['schnell', 'gruendlich'] : wahl.split(',');
  const hw = await detectHardware(undefined, { dataDir: getDataDir() });
  if (process.argv.includes('--cpu')) hw.backend = 'cpu';
  if (option('--modell')) {
    const eintrag = require('../models.json').find((m) => m.id === 'llama-ausgewogen');
    eintrag.file = path
      .relative(path.join(getDataDir(), 'models'), path.resolve(option('--modell')))
      .split(path.sep)
      .join('/');
  }
  const manager = new EngineManager({
    dataDir: getDataDir(),
    backend: hw.backend,
    tier: tiers.find((t) => t !== 'schnell') || 'schnell',
  });
  const s0 = Date.now();
  await manager.start();
  const startMs = Date.now() - s0;
  const zeilen = [];
  const glaetten = (t, text) =>
    polish(text, { tier: t, llamaUrl: manager.llamaUrl, llamaKey: manager.llamaKey });
  try {
    // Aufwärmen: die erste Anfrage enthält Modell- und Prompt-Aufbau und würde die Latenz verfälschen.
    const wText = await manager.transcribe(decodeWav(fs.readFileSync(wavPfad(da[0].id))));
    for (const t of tiers) await glaetten(t, wText);
    for (const s of da) {
      const samples = decodeWav(fs.readFileSync(wavPfad(s.id)));
      const t0 = Date.now();
      const roh = await manager.transcribe(samples);
      const tAsr = Date.now() - t0;
      const z = { id: s.id, erwartet: s.erwartet, roh, werRoh: wer(s.erwartet, roh), t: {} };
      for (const t of tiers) {
        const p0 = Date.now();
        const text = await glaetten(t, roh);
        const glatt = Date.now() - p0;
        z.t[t] = {
          text,
          wer: wer(s.erwartet, text),
          streng: wer(s.erwartet, text, streng),
          glatt,
          lat: tAsr + glatt,
        };
      }
      zeilen.push(z);
      console.log(
        `${s.id} roh ${pr(z.werRoh)} ` +
          tiers.map((t) => `${t} ${pr(z.t[t].wer)} ${sek(z.t[t].lat)}`).join(' | '),
      );
    }
  } finally {
    await manager.stop();
  }

  let md = '## 13. Testsatz mit echter Stimme (Task 11)\n\n';
  const modell = option('--modell') ? `, Modell ${path.basename(option('--modell'))}` : '';
  md += `Gemessen am ${new Date().toISOString().slice(0, 10)}, ${zeilen.length} Sätze, Backend ${hw.backend}${modell}. Latenz = Loslassen→Text (Erkennung + Glättung); Start bis bereit ${sek(startMs)}. „streng“ = WER mit Groß-/Kleinschreibung und Satzzeichen.\n\n`;
  for (const t of tiers) {
    const alle = zeilen.map((z) => z.t[t]);
    const ohne = zeilen.filter((z) => !KORREKTUR.has(z.id)).map((z) => z.t[t]);
    const kor = zeilen.filter((z) => KORREKTUR.has(z.id)).map((z) => z.t[t]);
    md += `- **${t}**: mittlere WER ${pr(mittel(alle.map((x) => x.wer)))} (alle Sätze; ohne Selbstkorrektur-Sätze ${pr(mittel(ohne.map((x) => x.wer)))}, nur diese ${pr(mittel(kor.map((x) => x.wer)))})`;
    md += `, streng ${pr(mittel(alle.map((x) => x.streng)))}, Median-Latenz ${sek(median(alle.map((x) => x.lat)))} (Glättung allein ${sek(median(alle.map((x) => x.glatt)))}, langsamste ${sek(Math.max(...alle.map((x) => x.glatt)))})\n`;
  }
  md += `- **roh** (Parakeet ohne Glättung): mittlere WER ${pr(mittel(zeilen.map((z) => z.werRoh)))}\n\n`;
  md += `| Nr. | Erwartet | Roh | ${tiers.map((t) => `${t} (WER, Zeit)`).join(' | ')} |\n`;
  md += `| --- | --- | --- | ${tiers.map(() => '---').join(' | ')} |\n`;
  for (const z of zeilen)
    md +=
      `| ${z.id} | ${zelle(z.erwartet)} | ${zelle(z.roh)} | ` +
      tiers
        .map((t) => `${zelle(z.t[t].text)} (${pr(z.t[t].wer)}, ${sek(z.t[t].lat)})`)
        .join(' | ') +
      ' |\n';

  console.log(md.slice(0, md.indexOf('| Nr.')));
  if (option('--aus')) return fs.writeFileSync(option('--aus'), md);
  const datei = path.join(root, 'docs', 'messungen.md');
  let alt = fs.readFileSync(datei, 'utf8');
  const k = alt.indexOf('## 13. Testsatz mit echter Stimme');
  if (k >= 0) {
    const e = alt.indexOf('\n## ', k + 1);
    alt = alt.slice(0, k) + (e >= 0 ? alt.slice(e + 1) : '');
  }
  fs.writeFileSync(datei, alt.replace(/\s*$/, '\n\n') + md);
  console.log('docs/messungen.md aktualisiert.');
}

app.whenReady().then(() =>
  lauf()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => app.quit()),
);
