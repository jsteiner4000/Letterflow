const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('letterflow', {
  info: () => ipcRenderer.invoke('app:info'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChanged: (cb) => {
      // Nur die Daten weiterreichen, nicht das Ereignisobjekt.
      ipcRenderer.on('settings:changed', (_event, settings) => cb(settings));
    },
  },
  setup: {
    plan: () => ipcRenderer.invoke('setup:plan'),
    retry: () => ipcRenderer.invoke('setup:retry'),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_event, p) => cb(p)),
    onError: (cb) => ipcRenderer.on('setup:error', (_event, e) => cb(e)),
  },
  status: {
    get: () => ipcRenderer.invoke('status:get'),
  },
  overlay: {
    ready: () => ipcRenderer.send('overlay:ready'),
    onState: (cb) => ipcRenderer.on('overlay:state', (_event, state) => cb(state)),
    onLevel: (cb) => ipcRenderer.on('overlay:level', (_event, n) => cb(n)),
    onHide: (cb) => ipcRenderer.on('overlay:hide', () => cb()),
    onRecordStart: (cb) => ipcRenderer.on('overlay:record-start', (_event, id) => cb(id)),
    onRecordStop: (cb) => ipcRenderer.on('overlay:record-stop', () => cb()),
    pcm: (daten) => ipcRenderer.send('overlay:pcm', daten),
    started: () => ipcRenderer.send('overlay:started'),
    stopped: () => ipcRenderer.send('overlay:stopped'),
    recorderError: (fehler) => ipcRenderer.send('overlay:recorder-error', fehler),
  },
});
