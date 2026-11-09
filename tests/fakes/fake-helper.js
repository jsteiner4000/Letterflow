// Ersatz für letterflow-helper.exe: gleiches Protokoll, steuerbar über stdin.
// Zusatzbefehle: {"cmd":"__emit","msg":{...}}, {"cmd":"__setFocus","focus":{...}},
// {"cmd":"__setPaste","paste":{...}}, {"cmd":"__exit"}, {"cmd":"__micFehler","name":"..."} (nächster
// Mikrofonstart scheitert), {"cmd":"__micEnde"} (Gerät während der Aufnahme abgezogen).
// Mikrofon: LETTERFLOW_FAKE_AUDIO_FILE (WAV, in Schleife) oder ein Piepton (0,2 s je Sekunde), in
// 40-ms-Paketen in Echtzeit. Bekannt ist nur das Gerät „Test-Mikrofon“ (und der Standard).
// Mit FAKE_HELPER_SILENT=1 werden id-Anfragen nicht beantwortet.
const fs = require('node:fs');
const readline = require('node:readline');
const { decodeWav } = require('../../src/main/wav');

let focus = {
  hwnd: 42,
  editable: 'no',
  elevated: false,
  exe: 'C:/Fake/app.exe',
  appName: 'Fake App',
};
let paste = { ok: true, reason: null };
const silent = process.env.FAKE_HELPER_SILENT === '1';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

// FAKE_HELPER_DIE=1: beendet sich sofort, ohne bereit zu melden (Hook-Installation fehlgeschlagen)
if (process.env.FAKE_HELPER_DIE === '1') process.exit(2);

out({ ev: 'ready' });

const datei = process.env.LETTERFLOW_FAKE_AUDIO_FILE;
const ton = datei
  ? decodeWav(fs.readFileSync(datei))
  : Float32Array.from({ length: 16000 }, (_, i) => (i < 3200 ? 0.3 * Math.sin(i / 4) : 0));
let pos = 0;
let mikTimer = null;
let warm = false;
let micFehler = null;
function mikrofon(m) {
  if (!m.on) {
    if (!mikTimer) return;
    clearInterval(mikTimer);
    mikTimer = null;
    return out({ ev: 'mic', stopped: true }); // warm gilt ab dem Start (wie im echten Helfer)
  }
  const fehler = micFehler || (m.device && m.device !== 'Test-Mikrofon' ? 'NotFoundError' : null);
  micFehler = null;
  if (fehler) return (out({ ev: 'mic', error: fehler }), out({ ev: 'mic', stopped: true }));
  out({ ev: 'mic', started: true, warm });
  warm = m.warm > 0;
  mikTimer = setInterval(() => {
    const p = new Float32Array(640);
    for (let i = 0; i < p.length; i++, pos = (pos + 1) % ton.length) p[i] = ton[pos];
    out({ ev: 'pcm', b: Buffer.from(p.buffer).toString('base64') });
  }, 40);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.cmd === '__emit') out(m.msg);
  else if (m.cmd === '__setFocus') focus = m.focus;
  else if (m.cmd === '__setPaste') paste = m.paste;
  else if (m.cmd === '__exit') process.exit(1);
  else if (m.cmd === '__micFehler') micFehler = m.name;
  else if (m.cmd === '__micEnde') {
    clearInterval(mikTimer);
    mikTimer = null;
    out({ ev: 'mic', error: 'TrackEndedError' });
    out({ ev: 'mic', stopped: true });
  } else if (m.cmd === 'mic') mikrofon(m);
  else if (silent) return;
  else if (m.cmd === 'focus') out({ id: m.id, focus });
  else if (m.cmd === 'paste') out({ id: m.id, paste });
  else if (m.cmd === 'vollbild') out({ id: m.id, vollbild: false });
  // grab: Bild aus lauter 7en; Breite 13 liefert absichtlich zu wenige Daten
  else if (m.cmd === 'grab') {
    const n = m.w === 13 ? 1 : m.w * m.h * 4;
    out({ id: m.id, grab: { w: m.w, h: m.h, bgra: Buffer.alloc(n, 7).toString('base64') } });
  }
});
