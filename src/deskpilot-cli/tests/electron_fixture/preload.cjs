const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixture', { state: value => ipcRenderer.send('fixture-state', value) });
