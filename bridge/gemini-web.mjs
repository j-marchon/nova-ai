/* gemini-web.mjs — Gemini app (gemini.google.com) protocol client
   Chat through the same internal endpoints the Gemini web app uses, with the
   user's own browser session. This reaches models a plan allows in the app
   (Gemini 4 Argon on a student trial) that the Antigravity API refuses.

   Reverse-engineered and unofficial: the model header values, the request
   shape and the reply indexes can change without notice. bridge/tools/probe-
   gemini-web.mjs re-checks all of it against a live account.

   Zero npm dependencies, just Node's https. Every network call goes through
   the `request` function given to the session, so tests can replace it. */

import https from "node:https";
import { parseGeminiWebStream, geminiWebError } from "../src/lib/subBridge.js";

const ORIGIN = "https://gemini.google.com";
const STREAM_PATH = "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const BATCH_PATH = "/_/BardChatUi/data/batchexecute";
/* Google answers with ~26 KB of headers; Node's default 16 KB limit fails
   that with "Header overflow". */
const MAX_HEADERS = 256 * 1024;
const UA = process.env.NOVA_BRIDGE_GEMINI_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const FALLBACK_BL = "boq_assistant-bard-web-server_20261110.00_p0";

/* An error with the HTTP status Nova should see. `retryable` marks failures a
   fresh page token may cure. */
export class GeminiWebError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/* ---- transport --------------------------------------------------------- */

/* One HTTPS request. Resolves { status, headers, body } once the response has
   ended; onChunk sees each decoded piece as it arrives. */
export function httpsRequest({ url, method = "GET", headers = {}, body, signal, timeoutMs = 20000, onChunk }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body == null ? null : Buffer.from(body);
    const req = https.request({
      hostname: u.hostname,
      maxHeaderSize: MAX_HEADERS,
      path: u.pathname + u.search,
      method,
      headers: { ...headers, ...(payload ? { "Content-Length": payload.length } : {}) },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; onChunk?.(c); });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      res.on("error", reject);
    });
    req.on("error", reject);
    /* a long silence mid-reply means the stream has died */
    req.setTimeout(timeoutMs, () => req.destroy(new Error("gemini.google.com did not answer.")));
    if (signal) {
      if (signal.aborted) req.destroy(new Error("aborted"));
      else signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---- cookies ----------------------------------------------------------- */

const COOKIE_NAME = /^[A-Za-z0-9_.-]+$/;

/* Cookies out of whatever was pasted: a whole Cookie header, a list copied
   from DevTools (name<TAB>value rows), a JSON export ([{name,value}] or
   {name:value}), or the bare __Secure-1PSID value, optionally followed by the
   bare __Secure-1PSIDTS value. `authuser=N` picks another signed-in account.
   Returns { cookies, authuser }. */
export function parseCookieInput(text) {
  const cookies = {};
  let authuser = 0;
  let raw = String(text || "").trim();
  if (!raw) return { cookies, authuser };
  const set = (k, v) => {
    k = String(k || "").trim();
    v = String(v ?? "").trim().replace(/^["']|["']$/g, "");
    if (!COOKIE_NAME.test(k) || !v) return;
    if (k === "authuser") authuser = Number(v) || 0;
    else cookies[k] = v;
  };
  if (/^[[{]/.test(raw)) {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) j.forEach((c) => set(c?.name, c?.value));
      else Object.entries(j).forEach(([k, v]) => set(k, v));
      return { cookies, authuser };
    } catch {}
  }
  raw = raw.replace(/^cookie:\s*/i, "");
  const bare = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.includes("\t")) {
      const [k, v] = line.split("\t");
      set(k, v);
      continue;
    }
    for (const part of line.split(/;\s*|\s+/)) {
      const t = part.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq > 0 && COOKIE_NAME.test(t.slice(0, eq))) set(t.slice(0, eq), t.slice(eq + 1));
      /* a cookie value is long; a short bare word is not one */
      else if (!t.includes("=") && t.length >= 20) bare.push(t);
    }
  }
  /* two bare values: PSID, then PSIDTS */
  if (!cookies["__Secure-1PSID"] && bare[0]) cookies["__Secure-1PSID"] = bare[0];
  if (!cookies["__Secure-1PSIDTS"] && bare[1] && cookies["__Secure-1PSID"] === bare[0]) cookies["__Secure-1PSIDTS"] = bare[1];
  return { cookies, authuser };
}

export const cookieHeader = (cookies) => Object.entries(cookies || {}).map(([k, v]) => `${k}=${v}`).join("; ");

/* Set-Cookie lines → { name: value } (expired and empty values dropped). */
function fromSetCookie(list) {
  const out = {};
  for (const c of [].concat(list || [])) {
    const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/);
    if (m && m[2] && !/max-age=0|expires=thu, 01 jan 1970/i.test(c)) out[m[1]] = m[2];
  }
  return out;
}

/* ---- models ------------------------------------------------------------ */

/* The web app picks the model with an x-goog-ext-525001261-jspb header that
   carries an opaque hash, as seen in DevTools → Network → StreamGenerate →
   Request Headers. `id` is that hash or the whole header value; none means no
   header, the account's default model. */
export function modelHeaders(id) {
  const v = String(id || "").trim();
  if (!v) return {};
  const value = v.startsWith("[") ? v : `[1,null,null,null,${JSON.stringify(v)},null,null,0,[4]]`;
  return { "x-goog-ext-525001261-jspb": value };
}

/* Nothing is built in: the models come from the app itself (listModels).
   Kept, empty, for bridge/tools/probe-gemini-web.mjs. */
export const KNOWN_MODELS = {};

/* The x-goog-ext-525001261-jspb value the web app sends today: its client
   capabilities at 8 and, at 14 and 15, the picked model's mode and thinking
   level (from listModels). The capabilities matter: without them the app's
   model list leaves out models such as 4 Carbon. Checked against a live Pro
   account in Nov 2026: StreamGenerate answered with 4 Hydrogen for mode 1
   while the account's own choice was 4 Neon. */
const APP_CAPABILITIES = [4, 33, 22, 5, 6, 8, 16, 19, 20, 38];
export function appModelHeader(mode, level = null) {
  const h = [1, null, null, null, null, null, "en", null, APP_CAPABILITIES, null, null, null, null, null];
  if (mode != null) h.push(mode, level);
  return JSON.stringify(h);
}

const slugOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/* The inner JSON of one rpc's answer in a batchexecute body, or null. */
function rpcResult(body, rpc) {
  for (const line of String(body || "").split("\n")) {
    if (!line.startsWith("[")) continue;
    let rows;
    try { rows = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (Array.isArray(row) && row[0] === "wrb.fr" && row[1] === rpc && typeof row[2] === "string") {
        try { return JSON.parse(row[2]); } catch { return null; }
      }
    }
  }
  return null;
}

/* The model picker's rows out of the app's otAQ7b answer, as
   [{ slug, name, header, locked }]. Its [24] is [policy, entries]; an entry is
   [info, levels, _, surfaces], where info[1] is the mode, info[4]/info[5] the
   name the picker shows ("4 Hydrogen"), info[14] set when the plan has to be upgraded
   for it, and each level is [id, name]. Surface 1 is the picker; the rest
   repeat the models for other screens. A model with several thinking levels
   is one row per level, as the picker offers them. Null when the answer is
   not in that shape (the app changed). */
export function parseGeminiModelList(body) {
  const entries = rpcResult(body, "otAQ7b")?.[24]?.[1];
  if (!Array.isArray(entries)) return null;
  const out = [];
  const seen = new Set();
  const add = (m) => { if (m.slug && !seen.has(m.slug)) { seen.add(m.slug); out.push(m); } };
  for (const e of entries) {
    const [info, levels, , surfaces] = Array.isArray(e) ? e : [];
    if (!Array.isArray(surfaces) || !surfaces.includes(1)) continue;
    const mode = info?.[1];
    /* info[4] is the short name ("Neon", "Auto"); info[5] the picker's label
       for a model ("4 Neon"), but Auto's description */
    const [short, long] = [String(info?.[4] || "").trim(), String(info?.[5] || "").trim()];
    const name = short && long.includes(short) ? long : short || long;
    if (!Number.isInteger(mode) || !name) continue;
    const locked = info[14] != null;
    const lv = (Array.isArray(levels) ? levels : []).filter((l) => Number.isInteger(l?.[0]) && typeof l?.[1] === "string" && l[1]);
    if (lv.length > 1) for (const [id, label] of lv) add({ slug: slugOf(`${name} ${label}`), name: `${name} (${label})`, header: appModelHeader(mode, id), locked });
    else add({ slug: slugOf(name), name, header: appModelHeader(mode, lv[0]?.[0] ?? null), locked });
  }
  return out;
}

/* ---- session ----------------------------------------------------------- */

export class GeminiWebSession {
  /** @param {{ cookies: Record<string,string>, authuser?: number, onCookies?: (c: Record<string,string>) => void, request?: Function }} o */
  constructor({ cookies, authuser = 0, onCookies, request = httpsRequest } = {}) {
    if (!cookies?.["__Secure-1PSID"]) throw new GeminiWebError("The Gemini app sign-in has no __Secure-1PSID cookie.", 400);
    this.cookies = { ...cookies };
    this.authuser = Number(authuser) || 0;
    this.onCookies = onCookies || null;
    this.request = request;
    this.at = null; // SNlM0e page token
    this.bl = ""; // build label (cfb2h)
    this.sid = ""; // session id (FdrFJe)
    this.reqId = 100000;
    this.ready = false;
  }

  get base() {
    return this.authuser ? `${ORIGIN}/u/${this.authuser}` : ORIGIN;
  }

  _headers(extra = {}) {
    return { Cookie: cookieHeader(this.cookies), "User-Agent": UA, ...extra };
  }

  /* keep every cookie Google hands back (the rotating __Secure-*PSIDTS above all) */
  _absorb(headers) {
    const fresh = fromSetCookie(headers?.["set-cookie"]);
    let changed = false;
    for (const [k, v] of Object.entries(fresh)) {
      if (this.cookies[k] !== v) { this.cookies[k] = v; changed = true; }
    }
    if (changed) this.onCookies?.({ ...this.cookies });
    return changed;
  }

  /* Load the app page; take the page token, build label and session id from
     it. Throws a 401 GeminiWebError when the cookies no longer sign in. */
  async init(signal) {
    this.ready = false;
    let url = `${this.base}/app`;
    let res;
    for (let hop = 0; hop < 4; hop++) {
      try {
        res = await this.request({ url, headers: this._headers({ Accept: "text/html" }), signal });
      } catch (e) {
        throw new GeminiWebError(`Could not reach gemini.google.com (${e.message}).`, 502);
      }
      this._absorb(res.headers);
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers?.location) {
        const loc = res.headers.location;
        if (/accounts\.google\.com/.test(loc)) throw new GeminiWebError("The Gemini app sign-in has expired. Sign in again.", 401);
        url = loc.startsWith("http") ? loc : `${ORIGIN}${loc}`;
        continue;
      }
      break;
    }
    if (res.status === 401 || res.status === 403) throw new GeminiWebError("The Gemini app sign-in has expired. Sign in again.", 401);
    if (res.status >= 400) throw new GeminiWebError(`gemini.google.com answered ${res.status}.`, 502);
    const html = res.body || "";
    const at = html.match(/"SNlM0e":"([^"]+)"/);
    if (!at) {
      if (/accounts\.google\.com|ServiceLogin/.test(html) || html.length < 2000) throw new GeminiWebError("The Gemini app sign-in has expired. Sign in again.", 401);
      throw new GeminiWebError("Could not read the Gemini app's page token (the page changed). Run bridge/tools/probe-gemini-web.mjs.", 502);
    }
    this.at = at[1];
    this.bl = html.match(/"cfb2h":"([^"]+)"/)?.[1] || "";
    this.sid = html.match(/"FdrFJe":"([^"]+)"/)?.[1] || "";
    this.ready = true;
    return true;
  }

  /* Google rotates __Secure-1PSIDTS; a session left alone stops working within
     the day. This asks accounts.google.com for a fresh one, as the web app does
     in the background. Resolves to true when a cookie changed. */
  async rotate(signal) {
    let res;
    try {
      res = await this.request({
        url: "https://accounts.google.com/RotateCookies",
        method: "POST",
        headers: this._headers({ "Content-Type": "application/json" }),
        body: '[000,"-0000000000000000000"]',
        signal,
        timeoutMs: 15000,
      });
    } catch (e) {
      throw new GeminiWebError(`Could not refresh the Gemini app sign-in (${e.message}).`, 502);
    }
    if (res.status === 401) throw new GeminiWebError("The Gemini app sign-in has expired. Sign in again.", 401);
    return this._absorb(res.headers);
  }

  /* One request body: a fresh conversation (context null) carrying `prompt`.
     The model is not chosen here but by the header (see modelHeaders). */
  _body(prompt) {
    const inner = [[prompt, 0, null, null, null, null, 0], ["en"], null];
    return new URLSearchParams({ "f.req": JSON.stringify([null, JSON.stringify(inner)]), at: this.at }).toString();
  }

  async _streamOnce({ prompt, header, signal, onSnapshot }) {
    const qs = new URLSearchParams({ bl: this.bl || FALLBACK_BL, _reqid: String(this.reqId), rt: "c", hl: "en" });
    if (this.sid) qs.set("f.sid", this.sid);
    this.reqId += 100000;
    let raw = "";
    let last = { text: "", thoughts: "" };
    const res = await this.request({
      url: `${this.base}${STREAM_PATH}?${qs}`,
      method: "POST",
      headers: this._headers({
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Accept: "*/*",
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
        "X-Same-Domain": "1",
        ...modelHeaders(header),
      }),
      body: this._body(prompt),
      signal,
      timeoutMs: 120000,
      onChunk: (chunk) => {
        raw += chunk;
        const p = parseGeminiWebStream(raw);
        if ((p.text && p.text !== last.text) || (p.thoughts && p.thoughts !== last.thoughts)) {
          last = p;
          onSnapshot?.(p);
        }
      },
    });
    this._absorb(res.headers);
    if (res.status === 401 || res.status === 403) throw new GeminiWebError("The Gemini app refused the sign-in. It may have expired. Sign in again.", 401, true);
    if (res.status === 429) throw new GeminiWebError("The Gemini app is rate limiting this account. Wait a moment.", 429);
    if (res.status >= 400) {
      const hint = String(res.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      throw new GeminiWebError(`The Gemini app rejected the request (${res.status})${hint ? `: ${hint}` : "."}`, res.status === 400 ? 400 : 502, res.status === 400);
    }
    const final = parseGeminiWebStream(res.body || raw);
    if (!final.text && !final.thoughts) {
      if (final.errorCode) { const e = geminiWebError(final.errorCode); throw Object.assign(new GeminiWebError(e.message, e.status), { code: final.errorCode }); }
      throw new GeminiWebError("The Gemini app sent back nothing. The model may not be available on this account.", 502);
    }
    return final;
  }

  /* Stream one reply. `onSnapshot` gets { text, thoughts } as they grow
     (each a full snapshot, not a delta). Resolves to the final parse. The page
     token goes stale after some hours: when nothing has been shown yet, get a
     fresh token (and cookie) and try once more. */
  async stream({ prompt, header = "", signal, onSnapshot }) {
    if (!this.ready) await this.init(signal);
    let shown = false;
    const relay = (p) => { shown = true; onSnapshot?.(p); };
    try {
      return await this._streamOnce({ prompt, header, signal, onSnapshot: relay });
    } catch (e) {
      if (shown || signal?.aborted || !e.retryable) throw e;
      await this.rotate(signal).catch(() => {});
      await this.init(signal);
      return this._streamOnce({ prompt, header, signal, onSnapshot: relay });
    }
  }

  /* One batchexecute call, as the app makes it. */
  async _batch(rpc, payload, { signal, headers = {} } = {}) {
    const qs = new URLSearchParams({ rpcids: rpc, "source-path": "/app", bl: this.bl || FALLBACK_BL, hl: "en", _reqid: String(this.reqId), rt: "c" });
    if (this.sid) qs.set("f.sid", this.sid);
    this.reqId += 100000;
    const res = await this.request({
      url: `${this.base}${BATCH_PATH}?${qs}`,
      method: "POST",
      headers: this._headers({ "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Origin: ORIGIN, Referer: `${ORIGIN}/`, "X-Same-Domain": "1", ...headers }),
      body: new URLSearchParams({ "f.req": JSON.stringify([[[rpc, payload, null, "generic"]]]), at: this.at }).toString(),
      signal,
      timeoutMs: 15000,
    });
    this._absorb(res.headers);
    return res;
  }

  /* The models the app's own picker offers this account (otAQ7b, called by
     the app on load), locked ones included: see parseGeminiModelList. */
  async listModels(signal) {
    if (!this.ready) await this.init(signal);
    let res;
    try {
      res = await this._batch("otAQ7b", "[1]", { signal, headers: { "x-goog-ext-525001261-jspb": appModelHeader() } });
    } catch (e) {
      throw new GeminiWebError(`Could not reach gemini.google.com (${e.message}).`, 502);
    }
    if (res.status === 401 || res.status === 403) throw new GeminiWebError("The Gemini app refused the sign-in. It may have expired. Sign in again.", 401);
    if (res.status >= 400) throw new GeminiWebError(`The Gemini app did not list its models (${res.status}).`, 502);
    const models = parseGeminiModelList(res.body);
    if (!models) throw new GeminiWebError("Could not read the Gemini app's model list (the app changed).", 502);
    return models;
  }

  /* Remove a conversation from the account's Gemini history, as the app's own
     delete does (GzXR5e). Checked against a live account: the chat leaves the
     history list (MaZiqc). True only when the rpc itself answered, since
     batchexecute says 200 for a failed call too. */
  async deleteChat(cid) {
    if (!cid || !this.ready) return false;
    try {
      const res = await this._batch("GzXR5e", JSON.stringify([String(cid).replace(/^(?!c_)/, "c_")]));
      return res.status < 400 && rpcResult(res.body, "GzXR5e") != null;
    } catch {
      return false;
    }
  }
}
