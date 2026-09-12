const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("solseerDesktop", {
  request: (message) => ipcRenderer.invoke("solseer:request", message),
  exportHistory: () => ipcRenderer.invoke("solseer:export-history"),
  onSnapshot: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("solseer:snapshot", listener);
    return () => ipcRenderer.removeListener("solseer:snapshot", listener);
  },
});
