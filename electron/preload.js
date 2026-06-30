const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    openVideo: () => ipcRenderer.invoke("dialog:openVideo"),

    openSrt: () => ipcRenderer.invoke("dialog:openSrt"),

});