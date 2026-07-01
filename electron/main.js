const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const { dialog, ipcMain } = require("electron");
const { escanearFontesDoSistema } = require("./fontScanner");

const isDev = !app.isPackaged;

let mainWindow;
let backend;

// Cache em memória do escaneamento de fontes: escanear o disco inteiro
// de fontes é uma operação relativamente pesada (centenas de arquivos),
// então guardamos o resultado da primeira chamada e reaproveitamos.
// O usuário não costuma instalar/desinstalar fontes com o app aberto,
// mas caso precise forçar atualização, o parâmetro forcarRecarga
// (vindo do renderer) permite re-escanear sob demanda.
let cacheDeFontes = null;

function startBackend() {
    const serverPath = path.join(__dirname, "..", "server", "index.js");

    backend = fork(serverPath, [], {
        silent: false
    });

    backend.on("error", console.error);

    backend.on("exit", (code) => {
        console.log("Servidor finalizado:", code);
    });
}

function createMenu() {

    const template = [

        {
            label: "Arquivo",
            submenu: [
                {
                    role: "reload"
                },
                {
                    type: "separator"
                },
                {
                    role: "quit"
                }
            ]
        },

        {
            label: "Editar",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "copy" },
                { role: "paste" }
            ]
        }

    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


function createWindow() {

    mainWindow = new BrowserWindow({

        width: 1600,
        height: 950,

        title: "Karaoke Caption Studio",

        webPreferences: {

            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false

        }

    });

    if (isDev) {

        mainWindow.loadURL("http://localhost:5173");

    } else {

        mainWindow.loadFile(
            path.join(__dirname, "..", "client", "dist", "index.html")
        );

    }
}

app.whenReady().then(() => {

    startBackend();

    createMenu();

    createWindow();

});

ipcMain.handle("dialog:openVideo", async () => {

    const { canceled, filePaths } = await dialog.showOpenDialog({

        title: "Selecionar vídeo",

        filters: [

            {
                name: "Vídeos",
                extensions: ["mp4", "mov", "avi", "mkv"]
            }

        ],

        properties: ["openFile"]

    });

    if (canceled) return null;

    return filePaths[0];

});

ipcMain.handle("dialog:openSrt", async () => {

    const { canceled, filePaths } = await dialog.showOpenDialog({

        title: "Selecionar legenda",

        filters: [

            {
                name: "Legendas",
                extensions: ["srt"]
            }

        ],

        properties: ["openFile"]

    });

    if (canceled) return null;

    return filePaths[0];

});

// Retorna a lista de famílias de fontes instaladas no sistema, cada uma
// com os estilos (peso + itálico) que realmente existem nos arquivos
// encontrados no disco. Roda em processo separado do fork do backend
// porque é uma operação de I/O síncrona (fs.readdirSync recursivo +
// parsing binário) — mantê-la aqui no main evita travar o processo do
// servidor Express, mas ainda assim pode segurar o event loop do main
// brevemente na primeira chamada.
ipcMain.handle("fonts:list", async (_event, forcarRecarga) => {

    if (cacheDeFontes && !forcarRecarga) {
        return cacheDeFontes;
    }

    try {
        cacheDeFontes = escanearFontesDoSistema();
        return cacheDeFontes;
    } catch (err) {
        console.error("Falha ao escanear fontes do sistema:", err);
        return [];
    }

});

app.on("window-all-closed", () => {

    if (backend)
        backend.kill();

    app.quit();

});