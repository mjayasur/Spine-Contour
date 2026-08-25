const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spineContour', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  predict: (request) => ipcRenderer.invoke('predict', request),
});
