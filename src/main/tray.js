const { app, Menu, Tray, nativeImage, nativeTheme } = require('electron');
const path = require('node:path');
const windows = require('./windows');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const TOOLTIP = 'Letterflow';

// Helles Symbol (weiß) für dunkle Taskleiste, dunkles Symbol für helle Taskleiste.
function trayIcon() {
  const name = nativeTheme.shouldUseDarkColors ? 'tray-hell.ico' : 'tray-dunkel.ico';
  return nativeImage.createFromPath(path.join(ASSETS, name));
}

function createTray() {
  const tray = new Tray(trayIcon());
  tray.setToolTip(TOOLTIP);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Einstellungen', click: () => windows.openSettings() },
      { label: 'Über Letterflow', click: () => windows.openAbout() },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]),
  );
  nativeTheme.on('updated', () => tray.setImage(trayIcon()));
  return tray;
}

module.exports = { createTray, TOOLTIP };
