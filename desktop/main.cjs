/* Nova for the desktop.

   Nova's web build is served from this computer only (127.0.0.1) on a fixed
   port, so its saved library stays at the same address every launch.

   Nova Bridge ships inside the same program but always runs on its own: Start
   Bridge (Settings → Providers → Nova Bridge, or the Bridge menu) starts this
   program again with --nova-bridge, a separate process with its own window,
   data folder and single-instance lock, shared with bridgeStart.sh. So there
   is only ever one Bridge on the computer, it keeps running when Nova closes,
   and Nova talks to it like any other device (approved as it asks, being on
   this computer). Nova tells it which skin it wears, so the two match.

   Development: npm run build, then npm run desktop. Packaged builds are made
   by desktop/build-desktop.mjs. */

const { app, BrowserWindow, WebContentsView, Menu, dialog, shell, nativeTheme, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

/* the packaged layout keeps everything beside this file; a checkout has it one level up */
const packed = fs.existsSync(path.join(__dirname, "bridge-app"));
const ROOT = packed ? __dirname : path.join(__dirname, "..");
const BRIDGE_FLAG = "--nova-bridge";
const bridgeMode = process.argv.includes(BRIDGE_FLAG);
if (!bridgeMode) app.setName("Nova");
/* Windows: the id the Start-menu entry carries (appId in build-desktop.mjs), so the taskbar
   shows Nova's icon and groups with it; the Bridge, its own program, gets its own */
if (process.platform === "win32") app.setAppUserModelId(bridgeMode ? "com.nova.roleplay.desktop.bridge" : "com.nova.roleplay.desktop");
/* Read aloud: Chromium on Linux speaks only through speech-dispatcher, and only
   when asked to (otherwise speechSynthesis has no voices and speak() fails with
   "synthesis-failed"). Needs speech-dispatcher and a voice such as espeak-ng. */
if (process.platform === "linux") app.commandLine.appendSwitch("enable-speech-dispatcher");
const NOVA_DIR = packed ? path.join(__dirname, "nova") : path.join(ROOT, "dist");
const ICON = path.join(NOVA_DIR, "icon-512.png");
const PORT = Number(process.env.NOVA_DESKTOP_PORT) || 47615;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/* Windows: no system title bar. The window is frameless (Windows 11 rounds
   its corners); Nova's page fills it, and Nova's own bar (titlebar/), like
   the Bridge window's, lies over its top on a clear background, so Nova's
   background shows through it. The page keeps that strip free as it does a
   phone's status bar (--safe-area-inset-top). */
const OWN_BAR = process.platform === "win32";
const BAR_HEIGHT = 40;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
};

/* The web release's policy, with plain-HTTP model servers on the home network allowed. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'self' https: http: ws: wss:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

function serveNova() {
  const root = path.resolve(NOVA_DIR);
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    /* only Nova's own pages, never another site's requests */
    const host = req.headers.host;
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.writeHead(421).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname); } catch { res.writeHead(400).end(); return; }
    let file = path.resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let stat = null;
    try { stat = fs.statSync(file); } catch {}
    if (!stat || stat.isDirectory()) {
      if (stat?.isDirectory() && fs.existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
      else if (!path.extname(pathname)) file = path.join(root, "index.html");   /* app routes */
      else { res.writeHead(404).end(); return; }
    }
    let body;
    try { body = fs.readFileSync(file); } catch { res.writeHead(404).end(); return; }
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

/* ---------- Nova Bridge, as its own process ---------- */

const BRIDGE_HOME = () => path.join(app.getPath("appData"), "nova-bridge-app");

/* The portable .exe unpacks all of Nova into a new Temp folder every time it
   starts (and deletes it when Nova closes), so starting the .exe again for
   the Bridge took as long as that unpacking, each time. Instead Nova keeps
   one copy of its unpacked files in %LOCALAPPDATA%\Nova\portable, made in
   the background once per build, and the Bridge starts from there at once.
   Resolves that copy's Nova.exe, or null when it cannot be made. */
let portableCopy = null;
function portableBridgeExe() {
  if (!process.env.PORTABLE_EXECUTABLE_FILE || process.platform !== "win32" || !app.isPackaged) return Promise.resolve(null);
  portableCopy ??= (async () => {
    /* original-fs: the app's archive (app.asar) is copied as a file, not opened as a folder */
    const ofs = require("original-fs");
    const from = path.dirname(process.execPath);
    const archive = ofs.statSync(path.join(from, "resources", "app.asar"));
    const root = path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "Nova", "portable");
    const name = `${app.getVersion()}-${archive.size}-${Math.round(archive.mtimeMs)}`;
    const dir = path.join(root, name);
    const exe = path.join(dir, path.basename(process.execPath));
    if (ofs.existsSync(path.join(dir, ".complete")) && ofs.existsSync(exe)) return exe;
    const partial = `${dir}.partial-${process.pid}`;
    await ofs.promises.rm(partial, { recursive: true, force: true });
    await ofs.promises.cp(from, partial, { recursive: true });
    ofs.writeFileSync(path.join(partial, ".complete"), "");
    await ofs.promises.rm(dir, { recursive: true, force: true });
    await ofs.promises.rename(partial, dir);
    /* older builds' copies. One a Bridge still runs from cannot be renamed
       (its files are in use), so it stays, whole, until a later start;
       an unfinished copy (Nova closed while copying) goes too. */
    for (const old of ofs.readdirSync(root)) {
      if (old === name) continue;
      const gone = path.join(root, `${old}.partial-old-${process.pid}`);
      try { await ofs.promises.rename(path.join(root, old), gone); } catch { continue; }
      await ofs.promises.rm(gone, { recursive: true, force: true }).catch(() => {});
    }
    return exe;
  })().catch((e) => {
    console.warn("Nova: could not keep a copy for Nova Bridge:", e.message);
    portableCopy = null;
    return null;
  });
  return portableCopy;
}

/* Start the Bridge program (or bring its window forward: a second start
   hands over to the one running). A single-file build runs from a temporary
   copy, so it starts the file the user has (APPIMAGE on Linux), or for the
   portable .exe its kept copy (above), or the .exe itself when there is
   none. Resolves once the Bridge has been started; a start already under
   way is not repeated. */
let bridgeStarting = null;
function startBridge() {
  bridgeStarting ??= (async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const target = env.APPIMAGE || (await portableBridgeExe()) || env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const args = app.isPackaged ? [BRIDGE_FLAG] : [__filename, BRIDGE_FLAG];
    await new Promise((resolve) => {
      const child = spawn(target, args, { detached: true, stdio: "ignore", env, windowsHide: false });
      child.once("spawn", resolve);
      child.once("error", (e) => { dialog.showErrorBox("Nova Bridge could not start", e.message); resolve(); });
      child.unref();
    });
    /* its window takes a moment to appear: a click meanwhile starts nothing more */
    await new Promise((r) => setTimeout(r, 1500));
  })().finally(() => { bridgeStarting = null; });
  return bridgeStarting;
}

/* ---------- the app icon: the skin's own or the one picked in Look (src/skins/icons.js) ----------
   The window's icon, and on Linux the menu entries' too: the package's
   entries (/usr/share/applications) are copied to the user's own entries
   folder with the skin's icon, which take their place; Nova's own icon
   removes the copies. Icons live inside the app's archive, so the one in
   use is copied out where the desktop can read it. */
const SKIN_ICONS = ["nova", "minimal", "aero", "holo"];
const ENTRIES = ["nova.desktop", "nova-bridge.desktop"];
function skinIcon(skin, window) {
  const id = SKIN_ICONS.includes(skin) ? skin : "nova";
  const file = path.join(NOVA_DIR, "icons", `${id}.png`);
  if (fs.existsSync(file)) window?.setIcon?.(file);
  if (process.platform !== "linux" || !app.isPackaged) return;
  const userEntries = path.join(process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share"), "applications");
  try {
    if (id === "nova") {
      for (const name of ENTRIES) {
        const mine = path.join(userEntries, name);
        if (fs.existsSync(mine) && fs.readFileSync(mine, "utf8").includes("X-Nova-Skin-Icon=")) fs.rmSync(mine);
      }
      return;
    }
    const iconOut = path.join(app.getPath("userData"), "icons", `${id}.png`);
    fs.mkdirSync(path.dirname(iconOut), { recursive: true });
    fs.writeFileSync(iconOut, fs.readFileSync(file));
    fs.mkdirSync(userEntries, { recursive: true });
    for (const name of ENTRIES) {
      const system = path.join("/usr/share/applications", name);
      if (!fs.existsSync(system)) continue;
      const text = fs.readFileSync(system, "utf8").replace(/^Icon=.*$/m, `Icon=${iconOut}`).trimEnd();
      fs.writeFileSync(path.join(userEntries, name), `${text}\nX-Nova-Skin-Icon=${id}\n`);
    }
  } catch (e) { console.warn("Nova: could not change the menu icon:", e.message); }
}

/* ---------- Nova Bridge in the Windows Start menu ----------
   The installer adds it (desktop/installer.nsh); the portable .exe has no
   installer, so Nova adds it the first time it runs, pointing at the file
   the user has, and keeps it pointing there if the file moves. */
function bridgeShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const link = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Nova Bridge.lnk");
  try {
    const now = fs.existsSync(link) ? shell.readShortcutLink(link) : null;
    if (now?.target === target && now?.args === BRIDGE_FLAG) return;
    shell.writeShortcutLink(link, now ? "replace" : "create", { target, args: BRIDGE_FLAG, icon: target, iconIndex: 0, description: "Nova Bridge" });
  } catch (e) { console.warn("Nova: could not add Nova Bridge to the Start menu:", e.message); }
}

/* the skin Nova wears, and its light or dark mode, for the Bridge window to match */
function shareSkin(id, scheme) {
  const skin = typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id) ? id : "nova";
  const look = JSON.stringify({ skin, theme: scheme === "light" ? "light" : "dark" });
  const dir = BRIDGE_HOME();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "skin.json");
    let current = null;
    try { current = fs.readFileSync(file, "utf8"); } catch {}
    if (current !== look) fs.writeFileSync(file, look, { mode: 0o600 });
  } catch (e) { console.warn("Nova: could not share the skin with the Bridge:", e.message); }
}

if (bridgeMode) {
  const { runBridgeApp } = require(packed ? path.join(ROOT, "bridge-app", "host.cjs") : path.join(ROOT, "bridge", "app", "host.cjs"));
  runBridgeApp({ bridgeFile: packed ? path.join(ROOT, "bridge.mjs") : path.join(ROOT, "bridge", "bridge.mjs"), icon: ICON });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  /* Nova's page may ask for only these things, and only Nova's own page */
  const fromNova = (e) => !!nova && e.sender === nova && e.senderFrame === nova.mainFrame && String(e.senderFrame.url).startsWith(ORIGIN + "/");
  ipcMain.handle("nova:start-bridge", (e) => (fromNova(e) ? startBridge() : undefined));
  ipcMain.handle("nova:skin", (e, id) => { if (fromNova(e)) { look.skin = typeof id === "string" ? id : "nova"; shareSkin(look.skin, look.scheme); sendLook(); } });
  ipcMain.handle("nova:icon", (e, id) => { if (fromNova(e)) skinIcon(typeof id === "string" ? id : "nova", win); });
  ipcMain.handle("nova:scheme", (e, scheme) => { if (fromNova(e)) { look.scheme = scheme === "light" ? "light" : "dark"; shareSkin(look.skin, look.scheme); sendLook(); } });
  /* Update (the "A new update is available" prompt): the installer, the AppImage and the
     .deb download the new release from GitHub and restart into it (electron-updater,
     reading app-update.yml from the package; a .deb asks for the admin password).
     The portable .exe cannot replace itself; it is sent to the download page. */
  ipcMain.handle("nova:update", async (e) => {
    if (!fromNova(e)) return;
    const linuxPackage = process.platform === "linux" && (!!process.env.APPIMAGE || fs.existsSync(path.join(process.resourcesPath, "package-type")));
    const windowsInstall = process.platform === "win32" && !process.env.PORTABLE_EXECUTABLE_FILE;
    if (!app.isPackaged || !(windowsInstall || linuxPackage)) return { manual: true };
    const updater = require(packed ? path.join(ROOT, "updater.cjs") : "electron-updater").autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    const progress = (p) => { if (!e.sender.isDestroyed()) e.sender.send("nova:update-progress", p.percent); };
    updater.on("download-progress", progress);
    try {
      const found = await updater.checkForUpdates();
      if (!found?.isUpdateAvailable) return { latest: true };
      await updater.downloadUpdate();
    } finally { updater.removeListener("download-progress", progress); }
    setImmediate(() => updater.quitAndInstall(true, true));
    return { installing: true };
  });
  /* the title bar's buttons, from the title bar only */
  ipcMain.handle("nova:bar", (e, action) => {
    if (!win || !bar || e.sender !== bar.webContents) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (action === "close") win.close();
  });

  let win = null;
  /* Nova's page (the window's own), and the title bar over it */
  let nova = null;
  let bar = null;
  let quitting = false;
  const look = { skin: "nova", scheme: "dark" };
  function sendLook() {
    if (bar && win && !win.isDestroyed()) bar.webContents.send("nova:look", { ...look, maximized: win.isMaximized() });
  }

  function showNova() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function menu() {
    const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { label: "Nova", submenu: [
        { label: "Reload", accelerator: `${mod}+R`, click: () => nova?.reload() },
        { type: "separator" },
        { role: "quit" },
      ] },
      { role: "editMenu" },
      { label: "View", submenu: [
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
        { type: "separator" }, { role: "toggleDevTools" },
      ] },
      { label: "Bridge", submenu: [
        { label: "Start Nova Bridge", accelerator: `${mod}+Shift+B`, click: startBridge },
      ] },
    ]));
  }

  function createWindow() {
    nativeTheme.themeSource = "dark";
    win = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 360,
      minHeight: 520,
      backgroundColor: "#000000",
      title: "Nova",
      icon: ICON,
      autoHideMenuBar: true,
      ...(OWN_BAR ? { frame: false } : {}),
      webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, "preload.cjs") },
    });
    nova = win.webContents;
    if (OWN_BAR) {
      bar = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "titlebar", "preload.cjs") } });
      bar.setBackgroundColor("#00000000");
      win.contentView.addChildView(bar);
      const fit = () => bar.setBounds({ x: 0, y: 0, width: win.getContentSize()[0], height: BAR_HEIGHT });
      fit();
      win.on("resize", fit);
      for (const ev of ["maximize", "unmaximize", "restore"]) win.on(ev, () => { fit(); sendLook(); });
      bar.webContents.on("did-finish-load", sendLook);
      bar.webContents.on("will-navigate", (e) => e.preventDefault());
      bar.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      bar.webContents.loadFile(path.join(__dirname, "titlebar", "index.html"));
      nova.on("dom-ready", () => nova.insertCSS(`:root { --safe-area-inset-top: ${BAR_HEIGHT}px !important; }`));
      /* a frameless window has no menu, so the menu's shortcuts are kept here */
      const keys = (e, input) => {
        if (input.type !== "keyDown") return;
        const ctrl = input.control || input.meta;
        const k = String(input.key).toLowerCase();
        const act = ctrl && input.shift && k === "b" ? startBridge
          : ctrl && !input.shift && k === "r" ? () => nova.reload()
          : ctrl && input.shift && k === "i" ? () => nova.toggleDevTools()
          : ctrl && k === "0" ? () => nova.setZoomLevel(0)
          : ctrl && (k === "=" || k === "+") ? () => nova.setZoomLevel(nova.getZoomLevel() + 0.5)
          : ctrl && k === "-" ? () => nova.setZoomLevel(nova.getZoomLevel() - 0.5)
          : k === "f11" ? () => win.setFullScreen(!win.isFullScreen())
          : null;
        if (act) { e.preventDefault(); act(); }
      };
      nova.on("before-input-event", keys);
      bar.webContents.on("before-input-event", keys);
      win.on("closed", () => { if (!bar.webContents.isDestroyed()) bar.webContents.close(); bar = null; });
    }
    /* the whole screen from the start; restoring gives the size above */
    win.maximize();
    nova.loadURL(ORIGIN + "/");
    /* links to other sites open in the browser */
    nova.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url) && !url.startsWith(ORIGIN + "/")) shell.openExternal(url);
      return { action: "deny" };
    });
    nova.on("will-navigate", (e, url) => {
      if (url.startsWith(ORIGIN + "/")) return;
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    /* backups and other files Nova saves: a titled dialog that starts in
       Documents/Nova, the folder the phone app uses too */
    nova.session.on("will-download", (_e, item) => {
      const name = item.getFilename() || "nova-file";
      const folder = path.join(app.getPath("documents"), "Nova");
      try { fs.mkdirSync(folder, { recursive: true }); } catch {}
      item.setSaveDialogOptions({
        title: /^nova-backup/i.test(name) ? "Save Nova backup" : "Save from Nova",
        defaultPath: path.join(folder, name),
      });
    });
    win.on("closed", () => { win = null; nova = null; if (!quitting) app.quit(); });
  }

  app.on("second-instance", showNova);

  app.on("before-quit", () => { quitting = true; });

  app.whenReady().then(async () => {
    try { await serveNova(); }
    catch (error) {
      dialog.showErrorBox("Nova could not start",
        error.code === "EADDRINUSE"
          ? `Port ${PORT} on this computer is in use by another program. Close it and open Nova again.`
          : error.message);
      app.exit(1);
      return;
    }
    menu();
    createWindow();
    bridgeShortcut();
    /* the portable .exe's copy for the Bridge, made while Nova opens */
    setTimeout(() => portableBridgeExe(), 3000);
  });

  app.on("window-all-closed", () => app.quit());
}
