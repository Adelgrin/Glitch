/**
 * Glitch — processo principal do Electron.
 *
 * O app web (pasta dist/) é servido pelo protocolo próprio app://glitch/ em vez de file://:
 * assim caminhos absolutos ("/icon-192.png"), o WASM da criptografia, IndexedDB, microfone
 * (contexto seguro) e o retorno do login SSO funcionam como no navegador.
 */
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "app";
const HOST = "glitch";
const APP_URL = `${SCHEME}://${HOST}/`;
const DEV = process.argv.includes("--dev");
const DEV_URL = "http://localhost:5173/";
const DIST = path.join(__dirname, "..", "dist");
const ICON = path.join(__dirname, "icon.png");
const IS_WAYLAND =
  process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

// Linux: captura de tela pelo PipeWire (necessário no Wayland) e Wayland nativo quando disponível
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

// Precisa vir antes do app ficar pronto
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

app.setAppUserModelId("app.glitch.desktop");

// Uma instância só: abrir de novo traz a janela existente para a frente
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response("Not found", { status: 404 });
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) return new Response("Forbidden", { status: 403 });
    try {
      const st = await fs.promises.stat(file);
      if (st.isDirectory()) file = path.join(DIST, "index.html");
    } catch {
      // Rotas do app (ex.: retorno do SSO) caem no index.html
      file = path.join(DIST, "index.html");
    }
    const data = await fs.promises.readFile(file);
    return new Response(data, {
      headers: { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Permissões (microfone, câmera, tela, notificações)                  */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set([
  "media",
  "display-capture",
  "notifications",
  "fullscreen",
  "clipboard-read",
  "clipboard-sanitized-write",
  "speaker-selection",
]);

function isAppOrigin(origin) {
  return !!origin && (origin.startsWith(`${SCHEME}://${HOST}`) || (DEV && origin.startsWith("http://localhost:5173")));
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED.has(permission) && isAppOrigin(details.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED.has(permission) && isAppOrigin(origin));
  // Dispositivos (escolher microfone/câmera) sem perguntar de novo
  ses.setDevicePermissionHandler(() => true);

  // Compartilhamento de tela: o Electron não tem seletor próprio no Windows, usamos o nosso
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const choice = await pickSource(request.audioRequested);
      if (!choice) return callback({});
      callback({
        video: choice.source,
        ...(choice.audio && process.platform === "win32" ? { audio: "loopback" } : {}),
      });
    } catch (e) {
      console.error("Falha no seletor de tela", e);
      callback({});
    }
  });
}

/* ------------------------------------------------------------------ */
/* Seletor de tela/janela                                              */
/* ------------------------------------------------------------------ */

let pickerWindow = null;

async function pickSource(audioRequested) {
  // Já há um seletor aberto: traz para frente e recusa o pedido repetido
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus();
    return null;
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 400, height: 225 },
    fetchWindowIcons: true,
  });
  // Linux com Wayland: o sistema (portal do PipeWire) já mostrou o seletor dele e
  // devolve só a fonte escolhida — não abrimos um segundo seletor.
  if (IS_WAYLAND) return sources[0] ? { source: sources[0], audio: false } : null;
  const ownId = mainWindow?.getMediaSourceId?.();
  const list = sources
    .filter((s) => s.id !== ownId)
    .map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith("screen:"),
      thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler("picker:get");
      ipcMain.removeAllListeners("picker:choose");
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
      pickerWindow = null;
      resolve(value);
    };
    ipcMain.handle("picker:get", () => ({ sources: list, audioRequested, canShareAudio: process.platform === "win32" }));
    ipcMain.on("picker:choose", (_e, payload) => {
      if (!payload) return finish(null);
      const source = sources.find((s) => s.id === payload.id);
      finish(source ? { source, audio: !!payload.audio } : null);
    });

    pickerWindow = new BrowserWindow({
      parent: mainWindow ?? undefined,
      modal: true,
      width: 820,
      height: 600,
      minWidth: 560,
      minHeight: 420,
      title: "Compartilhar tela — Glitch",
      backgroundColor: "#111214",
      icon: ICON,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    pickerWindow.setMenu(null);
    pickerWindow.once("ready-to-show", () => pickerWindow?.show());
    pickerWindow.on("closed", () => finish(null));
    pickerWindow.loadFile(path.join(__dirname, "picker.html"));
  });
}

/* ------------------------------------------------------------------ */
/* Janela principal                                                    */
/* ------------------------------------------------------------------ */

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 560,
    title: "Glitch",
    backgroundColor: "#000000",
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Links (target=_blank) abrem no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith("mailto:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Navegação na própria janela: só o app e páginas web (login SSO); o resto vai para o sistema
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL) || /^https?:\/\//i.test(url)) return;
    event.preventDefault();
  });

  // Atalhos (a janela não tem menu)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const wc = mainWindow.webContents;
    const key = input.key.toLowerCase();
    if ((ctrl && input.shift && key === "i") || input.key === "F12") {
      wc.toggleDevTools();
      event.preventDefault();
    } else if ((ctrl && key === "r") || input.key === "F5") {
      wc.reload();
      event.preventDefault();
    } else if (ctrl && (key === "=" || key === "+")) {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
      event.preventDefault();
    } else if (ctrl && key === "-") {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
      event.preventDefault();
    } else if (ctrl && key === "0") {
      wc.setZoomLevel(0);
      event.preventDefault();
    } else if (input.key === "F11") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  // Menu de contexto básico (copiar/colar e correção ortográfica)
  mainWindow.webContents.on("context-menu", (_e, params) => {
    const items = [];
    for (const s of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: s, click: () => mainWindow.webContents.replaceMisspelling(s) });
    }
    if (params.misspelledWord) {
      items.push(
        { label: "Adicionar ao dicionário", click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: "separator" },
      );
    }
    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      items.push({ label: "Abrir link no navegador", click: () => shell.openExternal(params.linkURL) }, { type: "separator" });
    }
    if (params.isEditable) items.push({ role: "cut", label: "Recortar" }, { role: "copy", label: "Copiar" }, { role: "paste", label: "Colar" }, { role: "selectAll", label: "Selecionar tudo" });
    else if (params.selectionText) items.push({ role: "copy", label: "Copiar" });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(DEV ? DEV_URL : APP_URL);
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  serveDist();
  setupPermissions();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
