const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    openVideo: () => ipcRenderer.invoke("dialog:openVideo"),

    openSrt: () => ipcRenderer.invoke("dialog:openSrt"),

    // Retorna um array de nomes de fontes instaladas no sistema
    // operacional. Usado pelo PainelPropriedades para popular o seletor
    // de fonte. Veja o handler "sistema:listarFontes" em main.js.
    listarFontes: () => ipcRenderer.invoke("sistema:listarFontes"),

});
