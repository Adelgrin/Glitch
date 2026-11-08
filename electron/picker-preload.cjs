// Ponte mínima entre o seletor de tela (picker.html) e o processo principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("glitchPicker", {
  get: () => ipcRenderer.invoke("picker:get"),
  choose: (id, audio) => ipcRenderer.send("picker:choose", { id, audio }),
  cancel: () => ipcRenderer.send("picker:choose", null),
});
