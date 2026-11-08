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
});
