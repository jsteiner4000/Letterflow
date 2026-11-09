// Erzeugt die Zustands-Symbole der Taskleiste (assets/tray-{hoert,hinweis}-{hell,dunkel}.ico).
// Aufruf: npx electron scripts/make-tray-icons.js   (Logo-Strich aus branding/symbol-klein.svg)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 20, 24, 32];
// hell = helle Taskleiste (satte Fläche, weißes Zeichen); dunkel = dunkle Taskleiste (helle Fläche, dunkles Zeichen).
const FARBEN = {
  'hoert-hell': ['#0F766E', '#FFFFFF'],
  'hoert-dunkel': ['#5EEAD4', '#04201C'],
  'hinweis-hell': ['#C2410C', '#FFFFFF'],
  'hinweis-dunkel': ['#FDBA74', '#04201C'],
};
const STRICH = fs.readFileSync(path.join(ROOT, 'branding', 'symbol-klein.svg'), 'utf8').match(/ d="([^"]+)"/)[1];

const svg = (flaeche, zeichen) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%">` +
  `<rect width="256" height="256" rx="56" fill="${flaeche}"/>` +
  `<g transform="translate(128 128) scale(.72) translate(-129 -120)"><path fill="none" stroke="${zeichen}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" d="${STRICH}"/></g></svg>`;

// PNG-in-ICO: Kopf, Verzeichnis, dann die PNG-Daten.
function ico(pngs) {
  const kopf = Buffer.alloc(6 + 16 * pngs.length);
  kopf.writeUInt16LE(1, 2);
  kopf.writeUInt16LE(pngs.length, 4);
  let offset = kopf.length;
  pngs.forEach(({ size, png }, i) => {
    const p = 6 + 16 * i;
    kopf[p] = kopf[p + 1] = size;
    kopf.writeUInt16LE(1, p + 4);
    kopf.writeUInt16LE(32, p + 6);
    kopf.writeUInt32LE(png.length, p + 8);
    kopf.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  return Buffer.concat([kopf, ...pngs.map((p) => p.png)]);
}

async function render(win, quelle, size) {
  win.setContentSize(size, size);
  await win.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden">${quelle}</body>`),
  );
  await new Promise((r) => setTimeout(r, 150));
  return (await win.webContents.capturePage()).resize({ width: size, height: size, quality: 'best' }).toPNG();
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  for (const [name, [flaeche, zeichen]] of Object.entries(FARBEN)) {
    const pngs = [];
    for (const size of SIZES) pngs.push({ size, png: await render(win, svg(flaeche, zeichen), size) });
    fs.writeFileSync(path.join(ROOT, 'assets', `tray-${name}.ico`), ico(pngs));
  }
  // Vorschau: alle sechs Symbole bei 16 und 32 px (Screenshot nach docs/design/ist/).
  const bild = (n, px) =>
    `<img src="data:image/x-icon;base64,${fs.readFileSync(path.join(ROOT, 'assets', `tray-${n}.ico`)).toString('base64')}" width="${px}" height="${px}" style="margin:8px">`;
  // „bereit“ heißt nach der Zeichenfarbe: tray-dunkel.ico gehört auf die helle Taskleiste.
  const reihe = (modus, bg, px) =>
    `<div style="background:${bg};padding:8px;display:flex">` +
    [modus === 'hell' ? 'dunkel' : 'hell', `hoert-${modus}`, `hinweis-${modus}`].map((n) => bild(n, px)).join('') +
    '</div>';
  const html = `<body style="margin:0;display:grid;grid-template-columns:auto auto;width:max-content">${[16, 32]
    .map((px) => reihe('hell', '#F3F3F3', px) + reihe('dunkel', '#202020', px))
    .join('')}</body>`;
  const vorschau = new BrowserWindow({ show: false, width: 400, height: 140, webPreferences: { offscreen: true } });
  await vorschau.loadURL('data:text/html,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const out = path.join(ROOT, 'docs', 'design', 'ist', 'tray-symbole.png');
  fs.writeFileSync(out, (await vorschau.webContents.capturePage()).toPNG());
  app.quit();
});
