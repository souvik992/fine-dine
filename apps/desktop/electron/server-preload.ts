// The DinePOS Server window's only bridge to the main process (it stays sandboxed): status and the server buttons.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dineposServer', {
  snapshot: () => ipcRenderer.invoke('server:snapshot'),
  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openData: () => ipcRenderer.invoke('server:open-data'),
  openLogs: () => ipcRenderer.invoke('server:open-logs'),
  openTerminal: () => ipcRenderer.invoke('server:open-terminal'),
  quit: () => ipcRenderer.invoke('server:quit'),
});
