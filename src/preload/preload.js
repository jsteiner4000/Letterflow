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
  status: {
    get: () => ipcRenderer.invoke('status:get'),
  },
});
