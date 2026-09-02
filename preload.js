const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spineContour', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  predict: (request) => ipcRenderer.invoke('predict', request),
  onPredictionProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('prediction-progress', listener);
    return () => ipcRenderer.removeListener('prediction-progress', listener);
  },
  measure: (geometry) => ipcRenderer.invoke('measure', geometry),
});
