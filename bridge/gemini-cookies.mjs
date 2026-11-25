/* gemini-cookies.mjs — get the Gemini app sign-in from a real browser.

   Google refuses sign-in inside embedded browsers (Electron, webviews:
   "This browser or app may not be secure"), so the Bridge never shows a login
   page itself. It uses the user's own browser instead, two ways:

   1. Firefox: the Google cookies of a Firefox profile already signed in to
      Google are read from its cookies.sqlite. No sign-in needed.
   2. Chrome, Edge, Brave or Chromium, with its own saved profile (never the
      user's everyday one). Google refuses to sign in a browser that has a
      DevTools port open ("This browser or app may not be secure"), so the
      sign-in happens in a plain window of that browser, without one; once
      the user closes it, the same profile is opened again, unseen, with a
      local DevTools port only to read its cookies. A later run is already
      signed in and opens no window at all.

   Learn models never signs in there at all: it puts
   the Bridge's saved Google cookies into that browser and opens Gemini signed
   in, so the sign-in page is never shown.

   Only Google's cookies are read, only on the user's request (Sign in, Learn
   models, or the geminiProbe scripts). Zero dependencies: Node 22+ with its
   built-in WebSocket and, for Firefox, node:sqlite.

   Environment: NOVA_BRIDGE_GEMINI_BROWSER = auto (default) | firefox |
   chromium | none; NOVA_BRIDGE_BROWSER = path to the Chrome-family browser. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isGoogle = (domain) => /(^|\.)google\.com$/i.test(String(domain || "").replace(/^\./, ""));
const MODEL_HEADER = "x-goog-ext-525001261-jspb";

export class BrowserSignInError extends Error {}

/* ---------- 1. Firefox ---------- */

export function firefoxRoots({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (platform === "win32") return [path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Mozilla", "Firefox", "Profiles")];
  if (platform === "darwin") return [path.join(home, "Library", "Application Support", "Firefox", "Profiles")];
  return [
    path.join(home, ".mozilla", "firefox"),
    /* new installs since Firefox moved to the XDG folders */
    path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "mozilla", "firefox"),
    path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
    path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
  ];
}

/* One Google sign-in out of a profile's cookie rows. Firefox keeps a cookie
   jar per container and, with Total Cookie Protection, per site that embeds
   Google (originAttributes "^partitionKey=…"); those embedded copies are
   usually signed out or older. Mixing jars, or keeping a row that has expired
   but not been purged yet, pairs one sign-in's __Secure-1PSID with another's
   __Secure-1PSIDTS, which Google answers as signed out. So: no partitioned
   jars, no expired rows, and one jar only, the default one when it is signed
   in, else the most recently used. Resolves { cookies, used } or null. */
export function firefoxJar(rows, now = Date.now()) {
  const jars = new Map();
  for (const r of rows) {
    const attrs = String(r.originAttributes || "");
    if (attrs.includes("partitionKey")) continue;
    /* seconds in older Firefox, milliseconds in newer */
    const exp = Number(r.expiry) || 0;
    if (exp > 0 && (exp > 1e11 ? exp : exp * 1000) <= now) continue;
    if (!r.value || !/^[A-Za-z0-9_.-]+$/.test(r.name)) continue;
    const jar = jars.get(attrs) || { cookies: {}, used: 0 };
    jar.cookies[r.name] = r.value;
    jar.used = Math.max(jar.used, Number(r.lastAccessed) || 0);
    jars.set(attrs, jar);
  }
  const signedIn = [...jars].filter(([, j]) => j.cookies["__Secure-1PSID"]);
  if (!signedIn.length) return null;
  return (signedIn.find(([attrs]) => attrs === "") || signedIn.sort((a, b) => b[1].used - a[1].used)[0])[1];
}

/* Google's cookies from the Firefox profile that has a Google sign-in (the most
   recently used one when several do). Resolves null when there is none. */
export async function firefoxCookies({ roots = firefoxRoots() } = {}) {
  let sqlite;
  try { sqlite = await import("node:sqlite"); } catch { return null; }
  let best = null;
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      const db = path.join(root, d.name, "cookies.sqlite");
      if (!fs.existsSync(db)) continue;
      /* Firefox keeps the file open and writes through a WAL: read a copy of all of it */
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-ff-"));
      try {
        for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, path.join(tmp, `cookies.sqlite${ext}`));
        const conn = new sqlite.DatabaseSync(path.join(tmp, "cookies.sqlite"));
        try {
          /* .google.com last, so it wins a name another Google host also uses */
          const rows = conn.prepare("SELECT * FROM moz_cookies WHERE host = 'google.com' OR host LIKE '%.google.com' ORDER BY host = '.google.com', lastAccessed").all();
          const jar = firefoxJar(rows);
          if (jar && (!best || jar.used > best.used)) best = { cookies: jar.cookies, authuser: 0, from: "Firefox", used: jar.used };
        } finally {
          conn.close();
        }
      } catch {
        /* a locked or unreadable profile is skipped */
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
  return best && { cookies: best.cookies, authuser: best.authuser, from: best.from };
}

/* ---------- 2. Chrome, Edge, Brave, Chromium ---------- */

export function chromiumCandidates({ env = process.env, platform = process.platform } = {}) {
  if (env.NOVA_BRIDGE_BROWSER) return [{ name: "your browser", path: env.NOVA_BRIDGE_BROWSER }];
  if (platform === "win32") {
    const bases = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter(Boolean);
    const rel = [
      ["Chrome", "Google\\Chrome\\Application\\chrome.exe"],
      ["Edge", "Microsoft\\Edge\\Application\\msedge.exe"],
      ["Brave", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
      ["Chromium", "Chromium\\Application\\chrome.exe"],
    ];
    return rel.flatMap(([name, r]) => bases.map((b) => ({ name, path: path.join(b, r) })));
  }
  if (platform === "darwin") {
    return [
      ["Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      ["Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      ["Brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
      ["Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    ].map(([name, p]) => ({ name, path: p }));
  }
  const names = [["Chrome", "google-chrome"], ["Chrome", "google-chrome-stable"], ["Chromium", "chromium"], ["Chromium", "chromium-browser"], ["Edge", "microsoft-edge"], ["Brave", "brave-browser"]];
  const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  return names.flatMap(([name, bin]) => dirs.map((d) => ({ name, path: path.join(d, bin) })));
}

export function findChromium(opts) {
  return chromiumCandidates(opts).find((c) => { try { return fs.statSync(c.path).isFile(); } catch { return false; } }) || null;
}

/* a DevTools connection: send(method, params, sessionId), onEvent(fn), closed */
function connectCdp(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return reject(e); }
    let seq = 0;
    const pending = new Map();
    const listeners = new Set();
    let onClosed;
    let gone = false;
    const closed = new Promise((r) => { onClosed = r; });
    const api = {
      closed,
      send(method, params = {}, sessionId) {
        return new Promise((res, rej) => {
          if (gone) return rej(new Error("The browser was closed."));
          const id = ++seq;
          pending.set(id, { res, rej });
          try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); } catch (e) { pending.delete(id); rej(e); }
        });
      },
      onEvent: (fn) => listeners.add(fn),
      close: () => { try { ws.close(); } catch {} },
    };
    ws.onopen = () => resolve(api);
    ws.onerror = () => reject(new Error("Could not connect to the browser."));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error.message || "DevTools error")); else p.res(m.result || {});
      } else if (m.method) {
        for (const fn of listeners) { try { fn(m); } catch {} }
      }
    };
    ws.onclose = () => {
      gone = true;
      for (const p of pending.values()) p.rej(new Error("The browser was closed."));
      pending.clear();
      onClosed();
    };
  });
}

const readPortFile = (profileDir) => {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(profileDir, "DevToolsActivePort"), "utf8").split("\n");
    return port && wsPath ? `ws://127.0.0.1:${port.trim()}${wsPath.trim()}` : null;
  } catch { return null; }
};

/* The browser on its own saved profile with a DevTools port: an instance that
   is still open from before is reused. Resolves { cdp, child, name }. */
async function openBrowser({ profileDir, exe, url, onStatus, signal, headless = false }) {
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const running = readPortFile(profileDir);
  if (running) {
    try { return { cdp: await connectCdp(running), child: null, name: "browser" }; } catch { /* stale file */ }
    fs.rmSync(path.join(profileDir, "DevToolsActivePort"), { force: true });
  }
  const found = exe || findChromium();
  if (!found) throw new BrowserSignInError("No Chrome, Edge, Brave or Chromium found. Install one, set NOVA_BRIDGE_BROWSER to its path, or paste your cookies instead.");
  if (!headless) onStatus?.(`Opening ${found.name}.`);
  const child = spawn(found.path, [
    ...(found.args || []),
    ...(headless ? ["--headless=new"] : []),
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ], { stdio: "ignore" });
  let exited = false;
  child.on("exit", () => { exited = true; });
  child.on("error", () => { exited = true; });
  for (let i = 0; i < 120; i++) {
    if (signal?.aborted) { child.kill(); throw new BrowserSignInError("Cancelled."); }
    const ws = readPortFile(profileDir);
    if (ws) {
      try { return { cdp: await connectCdp(ws), child, name: found.name }; } catch { /* not listening yet */ }
    }
    if (exited) throw new BrowserSignInError(`${found.name} closed before it could be used. If it was already open with this profile, close it and try again.`);
    await sleep(250);
  }
  child.kill();
  throw new BrowserSignInError(`${found.name} did not start in time.`);
}

async function closeBrowser({ cdp, child }) {
  try { await cdp.send("Browser.close"); } catch {}
  cdp.close();
  if (child) {
    const gone = child.exitCode !== null || child.signalCode !== null;
    if (!gone) await Promise.race([new Promise((r) => child.once("exit", r)), sleep(3000)]);
    try { child.kill(); } catch {}
  }
}

/* Google's cookies as DevTools cookie parameters, for a browser that is not
   signed in. Names and values are all that was kept, so every cookie goes on
   .google.com; __Host- ones (accounts.google.com only) are left out. */
export function cookieParams(cookies) {
  return Object.entries(cookies || {})
    .filter(([name, value]) => name && value && !name.startsWith("__Host-"))
    .map(([name, value]) => ({ name, value: String(value), domain: ".google.com", path: "/", secure: true, sameSite: "None" }));
}

const googleCookies = async (cdp) => {
  const { cookies = [] } = await cdp.send("Storage.getCookies");
  const map = {};
  /* first-party only (a partitioned copy is another, older sign-in), and
     .google.com's own value when another Google host has the same name */
  const own = cookies.filter((c) => isGoogle(c.domain) && c.value && !c.partitionKey);
  for (const c of [...own.filter((c) => c.domain !== ".google.com"), ...own.filter((c) => c.domain === ".google.com")]) map[c.name] = c.value;
  return map;
};

/* The Google sign-in saved in the browser profile, read over DevTools from
   the browser started unseen; null when it has none. */
async function savedChromiumCookies({ profileDir, exe, signal }) {
  const b = await openBrowser({ profileDir, exe, url: "about:blank", signal, headless: true });
  try {
    const cookies = await googleCookies(b.cdp).catch(() => ({}));
    return cookies["__Secure-1PSID"] ? { cookies, authuser: 0, from: b.name } : null;
  } finally {
    await closeBrowser(b);
  }
}

/* The Google sign-in from the browser's saved profile; when it has none, a
   plain window of that browser on gemini.google.com for the user to sign in
   (no DevTools port: Google refuses those), read once it is closed.
   Resolves { cookies, authuser, from }. */
export async function chromiumCookies({ profileDir, exe, onStatus, signal, timeoutMs = 10 * 60 * 1000 } = {}) {
  const found = exe || findChromium();
  if (!found) throw new BrowserSignInError("No Chrome, Edge, Brave or Chromium found. Install one, set NOVA_BRIDGE_BROWSER to its path, or paste your cookies instead.");
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const saved = await savedChromiumCookies({ profileDir, exe: found, signal }).catch(() => null);
  if (saved) return saved;

  onStatus?.(`Sign in to Google in the ${found.name} window, then close it.`);
  const child = spawn(found.path, [
    ...(found.args || []),
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://gemini.google.com/app",
  ], { stdio: "ignore" });
  const exited = new Promise((resolve) => { child.on("exit", resolve); child.on("error", resolve); });
  let timer;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BrowserSignInError("Timed out waiting for the Google sign-in (10 minutes).")), timeoutMs);
    signal?.addEventListener("abort", () => reject(new BrowserSignInError("Cancelled.")), { once: true });
  });
  try {
    await Promise.race([exited, stop]);
  } catch (e) {
    try { child.kill(); } catch {}
    throw e;
  } finally {
    clearTimeout(timer);
  }

  onStatus?.("Reading the sign-in…");
  const r = await savedChromiumCookies({ profileDir, exe: found, signal });
  if (r) return r;
  throw new BrowserSignInError(`The ${found.name} window was closed before you signed in to Google there. If a window from an earlier try is still open, close it, then select Sign in again. Or paste your cookies.`);
}

/* ---------- the two together ---------- */

export async function getGeminiCookies({ profileDir, prefer = process.env.NOVA_BRIDGE_GEMINI_BROWSER || "auto", interactive = false, onStatus, signal, exe, roots } = {}) {
  if (prefer === "none") throw new BrowserSignInError("Browser sign-in is switched off. Paste your gemini.google.com cookies instead.");
  if (prefer === "auto" || prefer === "firefox") {
    const ff = await firefoxCookies(roots ? { roots } : undefined).catch(() => null);
    if (ff) {
      onStatus?.("Using the Google sign-in found in Firefox.");
      return ff;
    }
    if (interactive && process.platform === "linux" && (prefer === "firefox" || (!exe && !process.env.NOVA_BRIDGE_BROWSER))) {
      const child = spawn("firefox", ["--new-tab", "https://gemini.google.com/app"], { detached: true, stdio: "ignore" });
      try {
        await once(child, "spawn");
        child.unref();
        return { retryMessage: "Sign in at gemini.google.com in Firefox, then return here and select Sign in again." };
      } catch (error) {
        if (error.code !== "ENOENT" || prefer === "firefox") throw new BrowserSignInError(`Could not open Firefox: ${error.message}. Open gemini.google.com in Firefox, then try again.`);
      }
    }
    if (prefer === "firefox") throw new BrowserSignInError("No Google sign-in found in Firefox. Sign in to Google in Firefox first.");
  }
  return chromiumCookies({ profileDir, exe, onStatus, signal });
}

/* Delete the saved browser profile (the sign-in made through chromiumCookies). */
export async function forgetGeminiBrowser(profileDir) {
  if (!profileDir) return;
  if (readPortFile(profileDir)) {
    try { const cdp = await connectCdp(readPortFile(profileDir)); await closeBrowser({ cdp, child: null }); await sleep(500); } catch {}
  }
  fs.rmSync(profileDir, { recursive: true, force: true });
}

/* ---------- Learn models ---------- */

/* a model's slug from what the user typed: "Gemini 4 Argon" -> "gemini-4-argon" */
export const slugOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/* the prompt out of a StreamGenerate form body: f.req = [null, "<json>"], whose [0][0] is the text */
export function promptOf(postData) {
  try {
    const req = JSON.parse(new URLSearchParams(String(postData || "")).get("f.req"));
    const text = JSON.parse(req[1])[0][0];
    return typeof text === "string" ? text : null;
  } catch { return null; }
}

/* Gemini's newer web app sends a message to geminiweb-pa…/v1/processSession as
   form fields reqN___data__, each a base64 protobuf. The typed text sits at
   1.8.5.1.1.1 (or 2.9.1, when it goes on its own) and the model's hash (the
   same one the model header carries) at 1.1.2. Returns { prompt, model } (one may be null), or null when it carries neither. */
function readVarint(b, i) {
  let r = 0, mul = 1, c;
  do {
    if (i >= b.length) throw new Error("truncated");
    c = b[i++];
    r += (c & 0x7f) * mul;
    mul *= 128;
  } while (c & 0x80);
  return [r, i];
}
function protoFields(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    let k, v;
    [k, i] = readVarint(b, i);
    const f = Math.floor(k / 8), w = k % 8;
    if (f < 1) throw new Error("bad field");
    if (w === 0) { [v, i] = readVarint(b, i); out.push({ f, v }); }
    else if (w === 2) { [v, i] = readVarint(b, i); if (i + v > b.length) throw new Error("truncated"); out.push({ f, bytes: b.subarray(i, i + v) }); i += v; }
    else if (w === 1) i += 8;
    else if (w === 5) i += 4;
    else throw new Error("bad wire type");
    if (i > b.length) throw new Error("truncated");
  }
  return out;
}
const protoSub = (fields, n) => fields.filter((x) => x.f === n && x.bytes).flatMap((x) => { try { return [protoFields(x.bytes)]; } catch { return []; } });
const protoStr = (fields, n) => fields.filter((x) => x.f === n && x.bytes).map((x) => x.bytes.toString("utf8"));
const protoPath = (fields, path) => path.reduce((level, n) => level.flatMap((m) => protoSub(m, n)), [fields]);

export function sessionMessageOf(postData) {
  let form;
  try { form = new URLSearchParams(String(postData || "")); } catch { return null; }
  let prompt = null, model = null, any = false;
  for (const [key, value] of form) {
    if (!/^req\d+___data__$/.test(key)) continue;
    let fields;
    try { fields = protoFields(Buffer.from(value, "base64")); } catch { continue; }
    any = true;
    prompt ??= [...protoPath(fields, [1, 8, 5, 1, 1]), ...protoPath(fields, [2, 9])].flatMap((m) => protoStr(m, 1)).find((t) => t.trim()) ?? null;
    model ??= protoPath(fields, [1, 1]).flatMap((m) => protoStr(m, 2)).find((t) => /^[0-9a-f]{16}$/i.test(t)) ?? null;
  }
  return any && (prompt || model) ? { prompt, model } : null;
}

const BANNER = "Learn models: pick a model in Gemini, then send its name as the message (for example “Gemini 4 Argon”). Repeat for each model, then close this browser.";
const BANNER_JS = `(() => { const add = () => { if (document.getElementById("nova-learn")) return; const d = document.createElement("div"); d.id = "nova-learn"; d.textContent = ${JSON.stringify(BANNER)}; d.style.cssText = "position:fixed;z-index:2147483647;left:0;right:0;top:0;padding:8px 12px;background:#111;color:#fff;font:14px system-ui;text-align:center"; (document.body || document.documentElement).appendChild(d); }; if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add(); })();`;

/* Open the browser on Gemini and watch what the app sends. Each message the user
   sends with a model picked gives { name, slug, header }: the prompt (which the
   user makes the model's name) and the model header. With `cookies` (the Bridge's
   saved Google sign-in) the browser is given them first, so Gemini opens signed
   in and Google's sign-in page, which refuses this browser, is never shown.
   Resolves the names when the browser is closed. When none were learned, the
   array's `problem` says why (what Gemini sent instead), for the Bridge to show. */
export async function learnGeminiModels({ profileDir, exe, cookies, onModel, onStatus, signal } = {}) {
  const GEMINI_APP = "https://gemini.google.com/app";
  const withCookies = cookieParams(cookies).length > 0;
  const b = await openBrowser({ profileDir, exe, url: withCookies ? "about:blank" : GEMINI_APP, onStatus, signal });
  const learned = [];
  const seen = new Set();
  const sends = [];           /* what each Gemini message carried, for the problem report */
  const requests = new Map(); /* requestId -> { r, sessionId, extra, done } */
  const sessions = new Map(); /* targetId -> Promise<sessionId> */
  /* pages, their frames and workers: Gemini's request can come from any of them */
  const WATCH = new Set(["page", "iframe", "worker", "shared_worker", "service_worker"]);
  const attach = (targetId, type = "page") => {
    if (!sessions.has(targetId)) {
      sessions.set(targetId, (async () => {
        const { sessionId } = await b.cdp.send("Target.attachToTarget", { targetId, flatten: true });
        await b.cdp.send("Network.enable", { maxPostDataSize: 1 << 20 }, sessionId);
        if (type === "page") {
          await b.cdp.send("Page.enable", {}, sessionId).catch(() => {});
          await b.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BANNER_JS }, sessionId).catch(() => {});
          await b.cdp.send("Runtime.evaluate", { expression: BANNER_JS }, sessionId).catch(() => {});
        }
        return sessionId;
      })().catch(() => { sessions.delete(targetId); return null; }));
    }
    return sessions.get(targetId);
  };
  const headerOf = (...lists) => {
    for (const h of lists) {
      const key = Object.keys(h || {}).find((k) => k.toLowerCase() === MODEL_HEADER);
      if (key && h[key]) return h[key];
    }
    return null;
  };
  /* the body: inline, in postDataEntries (base64), or asked for */
  const bodyOf = async (r, requestId, sessionId) => {
    if (r.postData) return r.postData;
    const entries = (r.postDataEntries || []).map((e) => (e.bytes ? Buffer.from(e.bytes, "base64").toString("utf8") : "")).join("");
    if (entries) return entries;
    if (!r.hasPostData) return "";
    try { return (await b.cdp.send("Network.getRequestPostData", { requestId }, sessionId)).postData || ""; } catch { return ""; }
  };
  const consider = async (requestId) => {
    const q = requests.get(requestId);
    if (!q || q.done) return;
    const header = headerOf(q.r.headers, q.extra);
    if (!header && !q.extra) return; /* its sent headers may still come (requestWillBeSentExtraInfo) */
    q.done = true;
    const prompt = promptOf(await bodyOf(q.r, requestId, q.sessionId));
    const extNames = [...new Set([...Object.keys(q.r.headers || {}), ...Object.keys(q.extra || {})]
      .map((k) => k.toLowerCase()).filter((k) => k.startsWith("x-goog-ext-")))];
    sends.push({ header: !!header, prompt: prompt != null, extNames });
    if (header && prompt) learn(prompt, header);
  };
  const learn = (prompt, header) => {
    const name = prompt.trim().slice(0, 40);
    const slug = slugOf(name);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    learned.push(name);
    onModel?.({ name, slug, header });
  };
  const lastModel = new Map(); /* sessionId -> the model hash last sent there */
  const pending = new Set();
  const later = (p) => { pending.add(p); p.finally(() => pending.delete(p)); };
  b.cdp.onEvent((m) => {
    const p = m.params || {};
    if (m.method === "Target.targetCreated" && WATCH.has(p.targetInfo?.type)) attach(p.targetInfo.targetId, p.targetInfo.type);
    if (m.method === "Network.requestWillBeSent" && /\/processSession\b/.test(p.request?.url || "")) {
      /* the newer web app: text and model hash in one message */
      later((async () => {
        const msg = sessionMessageOf(await bodyOf(p.request, p.requestId, m.sessionId));
        if (!msg) return;
        /* the model and the text can come in separate requests: pair them */
        if (msg.model) lastModel.set(m.sessionId, msg.model);
        if (!msg.prompt) return;
        const model = msg.model || lastModel.get(m.sessionId);
        sends.push({ header: !!model, prompt: true, extNames: [] });
        if (model) learn(msg.prompt, model);
      })());
    } else if (m.method === "Network.requestWillBeSent") {
      const r = p.request;
      if (!r || !/StreamGenerate/.test(r.url || "")) return;
      requests.set(p.requestId, { ...requests.get(p.requestId), r, sessionId: m.sessionId });
      later(consider(p.requestId));
    } else if (m.method === "Network.requestWillBeSentExtraInfo") {
      const q = requests.get(p.requestId);
      if (q) { q.extra = p.headers || {}; later(consider(p.requestId)); }
      else requests.set(p.requestId, { extra: p.headers || {}, pending: true });
    } else if (m.method === "Network.responseReceived" || m.method === "Network.loadingFailed") {
      /* no extra headers came: decide on what the request itself carried */
      const q = requests.get(p.requestId);
      if (q?.r && !q.done) { q.extra = q.extra || {}; later(consider(p.requestId)); }
      else if (q && !q.r) requests.delete(p.requestId); /* some other request */
    }
  });
  try {
    if (withCookies) await b.cdp.send("Storage.setCookies", { cookies: cookieParams(cookies) });
    await b.cdp.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos = [] } = await b.cdp.send("Target.getTargets");
    let first = true;
    for (const t of targetInfos) {
      if (t.type !== "page") continue;
      const sessionId = await attach(t.targetId);
      /* the one blank tab opened for the cookies goes to Gemini, signed in */
      if (withCookies && first && sessionId) await b.cdp.send("Page.navigate", { url: GEMINI_APP }, sessionId).catch(() => {});
      first = false;
    }
    onStatus?.("Pick a model in Gemini and send its name as the message. Close the browser when done.");
    await Promise.race([b.cdp.closed, new Promise((r) => signal?.addEventListener("abort", r, { once: true }))]);
    for (const [id, q] of requests) if (q.r && !q.done) { q.extra = q.extra || {}; later(consider(id)); }
    await Promise.allSettled([...pending]);
  } finally {
    await closeBrowser(b);
  }
  if (!learned.length) learned.problem = learnProblem(sends);
  return learned;
}

/* Why nothing was learned, from what each Gemini message carried. */
export function learnProblem(sends) {
  if (!sends.length) return "No Gemini messages were seen. In the browser window the Bridge opens, pick a model, send its name as the message and wait for the reply, then close that window.";
  const n = `${sends.length} Gemini message${sends.length === 1 ? "" : "s"}`;
  if (!sends.some((s) => s.header)) {
    const ext = [...new Set(sends.flatMap((s) => s.extNames))];
    return `Saw ${n}, but none carried a model (the ${MODEL_HEADER} header or the model in the message), so Gemini may have changed how it picks models. ${ext.length ? `Headers it sent: ${ext.join(", ")}.` : "It sent no x-goog-ext headers."} Add a model by hand with POST /auth/gemini-web/models, or use gemini-web/default.`;
  }
  if (!sends.some((s) => s.prompt)) return `Saw ${n} with a model, but could not read the message text, so Gemini may have changed its request format. Use gemini-web/default, or add a model by hand with POST /auth/gemini-web/models.`;
  return `Saw ${n}, but the typed names were not usable model names. Send just the model's name, for example "Gemini 4 Argon".`;
}
