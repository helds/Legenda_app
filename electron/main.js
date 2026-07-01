const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const { dialog, ipcMain } = require("electron");

const isDev = !app.isPackaged;

let mainWindow;
let backend;

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

// Lista as fontes instaladas no sistema operacional do usuário (Windows,
// macOS, Linux), usada pelo seletor de fonte na interface para oferecer
// mais opções além das fontes web-safe embutidas. A lib font-list é
// carregada de forma "lazy" (require dentro do handler) para não atrasar
// a inicialização do app caso o módulo nativo demore para carregar, e
// para isolar falhas: se a lib não estiver instalada/buildada para a
// plataforma atual, devolvemos uma lista vazia e o frontend cai para o
// fallback fixo em vez de quebrar o app inteiro.
ipcMain.handle("sistema:listarFontes", async () => {

    try {

        const fontList = require("font-list");
        const fontes = await fontList.getFonts({ disableQuoting: true });

        // Remove duplicatas e ordena alfabeticamente.
        const unicas = Array.from(new Set(fontes)).sort((a, b) =>
            a.localeCompare(b, "pt-BR")
        );

        return unicas;

    } catch (err) {

        console.error("Falha ao listar fontes do sistema:", err);
        return [];

    }

});

app.on("window-all-closed", () => {

    if (backend)
        backend.kill();

    app.quit();

});
