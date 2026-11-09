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
  },
  recorder: {
    ready: () => ipcRenderer.send('recorder:ready'),
    onStart: (cb) => ipcRenderer.on('recorder:start', (_event, o) => cb(o)),
    onStop: (cb) => ipcRenderer.on('recorder:stop', () => cb()),
    pcm: (daten) => ipcRenderer.send('recorder:pcm', daten),
    started: (warm) => ipcRenderer.send('recorder:started', warm),
    stopped: () => ipcRenderer.send('recorder:stopped'),
    error: (fehler) => ipcRenderer.send('recorder:error', fehler),
  },
});
