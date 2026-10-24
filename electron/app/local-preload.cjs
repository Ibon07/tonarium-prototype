const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tonariumShell', Object.freeze({
  state: () => ipcRenderer.invoke('shell:state'),
  connect: value => ipcRenderer.invoke('shell:connect', value),
  retry: () => ipcRenderer.invoke('shell:retry'),
  selectSource: id => ipcRenderer.invoke('shell:source', id),
}));
