import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('builderAPI', {
  listPlugins: (dshDir) => ipcRenderer.invoke('builder:listPlugins', dshDir),
  build: (opts) => ipcRenderer.invoke('builder:build', opts),
  getDshVersion: (dshDir) => ipcRenderer.invoke('builder:dsh-version', dshDir),
})
