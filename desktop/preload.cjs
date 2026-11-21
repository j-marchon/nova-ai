/* What Nova's page may ask of the desktop app: start Nova Bridge (its own
   program, in its own window) and tell it which skin Nova wears. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("novaDesktop", {
  platform: process.platform,
  startBridge: () => ipcRenderer.invoke("nova:start-bridge"),
  setSkin: (id) => ipcRenderer.invoke("nova:skin", String(id || "nova")),
});
