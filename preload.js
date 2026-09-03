const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('spineContour', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  predict: (request) => ipcRenderer.invoke('predict', request),
  measure: (geometry) => ipcRenderer.invoke('measure', geometry),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveCsv: (request) => ipcRenderer.invoke('save-csv', request),
  loadStudies: () => ipcRenderer.invoke('load-studies'),
  saveStudies: (studies) => ipcRenderer.invoke('save-studies', studies),
  loadPrediction: (id) => ipcRenderer.invoke('load-prediction', id),
  savePrediction: (id, response) => ipcRenderer.invoke('save-prediction', id, response),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  // Electron >= 32 removed File.path; this is the sanctioned replacement, and File objects
  // cross the context bridge. Used by the Studies dropzone so a dropped film keeps a real path.
  pathForFile: (file) => webUtils.getPathForFile(file),
});
