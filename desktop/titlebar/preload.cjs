/* What the title bar may ask of the desktop app: its three window buttons. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("novaBar", {
  window: (action) => ipcRenderer.invoke("nova:bar", String(action)),
  onLook: (callback) => { ipcRenderer.on("nova:look", (_event, look) => callback(look)); },
});
