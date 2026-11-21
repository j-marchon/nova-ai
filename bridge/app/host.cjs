/* Nova Bridge hosting and its window. Always its own program, in its own
   process: started by bridgeStart.sh / bridgeStart.cmd (bridge/app/main.cjs),
   or by the Nova desktop app's Start Bridge button, which runs the same
   program again with --nova-bridge (desktop/main.cjs). One Bridge per
   computer: both ways share one data folder and one single-instance lock,
   so a second start only brings the running window forward.

   The window: a status light, the counts, the subscriptions, the devices
   allowed in (with a code to approve a new one, and a way to block one),
   worn in the same skin as the Nova app on this computer. Opening it starts
   hosting; closing it while hosting asks first. */

const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");

/* the skins the Bridge window can wear; any other falls back to Nova's own */
const SKINS = ["nova", "minimal", "aero"];

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

  /* The skin the Nova app on this computer wears (desktop/main.cjs writes
     it here as it changes); read again only when the file does. */
  const SKIN_FILE = path.join(HOME, "skin.json");
  let skin = { at: -1, id: "nova" };
  const currentSkin = () => {
    try {
      const at = fs.statSync(SKIN_FILE).mtimeMs;
      if (at !== skin.at) {
        const id = JSON.parse(fs.readFileSync(SKIN_FILE, "utf8")).skin;
        skin = { at, id: SKINS.includes(id) ? id : "nova" };
      }
    } catch { skin = { at: -1, id: "nova" }; }
    return skin.id;
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
    return { ...b.bridgeInfo(), starting, problem: lastProblem, skin: currentSkin(), platform: process.platform };
  }

  const panelUrl = pathToFileURL(path.join(__dirname, "index.html")).href;
  const fromPanel = (e) => win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && e.senderFrame.url === panelUrl;
  const handle = (name, fn) => ipcMain.handle(name, (e, ...args) => {
    if (!fromPanel(e)) throw new Error("Untrusted window");
    return fn(...args);
  });

  handle("info", () => snapshot());
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
    nativeTheme.themeSource = currentSkin() === "aero" ? "light" : "dark";
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
      /* closing while hosting: ask first */
      if (!bridge?.bridgeInfo().running) return;
      e.preventDefault();
      win.webContents.send("confirm-close", bridge.bridgeInfo());
    });
  }

  /* quitting from the taskbar or the system goes through the same question */
  app.on("before-quit", (e) => {
    if (forceQuit || !bridge?.bridgeInfo().running) return;
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
    /* open the window and start hosting */
    async ready() {
      createWindow();
      await start();
    },
    show,
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
  app.whenReady().then(() => host.ready());
  app.on("window-all-closed", () => app.quit());
}

module.exports = { createBridgeHost, runBridgeApp };
