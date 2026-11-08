// Handprüfung des nativen Helfers: startet die Exe, gibt alle Ereignisse aus und nimmt Befehle von stdin.
// Befehle: focus | paste <hwnd> | mask on | mask off | quit
// Aufruf: node scripts/helper-probe.js [pfad-zur-exe]
const path = require('node:path');
const readline = require('node:readline');
const { Helper } = require('../src/main/helper');

const exe = process.argv[2] || path.join(__dirname, '..', 'resources', 'bin', 'letterflow-helper.exe');
const h = new Helper();
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// Rohnachrichten mitschneiden (vor der Tastenlogik)
const origLine = h._onLine.bind(h);
h._onLine = (l) => {
  log('<-', l);
  origLine(l);
};
for (const n of ['ready', 'hotkey-down', 'hotkey-up', 'hotkey-cancel']) h.on(n, () => log('Ereignis:', n));

h.start(exe);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const [cmd, arg] = line.trim().split(/\s+/);
  if (cmd === 'focus') log('focus ->', JSON.stringify(await h.focus()));
  else if (cmd === 'paste') log('paste ->', JSON.stringify(await h.paste(Number(arg))));
  else if (cmd === 'mask') {
    h.setMask(arg === 'on');
    log('mask', arg === 'on' ? 'an' : 'aus');
  } else if (cmd === 'quit') {
    h.stop();
    process.exit(0);
  } else log('unbekannt:', line);
});
