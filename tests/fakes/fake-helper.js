// Ersatz für letterflow-helper.exe: gleiches Protokoll, steuerbar über stdin.
// Zusatzbefehle: {"cmd":"__emit","msg":{...}}, {"cmd":"__setFocus","focus":{...}},
// {"cmd":"__setPaste","paste":{...}}, {"cmd":"__exit"}.
// Mit FAKE_HELPER_SILENT=1 werden id-Anfragen nicht beantwortet.
const readline = require('node:readline');

let focus = { hwnd: 42, editable: 'no', elevated: false };
let paste = { ok: true, reason: null };
const silent = process.env.FAKE_HELPER_SILENT === '1';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

// FAKE_HELPER_DIE=1: beendet sich sofort, ohne bereit zu melden (Hook-Installation fehlgeschlagen)
if (process.env.FAKE_HELPER_DIE === '1') process.exit(2);

out({ ev: 'ready' });

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
  else if (silent) return;
  else if (m.cmd === 'focus') out({ id: m.id, focus });
  else if (m.cmd === 'paste') out({ id: m.id, paste });
});
