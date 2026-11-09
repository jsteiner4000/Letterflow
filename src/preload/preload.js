const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('letterflow', {
  info: () => ipcRenderer.invoke('app:info'),
  about: () => ipcRenderer.invoke('app:about'),
  licenses: () => ipcRenderer.invoke('app:licenses'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    groesse: (hoehe) => ipcRenderer.send('settings:groesse', hoehe),
    onChanged: (cb) => {
      // Nur die Daten weiterreichen, nicht das Ereignisobjekt.
      ipcRenderer.on('settings:changed', (_event, settings) => cb(settings));
    },
  },
  setup: {
    plan: () => ipcRenderer.invoke('setup:plan'),
    retry: () => ipcRenderer.invoke('setup:retry'),
    waehlen: (wahl) => ipcRenderer.invoke('setup:waehlen', wahl),
    onPlan: (cb) => ipcRenderer.on('setup:plan', (_event, p) => cb(p)),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_event, p) => cb(p)),
    onError: (cb) => ipcRenderer.on('setup:error', (_event, e) => cb(e)),
  },
  status: {
    get: () => ipcRenderer.invoke('status:get'),
  },
  overlay: {
    ready: () => ipcRenderer.send('overlay:ready'),
    erschienen: (anteil) => ipcRenderer.send('overlay:erschienen', anteil),
    onState: (cb) => ipcRenderer.on('overlay:state', (_event, state) => cb(state)),
    onLevel: (cb) => ipcRenderer.on('overlay:level', (_event, n) => cb(n)),
    onBackdrop: (cb) => ipcRenderer.on('overlay:backdrop', (_event, b) => cb(b)),
    onHide: (cb) => ipcRenderer.on('overlay:hide', () => cb()),
    // Fenster gezeigt bzw. Pille verschwunden: Antwort erst nach zwei gezeichneten Bildern
    onZeigen: (cb) => ipcRenderer.on('overlay:zeigen', () => cb()),
    gezeigt: () => ipcRenderer.send('overlay:gezeigt'),
    weg: () => ipcRenderer.send('overlay:weg'),
  },
});
