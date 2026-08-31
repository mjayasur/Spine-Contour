const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spineContour', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  predict: (request) => ipcRenderer.invoke('predict', request),
  measure: (geometry) => ipcRenderer.invoke('measure', geometry),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
