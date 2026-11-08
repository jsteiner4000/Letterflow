const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('letterflow', {
  info: () => ipcRenderer.invoke('app:info'),
});
