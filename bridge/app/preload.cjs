const { contextBridge, ipcRenderer } = require("electron");
const call = (name) => (...a) => ipcRenderer.invoke(name, ...a);
contextBridge.exposeInMainWorld("bridge", {
  info: call("info"), start: call("start"), stop: call("stop"),
  signin: call("signin"), signout: call("signout"), device: call("device"),
  window: call("window"), autostart: call("autostart"), closeConfirmed: call("close-confirmed"),
  onConfirmClose: (callback) => { ipcRenderer.on("confirm-close", (_event, info) => callback(info)); },
});
