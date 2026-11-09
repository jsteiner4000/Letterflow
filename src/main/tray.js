const { app, Menu, Tray, nativeImage, nativeTheme } = require('electron');
const path = require('node:path');
const windows = require('./windows');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const HINWEIS_MS = 4000;
// Tooltip und Symbolname je Zustand (Name: hell = helle Taskleiste; „bereit“ heißt nach der Zeichenfarbe).
const ZUSTAENDE = {
  bereit: { tooltip: 'Letterflow – bereit', hell: 'tray-dunkel', dunkel: 'tray-hell' },
  hoert: { tooltip: 'Letterflow – hört zu', hell: 'tray-hoert-hell', dunkel: 'tray-hoert-dunkel' },
  hinweis: {
    tooltip: 'Letterflow – Hinweis',
    hell: 'tray-hinweis-hell',
    dunkel: 'tray-hinweis-dunkel',
  },
};

let state = 'bereit';
let hinweisTimer = null;
let tray = null;

function render() {
  const z = ZUSTAENDE[state];
  const name = z[nativeTheme.shouldUseDarkColors ? 'dunkel' : 'hell'];
  tray.setImage(nativeImage.createFromPath(path.join(ASSETS, `${name}.ico`)));
  tray.setToolTip(z.tooltip);
}

// 'bereit' | 'hoert' | 'hinweis' (fällt nach 4 s auf 'bereit' zurück)
function setState(neu) {
  clearTimeout(hinweisTimer);
  state = neu;
  if (neu === 'hinweis') hinweisTimer = setTimeout(() => setState('bereit'), HINWEIS_MS);
  if (tray) render();
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  render();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Einstellungen', click: () => windows.openSettings() },
      { label: 'Über Letterflow', click: () => windows.openAbout() },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]),
  );
  nativeTheme.on('updated', render);
  return tray;
}

module.exports = { createTray, setState, tooltip: () => ZUSTAENDE[state].tooltip };
