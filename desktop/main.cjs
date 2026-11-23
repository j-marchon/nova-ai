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

const { app, BrowserWindow, Menu, dialog, shell, nativeTheme, ipcMain } = require("electron");
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
/* Read aloud: Chromium on Linux speaks only through speech-dispatcher, and only
   when asked to (otherwise speechSynthesis has no voices and speak() fails with
   "synthesis-failed"). Needs speech-dispatcher and a voice such as espeak-ng. */
if (process.platform === "linux") app.commandLine.appendSwitch("enable-speech-dispatcher");
const NOVA_DIR = packed ? path.join(__dirname, "nova") : path.join(ROOT, "dist");
const ICON = path.join(NOVA_DIR, "icon-512.png");
const PORT = Number(process.env.NOVA_DESKTOP_PORT) || 47615;
const ORIGIN = `http://127.0.0.1:${PORT}`;

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

/* Start the Bridge program (or bring its window forward: a second start
   hands over to the one running). A single-file build runs from a temporary
   copy, so the file the user has is started: APPIMAGE (Linux), or the
   portable .exe (Windows). */
function startBridge() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const target = env.APPIMAGE || env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = app.isPackaged ? [BRIDGE_FLAG] : [__filename, BRIDGE_FLAG];
  const child = spawn(target, args, { detached: true, stdio: "ignore", env, windowsHide: false });
  child.on("error", (e) => dialog.showErrorBox("Nova Bridge could not start", e.message));
  child.unref();
}

/* ---------- the icon follows the skin (src/skins/icons.js) ----------
   The window's icon, and on Linux the menu entries' too: the package's
   entries (/usr/share/applications) are copied to the user's own entries
   folder with the skin's icon, which take their place; Nova's own icon
   removes the copies. Icons live inside the app's archive, so the one in
   use is copied out where the desktop can read it. */
const SKIN_ICONS = ["nova", "minimal", "aero"];
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

/* the skin Nova wears, for the Bridge window to match, and the icons */
function shareSkin(id, window) {
  const skin = typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id) ? id : "nova";
  skinIcon(skin, window);
  const dir = BRIDGE_HOME();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "skin.json");
    let current = null;
    try { current = JSON.parse(fs.readFileSync(file, "utf8")).skin; } catch {}
    if (current !== skin) fs.writeFileSync(file, JSON.stringify({ skin }), { mode: 0o600 });
  } catch (e) { console.warn("Nova: could not share the skin with the Bridge:", e.message); }
}

if (bridgeMode) {
  const { runBridgeApp } = require(packed ? path.join(ROOT, "bridge-app", "host.cjs") : path.join(ROOT, "bridge", "app", "host.cjs"));
  runBridgeApp({ bridgeFile: packed ? path.join(ROOT, "bridge.mjs") : path.join(ROOT, "bridge", "bridge.mjs"), icon: ICON });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  /* Nova's page may ask for only these two things, and only Nova's own page */
  const fromNova = (e) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && String(e.senderFrame.url).startsWith(ORIGIN + "/");
  ipcMain.handle("nova:start-bridge", (e) => { if (fromNova(e)) startBridge(); });
  ipcMain.handle("nova:skin", (e, id) => { if (fromNova(e)) shareSkin(id, win); });

  let win = null;
  let quitting = false;

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
        { label: "Reload", accelerator: `${mod}+R`, click: () => win?.webContents.reload() },
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
      webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, "preload.cjs") },
    });
    /* the whole screen from the start; restoring gives the size above */
    win.maximize();
    win.loadURL(ORIGIN + "/");
    /* links to other sites open in the browser */
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url) && !url.startsWith(ORIGIN + "/")) shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (url.startsWith(ORIGIN + "/")) return;
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    /* backups and other files Nova saves: a titled dialog that starts in
       Documents/Nova, the folder the phone app uses too */
    win.webContents.session.on("will-download", (_e, item) => {
      const name = item.getFilename() || "nova-file";
      const folder = path.join(app.getPath("documents"), "Nova");
      try { fs.mkdirSync(folder, { recursive: true }); } catch {}
      item.setSaveDialogOptions({
        title: /^nova-backup/i.test(name) ? "Save Nova backup" : "Save from Nova",
        defaultPath: path.join(folder, name),
      });
    });
    win.on("closed", () => { win = null; if (!quitting) app.quit(); });
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
  });

  app.on("window-all-closed", () => app.quit());
}
