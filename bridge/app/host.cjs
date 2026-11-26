/* Nova Bridge hosting and its window. Always its own program, in its own
   process: started by bridgeStart.sh / bridgeStart.cmd (bridge/app/main.cjs),
   or by the Nova desktop app's Start Bridge button, which runs the same
   program again with --nova-bridge (desktop/main.cjs). One Bridge per
   computer: both ways share one data folder and one single-instance lock,
   so a second start only brings the running window forward.

   The window: a status light, the counts, the subscriptions, the devices
   allowed in (with a code to approve a new one, and a way to block one),
   worn in the same skin as the Nova app on this computer. Opening it starts
   hosting; closing it while hosting asks first.

   Start with this computer (off unless turned on in the window): the Bridge
   starts at login with --hidden, hosting with no window; opening Nova
   Bridge from the menu then shows the window of the one already running. */

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { pathToFileURL, fileURLToPath } = require("node:url");

/* the skins the Bridge window can wear; any other falls back to Nova's own */
const SKINS = ["nova", "minimal", "aero", "holo"];

function createBridgeHost({
  bridgeFile,            /* path to bridge.mjs (or its bundle) */
  icon,                  /* window icon */
} = {}) {
  const HOME = app.getPath("userData");
  /* A packaged app runs from a read-only or temporary folder: keep the Bridge's
     sign-ins and approved devices in the data folder instead. */
  if (!process.env.NOVA_BRIDGE_AUTH_FILE && app.isPackaged) {
    process.env.NOVA_BRIDGE_AUTH_FILE = path.join(HOME, "nova-bridge-auth.json");
  }
  /* the Bridge answers the Wi-Fi it is on (approved devices only) */
  if (process.env.NOVA_BRIDGE_LAN === undefined) process.env.NOVA_BRIDGE_LAN = "1";

  /* Host configuration such as NOVA_GOOGLE_CLIENT_ID and NOVA_GOOGLE_CLIENT_SECRET
     (Google sign-in) lives in a .env kept out of git and downloads: in the user's
     data folder, or at the repo root when run from a checkout. Variables already
     set in the environment win. */
  const envFiles = [path.join(HOME, ".env")];
  /* named in the Google sign-in error, so a user knows where the file goes */
  if (process.env.NOVA_BRIDGE_ENV_DIR === undefined) process.env.NOVA_BRIDGE_ENV_DIR = HOME;
  if (!app.isPackaged) envFiles.push(path.join(path.dirname(bridgeFile), "..", ".env"));
  for (const file of envFiles) {
    try { process.loadEnvFile(file); }
    catch (e) { if (e.code !== "ENOENT") console.warn(`Nova Bridge: could not read ${file}: ${e.message}`); }
  }

  /* The skin the Nova app on this computer wears, and its light or dark
     mode (desktop/main.cjs writes them here as they change); read again
     only when the file does. */
  const SKIN_FILE = path.join(HOME, "skin.json");
  let skin = { at: -1, id: "nova", theme: "dark" };
  const currentSkin = () => {
    try {
      const at = fs.statSync(SKIN_FILE).mtimeMs;
      if (at !== skin.at) {
        const saved = JSON.parse(fs.readFileSync(SKIN_FILE, "utf8"));
        skin = { at, id: SKINS.includes(saved.skin) ? saved.skin : "nova", theme: saved.theme === "light" ? "light" : "dark" };
      }
    } catch { skin = { at: -1, id: "nova", theme: "dark" }; }
    return skin;
  };

  function connectionKey() {
    if (process.env.NOVA_BRIDGE_KEY?.trim()) return process.env.NOVA_BRIDGE_KEY.trim();
    const file = path.join(HOME, "bridge-key");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); }
    catch (e) { if (e.code !== "EEXIST") throw new Error("Could not create the Bridge key: " + e.message); }
    fs.chmodSync(file, 0o600);
    const key = fs.readFileSync(file, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("The saved Bridge key is invalid. Restore the bridge-key file from a private backup.");
    process.env.NOVA_BRIDGE_KEY = key;
    return key;
  }

  /* ---------- start with this computer ----------
     The command that started this Bridge, run again at login with --hidden:
     the file the user has for single-file builds (AppImage, portable .exe),
     this program otherwise. Linux: a desktop entry in ~/.config/autostart;
     Windows and macOS: the system's login items. */
  const HIDDEN = "--hidden";
  const loginCommand = () => {
    const exe = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const args = process.argv.slice(1).filter((a) => a !== HIDDEN).map((a) => (a.startsWith("-") ? a : path.resolve(a)));
    return { exe, args: [...args, HIDDEN] };
  };
  const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config"), "autostart", "nova-bridge.desktop");
  const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, "\\$1")}"`);
  function startsAtLogin() {
    if (process.platform === "linux") return fs.existsSync(autostartFile());
    try { return !!app.getLoginItemSettings({ path: loginCommand().exe, args: loginCommand().args }).openAtLogin; } catch { return false; }
  }
  function setStartsAtLogin(on) {
    const { exe, args } = loginCommand();
    if (process.platform === "linux") {
      const file = autostartFile();
      if (on) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, ["[Desktop Entry]", "Type=Application", "Name=Nova Bridge", "Comment=Starts Nova Bridge, without its window, when you log in", `Exec=${[exe, ...args].map(quote).join(" ")}`, "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n"));
      } else fs.rmSync(file, { force: true });
    } else app.setLoginItemSettings({ openAtLogin: !!on, path: exe, args });
    return startsAtLogin();
  }

  /* ---------- keep running in the tray ----------
     On by default: closing the window hides it, the Bridge goes on hosting
     and an icon in the system tray (the status area on Linux) brings it
     back. Off: closing the window asks, then stops, as it always did. */
  const TRAY_FILE = path.join(HOME, "tray.json");
  const trayWanted = () => {
    try { return JSON.parse(fs.readFileSync(TRAY_FILE, "utf8")).tray !== false; } catch { return true; }
  };
  let tray = null;
  function setTray(on) {
    try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(TRAY_FILE, JSON.stringify({ tray: !!on })); } catch {}
    syncTray();
    return trayWanted();
  }
  function syncTray() {
    if (trayWanted()) {
      if (tray && !tray.isDestroyed()) return;
      try {
        const img = nativeImage.createFromPath(icon || "").resize({ width: 22, height: 22 });
        tray = new Tray(img);
        tray.setToolTip("Nova Bridge");
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: "Open Nova Bridge", click: () => show() },
          { type: "separator" },
          { label: "Quit and stop the Bridge", click: async () => { forceQuit = true; await stop(); app.quit(); } },
        ]));
        tray.on("click", () => show());
      } catch (e) { tray = null; }
    } else if (tray) {
      tray.destroy();
      tray = null;
    }
  }

  let bridge = null;
  let win = null;
  let wanted = false;      /* the user wants it running: the watchdog restarts it if it drops */
  let starting = false;
  let lastProblem = null;
  let forceQuit = false;

  process.on("uncaughtException", (e) => { lastProblem = e.message; });
  process.on("unhandledRejection", (e) => { lastProblem = e?.message || String(e); });

  async function lib() {
    if (!bridge) {
      connectionKey();
      bridge = await import(pathToFileURL(bridgeFile).href);
      /* sign-in pages open the way the desktop opens links */
      bridge.bridgeSetOpener?.((url) => shell.openExternal(url));
    }
    return bridge;
  }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const b = await lib();
      await b.startBridge();
      wanted = true;
      lastProblem = null;
    } catch (e) {
      wanted = false;
      lastProblem = /already in use/i.test(e.message) ? "Another program is using the Bridge's port (5005)." : e.message;
    } finally {
      starting = false;
    }
  }

  async function stop() {
    wanted = false;
    if (bridge) await bridge.stopBridge();
  }

  async function snapshot() {
    const b = await lib();
    const { id, theme } = currentSkin();
    return { ...b.bridgeInfo(), starting, problem: lastProblem, skin: id, theme, platform: process.platform };
  }

  /* compared as paths, not as URL text: Node and Chromium escape some
     characters differently (the portable .exe runs from a short Temp path
     such as C:\Users\JOHNDO~1\..., whose "~" Node writes as %7E) */
  const panelPath = path.join(__dirname, "index.html");
  const isPanel = (url) => { try { return fileURLToPath(url) === panelPath; } catch { return false; } };
  const fromPanel = (e) => win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && isPanel(e.senderFrame.url);
  const handle = (name, fn) => ipcMain.handle(name, (e, ...args) => {
    if (!fromPanel(e)) throw new Error("Untrusted window");
    return fn(...args);
  });

  handle("info", () => snapshot());
  handle("autostart", (on) => (typeof on === "boolean" ? setStartsAtLogin(on) : startsAtLogin()));
  handle("tray", (on) => (typeof on === "boolean" ? setTray(on) : trayWanted()));
  handle("start", async () => { await start(); return snapshot(); });
  handle("stop", async () => { await stop(); return snapshot(); });
  handle("signin", async (id) => {
    if (typeof id !== "string") return { error: "Unknown subscription." };
    try { return (await (await lib()).bridgeSignIn(id)) || {}; } catch (error) { return { error: error.message }; }
  });
  handle("signout", async (id) => {
    try { (await lib()).bridgeSignOut(id); return {}; } catch (error) { return { error: error.message }; }
  });
  handle("device", async (id, action) => {
    if (typeof id !== "string" || !["approve", "reject", "block", "unblock", "revoke"].includes(action)) throw new Error("Invalid device action");
    (await lib()).bridgeDevice(id, action);
    return snapshot();
  });
  handle("window", (action) => {
    if (action === "minimize") win.minimize();
    else if (action === "close") win.close();
  });
  handle("close-confirmed", async () => {
    if (forceQuit) return;
    forceQuit = true;
    await stop();
    app.quit();
  });

  function createWindow({ show = true } = {}) {
    const { id, theme } = currentSkin();
    nativeTheme.themeSource = id === "aero" || (id === "holo" && theme === "light") ? "light" : "dark";
    Menu.setApplicationMenu(null);
    /* frameless and see-through: the window's rounded corners are its page's */
    win = new BrowserWindow({
      width: 420,
      height: 700,
      minWidth: 380,
      minHeight: 560,
      show,
      frame: false,
      transparent: true,
      resizable: process.platform !== "win32",
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      hasShadow: true,
      title: "Nova Bridge",
      icon,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
    });
    win.loadFile(path.join(__dirname, "index.html"));
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (e) => e.preventDefault());

    win.on("close", (e) => {
      if (forceQuit) return;
      /* in the tray: the window goes, the Bridge stays */
      if (trayWanted() && tray && !tray.isDestroyed()) { e.preventDefault(); win.hide(); return; }
      /* closing while hosting: ask first */
      if (!bridge?.bridgeInfo().running) return;
      e.preventDefault();
      win.webContents.send("confirm-close", bridge.bridgeInfo());
    });
  }

  /* quitting from the taskbar or the system goes through the same question */
  app.on("before-quit", (e) => {
    if (forceQuit || !bridge?.bridgeInfo().running) return;
    /* a system quit (log out, shut down) while it lives in the tray just stops it */
    if (trayWanted() && tray && !tray.isDestroyed() && !win?.isVisible()) { forceQuit = true; return; }
    e.preventDefault();
    if (win) { win.show(); win.focus(); win.close(); }
  });

  function show() {
    if (!win || win.isDestroyed()) createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /* if the Bridge drops without being asked to, bring it back */
  setInterval(async () => {
    if (!wanted || starting || !bridge) return;
    if (!bridge.bridgeInfo().running) {
      lastProblem = "The Bridge stopped by itself and was restarted.";
      await start();
      if (!bridge.bridgeInfo().running) wanted = true; /* keep trying */
    }
  }, 4000).unref();

  /* a device asking for access brings the window forward, once per request */
  const asked = new Set();
  setInterval(() => {
    if (!bridge) return;
    for (const d of bridge.bridgeInfo().pending) if (!asked.has(d.id)) { asked.add(d.id); show(); }
  }, 1500).unref();

  return {
    /* open the window and start hosting; at login (--hidden), host
       without showing the window until it is asked for */
    async ready({ hidden = false } = {}) {
      syncTray();
      createWindow({ show: !hidden });
      await start();
    },
    show,
    keepsRunning: () => trayWanted() && !!tray && !tray.isDestroyed(),
  };
}

/* Run as the Nova Bridge program: one per computer, its own data folder.
   `entry` is how it was started, for the log only. */
function runBridgeApp({ bridgeFile, icon }) {
  app.setName("Nova Bridge");
  /* the same folder whichever way it starts (Electron names it after the
     package otherwise: nova-bridge-app standalone, Nova in the desktop app) */
  app.setPath("userData", process.env.NOVA_BRIDGE_DATA || path.join(app.getPath("appData"), "nova-bridge-app"));
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const host = createBridgeHost({ bridgeFile, icon });
  app.on("second-instance", () => host.show());
  app.whenReady().then(() => host.ready({ hidden: process.argv.includes("--hidden") }));
  app.on("window-all-closed", () => { if (!host.keepsRunning()) app.quit(); });
}

module.exports = { createBridgeHost, runBridgeApp };
