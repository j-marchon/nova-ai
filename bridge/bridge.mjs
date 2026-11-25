import { createDeviceAccess } from "./bridge-devices.mjs";
/* ============================================================
   Nova Bridge — Unified Subscription-to-OpenAI Gateway
   ============================================================
   Turns Google Antigravity (any Google account, Google AI Pro), Claude
   Pro/Max (through Claude Code on this computer), ChatGPT Plus/Pro (Codex)
   subscriptions and the Gemini app (gemini.google.com, chat only) into one
   OpenRouter-compatible endpoint at http://localhost:5005/v1.

   - Direct HTTPS to each upstream, signed in the way its official tool does
   - Nova's whole system prompt goes into the upstream's own system field
   - Tokens refresh by themselves; existing CLI sign-ins are picked up

   Signing in and out happens in the Bridge window (or with the Bridge key).
   Chatting needs an approved device: Nova on this computer is approved as it
   asks, a phone shows a code to approve in the window. Only this computer
   and devices on the same local network are answered at all, and a device
   approved on one network is not served from another.

   Environment:
     PORT                  default 5005
     NOVA_BRIDGE_KEY        administrator key (the Bridge window makes one)
     NOVA_BRIDGE_LAN        set to 0 to answer this computer only
     NOVA_BRIDGE_ORIGINS    comma-separated exact browser origins
     NOVA_BRIDGE_CLAUDE_BIN the Claude Code program, if not found by itself
     NOVA_BRIDGE_TIMEOUT   seconds an upstream may stay silent (default 180)
     GOOGLE_CLOUD_PROJECT  your own Cloud project, for Google accounts that
                           need one (not needed otherwise)
     NOVA_BRIDGE_AGY_UA    User-Agent sent to Antigravity, should Google start
                           wanting a newer client (default below)
     NOVA_BRIDGE_GEMINI_UA User-Agent sent to the Gemini app
     NOVA_BRIDGE_GEMINI_CONCURRENCY  replies the Gemini app may write at once (2)
     NOVA_BRIDGE_GEMINI_DELETE       set to 0 to keep each chat in the
                                     Gemini history after its reply
   ============================================================ */

import http from "node:http";
import { isIP } from "node:net";
import dgram from "node:dgram";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { exec, execFile } from "node:child_process";
import { forgetGeminiBrowser, getGeminiCookies, learnGeminiModels } from "./gemini-cookies.mjs";
import { GeminiWebSession, httpsRequest, parseCookieInput } from "./gemini-web.mjs";
import { claudeChat, claudeLogin, claudeModels, claudeStatus } from "./claude-code.mjs";
import {
  PROVIDER_IDS,
  SUBSCRIPTION_MODELS,
  SUBSCRIPTION_PROVIDERS,
  estimateTokens,
  extractChatGptAccountId,
  jwtExpiry,
  modelEntry,
  nextPacificMidnight,
  pacificDay,
  parseCodexSseLine,
  parseGoogleCodeAssistSseLine,
  parseOpenAISseLine,
  resolveSubscriptionModel,
  summarizeQuota,
  toCodexResponsesPayload,
  toClaudeCodePrompt,
  servedModelMatches,
  toGeminiWebPrompt,
  toGoogleCodeAssistPayload,
} from "../src/lib/subBridge.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.NOVA_BRIDGE_HOME || os.homedir();
const AUTH_FILE = process.env.NOVA_BRIDGE_AUTH_FILE || path.join(HERE, "..", ".nova-bridge-auth.json");
const deviceAccess = createDeviceAccess(AUTH_FILE + ".devices");
const deviceReplies = new Map();
const subscriptionReplies = new Map();
const PORT = Number(process.env.PORT) || 5005;
const KEY = String(process.env.NOVA_BRIDGE_KEY || "").trim();
const LAN = process.env.NOVA_BRIDGE_LAN !== "0";
const IDLE_MS = (Number(process.env.NOVA_BRIDGE_TIMEOUT) || 180) * 1000;
const ENV_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || "";
const PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const ARCH = process.arch === "x64" ? "amd64" : process.arch;
/* Antigravity hides its newest models (Gemini 4 Argon) from clients that do
   not name a client family and a recent version: a bare "antigravity/1.x"
   gets neither the model in the list nor a reply (404). The Antigravity App's
   own form does. */
const AGY_UA = String(process.env.NOVA_BRIDGE_AGY_UA || "").trim() || `antigravity/hub/2.24.0 ${PLATFORM}/${ARCH}`;

/* ---------- Sign-in clients ----------

   The public OAuth clients of the official tools. A token can only be
   refreshed by the client that issued it. (The Gemini CLI's client is gone:
   Google stopped serving personal accounts through it.) */
/* filled in when the Bridge is bundled for a release; empty in a checkout */
const BUILT_GOOGLE = typeof __NOVA_BUILT_GOOGLE__ === "object" && __NOVA_BUILT_GOOGLE__ ? __NOVA_BUILT_GOOGLE__ : {};
const GOOGLE = {
  antigravity: {
    /* .env first; a packaged build carries the one it was built with
       (desktop/build-desktop.mjs), so sign-in works without setup */
    clientId: process.env.NOVA_GOOGLE_CLIENT_ID || BUILT_GOOGLE.id,
    clientSecret: process.env.NOVA_GOOGLE_CLIENT_SECRET || BUILT_GOOGLE.secret,
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    /* Antigravity's client only accepts this exact redirect */
    port: 51121,
    callbackPath: "/oauth-callback",
    /* the endpoints Antigravity itself uses, in its order, then production */
    hosts: ["https://daily-cloudcode-pa.sandbox.googleapis.com", "https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"],
    headers: () => ({
      "User-Agent": AGY_UA,
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify({ ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
    }),
  },
};

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/* the Codex backend lists no models to clients it thinks are too old */
const CODEX_VERSION = "1.0.0";

/* An upstream failure, with the HTTP status Nova should see. */
class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const notConnected = (name) => new UpstreamError(`${name} is not connected. Connect it in Nova → Settings → Nova Bridge.`, 401);

/* ---------- Credential store ----------

   .nova-bridge-auth.json at the repo root, one entry per provider.
   `skipCli` lists providers signed out here, so their CLI sign-in is not
   picked up again straight away. */

function loadStore() {
  let store = { antigravity: null, claude: null, openai: null, "gemini-web": null, skipCli: [] };
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const saved = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
      /* sign-ins of channels since removed (the Gemini CLI, kept as "gemini"
         and before that "google") */
      delete saved.gemini;
      delete saved.google;
      delete saved.anthropic;
      /* GitHub Copilot, replaced by Claude */
      delete saved.copilot;
      store = { ...store, ...saved };
    }
  } catch (e) {
    throw new Error("Could not read the Bridge sign-in file. Restore it from a private backup.");
  }
  if (!Array.isArray(store.skipCli)) store.skipCli = [];
  return store;
}

function saveStore() {
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2), { mode: 0o600 });
    /* the mode above only applies to a new file; an older one may be looser */
    try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
  } catch (e) {
    console.error("Failed to save auth store:", e.message);
  }
}

const readJson = (p) => {
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
};

const CODEX_AUTH = () => path.join(process.env.CODEX_HOME || path.join(HOME, ".codex"), "auth.json");

/* Pick up an existing Codex CLI sign-in, so someone already signed in there
   works at once. (Claude Code is never picked up by itself: connecting it
   goes through the warning in the Bridge window.) */
function autoDiscoverCliCredentials() {
  const skip = new Set(authStore.skipCli);
  let changed = false;

  /* Codex rotates refresh tokens: a copy refreshed here would sign the Codex
     CLI out. So the CLI's file is used in place and written back on refresh. */
  if (!authStore.openai && !skip.has("openai")) {
    const t = readJson(CODEX_AUTH())?.tokens;
    if (t?.refresh_token) {
      authStore.openai = { source: "codex-cli" };
      changed = true;
    }
  }

  if (changed) saveStore();
}

/* Antigravity's own sign-in (the agy CLI and app), which go-keyring keeps in
   the system keychain as service "gemini", account "antigravity": a Go
   oauth2 token, { token: { access_token, refresh_token, expiry }, id_token_email }.
   Read fresh on every refresh and never copied, so signing out of
   Antigravity signs the Bridge out too. NOVA_BRIDGE_AGY_CRED names a JSON
   file to read instead (tests), or "none" to skip it.
   shortcut: macOS and Linux follow go-keyring's documented layout, only Windows was tried. */
const AGY_PS = "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class NovaCred{[DllImport(\"advapi32.dll\",CharSet=CharSet.Unicode)]public static extern bool CredReadW(string t,int y,int f,out IntPtr c);[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct C{public int F;public int T;public string N;public string M;public long W;public int S;public IntPtr B;}}';$p=[IntPtr]::Zero;if([NovaCred]::CredReadW('gemini:antigravity',1,0,[ref]$p)){$c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][NovaCred+C]);$b=New-Object byte[] $c.S;[Runtime.InteropServices.Marshal]::Copy($c.B,$b,0,$c.S);[Console]::Out.Write([Convert]::ToBase64String($b))}";
/* Linux without secret-tool (libsecret-tools; the .deb depends on it, an AppImage cannot) */
let secretToolMissing = false;
function readAgyCredential() {
  const override = process.env.NOVA_BRIDGE_AGY_CRED;
  if (override === "none") return Promise.resolve(null);
  if (override) return Promise.resolve(readJson(override));
  const [cmd, args] = process.platform === "win32"
    ? ["powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(AGY_PS, "utf16le").toString("base64")]]
    : process.platform === "darwin"
      ? ["security", ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"]]
      : ["secret-tool", ["lookup", "service", "gemini", "username", "antigravity"]];
  return new Promise((resolve) => execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, out) => {
    if (cmd === "secret-tool") secretToolMissing = err?.code === "ENOENT";
    if (err) return resolve(null);
    let text = String(out).trim();
    if (process.platform === "win32") text = Buffer.from(text, "base64").toString("utf8");
    else if (text.startsWith("go-keyring-base64:")) text = Buffer.from(text.slice(18), "base64").toString("utf8");
    try { resolve(JSON.parse(text)); } catch { resolve(null); }
  }));
}

/* agy renews its own token and saves it back when asked for its model list
   (about 2 s, no quota), so the Bridge needs no Google client of its own.
   One run at a time however many chats wait. NOVA_BRIDGE_AGY_BIN names a
   Node script to run instead (tests). */
let agyRenewing = null;
function renewAgy() {
  const local = path.join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe");
  const [bin, pre] = process.env.NOVA_BRIDGE_AGY_BIN ? [process.execPath, [process.env.NOVA_BRIDGE_AGY_BIN]]
    : [process.platform === "win32" && fs.existsSync(local) ? local : "agy", []];
  agyRenewing ??= new Promise((resolve) => execFile(bin, [...pre, "models"], { timeout: 30000, windowsHide: true }, () => resolve()))
    .then(readAgyCredential)
    .finally(() => { agyRenewing = null; });
  return agyRenewing;
}

/* Use a signed-in Antigravity at once, unless signed out here. */
async function discoverAgy() {
  if (authStore.antigravity || authStore.skipCli.includes("antigravity")) return;
  const cred = await readAgyCredential();
  if (!cred?.token?.refresh_token || authStore.antigravity) return;
  authStore.antigravity = { source: "agy", email: cred.id_token_email || "", project: "" };
  saveStore();
}

let authStore = loadStore();
autoDiscoverCliCredentials();

/* Sign-in flows in progress, by provider: what the panel shows. */
const pendingFlows = new Map();

/* Claude Code's own sign-in, as last checked (claudeStatus caches it): the
   Bridge only counts Claude connected while Claude Code is signed in too. */
let claudeLive = null;
const checkClaude = () => claudeStatus().then((s) => { claudeLive = s; return s; }, () => null);

const isConnected = (id) => {
  const s = authStore[id];
  if (id === "claude") return s?.source === "claude-code" && claudeLive?.loggedIn !== false;
  return !!(s && (s.refresh_token || s.access_token || s.oauth_token || s.cookies?.["__Secure-1PSID"] || s.source === "codex-cli" || s.source === "agy"));
};
const connectedProviders = () => PROVIDER_IDS.filter(isConnected);

/* ---------- Token refresh ---------- */

const expiring = (at) => !at || Date.now() > Number(at) - 60000;

/* A release bundle (desktop/build-desktop.mjs) defines __NOVA_BUILT_GOOGLE__;
   a checkout does not. A download without the Google client says so in plain
   words; only someone running Nova from its source is pointed at .env. */
const BUNDLED = typeof __NOVA_BUILT_GOOGLE__ !== "undefined";
const googleReady = (channel) => !!(GOOGLE[channel]?.clientId && GOOGLE[channel]?.clientSecret);
const GOOGLE_MISSING = "Sign in to the Antigravity app (or run agy) on this computer, then select Sign in again.";
function googleClient(channel) {
  const cfg = GOOGLE[channel];
  if (!googleReady(channel)) {
    throw new UpstreamError(BUNDLED ? GOOGLE_MISSING
      : `Google sign-in is not set up in this copy of Nova Bridge. To use it, put NOVA_GOOGLE_CLIENT_ID and NOVA_GOOGLE_CLIENT_SECRET in a file named .env in ${process.env.NOVA_BRIDGE_ENV_DIR || "the Bridge's folder"}, then restart Nova.`, 503);
  }
  return cfg;
}

/* settled once an Antigravity sign-in has been looked for (tests wait on it) */
export const agyDiscovered = discoverAgy().catch(() => {});

function upstreamFetch(address, init) {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password) throw new UpstreamError("Subscription providers require HTTPS.");
  return fetch(address, { ...init, redirect: "error" });
}

async function postForm(url, params) {
  const res = await upstreamFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  return { res, data: await res.json().catch(() => ({})) };
}

/* Google: a fresh access token, then the Code Assist project the account is
   set up with — onboarding it the first time if needed. */
async function ensureGoogleAuth(channel, force = false) {
  const g = authStore[channel];
  const cfg = GOOGLE[channel];
  const name = "Antigravity";
  if (!g) throw notConnected(name);
  const stale = force || !g.access_token || expiring(g.expires_at);
  let refresh = stale && g.refresh_token;
  if (stale && g.source === "agy") {
    let t = (await readAgyCredential())?.token;
    /* force: Google refused the token the Bridge had, so agy renews it */
    if (t?.refresh_token && (force || expiring(Date.parse(t.expiry)))) t = (await renewAgy())?.token;
    if (!t?.refresh_token) throw new UpstreamError(`${name} is signed out. Sign in to Antigravity again, or connect it here.`, 401);
    const at = Date.parse(t.expiry);
    if (t.access_token && !expiring(at) && t.access_token !== (force && g.access_token)) {
      g.access_token = t.access_token;
      g.expires_at = at;
      saveStore();
    } else if (googleReady(channel)) refresh = t.refresh_token;
    else throw new UpstreamError(`${name} could not renew its sign-in. Open Antigravity (or run agy) once, then try again.`, 401);
  }
  if (refresh) {
    googleClient(channel);
    const { res, data } = await postForm("https://oauth2.googleapis.com/token", {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    });
    if (!res.ok || !data.access_token) {
      throw new UpstreamError(g.source === "agy"
        ? `Could not use your Antigravity sign-in (${data.error_description || data.error || res.status}). Sign out here, then connect it with Sign in.`
        : `${name} sign-in expired (${data.error_description || data.error || res.status}). Connect it again.`, 401);
    }
    g.access_token = data.access_token;
    g.expires_at = Date.now() + Number(data.expires_in || 3600) * 1000;
    saveStore();
  }
  if (!g.access_token) throw notConnected(name);
  if (!g.project) {
    try {
      g.project = await setupCodeAssist(channel, g);
      delete g.problem;
    } catch (e) {
      g.problem = e.message;
      throw e;
    } finally {
      saveStore();
    }
  }
  return g;
}

/* Code Assist setup: loadCodeAssist says which tier the account is on and
   its project; an account never set up is onboarded onto its default tier
   (free tier for personal accounts; AI Pro/Ultra are recognised there). */
async function setupCodeAssist(channel, g) {
  const name = "Antigravity";
  const metadata = { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI", ...(ENV_PROJECT ? { duetProject: ENV_PROJECT } : {}) };
  const call = (method, body) => codeAssistFetch(channel, g, method, body).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new UpstreamError(`${name} setup failed (${r.status}): ${data.error?.message || "no details"}`, r.status === 403 ? 403 : 502);
    return data;
  });
  const projectOf = (p) => (typeof p === "string" ? p : p?.id || "");

  const load = await call("loadCodeAssist", { ...(ENV_PROJECT ? { cloudaicompanionProject: ENV_PROJECT } : {}), metadata });
  if (load.currentTier) {
    const project = projectOf(load.cloudaicompanionProject) || ENV_PROJECT;
    if (!project) throw new UpstreamError(`${name}: this account needs a Google Cloud project. Set GOOGLE_CLOUD_PROJECT and restart the bridge.`, 403);
    return project;
  }

  const tier = (load.allowedTiers || []).find((t) => t.isDefault) || { id: "free-tier" };
  if (tier.userDefinedCloudaicompanionProject && !ENV_PROJECT) {
    /* Google says why the free tier is out, e.g. that it now wants personal accounts on Antigravity */
    const why = (load.ineligibleTiers || []).map((t) => t.reasonMessage).filter(Boolean)[0];
    throw new UpstreamError(why ? `${name}: Google says: ${why}` : `${name}: this account's tier needs your own Google Cloud project. Set GOOGLE_CLOUD_PROJECT and restart the bridge.`, 403);
  }
  const body = tier.id === "free-tier"
    ? { tierId: tier.id, metadata }
    : { tierId: tier.id, cloudaicompanionProject: ENV_PROJECT, metadata };
  for (let i = 0; i < 12; i++) {
    const op = await call("onboardUser", body);
    if (op.done) {
      const project = projectOf(op.response?.cloudaicompanionProject) || ENV_PROJECT;
      if (project) return project;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new UpstreamError(`${name}: Google did not finish setting up the account. Try again in a minute.`, 503);
}

/* Google's own account of a failed call, read from a copy so the response
   can still be handed on: how long it asks to wait (RetryInfo) and why
   (ErrorInfo). */
async function googleFailureInfo(res) {
  const text = await res.clone().text().catch(() => "");
  let details = [];
  try { details = JSON.parse(text).error?.details || []; } catch {}
  const delay = details.find((d) => /RetryInfo$/.test(d?.["@type"] || ""))?.retryDelay;
  const ms = delay ? parseFloat(delay) * 1000 : NaN;
  return {
    retryMs: Number.isFinite(ms) ? ms : null,
    reason: details.find((d) => /ErrorInfo$/.test(d?.["@type"] || ""))?.reason || "",
  };
}

const discard = (res) => { res.body?.cancel().catch(() => {}); };
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

/* A busy model (429, 5xx) usually frees up within seconds; Google says how
   long in RetryInfo. A wait longer than this is a used-up quota, not a busy
   moment, and is reported rather than sat through. */
const BUSY = new Set([429, 500, 502, 503, 504]);
const BUSY_TRIES = 3;
const BUSY_WAIT_MS = 8000;

/* A Code Assist call. The account's own host is asked first, and asked
   again (after the wait Google names) while the model is only busy. The
   other hosts are a fallback for when it is down or lacks the model. If
   they fail too, Nova is told the first host's answer, never the last's:
   the production host answers 429 to accounts it does not serve, so
   reporting it turned a missing model or a passing 503 into a false "rate
   limit" on every reply. */
async function codeAssistFetch(channel, g, method, body, { signal, stream = false } = {}) {
  const cfg = GOOGLE[channel];
  const hosts = g.host ? [g.host, ...cfg.hosts.filter((h) => h !== g.host)] : cfg.hosts;
  let first = null;
  let unreachable = null;
  for (const [n, host] of hosts.entries()) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await upstreamFetch(`${host}/v1internal:${method}${stream ? "?alt=sse" : ""}`, {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${g.access_token}`,
            "Content-Type": "application/json",
            Accept: stream ? "text/event-stream" : "application/json",
            ...cfg.headers(),
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        unreachable ??= e;
        break;
      }
      if (res.ok) {
        if (first) discard(first);
        if (g.host !== host) g.host = host;
        return res;
      }
      /* the first host's refusal of the request itself (bad request,
         sign-in) is the answer; no other host will think differently */
      if (!first && !BUSY.has(res.status) && res.status !== 404) return res;
      if (n === 0 && BUSY.has(res.status) && attempt < BUSY_TRIES) {
        const { retryMs, reason } = await googleFailureInfo(res);
        const wait = retryMs ?? 600 * 2 ** (attempt - 1) + Math.random() * 400;
        if (wait <= BUSY_WAIT_MS) {
          console.warn(`Google is busy (HTTP ${res.status}${reason ? ` ${reason}` : ""}); asking again in ${(wait / 1000).toFixed(1)}s.`);
          discard(res);
          await pause(wait, signal);
          continue;
        }
      }
      if (first) discard(res);
      else first = res;
      break;
    }
  }
  if (first) return first;
  throw new UpstreamError(`Could not reach Google (${unreachable?.message || "no answer"}).`, 502);
}

/* ChatGPT tokens: our own sign-in lives in the store; a Codex CLI sign-in is
   read from (and refreshed back into) ~/.codex/auth.json. */
async function ensureOpenAIAuth(force = false) {
  const o = authStore.openai;
  if (!o) throw notConnected("ChatGPT");
  const linked = o.source === "codex-cli";
  const file = linked ? readJson(CODEX_AUTH()) : null;
  const tok = linked ? { ...(file?.tokens || {}) } : o;
  if (!tok.access_token && !tok.refresh_token) throw notConnected("ChatGPT");
  const expiresAt = tok.expires_at || jwtExpiry(tok.access_token);
  if ((force || !tok.access_token || expiring(expiresAt)) && tok.refresh_token) {
    const res = await upstreamFetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: OPENAI_CLIENT_ID, grant_type: "refresh_token", refresh_token: tok.refresh_token, scope: "openid profile email" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new UpstreamError(`ChatGPT sign-in expired (${res.status}). Connect it again${linked ? " or run `codex login`" : ""}.`, 401);
    }
    tok.access_token = data.access_token;
    if (data.refresh_token) tok.refresh_token = data.refresh_token;
    if (data.id_token) tok.id_token = data.id_token;
    tok.account_id = tok.account_id || extractChatGptAccountId(data) || "";
    if (linked) {
      try {
        fs.writeFileSync(CODEX_AUTH(), JSON.stringify({ ...file, tokens: { id_token: tok.id_token, access_token: tok.access_token, refresh_token: tok.refresh_token, account_id: tok.account_id }, last_refresh: new Date().toISOString() }, null, 2), { mode: 0o600 });
      } catch (e) {
        console.error("Could not update the Codex CLI sign-in:", e.message);
      }
    } else {
      tok.expires_at = Date.now() + Number(data.expires_in || 3600) * 1000;
      saveStore();
    }
  }
  return { access_token: tok.access_token, account_id: tok.account_id || extractChatGptAccountId(tok) || "" };
}

/* ---------- Model lists ----------
   Only advertise models returned by the connected account's upstream. */
const modelCache = new Map();
const MODEL_TTL = 30000;
const modelLoads = new Map();
const cachedModels = (provider) => {
  const hit = modelCache.get(provider);
  return hit && Date.now() - hit.at < MODEL_TTL ? hit.list : [];
};

async function upstreamModels(provider) {
  const hit = modelCache.get(provider);
  if (hit && Date.now() - hit.at < MODEL_TTL) return hit.list;
  if (modelLoads.has(provider)) return modelLoads.get(provider);
  const pending = (async () => {
    try {
      const rows = await withTimeout(LISTERS[provider](), 8000);
      const list = [...new Map(rows.filter((m) => m.id).map((m) => [m.id, m])).values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      modelCache.set(provider, { at: Date.now(), list });
      return list;
    } catch {
      modelCache.delete(provider);
      return [];
    } finally {
      modelLoads.delete(provider);
    }
  })();
  modelLoads.set(provider, pending);
  return pending;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms).unref?.())]);
const knownName = (provider, id) => SUBSCRIPTION_MODELS[provider].find((m) => m.id === `${provider}/${id}`) || {};

/* Antigravity's catalog as [id, model] rows. It also carries each model's
   quota (see summarizeQuota), so the usage figures are read from the same call. */
async function antigravityModels() {
  const g = await ensureGoogleAuth("antigravity");
  const r = await codeAssistFetch("antigravity", g, "fetchAvailableModels", { project: g.project });
  if (!r.ok) throw await failure("Antigravity", r);
  const data = await r.json();
  const raw = data.models || {};
  /* the ids Antigravity's own model picker shows (agentModelSorts); the rest
     of the catalog is internal: autocomplete, aliases, tiered routes */
  const picker = new Set((data.agentModelSorts || []).flatMap((s) => (s.groups || []).flatMap((g) => g.modelIds || [])));
  const rows = Array.isArray(raw) ? raw.map((m) => [m.id || m.name, m]) : Object.entries(raw);
  return rows.map(([id, m]) => [id, m, picker.size ? picker.has(id) : !/embed|image|tab_|chat_\d/i.test(id)]);
}

const LISTERS = {
  async antigravity() {
    const rows = await antigravityModels();
    return rows
      /* disabled: a model the plan lacks (Argon on the free tier) */
      .filter(([id, m, shown]) => id && shown && !m.disabled && !/-disabled$/i.test(id))
      .map(([id, m]) => modelEntry("antigravity", id, { name: m.displayName || m.label, ctx: m.maxTokens || m.contextWindow || knownName("antigravity", id).ctx }));
  },
  async claude() {
    const s = await checkClaude();
    if (!s?.loggedIn) throw notConnected("Claude");
    return (await claudeModels()).map((m) => modelEntry("claude", m.id, { name: m.name, ctx: m.ctx || 200000 }));
  },
  async openai() {
    const o = await ensureOpenAIAuth();
    const r = await upstreamFetch(`https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_VERSION}`, { headers: codexHeaders(o) });
    if (!r.ok) throw await failure("ChatGPT", r);
    const rows = (await r.json()).models || [];
    return rows
      /* "list" is what Codex's own picker shows */
      .filter((m) => m.slug && m.visibility === "list")
      .map((m) => modelEntry("openai", m.slug, { name: m.display_name, ctx: m.context_window }));
  },
  async "gemini-web"() {
    await readyGemini();
    await geminiAppModels().catch(() => null);
    return geminiModelList();
  },
};

/* What each connected subscription can say about its limits, for Nova's
   Usage tab. Antigravity reports a quota; the Gemini app only has what the
   Bridge counted; Claude and ChatGPT report nothing here. `raw` adds the
   quota fields exactly as Google sent them, to check the field names. */
let quotaCache = null;
async function usagePayload({ raw = false } = {}) {
  const providers = {};
  for (const id of connectedProviders()) {
    if (id === "antigravity") {
      try {
        if (!quotaCache || Date.now() - quotaCache.at > 20000) quotaCache = { at: Date.now(), rows: await antigravityModels() };
        providers[id] = {
          connected: true,
          kind: "quota",
          ...summarizeQuota(quotaCache.rows),
          ...(raw ? { raw: quotaCache.rows.map(([mid, m]) => ({ id: mid, ...Object.fromEntries(Object.entries(m || {}).filter(([k]) => /quota|limit|reset|tier|remain|credit/i.test(k))) })) } : {}),
        };
      } catch (e) {
        providers[id] = { connected: true, kind: "quota", windows: [], models: [], error: e.message };
      }
    } else if (id === GEMINI) {
      const u = geminiToday();
      providers[id] = {
        connected: true,
        kind: "counted",
        day: u.day,
        resetsAt: new Date(nextPacificMidnight()).toISOString(),
        requests: u.requests,
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut,
        byModel: u.byModel,
        limitHitAt: u.limitHitAt ? new Date(u.limitHitAt).toISOString() : null,
      };
    } else {
      providers[id] = { connected: true, kind: "none" };
    }
  }
  return { object: "usage", providers };
}

async function activeModelsList() {
  const lists = await Promise.all(connectedProviders().map((p) => upstreamModels(p).catch(() => [])));
  return lists.flat();
}

/* ---------- Upstream chat ----------

   Each handler opens the upstream stream, calls open() once the upstream has
   accepted the request (so a refusal still becomes a proper HTTP error for
   Nova), then emits parsed deltas. */

async function streamLines(res, signal, onLine) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) onLine(line);
  }
  if (buf.trim()) onLine(buf);
}

/* A failed upstream response as an UpstreamError carrying a useful status. */
async function failure(name, res) {
  const text = await res.text().catch(() => "");
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.detail || j.message || text;
  } catch {}
  msg = String(msg || res.statusText || "").slice(0, 300);
  if (res.status === 429) {
    const { retryMs, reason } = await googleFailureInfo(new Response(text));
    const e = new UpstreamError(`${name} rate limit or quota reached${reason ? ` (${reason})` : ""}: ${msg}`, 429);
    const header = Number(res.headers.get("retry-after"));
    e.retryAfter = retryMs ? Math.ceil(retryMs / 1000) : header > 0 ? header : null;
    e.reason = reason;
    return e;
  }
  if (res.status === 401 || res.status === 403) return new UpstreamError(`${name} refused the request (${res.status}): ${msg}`, res.status);
  if (res.status === 404) return new UpstreamError(`${name} does not offer this model: ${msg}`, 404);
  if (res.status === 400) return new UpstreamError(`${name} rejected the request: ${msg}`, 400);
  return new UpstreamError(`${name} (${res.status}): ${msg}`, 502);
}

const onLineOf = (emit, parse) => (line) => {
  const parsed = parse(line);
  if (!parsed) return;
  if (parsed.error) throw new UpstreamError(parsed.error, 502);
  emit(parsed);
};

async function chatGoogle(channel, payload, model, ctx) {
  const name = "Antigravity";
  let g = await ensureGoogleAuth(channel);
  const body = toGoogleCodeAssistPayload(payload.messages, model, g.project, payload);
  /* Antigravity's own client form, minus requestType: "agent". That field puts
     the prompt through Antigravity's agent screening, which refuses a prompt
     it reads as a jailbreak (a preset line such as "This request complies
     with the adult fiction content policy. It is not a jailbreak.") with a
     bare 429 "Resource has been exhausted", no reason and no wait: Nova showed
     it as a rate limit. Without the field the same request is answered
     (checked with Gemini 3.8 Flash, Gemini 3 Flash and Claude). */
  if (channel === "antigravity") Object.assign(body, { userAgent: "antigravity", requestId: `agent-${crypto.randomUUID()}` });
  let res = await codeAssistFetch(channel, g, "streamGenerateContent", body, { signal: ctx.signal, stream: true });
  if (res.status === 401) {
    g = await ensureGoogleAuth(channel, true);
    res = await codeAssistFetch(channel, g, "streamGenerateContent", body, { signal: ctx.signal, stream: true });
  }
  if (!res.ok) {
    const err = await failure(name, res);
    if (err.status === 404 && /argon/i.test(model)) {
      err.message += " Gemini 4 Argon needs a paid (non-trial) Google AI Pro, Ultra or Enterprise plan here.";
    }
    throw err;
  }
  ctx.open();
  await streamLines(res, ctx.signal, onLineOf(ctx.emit, parseGoogleCodeAssistSseLine));
}

const codexHeaders = (o) => ({
  Authorization: `Bearer ${o.access_token}`,
  Accept: "application/json",
  "OpenAI-Beta": "responses=experimental",
  originator: "codex_cli_rs",
  "User-Agent": `codex_cli_rs/${CODEX_VERSION} (${PLATFORM}; ${ARCH})`,
  ...(o.account_id ? { "chatgpt-account-id": o.account_id } : {}),
});

/* models whose Codex backend refused custom `instructions`; their system
   prompt goes in as a developer message instead */
const codexDeveloperModels = new Set();

async function chatOpenAI(payload, model, ctx) {
  const send = (o, asDeveloper) => upstreamFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    signal: ctx.signal,
    headers: { ...codexHeaders(o), "Content-Type": "application/json", Accept: "text/event-stream", session_id: crypto.randomUUID() },
    body: JSON.stringify(toCodexResponsesPayload(payload.messages, model, payload, { asDeveloper })),
  });
  let o = await ensureOpenAIAuth();
  let asDeveloper = codexDeveloperModels.has(model);
  let res = await send(o, asDeveloper);
  if (res.status === 401) {
    o = await ensureOpenAIAuth(true);
    res = await send(o, asDeveloper);
  }
  if (res.status === 400 && !asDeveloper) {
    const text = await res.clone().text().catch(() => "");
    if (/instruction/i.test(text)) {
      codexDeveloperModels.add(model);
      res = await send(o, (asDeveloper = true));
    }
  }
  if (!res.ok) throw await failure("ChatGPT", res);
  ctx.open();
  await streamLines(res, ctx.signal, onLineOf(ctx.emit, parseCodexSseLine));
}

/* ---------- Pictures ----------

   POST /v1/images/generations in the OpenAI format, made by a connected
   ChatGPT subscription: one Codex request that must call its
   image_generation tool. Answers { data: [{ b64_json }] }. Copilot and
   Gemini sign-ins offer no pictures, and no subscription offers speech. */
const imageSize = (s) => {
  if (["1024x1024", "1024x1536", "1536x1024", "auto"].includes(s)) return s;
  const [w, h] = String(s || "").split("x").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
};

async function handleImages(req, res) {
  const payload = await readBody(req);
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new UpstreamError("prompt is required.", 400);
  if (!connectedProviders().includes("openai")) throw new UpstreamError("Pictures need ChatGPT. Connect a ChatGPT subscription in the Bridge window.", 501);
  let model = String(payload.model || "").replace(/^openai\//, "").trim();
  if (!model) {
    const list = (await upstreamModels("openai").catch(() => [])).map((m) => m.id.replace(/^openai\//, "")).filter((id) => !/review/i.test(id));
    /* the light model is plenty to call the picture tool */
    model = list.find((id) => /luna|mini/i.test(id)) || list[0] || "";
  }
  if (!model) throw new UpstreamError("ChatGPT offers no model right now. Try again shortly.", 503);
  const ac = new AbortController();
  res.once("close", () => ac.abort());
  const size = imageSize(payload.size);
  /* the tool's size is a hint the model may overrule; saying it helps */
  const shape = { "1024x1536": "Portrait (tall) format.", "1536x1024": "Landscape (wide) format.", "1024x1024": "Square format." }[size] || "";
  const body = JSON.stringify({
    model,
    instructions: "Make the picture the user describes. Do not ask questions; do not add text unless asked.",
    input: [{ role: "user", content: [{ type: "input_text", text: shape ? `${prompt}\n\n${shape}` : prompt }] }],
    tools: [{ type: "image_generation", size, quality: ["low", "medium", "high"].includes(payload.quality) ? payload.quality : "auto" }],
    tool_choice: { type: "image_generation" },
    stream: true,
    store: false,
  });
  const send = (o) => upstreamFetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    signal: ac.signal,
    headers: { ...codexHeaders(o), "Content-Type": "application/json", Accept: "text/event-stream", session_id: crypto.randomUUID() },
    body,
  });
  let o = await ensureOpenAIAuth();
  let up = await send(o);
  if (up.status === 401) { o = await ensureOpenAIAuth(true); up = await send(o); }
  if (!up.ok) throw await failure("ChatGPT", up);
  let image = "", problem = "";
  await streamLines(up, ac.signal, (line) => {
    if (!line.startsWith("data:")) return;
    let e;
    try { e = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (e.type === "response.output_item.done" && e.item?.type === "image_generation_call" && e.item.result) image = e.item.result;
    if (e.type === "response.failed" || e.type === "error") problem = e.response?.error?.message || e.error?.message || e.message || "it failed";
  });
  if (!image) throw new UpstreamError(problem ? `ChatGPT could not make the picture: ${problem}` : "ChatGPT returned no picture.", 502);
  json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: image }] });
}

/* ---------- Gemini app (gemini.google.com session) ----------

   Chat through the web app's own endpoints with the user's Google session
   (gemini-web.mjs). The sign-in is the cookie set of a signed-in browser,
   copied by the Bridge window's login window or pasted. Reverse-engineered:
   models are "known and learned", not listed by Google. */
const GEMINI = "gemini-web";
const GEMINI_NAME = "Gemini app";
const GEMINI_CTX = 131072;
const GEMINI_MAX = Math.max(1, Number(process.env.NOVA_BRIDGE_GEMINI_CONCURRENCY) || 2);
const GEMINI_ROTATE_MS = 9 * 60000;
/* the real browser's saved profile, for signing in (never the user's own) */
const GEMINI_PROFILE = AUTH_FILE + ".browser";
/* Every reply is a conversation of its own in the Gemini app, so each one is
   deleted from the account's history once it has been read; set
   NOVA_BRIDGE_GEMINI_DELETE=0 to keep them. */
const geminiDelete = () => process.env.NOVA_BRIDGE_GEMINI_DELETE !== "0";
let geminiDeleteWarned = false;
let geminiTransport = httpsRequest;
let geminiSess = null;
/* the app's own model list (see geminiAppModels): { at, models } */
let geminiAppList = null;
const GEMINI_LIST_MS = 10 * 60000;
let geminiTimer = null;
let browserSignIn = null;
let geminiActive = 0;
const geminiQueue = [];

/* test hook: replace the HTTPS transport */
export function bridgeSetGeminiTransport(fn) {
  geminiTransport = fn || httpsRequest;
  geminiSess = null;
  geminiAppList = null;
  modelCache.delete(GEMINI);
}

/* Replaces how the sign-in is fetched from a browser (tests): ({ skipSaved }) => Promise<{ cookies, authuser, saved }> */
export function bridgeSetBrowserSignIn(fn) {
  browserSignIn = typeof fn === "function" ? fn : null;
}

/* Google does not say how much of the Gemini app's allowance is left, so the
   Bridge counts what it sent today (a day ends at midnight Pacific time). */
function geminiToday() {
  const s = authStore[GEMINI];
  if (!s) return null;
  const day = pacificDay();
  if (s.usage?.day !== day) s.usage = { day, requests: 0, tokensIn: 0, tokensOut: 0, byModel: {}, limitHitAt: 0 };
  return s.usage;
}

function noteGeminiUse(slug, tokensIn, tokensOut) {
  const u = geminiToday();
  if (!u) return;
  u.requests++;
  u.tokensIn += tokensIn;
  u.tokensOut += tokensOut;
  u.byModel[slug] = (u.byModel[slug] || 0) + 1;
  saveStore();
}

function noteGeminiLimit() {
  const u = geminiToday();
  if (!u) return;
  u.limitHitAt = Date.now();
  saveStore();
}

const geminiProblem = (msg) => {
  const s = authStore[GEMINI];
  if (s) s.problem = msg || null;
};

function geminiSession() {
  const s = authStore[GEMINI];
  if (!s?.cookies?.["__Secure-1PSID"]) throw notConnected(GEMINI_NAME);
  if (!geminiSess) {
    geminiSess = new GeminiWebSession({
      cookies: s.cookies,
      authuser: s.authuser,
      request: geminiTransport,
      onCookies: (c) => {
        if (authStore[GEMINI]) { authStore[GEMINI].cookies = c; saveStore(); }
      },
    });
  }
  return geminiSess;
}

/* a gemini-web.mjs error as the UpstreamError Nova should see */
function geminiFail(e) {
  if (e instanceof UpstreamError) return e;
  const status = e.status || 502;
  if (status === 401) geminiProblem(e.message);
  return Object.assign(new UpstreamError(e.message, status), e.code ? { code: e.code } : {});
}

async function readyGemini(signal) {
  const g = geminiSession();
  if (!g.ready) {
    try {
      await g.init(signal);
    } catch (e) {
      throw geminiFail(e);
    }
    geminiProblem(null);
  }
  return g;
}

/* Keep Google's rotating cookie fresh while the Bridge runs. */
function startGeminiRotation() {
  if (geminiTimer) return;
  geminiTimer = setInterval(async () => {
    if (!isConnected(GEMINI)) return stopGeminiRotation();
    try {
      await geminiSession().rotate();
    } catch (e) {
      if (e.status === 401) geminiProblem(e.message);
    }
  }, GEMINI_ROTATE_MS);
  geminiTimer.unref?.();
}

function stopGeminiRotation() {
  clearInterval(geminiTimer);
  geminiTimer = null;
}

/* Check the cookies against gemini.google.com before keeping them, as every
   other manual sign-in is checked. */
async function geminiSignedIn(cookies, authuser, source) {
  if (!cookies?.["__Secure-1PSID"]) throw new UpstreamError("No __Secure-1PSID cookie in that. Copy it (and __Secure-1PSIDTS) from a browser signed in to gemini.google.com.", 400);
  const sess = new GeminiWebSession({ cookies, authuser, request: geminiTransport });
  try {
    await sess.init();
  } catch (e) {
    throw new UpstreamError(e.message, e.status || 400);
  }
  const prev = authStore[GEMINI];
  signedIn(GEMINI, { cookies: sess.cookies, authuser: sess.authuser, source, models: prev?.models || [], stale: [], usage: prev?.usage });
  sess.onCookies = (c) => {
    if (authStore[GEMINI]) { authStore[GEMINI].cookies = c; saveStore(); }
  };
  geminiSess = sess;
  geminiAppList = null;
  modelCache.delete(GEMINI);
  startGeminiRotation();
}

/* Sign in with pasted cookies (a Cookie header, DevTools rows, a JSON export, or the two bare values). */
export async function bridgeSignInToken(provider, token) {
  if (provider !== GEMINI) throw new UpstreamError(`${provider} signs in with a code, not pasted cookies.`, 400);
  const { cookies, authuser } = parseCookieInput(token);
  await geminiSignedIn(cookies, authuser, "manual");
  return bridgeInfo();
}

/* Learn models: open the browser on Gemini and note each model the user picks
   (see learnGeminiModels). Resolves the names learned when the browser is closed. */
let learning = null;
export function bridgeLearnModels() {
  if (!isConnected(GEMINI)) return Promise.reject(new UpstreamError("Connect the Gemini app first.", 401));
  if (learning) return learning;
  learning = learnGeminiModels({
    profileDir: GEMINI_PROFILE,
    /* the saved Google sign-in goes into that browser: Google refuses to sign in there */
    cookies: authStore[GEMINI]?.cookies,
    onModel: (m) => { try { bridgeGeminiModels(m); } catch (e) { console.warn(`   ${GEMINI}: could not keep ${m.slug}: ${e.message}`); } },
  }).then((names) => {
    if (!names.length && names.problem) {
      console.warn(`   ${GEMINI}: learn models: ${names.problem}`);
      throw new UpstreamError(names.problem, 422);
    }
    return [...names];
  }).finally(() => { learning = null; });
  return learning;
}

/* The models the Gemini app's own picker offers this account, read from the
   app (GeminiWebSession.listModels) and kept for a few minutes. A failed read
   keeps the last list; null when there has never been one. */
async function geminiAppModels(signal) {
  if (geminiAppList && Date.now() - geminiAppList.at < GEMINI_LIST_MS) return geminiAppList.models;
  const g = await readyGemini(signal);
  try {
    geminiAppList = { at: Date.now(), models: await g.listModels(signal) };
  } catch (e) {
    if (e.status === 401) throw geminiFail(e);
    console.warn(`   ${GEMINI}: could not read the Gemini app's model list (${e.message}).`);
    if (geminiAppList) geminiAppList.at = Date.now();
  }
  return geminiAppList?.models || null;
}

/* Models by slug: the app's own, then the ones learned in the Bridge window
   (a browser capture of the model hash, kept for chats that name them). Only
   learned ones go stale: the app's list is the app's word on what exists. */
function geminiKnown() {
  const s = authStore[GEMINI];
  const stale = new Set(s?.stale || []);
  const map = new Map();
  for (const m of s?.models || []) if (m?.slug && m.header) map.set(m.slug, { ...m, stale: stale.has(m.slug) });
  for (const m of geminiAppList?.models || []) map.set(m.slug, { ...m, app: true });
  return map;
}

/* Exactly what the app's picker offers this plan, nothing else: no default,
   no model the plan lacks, and nothing while the list cannot be read.
   (Learned models and "default" still answer a chat that names them.) */
function geminiModelList() {
  return (geminiAppList?.models || []).filter((m) => !m.locked).map((m) => modelEntry(GEMINI, m.slug, { name: m.name, ctx: GEMINI_CTX }));
}

/* Add, replace or remove a learned model: { slug, name, header } or { remove: slug }.
   `header` is the x-goog-ext-525001261-jspb value (or just its model hash). */
export function bridgeGeminiModels({ slug, name, header, remove } = {}) {
  const s = authStore[GEMINI];
  if (!s) throw new UpstreamError("Connect the Gemini app first.", 401);
  const id = String(remove || slug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id === "default") throw new UpstreamError("Model name: letters, digits, dots and dashes only.", 400);
  s.models = (s.models || []).filter((m) => m.slug !== id);
  if (!remove) {
    const h = String(header || "").trim();
    if (!/^([0-9a-f]{8,32}|\[.*\])$/i.test(h)) throw new UpstreamError("header must be the model hash, or the whole x-goog-ext-525001261-jspb value.", 400);
    s.models.push({ slug: id, name: String(name || id).trim() || id, header: h, learnedAt: Date.now() });
    s.stale = (s.stale || []).filter((x) => x !== id);
  }
  modelCache.delete(GEMINI);
  saveStore();
  return geminiModelList().map((m) => ({ id: m.id, name: m.name }));
}

function geminiSlot(signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      const next = geminiQueue.shift();
      if (next) next();
      else geminiActive--;
    };
    if (geminiActive < GEMINI_MAX) {
      geminiActive++;
      return resolve(release);
    }
    const waiter = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(release);
    };
    const onAbort = () => {
      const i = geminiQueue.indexOf(waiter);
      if (i >= 0) geminiQueue.splice(i, 1);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    geminiQueue.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function chatGeminiWeb(payload, slug, ctx) {
  const wanted = String(slug || "").toLowerCase();
  if (wanted && wanted !== "default") await geminiAppModels(ctx.signal).catch(() => null);
  const known = geminiKnown();
  let model;
  if (!wanted || wanted === "default") {
    model = { slug: "default", header: "" };
  } else {
    model = known.get(wanted) || known.get(wanted.replace(/-(low|medium|high)$/, ""));
    if (!model && /argon/.test(wanted)) model = [...known.values()].find((m) => /argon/i.test(m.slug) && !m.stale);
    if (!model) throw new UpstreamError(`The Gemini app has no model "${slug}" here. Known: default${known.size ? `, ${[...known.keys()].join(", ")}` : ""}.`, 404);
    if (model.stale) throw new UpstreamError(`The Gemini app stopped accepting ${model.slug}. Re-learn models in the Bridge window, or use gemini-web/default.`, 404);
  }
  const prompt = toGeminiWebPrompt(payload.messages);
  const release = await geminiSlot(ctx.signal);
  try {
    const g = await readyGemini(ctx.signal);
    /* open() waits for the first words, so a refusal Google puts inside a 200
       answer is still a proper HTTP error for Nova */
    let opened = false;
    let sentText = "";
    let sentThoughts = "";
    const show = (p) => {
      if (p.thoughts.length > sentThoughts.length && p.thoughts.startsWith(sentThoughts)) {
        if (!opened) { opened = true; ctx.open(); }
        ctx.emit({ reasoning: p.thoughts.slice(sentThoughts.length) });
        sentThoughts = p.thoughts;
      }
      if (p.text.length > sentText.length && p.text.startsWith(sentText)) {
        if (!opened) { opened = true; ctx.open(); }
        ctx.emit({ content: p.text.slice(sentText.length) });
        sentText = p.text;
      }
    };
    let final;
    try {
      final = await g.stream({ prompt, header: model.header, signal: ctx.signal, onSnapshot: show });
    } catch (e) {
      if (e.code === 1037) noteGeminiLimit();
      if ((e.code === 1050 || e.code === 1052) && model.header && !model.app) {
        const s = authStore[GEMINI];
        if (s) { s.stale = [...new Set([...(s.stale || []), model.slug])]; saveStore(); modelCache.delete(GEMINI); }
      }
      throw geminiFail(e);
    }
    show(final);
    /* the app names the model that answered: a header it no longer honours
       falls back to the account's default without any error (Auto picks one
       for itself) */
    if (model.header && !(model.app && model.slug === "auto") && !servedModelMatches(final.model, model.name || model.slug)) {
      console.warn(`   ${GEMINI}: asked for ${model.slug} but the Gemini app answered with "${final.model}".${model.app ? (model.locked ? " This plan does not include it." : "") : " Its model header may be stale: re-learn models in the Bridge window."}`);
    }
    if (!opened) { opened = true; ctx.open(); }
    const out = estimateTokens(final.text) + estimateTokens(final.thoughts);
    const into = estimateTokens(prompt);
    ctx.emit({ finishReason: "stop", usage: { prompt_tokens: into, completion_tokens: out, total_tokens: into + out } });
    geminiProblem(null);
    noteGeminiUse(model.slug, into, out);
    if (geminiDelete() && final.cid) {
      g.deleteChat(final.cid).then((ok) => {
        if (!ok && !geminiDeleteWarned) { geminiDeleteWarned = true; console.warn(`${GEMINI}: could not remove a chat from the Gemini app's history; it stays there until deleted by hand.`); }
      }).catch(() => {});
    }
  } finally {
    release();
  }
}

async function chatClaude(payload, model, ctx) {
  const s = await checkClaude();
  if (!s?.loggedIn) throw new UpstreamError(s?.installed === false ? "Claude Code is not installed on the Bridge's computer." : "Claude Code is signed out. Connect Claude again in the Bridge window.", 401);
  const { system, prompt } = toClaudeCodePrompt(payload.messages);
  await claudeChat({ system, prompt, model, signal: ctx.signal, emit: ctx.emit, open: ctx.open });
}

const CHAT = {
  antigravity: (p, m, ctx) => chatGoogle("antigravity", p, m, ctx),
  claude: chatClaude,
  openai: chatOpenAI,
  [GEMINI]: chatGeminiWeb,
};

/* ---------- Sign-in flows ---------- */

/* The desktop app hands the Bridge its own way of opening a link (Electron's
   shell.openExternal), which finds the browser the way the desktop does;
   run on its own, the Bridge uses the system's opener. A failure is kept
   and shown, and the Bridge window's Open button tries again. */
let opener = null;
export function bridgeSetOpener(fn) { opener = typeof fn === "function" ? fn : null; }
function systemOpen(url) {
  const done = (e) => { if (e) console.warn(`   Could not open the browser: ${e.message}`); };
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url], done);
  else if (process.platform === "darwin") execFile("open", [url], done);
  else execFile("xdg-open", [url], done);
}
function openBrowser(url) {
  if (!opener) return systemOpen(url);
  Promise.resolve().then(() => opener(url)).catch((e) => {
    console.warn(`   Could not open the browser (${e?.message || e}); trying the system's opener.`);
    systemOpen(url);
  });
}

const signedIn = (id, entry) => {
  authStore[id] = entry;
  authStore.skipCli = authStore.skipCli.filter((p) => p !== id);
  modelCache.delete(id);
  saveStore();
  pendingFlows.set(id, { status: "complete" });
};

/* Google: browser sign-in with PKCE. Google only ever sends the browser back
   to http://localhost:51121. Signing in on this computer, a one-time listener
   there takes the code. Signing in on a phone, that address is the phone
   itself, so the page fails to load; the address it shows carries the code
   and is pasted back into Nova (finishGoogleOAuth). */
const googleListeners = new Map();

const googlePage = (msg) => `<html><body style="background:#0a0a0c;color:#e4e4e7;font-family:system-ui;padding:40px;text-align:center"><h2>${msg}</h2><p>You can close this tab and return to Nova.</p></body></html>`;

async function exchangeGoogleCode(channel, flow, code) {
  const cfg = GOOGLE[channel];
  const { res: r, data: tok } = await postForm("https://oauth2.googleapis.com/token", {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: flow.verifier,
    grant_type: "authorization_code",
    redirect_uri: flow.redirectUri,
  });
  if (!r.ok || !tok.access_token) throw new UpstreamError(`Google sign-in failed: ${tok.error_description || tok.error || `token exchange failed (${r.status})`}`, 400);
  signedIn(channel, {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || "",
    expires_at: Date.now() + Number(tok.expires_in || 3600) * 1000,
    project: "",
    source: "oauth",
  });
  googleListeners.get(channel)?.close();
  /* set up the Code Assist project now, so the first chat does not wait */
  ensureGoogleAuth(channel).catch((e) => pendingFlows.set(channel, { status: "error", message: e.message }));
}

/* The address the phone's browser was sent back to (or just its code). */
async function finishGoogleOAuth(channel, pasted) {
  const flow = pendingFlows.get(channel);
  if (flow?.status !== "pending" || !flow.verifier) throw new UpstreamError("No Google sign-in is waiting. Tap Connect again.", 409);
  const text = String(pasted || "").trim();
  const query = new URLSearchParams(text.includes("?") ? text.slice(text.indexOf("?") + 1) : text.includes("=") ? text : "");
  const code = query.get("code") || (/^[\w/.-]{20,}$/.test(text) ? text : "");
  if (!code) throw new UpstreamError(query.get("error") ? `Google says: ${query.get("error")}` : "That address has no sign-in code in it. Copy the whole address of the page Google sent you to.", 400);
  if (query.has("state") && query.get("state") !== flow.state) throw new UpstreamError("That address is from an older sign-in. Tap Connect again.", 400);
  await exchangeGoogleCode(channel, flow, code);
}

function startGoogleOAuth(channel, { local = true } = {}) {
  const cfg = googleClient(channel);
  googleListeners.get(channel)?.close();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `http://localhost:${cfg.port}${cfg.callbackPath}`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", cfg.clientId);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("scope", cfg.scopes.join(" "));
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("state", state);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  /* a phone needs time to copy the address back */
  const flow = { status: "pending", url: auth.toString(), expires_at: Date.now() + 10 * 60000, verifier, state, redirectUri,
    /* shown in the Bridge window, with Open beside it */
    message: "Sign in to Google in your browser. No browser? Press Open." };

  const cb = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname !== cfg.callbackPath) {
      res.writeHead(404);
      return res.end();
    }
    const code = u.searchParams.get("code");
    if (!code || u.searchParams.get("state") !== state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(googlePage("Sign-in was cancelled or did not match."));
      if (pendingFlows.get(channel) === flow) pendingFlows.set(channel, { status: "error", message: u.searchParams.get("error") || "Sign-in was cancelled." });
      return cb.close();
    }
    try {
      await exchangeGoogleCode(channel, flow, code);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(googlePage("✅ Connected to Nova Bridge"));
    } catch (e) {
      pendingFlows.set(channel, { status: "error", message: e.message });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(googlePage("Sign-in failed. Return to Nova Bridge for details."));
    }
    cb.close();
  });
  cb.on("close", () => { if (googleListeners.get(channel) === cb) googleListeners.delete(channel); });
  setTimeout(() => {
    cb.close();
    if (pendingFlows.get(channel) === flow) pendingFlows.set(channel, { status: "error", message: "Sign-in timed out. Try again." });
  }, 10 * 60000).unref();

  return new Promise((resolve, reject) => {
    cb.once("error", (e) => {
      /* from a phone the code comes back by paste, so a busy port is no matter */
      if (!local) {
        pendingFlows.set(channel, flow);
        return resolve(flow);
      }
      reject(new UpstreamError(e.code === "EADDRINUSE" ? `Port ${cfg.port} is busy (is the official app signing in?). Close it and try again.` : e.message, 409));
    });
    /* loopback only: the callback must never be reachable from the LAN */
    cb.listen(cfg.port, "127.0.0.1", () => {
      googleListeners.set(channel, cb);
      pendingFlows.set(channel, flow);
      if (local) openBrowser(flow.url);
      resolve(flow);
    });
  });
}

/* Device flows (GitHub, ChatGPT): show a code, poll until it is entered or
   the code expires. Works from any device. */
function pollDevice(id, flow, attempt) {
  const tick = async () => {
    if (pendingFlows.get(id) !== flow) return;
    if (Date.now() > flow.expires_at) {
      pendingFlows.set(id, { status: "error", message: "The code expired. Try again." });
      return;
    }
    try {
      const out = await attempt(flow);
      if (out === "done") return;
      if (out?.error) {
        pendingFlows.set(id, { status: "error", message: out.error });
        return;
      }
    } catch (e) {
      flow.lastError = e.message;
    }
    setTimeout(tick, flow.interval).unref();
  };
  setTimeout(tick, flow.interval).unref();
}

async function startOpenAIDeviceFlow() {
  const res = await upstreamFetch("https://auth.openai.com/api/accounts/deviceauth/usercode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.device_auth_id) {
    throw new UpstreamError("Could not start ChatGPT sign-in. Turn on device code sign-in in ChatGPT → Settings → Security, then try again.", 502);
  }
  const flow = {
    status: "pending",
    user_code: data.user_code || data.usercode,
    verification_uri: "https://auth.openai.com/codex/device",
    device_auth_id: data.device_auth_id,
    interval: (Number(data.interval) || 5) * 1000,
    expires_at: Date.now() + 15 * 60000,
  };
  pendingFlows.set("openai", flow);
  pollDevice("openai", flow, async (f) => {
    const r = await upstreamFetch("https://auth.openai.com/api/accounts/deviceauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: f.device_auth_id, user_code: f.user_code }),
    });
    /* 403/404 mean "not entered yet" */
    if (r.status === 403 || r.status === 404) return;
    if (!r.ok) return { error: `ChatGPT sign-in failed (${r.status}).` };
    const d = await r.json();
    const { res: tr, data: tok } = await postForm("https://auth.openai.com/oauth/token", {
      grant_type: "authorization_code",
      code: d.authorization_code,
      redirect_uri: "https://auth.openai.com/deviceauth/callback",
      client_id: OPENAI_CLIENT_ID,
      code_verifier: d.code_verifier,
    });
    if (!tr.ok || !tok.access_token) return { error: tok.error_description || tok.error || `ChatGPT token exchange failed (${tr.status}).` };
    signedIn("openai", {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || "",
      id_token: tok.id_token || "",
      account_id: extractChatGptAccountId(tok) || "",
      expires_at: Date.now() + Number(tok.expires_in || 3600) * 1000,
      source: "device-flow",
    });
    return "done";
  });
  return publicFlow(flow);
}

/* what the panel may see of a flow: never the device codes */
const publicFlow = (f) => (f ? { status: f.status, user_code: f.user_code, verification_uri: f.verification_uri, url: f.url, message: f.message || f.lastError, expires_at: f.expires_at } : null);

/* non-admin devices see only the coarse state, never the sign-in URL or device code */
const coarseFlow = (f) => (f ? { status: f.status } : null);

const START = {
  /* Antigravity (the app or agy) signed in on this computer is used at once;
     otherwise Google's sign-in page, when this build has the client for it */
  async antigravity(o) {
    const cred = await readAgyCredential();
    if (!cred?.token?.refresh_token && secretToolMissing && !googleReady("antigravity")) {
      throw new UpstreamError("Nova Bridge needs secret-tool to read Antigravity's sign-in. Install it (sudo apt install libsecret-tools), then select Sign in again.", 503);
    }
    if (!cred?.token?.refresh_token) return startGoogleOAuth("antigravity", o).then(publicFlow);
    signedIn("antigravity", { source: "agy", email: cred.id_token_email || "", project: "" });
    return publicFlow(pendingFlows.get("antigravity"));
  },
  /* Only from the Bridge window, after its warning: Claude Code signs in
     in the browser (or is signed in already), then the Bridge counts it. */
  async claude({ window } = {}) {
    if (!window) throw new UpstreamError("Connect Claude in the Bridge window on the computer running it.", 400);
    const current = pendingFlows.get("claude");
    if (current?.status === "pending") return publicFlow(current);
    const s = await claudeStatus({ fresh: true });
    claudeLive = s;
    if (!s.installed) throw new UpstreamError("Claude Code is not installed on this computer.", 400);
    if (s.loggedIn) { signedIn("claude", { source: "claude-code", plan: s.plan || "" }); return publicFlow(pendingFlows.get("claude")); }
    pendingFlows.set("claude", { status: "pending", message: "Finish signing in in the browser." });
    claudeLogin({ onUrl: (url) => { const f = pendingFlows.get("claude"); if (f?.status === "pending") pendingFlows.set("claude", { ...f, url }); } }).then((st) => { claudeLive = st; signedIn("claude", { source: "claude-code", plan: st.plan || "" }); })
      .catch((e) => pendingFlows.set("claude", { status: "error", message: e.message }));
    return publicFlow(pendingFlows.get("claude"));
  },
  /* the Codex sign-in on this computer is used at once; otherwise a device code */
  async openai() {
    if (!readJson(CODEX_AUTH())?.tokens?.refresh_token) return startOpenAIDeviceFlow();
    signedIn("openai", { source: "codex-cli" });
    return publicFlow(pendingFlows.get("openai"));
  },
  /* The user's own browser, on this computer only: Firefox's Google sign-in, or
     Chrome/Edge/Brave opened for signing in (Google refuses embedded windows). */
  async [GEMINI]({ local } = {}) {
    if (!local) throw new UpstreamError("Sign in from the Bridge window on the computer running it, or paste your gemini.google.com cookies below.", 400);
    if (!browserSignIn && process.env.NOVA_BRIDGE_GEMINI_BROWSER === "none") throw new UpstreamError("Browser sign-in is switched off: paste your gemini.google.com cookies instead.", 400);
    /* Connect pressed again while the browser is open: the same sign-in, not a second */
    const current = pendingFlows.get(GEMINI);
    if (current?.status === "pending" && !current.retry) return publicFlow(current);
    pendingFlows.set(GEMINI, { status: "pending", message: "Looking for your Google sign-in…" });
    const say = (message) => { if (pendingFlows.get(GEMINI)?.status === "pending") pendingFlows.set(GEMINI, { status: "pending", message }); };
    const fetchCookies = (skipSaved) => (browserSignIn ? browserSignIn({ skipSaved }) : getGeminiCookies({ profileDir: GEMINI_PROFILE, interactive: true, onStatus: say, skipSaved }));
    const use = (r) => {
      if (r?.retryMessage) pendingFlows.set(GEMINI, { status: "pending", retry: true, message: r.retryMessage });
      else return geminiSignedIn(r?.cookies, r?.authuser || 0, "browser");
    };
    Promise.resolve()
      .then(() => fetchCookies(false))
      /* the browser's saved sign-in Google has since ended: open the window to sign in again */
      .then((r) => Promise.resolve(use(r)).catch((e) => {
        if (e.status !== 401 || !r?.saved) throw e;
        say("That sign-in has ended. Sign in to Google in the browser window, then close it.");
        return Promise.resolve(fetchCookies(true)).then(use);
      }))
      .catch((e) => pendingFlows.set(GEMINI, { status: "error", message: e.message }));
    return publicFlow(pendingFlows.get(GEMINI));
  },
};

/* ---------- Who may call ----------

   A browser lets any web page send a request to localhost, so with an open
   CORS policy any site you visit could use your subscriptions. Only explicitly configured website origins are let through. Requests with no Origin at all
   (curl, the Android app's native HTTP) are not from a web page. */
const PRIVATE_HOST = (h) => h === "localhost" || h === "[::1]" || (isIP(h) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h));

/* The Nova desktop app serves Nova from this computer only, on a fixed port
   (desktop/main.cjs). Allowed past the origin check by default, and a device
   access request from it, over loopback, is approved as it asks: it is Nova
   on this very computer. A web page cannot claim that origin. */
const DESKTOP_PORT = Number(process.env.NOVA_DESKTOP_PORT) || 47615;
const desktopOrigin = (origin) => origin === `http://127.0.0.1:${DESKTOP_PORT}` || origin === `http://localhost:${DESKTOP_PORT}`;

export function originAllowed(origin) {
  if (!origin) return true;
  if (desktopOrigin(origin)) return true;
  return deviceAccess.allowsOrigin(origin) || String(process.env.NOVA_BRIDGE_ORIGINS || "").split(",").some(value => value.trim().replace(/\/+$/, "") === origin);
}

const isLoopback = (req) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || "");
const peerAddress = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");

/* ---------- The trusted network ----------

   Besides this computer, the Bridge answers only devices on one of its own
   local networks: a private address inside the range of one of this
   computer's network adapters (the Wi-Fi it is on). Anything else is
   dropped before it is read. Each approved device is tied to the network
   it was approved on. */
const ipNum = (ip) => ip.split(".").reduce((n, b) => (n * 256) + Number(b), 0);
export function networkOf(address) {
  if (isIP(address) !== 4 || !PRIVATE_HOST(address)) return null;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal || !n.netmask) continue;
      const mask = ipNum(n.netmask);
      /* a range wider than a /16 is not a home network */
      if (mask < ipNum("255.255.0.0")) continue;
      const base = (ipNum(n.address) & mask) >>> 0;
      if (((ipNum(address) & mask) >>> 0) === base) {
        const bits = n.netmask.split(".").reduce((c, b) => c + Number(b).toString(2).replace(/0/g, "").length, 0);
        return `${[base >>> 24, (base >>> 16) & 255, (base >>> 8) & 255, base & 255].join(".")}/${bits}`;
      }
    }
  }
  return null;
}
/* this computer, or a device on its own network; `net` for the latter */
function peerOf(req) {
  if (isLoopback(req)) return { ok: true, net: null };
  const net = networkOf(peerAddress(req));
  return { ok: !!net, net };
}

/* ---------- Live numbers (for the Nova Bridge window) ----------

   Who has talked to the Bridge lately, and what is in flight right now. A
   device counts as active for DEVICE_TTL after its last request. */
const DEVICE_TTL = 5 * 60000;
const stats = { startedAt: 0, requests: 0, active: 0, errors: 0, devices: new Map(), last: null };

function noteDevice(req) {
  const raw = peerAddress(req);
  const local = isLoopback(req);
  const id = req.deviceId || (local ? "local" : raw);
  const ua = String(req.headers["user-agent"] || "");
  const kind = local ? "This computer" : /android|okhttp|capacitor/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iPhone" : /windows|macintosh|linux/i.test(ua) ? "Computer" : "Device";
  const d = stats.devices.get(id) || { id, deviceId: req.deviceId || null, address: local ? "localhost" : raw, kind, requests: 0 };
  d.kind = kind;
  d.address = local ? "localhost" : raw;
  d.requests++;
  d.lastSeen = Date.now();
  stats.devices.set(id, d);
}

/* Origin checks are not authentication. The key makes a caller an admin; an
   approved device, on the network it was approved on, may chat. */
function keyOk(req) {
  const sent = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(sent);
  const b = Buffer.from(KEY);
  req.deviceId = deviceAccess.authorize(sent, req.headers.origin, req.peer?.net || null);
  req.isAdmin = !!KEY && a.length === b.length && crypto.timingSafeEqual(a, b);
  return req.isAdmin || !!req.deviceId;
}

/* ---------- HTTP server ---------- */

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
      /* virtual adapters (WSL, Hyper-V, VirtualBox, Docker) are not reachable from a phone */
      const virtual = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|loopback/i.test(name);
      out.push({ address: n.address, virtual });
    }
  }
  return out.sort((a, b) => a.virtual - b.virtual).map((n) => n.address);
}

function getLocalIp() {
  const all = lanAddresses();
  return all.find((a) => a.startsWith("192.168.")) || all.find((a) => /^(10|172)\./.test(a)) || all[0] || "";
}

function statusPayload(full, admin = true) {
  if (full) autoDiscoverCliCredentials();
  const ip = full ? getLocalIp() : null;
  const base = { ok: true, name: full ? os.hostname() : "Nova Bridge", port: PORT, lan: LAN && ip ? `http://${ip}:${PORT}/v1` : null, locked: true };
  if (!full) return { ...base, providers: {}, models: [] };
  const providers = {};
  for (const p of SUBSCRIPTION_PROVIDERS) {
    const s = authStore[p.id];
    providers[p.id] = {
      connected: isConnected(p.id),
      source: s?.source || null,
      project: s?.project || null,
      problem: s?.problem || null,
      flow: admin ? publicFlow(pendingFlows.get(p.id)) : coarseFlow(pendingFlows.get(p.id)),
    };
  }
  /* cached or curated rows only: health must answer at once */
  const models = connectedProviders().flatMap((p) => cachedModels(p));
  return { ...base, providers, models };
}

const json = (res, code, body, headers) => {
  if (res.headersSent) return res.end();
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
};

const errorBody = (status, message) => ({ error: { code: status, message } });

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new UpstreamError("Request too large.", 413));
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new UpstreamError("Invalid JSON.", 400)); }
    });
    req.on("error", reject);
    req.on("aborted", () => reject(new UpstreamError("Request disconnected.", 400)));
  });
}

async function handleChat(req, res) {
  const payload = await readBody(req);
  if (!Array.isArray(payload.messages) || !payload.messages.length) throw new UpstreamError("messages is required.", 400);
  const isStream = payload.stream === true;
  const connected = connectedProviders();
  let requestedModel = String(payload.model || "").trim();
  /* "auto" (or no model), like OpenRouter's: the first model a connected subscription offers */
  if (!requestedModel || requestedModel === "auto") {
    requestedModel = (await activeModelsList())[0]?.id || "";
    if (!requestedModel) {
      const problems = connected.map((p) => authStore[p]?.problem).filter(Boolean);
      throw new UpstreamError(problems[0] || "No subscription is connected. Connect one in Nova → Settings → Nova Bridge.", connected.length ? 403 : 401);
    }
  }
  const route = resolveSubscriptionModel(requestedModel, connected);
  if (res.destroyed) return;
  const responses = subscriptionReplies.get(route.provider) || new Set();
  responses.add(res); subscriptionReplies.set(route.provider, responses);
  res.once("close", () => { responses.delete(res); if (!responses.size) subscriptionReplies.delete(route.provider); });
  const model = requestedModel;
  const id = `gen-${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  const created = Math.floor(Date.now() / 1000);
  const frame = (delta, finish = null, usage) => JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    provider: route.provider,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  });

  /* stopped by Nova, or the upstream went quiet for too long */
  if (res.destroyed) return;
  const abort = new AbortController();
  let timedOut = false;
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { timedOut = true; abort.abort(); }, IDLE_MS);
  };
  res.on("close", () => { if (!res.writableEnded) abort.abort(); });
  touch();

  let opened = false;
  let text = "";
  let reasoning = "";
  let finish = null;
  let usage = null;
  const ctx = {
    signal: abort.signal,
    open() {
      opened = true;
      if (isStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(": NOVA BRIDGE PROCESSING\n\n");
      }
    },
    emit(d) {
      touch();
      if (d.usage) usage = d.usage;
      if (d.finishReason) finish = d.finishReason;
      if (d.reasoning) {
        reasoning += d.reasoning;
        if (isStream) res.write(`data: ${frame({ role: "assistant", reasoning: d.reasoning, reasoning_content: d.reasoning })}\n\n`);
      }
      if (d.content) {
        text += d.content;
        if (isStream) res.write(`data: ${frame({ role: "assistant", content: d.content })}\n\n`);
      }
    },
  };

  try {
    await CHAT[route.provider](payload, route.upstreamModel, ctx);
    clearTimeout(idle);
    if (!text && finish === "content_filter") throw new UpstreamError("The reply was blocked by the provider's safety filter.", 422);
    if (!text && !reasoning) throw new UpstreamError("The model sent back an empty reply.", 502);
    if (isStream) {
      res.write(`data: ${frame({}, finish || "stop", usage)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      json(res, 200, {
        id,
        object: "chat.completion",
        created,
        model,
        provider: route.provider,
        choices: [{ index: 0, message: { role: "assistant", content: text, ...(reasoning ? { reasoning, reasoning_content: reasoning } : {}) }, finish_reason: finish || "stop" }],
        ...(usage ? { usage } : {}),
      });
    }
  } catch (e) {
    clearTimeout(idle);
    if (abort.signal.aborted && !timedOut) return res.end();
    const status = timedOut ? 504 : e.status || 502;
    const msg = timedOut ? `The upstream sent nothing for ${IDLE_MS / 1000}s.` : e.message || "Upstream subscription request failed.";
    /* never the upstream's own words: they can quote the conversation */
    console.warn(`Upstream request failed (HTTP ${status}) for ${model}${e.reason ? `: ${e.reason}` : ""}.`);
    if (opened && isStream) {
      res.write(`data: ${JSON.stringify(errorBody(status, msg))}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      json(res, status, errorBody(status, msg), e.retryAfter ? { "Retry-After": String(e.retryAfter) } : undefined);
    }
  }
}

async function handleAuth(req, res, provider, action) {
  if (!PROVIDER_IDS.includes(provider)) return json(res, 404, errorBody(404, `Unknown provider: ${provider}`));
  const body = await readBody(req);

  if (action === "logout") {
    bridgeSignOut(provider);
    return json(res, 200, statusPayload(true));
  }

  if (action === "token") {
    const token = String(body.token || "").trim();
    if (!token) return json(res, 400, errorBody(400, "Token is required."));
    if (provider === GEMINI) {
      try {
        await bridgeSignInToken(GEMINI, token);
      } catch (e) {
        return json(res, e.status || 400, errorBody(e.status || 400, e.message));
      }
      return json(res, 200, statusPayload(true));
    }
    if (provider === "claude") return json(res, 400, errorBody(400, "Connect Claude in the Bridge window."));
    if (provider in GOOGLE) signedIn(provider, { refresh_token: token, source: "manual", project: "" });
    else signedIn("openai", { access_token: token, expires_at: jwtExpiry(token), source: "manual" });
    /* check it works before saying so */
    try {
      if (provider in GOOGLE) await ensureGoogleAuth(provider, true);
      else await ensureOpenAIAuth();
    } catch (e) {
      authStore[provider] = null;
      saveStore();
      return json(res, e.status || 400, errorBody(e.status || 400, e.message));
    }
    return json(res, 200, statusPayload(true));
  }

  if (action === "models" && provider === GEMINI) {
    try {
      return json(res, 200, { models: bridgeGeminiModels(body) });
    } catch (e) {
      return json(res, e.status || 400, errorBody(e.status || 400, e.message));
    }
  }

  if (action === "callback") {
    if (!(provider in GOOGLE)) return json(res, 404, errorBody(404, `${provider} signs in with a code, not an address.`));
    await finishGoogleOAuth(provider, body.url);
    return json(res, 200, statusPayload(true));
  }

  /* the browser opens on this computer only when the sign-in started here */
  if (action === "start") return json(res, 200, await START[provider]({ local: isLoopback(req) }));
  return json(res, 404, errorBody(404, `Unknown action: ${action}`));
}

/* ---------- Sync between devices ----------

   The Bridge keeps one shared copy of the library: the last Nova backup a
   device sent it, as the file and a small note of who sent it and when.
   Other devices read the note, download the file and merge it into their
   own data or replace it (the app decides; the Bridge only stores). The
   file is streamed to disk, never held whole: a library with pictures can
   be hundreds of MB. Written through a .part and renamed, so the copy under
   the real name is always complete. Only a device with a credential (the
   key or an approved device) may use it. */
const SYNC_DIR = process.env.NOVA_BRIDGE_SYNC_DIR || `${AUTH_FILE}.sync`;
const SYNC_FILE = path.join(SYNC_DIR, "library.json");
const SYNC_META = path.join(SYNC_DIR, "library.meta.json");
const SYNC_LIMIT = Number(process.env.NOVA_BRIDGE_SYNC_LIMIT) || 1024 * 1024 * 1024;

export function syncMeta() {
  try {
    const meta = JSON.parse(fs.readFileSync(SYNC_META, "utf8"));
    if (meta && Number(meta.rev) > 0 && fs.existsSync(SYNC_FILE)) return meta;
  } catch {}
  return { rev: 0 };
}

const header = (req, name, max = 200) => {
  let v = String(req.headers[name] || "");
  try { v = decodeURIComponent(v); } catch {}
  return v.replace(/[\u0000-\u001f]/g, "").slice(0, max);
};

async function receiveSync(req) {
  fs.mkdirSync(SYNC_DIR, { recursive: true, mode: 0o700 });
  const part = `${SYNC_FILE}.${crypto.randomUUID()}.part`;
  const out = fs.createWriteStream(part, { mode: 0o600 });
  let size = 0;
  let head = "";
  try {
    await new Promise((resolve, reject) => {
      const fail = (e) => { req.unpipe?.(out); out.destroy(); reject(e); };
      req.on("data", (c) => {
        size += c.length;
        if (head.length < 64) head += c.toString("utf8", 0, 64);
        if (size > SYNC_LIMIT) { fail(new UpstreamError("That library is larger than this Bridge accepts.", 413)); req.destroy(); return; }
        if (!out.write(c)) { req.pause(); out.once("drain", () => req.resume()); }
      });
      req.on("end", () => out.end(resolve));
      req.on("aborted", () => fail(new UpstreamError("The upload was cut off.", 400)));
      req.on("error", fail);
      out.on("error", fail);
    });
    if (!/^\s*\{\s*"app"\s*:\s*"nova"/.test(head)) throw new UpstreamError("That is not a Nova backup.", 400);
    const prev = syncMeta();
    const meta = {
      rev: (Number(prev.rev) || 0) + 1,
      at: Date.now(),
      bytes: size,
      device: header(req, "x-nova-device", 60) || "Nova device",
      summary: header(req, "x-nova-summary"),
      version: header(req, "x-nova-version", 30),
    };
    fs.renameSync(part, SYNC_FILE);
    fs.writeFileSync(`${SYNC_META}.tmp`, JSON.stringify(meta), { mode: 0o600 });
    fs.renameSync(`${SYNC_META}.tmp`, SYNC_META);
    return meta;
  } catch (e) {
    try { fs.unlinkSync(part); } catch {}
    throw e;
  }
}

async function handleSync(req, res, pathname) {
  if (!req.isAdmin && !req.deviceId) return json(res, 403, errorBody(403, "Sync needs this device approved in the Bridge window. Request device access in Settings → Nova Bridge."));
  const data = pathname.endsWith("/data");
  if (req.method === "GET" && !data) return json(res, 200, syncMeta());
  if (req.method === "GET") {
    const meta = syncMeta();
    if (!meta.rev) return json(res, 404, errorBody(404, "Nothing has been synced to this Bridge yet."));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": fs.statSync(SYNC_FILE).size, "X-Nova-Rev": String(meta.rev) });
    return new Promise((resolve) => {
      const file = fs.createReadStream(SYNC_FILE);
      file.on("error", () => { res.destroy(); resolve(); });
      res.on("close", () => { file.destroy(); resolve(); });
      file.pipe(res);
    });
  }
  if (req.method === "PUT" && !data) {
    /* a device that last saw an older copy must not overwrite a newer one
       blindly: it says which revision it based its upload on */
    const base = req.headers["x-nova-base-rev"];
    const current = syncMeta().rev;
    if (base != null && base !== "" && Number(base) !== current) {
      req.resume();
      return json(res, 409, { ...errorBody(409, "Another device synced since this one last did. Get its changes first."), rev: current });
    }
    return json(res, 200, await receiveSync(req));
  }
  return json(res, 405, errorBody(405, "Use GET or PUT."));
}

export const server = http.createServer(async (req, res) => {
  /* not this computer and not its own network: no answer at all */
  req.peer = peerOf(req);
  if (!req.peer.ok) { req.socket.destroy(); return; }
  const origin = req.headers.origin;
  const pathname = new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "");
  const pairingPath = ["/pair/request", "/pair/status"].includes(pathname);
  let pairingOrigin = false;
  try {
    const url = new URL(origin);
    pairingOrigin = origin === url.origin && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {}
  const trustedOrigin = originAllowed(origin);
  const publicHealth = ["/health", "/v1/health"].includes(pathname) && ["GET", "OPTIONS"].includes(req.method);
  if (!trustedOrigin && !(pairingOrigin && ((pairingPath && ["POST", "OPTIONS"].includes(req.method)) || publicHealth))) {
    console.warn(`[${new Date().toLocaleTimeString()}] refused a request from ${origin}`);
    return json(res, 403, errorBody(403, `Origin ${origin} is not allowed.`));
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Title, HTTP-Referer, X-Nova-Device, X-Nova-Summary, X-Nova-Version, X-Nova-Base-Rev");
  res.setHeader("Access-Control-Expose-Headers", "X-Nova-Rev, Retry-After");
  /* Chrome's private network access check for a page reaching a LAN address */
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const key = keyOk(req);
  if (key !== false) noteDevice(req);

  try {
    /* health answers everyone allowed, but tells a device without the key only that it is locked */
    if (req.method === "GET" && (pathname === "" || pathname === "/health" || pathname === "/v1/health")) {
      return json(res, 200, { ...statusPayload(key !== false && trustedOrigin, !!req.isAdmin || isLoopback(req)), management: !!req.isAdmin && trustedOrigin });
    }
    if (req.method === "POST" && ["/pair/request", "/pair/status"].includes(pathname)) {
      const deadline = setTimeout(() => req.destroy(), 5000);
      let body;
      try { body = await readBody(req, 2048); } finally { clearTimeout(deadline); }
      const result = pathname === "/pair/request"
        ? deviceAccess.request(body, isLoopback(req) ? "localhost" : peerAddress(req), origin, { net: req.peer.net, auto: isLoopback(req) && desktopOrigin(origin) })
        : deviceAccess.status(body.id, body.token);
      return json(res, 200, result);
    }
    if (key === false) return json(res, 401, errorBody(401, "Request access in Nova, then approve the matching code in the Bridge window."));

    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      return json(res, 200, { object: "list", data: await activeModelsList() });
    }

    if (req.method === "GET" && (pathname === "/v1/usage" || pathname === "/usage")) {
      return json(res, 200, await usagePayload({ raw: new URL(req.url, "http://x").searchParams.has("raw") }));
    }

    if (pathname === "/v1/sync" || pathname === "/sync" || pathname === "/v1/sync/data" || pathname === "/sync/data") {
      return await handleSync(req, res, pathname);
    }

    if (req.method === "POST" && pathname.startsWith("/auth/")) {
      /* Authentication changes require the same key as model requests. */
      const [, , provider, action = "start"] = pathname.split("/");
      if (!req.isAdmin) return json(res, 403, errorBody(403, "Manage subscriptions in the Bridge window."));
      return await handleAuth(req, res, provider, action);
    }

    if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
      stats.requests++;
      stats.active++;
      if (req.deviceId) {
        const replies = deviceReplies.get(req.deviceId) || new Set();
        replies.add(res); deviceReplies.set(req.deviceId, replies);
        res.once("close", () => { replies.delete(res); if (!replies.size) deviceReplies.delete(req.deviceId); });
      }
      try { return await handleChat(req, res); } finally { stats.active--; }
    }

    if (req.method === "POST" && (pathname === "/v1/images/generations" || pathname === "/images/generations")) {
      stats.requests++;
      stats.active++;
      try { return await handleImages(req, res); } finally { stats.active--; }
    }

    if (req.method === "POST" && (pathname === "/v1/audio/speech" || pathname === "/audio/speech")) {
      return json(res, 501, errorBody(501, "Nova Bridge cannot read aloud: ChatGPT, Claude and Gemini subscriptions have no speech API. Use the device voice or an OpenAI key."));
    }

    json(res, 404, errorBody(404, `Not found: ${pathname}`));
  } catch (e) {
    stats.errors++;
    stats.last = { at: Date.now(), message: e.message };
    json(res, e.status || 500, errorBody(e.status || 500, e.message));
  }
});
/* one bad socket must never take the Bridge down */
server.on("clientError", (_e, socket) => { try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch {} });
server.requestTimeout = 0;
const sockets = new Set();
server.on("connection", (sock) => { sockets.add(sock); sock.on("close", () => sockets.delete(sock)); });

/* ---------- Being found on the network ----------

   Nova on a phone broadcasts NOVA_BRIDGE_DISCOVER to this port over UDP;
   the answer comes from this computer's address, which is all it needs. */
let finderSocket = null;
function startFinder() {
  const finder = dgram.createSocket({ type: "udp4", reuseAddr: true });
  finder.on("message", (msg, rinfo) => {
    if (!msg.toString("utf8").startsWith("NOVA_BRIDGE_DISCOVER")) return;
    /* found only from this computer's own network */
    if (!networkOf(rinfo.address)) return;
    const reply = Buffer.from(JSON.stringify({ nova: "bridge", port: PORT, name: os.hostname() }));
    finder.send(reply, rinfo.port, rinfo.address, () => {});
  });
  finder.on("error", (e) => {
    console.warn(`⚠️  Network discovery is off (${e.message}). Phones can still use the address below.`);
    try { finder.close(); } catch {}
  });
  finder.bind(PORT, "0.0.0.0");
  finderSocket = finder;
}

/* ---------- Running it ----------

   startBridge / stopBridge / bridgeInfo are what the Nova Bridge window
   (bridge/app/) drives; `npm run bridge` uses the same calls. */

export function startBridge() {
  if (server.listening) return Promise.resolve(bridgeInfo());
  if (!KEY) return Promise.reject(new Error("Open Nova Bridge from its window: it makes its own key."));
  return new Promise((resolve, reject) => {
    const fail = (e) => reject(new Error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Is another Nova Bridge running? Close it, or set PORT.` : e.message));
    server.once("error", fail);
    server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
      server.off("error", fail);
      stats.startedAt = Date.now();
      stats.requests = 0;
      stats.errors = 0;
      stats.devices.clear();
      if (LAN) startFinder();
      /* check the Google sign-ins now, so a refused account shows in Nova before the first chat */
      for (const ch of Object.keys(GOOGLE)) {
        if (isConnected(ch)) ensureGoogleAuth(ch).catch((e) => console.warn(`   ${ch}: ${e.message}`));
      }
      if (authStore.claude) checkClaude();
      if (isConnected(GEMINI)) {
        startGeminiRotation();
        readyGemini().catch((e) => console.warn(`   ${GEMINI}: ${e.message}`));
      }
      resolve(bridgeInfo());
    });
  });
}

/* Stops listening, ends open replies and frees the port at once. */
export function stopBridge() {
  return new Promise((resolve) => {
    try { finderSocket?.close(); } catch {}
    finderSocket = null;
    for (const l of googleListeners.values()) { try { l.close(); } catch {} }
    stopGeminiRotation();
    for (const sock of sockets) { try { sock.destroy(); } catch {} }
    if (!server.listening) return resolve();
    server.close(() => resolve());
    setTimeout(resolve, 1500).unref();
  });
}

/* what the Bridge window may show of a sign-in in progress or just failed */
const bridgeFlow = (id) => {
  const f = pendingFlows.get(id);
  return f && (f.status === "pending" || f.status === "error") && (f.message || f.lastError) ? { status: f.status, message: f.message || f.lastError, ...(f.url ? { url: f.url } : {}) } : null;
};

export function bridgeInfo() {
  const now = Date.now();
  if (authStore.claude) checkClaude();
  const ip = getLocalIp();
  const connected = connectedProviders();
  const models = connected.flatMap((p) => cachedModels(p));
  /* every approved device, with what it did lately; the live entries of
     devices not approved (the administrator key) are left out */
  const seen = new Map([...stats.devices.values()].filter((d) => d.deviceId).map((d) => [d.deviceId, d]));
  const sessions = deviceAccess.list().filter((d) => d.status === "approved").map((d) => {
    const live = seen.get(d.id);
    return { id: d.id, name: d.name, address: live?.address || d.address, kind: live?.kind || (d.address === "localhost" ? "This computer" : "Device"), local: d.address === "localhost", requests: live?.requests || 0, lastSeen: live?.lastSeen || 0, active: !!live && now - live.lastSeen < DEVICE_TTL, replying: (deviceReplies.get(d.id)?.size || 0) > 0 };
  }).sort((a, b) => b.active - a.active || b.lastSeen - a.lastSeen);
  return {
    running: server.listening,
    port: PORT,
    local: `http://localhost:${PORT}/v1`,
    lan: LAN && ip ? `http://${ip}:${PORT}/v1` : null,
    startedAt: stats.startedAt,
    active: stats.active,
    requests: stats.requests,
    errors: stats.errors,
    lastError: stats.last,
    subscriptions: SUBSCRIPTION_PROVIDERS.map((p) => ({ id: p.id, name: p.name || p.id, connected: connected.includes(p.id), problem: authStore[p.id]?.problem || null, flow: bridgeFlow(p.id),
      ...(authStore[p.id]?.source === "agy" ? { note: `Using Antigravity on this computer${authStore[p.id].email ? ` (${authStore[p.id].email})` : ""}` } : {}) })),
    pairedDevices: deviceAccess.list(),
    pending: deviceAccess.list().filter((d) => d.status === "pending"),
    sessions,
    blocked: deviceAccess.blockedList(),
    devices: [...stats.devices.values()].filter((d) => now - d.lastSeen < DEVICE_TTL).sort((a, b) => b.lastSeen - a.lastSeen),
    models: models.map((m) => ({ id: m.id, name: m.name || m.id })),
  };
}

export function bridgeDevice(id, action) {
  deviceAccess.decide(id, action);
  if (action === "revoke" || action === "block") {
    for (const response of deviceReplies.get(id) || []) response.destroy();
    deviceReplies.delete(id);
  }
}

export function bridgeSignOut(provider) {
  if (!PROVIDER_IDS.includes(provider)) throw new Error("Unknown subscription.");
  const next = { ...authStore, [provider]: null, skipCli: [...new Set([...authStore.skipCli, provider])] };
  fs.writeFileSync(AUTH_FILE + ".tmp", JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(AUTH_FILE + ".tmp", AUTH_FILE);
  authStore = next;
  for (const response of subscriptionReplies.get(provider) || []) response.destroy();
  subscriptionReplies.delete(provider);
  pendingFlows.delete(provider);
  modelCache.delete(provider);
  if (provider in GOOGLE) googleListeners.get(provider)?.close();
  if (provider === GEMINI) {
    stopGeminiRotation();
    geminiSess = null;
    geminiAppList = null;
    forgetGeminiBrowser(GEMINI_PROFILE).catch(() => {});
  }
}

/* Models from each connected subscription, fetched live (the cached list can be short). */
export async function bridgeModels() {
  return (await activeModelsList()).map((m) => ({ id: m.id, name: m.name || m.id }));
}

/* Start the sign-in for a provider from the Bridge window. */
export async function bridgeSignIn(provider) {
  if (!START[provider]) throw new Error(`Unknown provider: ${provider}`);
  return START[provider]({ local: true, window: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.on("uncaughtException", (e) => console.error("Unexpected error:", e));
  process.on("unhandledRejection", (e) => console.error("Unexpected error:", e));
  startBridge().then(() => {
    const ip = getLocalIp();
    const active = connectedProviders();
    console.log(`
⚡ Nova Bridge is running
   This computer:   http://localhost:${PORT}/v1
   Other devices:   ${LAN && ip ? `${ip} (same network, approved in the Bridge window)` : "disabled (this computer only)"}
   Connected:       ${active.length ? active.join(", ") : "nothing yet — Nova → Settings → Nova Bridge"}
`);
    if (process.platform === "win32") console.log("   If Windows asks whether Node.js may use the network, allow Private networks so your phone can reach it.\n");
  }, (e) => { console.error(`⚠️  ${e.message}`); process.exit(1); });
}
