/* What Nova's page may ask of the desktop app: start Nova Bridge (its own
   program, in its own window), tell it and the title bar which skin and
   scheme Nova wears, and which icon the app wears. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("novaDesktop", {
  platform: process.platform,
  startBridge: () => ipcRenderer.invoke("nova:start-bridge"),
  setSkin: (id) => ipcRenderer.invoke("nova:skin", String(id || "nova")),
  setScheme: (scheme) => ipcRenderer.invoke("nova:scheme", String(scheme || "dark")),
  setIcon: (id) => ipcRenderer.invoke("nova:icon", String(id || "nova")),
  /* downloads and installs the newest release, then restarts (main.cjs); onProgress gets 0-100 */
  update: (onProgress) => {
    const progress = (_, percent) => { if (typeof onProgress === "function") onProgress(Number(percent) || 0); };
    ipcRenderer.on("nova:update-progress", progress);
    return ipcRenderer.invoke("nova:update").finally(() => ipcRenderer.removeListener("nova:update-progress", progress));
  },
});
