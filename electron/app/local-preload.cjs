const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tonariumShell', Object.freeze({
  audioList: () => ipcRenderer.invoke('shell:audio-list'),
  audioApply: value => ipcRenderer.invoke('shell:audio-apply', value),
  audioPermit: () => ipcRenderer.invoke('shell:audio-permit'),
  state: () => ipcRenderer.invoke('shell:state'),
  connect: value => ipcRenderer.invoke('shell:connect', value),
  retry: () => ipcRenderer.invoke('shell:retry'),
  selectSource: id => ipcRenderer.invoke('shell:source', id),
}));
