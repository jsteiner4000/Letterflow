// Aufnahme des Testsatzes: npx electron scripts/record-testset.js
// Leertaste halten = aufnehmen, Pfeiltasten = blättern. Schreibt testdata/stimme/<id>.wav (16 kHz mono).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { encodeWav } = require('../src/main/wav');

const root = path.join(__dirname, '..');
const satz = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'testset.json'), 'utf8'));
const ziel = path.join(root, 'testdata', 'stimme');
fs.mkdirSync(ziel, { recursive: true });
const url = (p) => pathToFileURL(path.join(root, p)).href;

const html = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Testsatz aufnehmen</title>
<link rel="stylesheet" href="${url('src/renderer/style.css')}">
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:32px;box-sizing:border-box;text-align:center;gap:16px;font-family:Inter,sans-serif}
#n,#h{color:var(--ink-2)}#s{font-size:32px;line-height:1.3;max-width:900px}#st{height:24px;color:var(--accent)}.rec #s{color:#b42318}</style>
<body><div id="n"></div><div id="s"></div><div id="h"></div><div id="st"></div>
<script>
const { ipcRenderer } = require('electron');
const satz = ${JSON.stringify(satz)};
let i = 0, ctx, node, pakete = [], laeuft = false;
const $ = (id) => document.getElementById(id);
function zeigen() {
  if (i >= satz.length) { $('n').textContent = ''; $('s').textContent = 'Fertig. Danke!'; $('h').textContent = '← zurück zum Wiederholen'; return; }
  $('n').textContent = 'Satz ' + (i + 1) + ' / ' + satz.length;
  $('s').textContent = satz[i].sprich;
  $('h').textContent = 'Leertaste halten, Satz sprechen, loslassen · ← / → blättern';
}
async function init() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('${url('src/renderer/recorder-worklet.js')}');
  node = new AudioWorkletNode(ctx, 'recorder');
  node.port.onmessage = (m) => { if (laeuft && m.data instanceof Float32Array) pakete.push(m.data); };
  ctx.createMediaStreamSource(stream).connect(node);
  zeigen();
}
addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (laeuft) return;
  if (e.code === 'Space' && !e.repeat && i < satz.length) { laeuft = true; pakete = []; document.body.classList.add('rec'); $('st').textContent = 'Aufnahme …'; }
  else if (e.code === 'ArrowRight' && i < satz.length) { i++; $('st').textContent = ''; zeigen(); }
  else if (e.code === 'ArrowLeft' && i > 0) { i--; $('st').textContent = ''; zeigen(); }
});
addEventListener('keyup', async (e) => {
  if (e.code !== 'Space' || !laeuft) return;
  document.body.classList.remove('rec');
  // Rest des Puffers abholen, dann erst die Aufnahme beenden.
  await new Promise((r) => {
    const alt = node.port.onmessage;
    node.port.onmessage = (m) => { if (m.data === 'flushed') { node.port.onmessage = alt; r(); } else alt(m); };
    node.port.postMessage('flush');
  });
  laeuft = false;
  const n = pakete.reduce((a, p) => a + p.length, 0);
  if (n < 8000) { $('st').textContent = 'Zu kurz, nochmal.'; return; }
  const alles = new Float32Array(n); let o = 0; for (const p of pakete) { alles.set(p, o); o += p.length; }
  await ipcRenderer.invoke('speichern', satz[i].id, alles);
  $('st').textContent = 'gespeichert'; i++; zeigen();
});
init().catch((e) => { $('s').textContent = 'Mikrofon nicht verfügbar: ' + e.message; });
</script></body></html>`;

ipcMain.handle('speichern', (_e, id, samples) => {
  if (!/^\d\d$/.test(id)) throw new Error('Ungültige Nummer');
  fs.writeFileSync(path.join(ziel, `${id}.wav`), encodeWav(samples, 16000));
});

app.whenReady().then(() => {
  app.on('web-contents-created', (_e, wc) =>
    wc.session.setPermissionRequestHandler((_w, _p, cb) => cb(true)),
  );
  const win = new BrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setMenuBarVisibility(false);
  const datei = path.join(app.getPath('temp'), 'letterflow-aufnahme.html');
  fs.writeFileSync(datei, html);
  win.loadFile(datei);
  if (process.env.LF_AUTOCLOSE) setTimeout(() => app.quit(), Number(process.env.LF_AUTOCLOSE));
});
app.on('window-all-closed', () => app.quit());
