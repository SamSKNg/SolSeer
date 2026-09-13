const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("solseerDesktop", {
  request: (message) => ipcRenderer.invoke("solseer:request", message),
  exportHistory: () => ipcRenderer.invoke("solseer:export-history"),
  updates: (action) => ipcRenderer.invoke("solseer:updates", action),
  onUpdateStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("solseer:update-status", listener);
    return () => ipcRenderer.removeListener("solseer:update-status", listener);
  },
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("solseer:snapshot", listener);
    return () => ipcRenderer.removeListener("solseer:snapshot", listener);
  },
});
