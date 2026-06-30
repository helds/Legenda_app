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

app.on("window-all-closed", () => {

    if (backend)
        backend.kill();

    app.quit();

});