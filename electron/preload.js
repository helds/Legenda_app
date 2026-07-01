const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    openVideo: () => ipcRenderer.invoke("dialog:openVideo"),

    openSrt: () => ipcRenderer.invoke("dialog:openSrt"),

    // Retorna as fontes instaladas no sistema, cada uma já com os
    // estilos (peso/itálico) que de fato existem nos arquivos
    // encontrados — usado pelo PainelPropriedades para popular o
    // seletor de fonte e filtrar os estilos disponíveis por família.
    // Passe true para forçar um novo escaneamento do disco (ignorando
    // o cache do processo main), útil se o usuário instalar uma fonte
    // nova sem reiniciar o app.
    listarFontes: (forcarRecarga = false) =>
        ipcRenderer.invoke("fonts:list", forcarRecarga),

});
