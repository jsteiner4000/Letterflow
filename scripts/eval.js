// Auswertung des Testsatzes: npx electron scripts/eval.js [--tier schnell|gruendlich|beide]
// Liest testdata/stimme/<id>.wav, schreibt Abschnitt 13 in docs/messungen.md.
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
const KORREKTUR = new Set(['16', '19', '20']); // Selbstkorrektur: bei „schnell“ nicht in der WER-Mitte
const wavPfad = (id) => path.join(root, 'testdata', 'stimme', id + '.wav');

const woerter = (t) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
function wer(erw, ist) {
  const a = woerter(erw);
  const b = woerter(ist);
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
  const tiers = wahl === 'beide' ? ['schnell', 'gruendlich'] : [wahl];
  const hw = await detectHardware(undefined, { dataDir: getDataDir() });
  const manager = new EngineManager({
    dataDir: getDataDir(),
    backend: hw.backend,
    tier: tiers.includes('gruendlich') ? 'gruendlich' : 'schnell',
  });
  await manager.start();
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
        z.t[t] = { text, wer: wer(s.erwartet, text), lat: tAsr + (Date.now() - p0) };
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
  md += `Gemessen am ${new Date().toISOString().slice(0, 10)}, ${zeilen.length} Sätze, Backend ${hw.backend}. Latenz = Loslassen→Text (Erkennung + Glättung).\n\n`;
  for (const t of tiers) {
    const alle = zeilen.map((z) => z.t[t]);
    const ohne = zeilen.filter((z) => !KORREKTUR.has(z.id)).map((z) => z.t[t]);
    const kor = zeilen.filter((z) => KORREKTUR.has(z.id)).map((z) => z.t[t]);
    md +=
      t === 'schnell'
        ? `- **schnell**: mittlere WER ${pr(mittel(ohne.map((x) => x.wer)))} (ohne Selbstkorrektur-Sätze; nur diese: ${pr(mittel(kor.map((x) => x.wer)))})`
        : `- **${t}**: mittlere WER ${pr(mittel(alle.map((x) => x.wer)))} (alle Sätze)`;
    md += `, Median-Latenz ${sek(median(alle.map((x) => x.lat)))}\n`;
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
