#!/usr/bin/env node
/* probe-gemini-web.mjs — check the Gemini app protocol against a live account.

   The Gemini app's internal API is reverse-engineered, so this is the first
   thing to run (and to re-run when the Bridge's Gemini app provider breaks).
   It shows which of the things gemini-web.mjs relies on still hold, and what
   it needs to learn.

   Cookies (from a browser signed in to gemini.google.com; DevTools →
   Application → Cookies, or Network → any request → Cookie header):
     GEMINI_COOKIES='<whole Cookie header>'   or
     GEMINI_PSID=... GEMINI_PSIDTS=...        or
     --cookies-file <path>   (anything parseCookieInput reads: header, rows, JSON)

   Usage: node bridge/tools/probe-gemini-web.mjs [flags]
     --authuser N      use /u/N (another signed-in Google account)
     --models a,b      model headers to try (hash or the whole
                       x-goog-ext-525001261-jspb value), besides the default
                       and the built-in Argon hash
     --no-thoughts     skip the thinking-model test (the slowest step)
     --long N          also measure how long a prompt is accepted (up to N chars)
     --delete          try deleting the probe chats from the Gemini history
     --fixture         also write scrubbed replies to tests/fixtures/gemini-web/
     --out <dir>       where to save raw pages and replies (default: a new temp dir)

   Saved files hold your session. They are written 0600 in a fresh folder:
   delete it when done. Nothing is sent anywhere but gemini.google.com. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiWebSession, KNOWN_MODELS, modelHeaders, parseCookieInput } from "../gemini-web.mjs";
import { parseGeminiWebStream, servedModelMatches } from "../../src/lib/subBridge.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const say = (...a) => console.log(...a);
const head = (t) => say(`\n=== ${t} ===`);
const ok = (t) => say(`  ✔ ${t}`);
const bad = (t) => say(`  ✘ ${t}`);
const note = (t) => say(`  · ${t}`);

/* ---------- cookies ---------- */
let raw = process.env.GEMINI_COOKIES || "";
if (!raw && process.env.GEMINI_PSID) raw = `${process.env.GEMINI_PSID}\n${process.env.GEMINI_PSIDTS || ""}`;
if (opt("cookies-file")) raw = fs.readFileSync(opt("cookies-file"), "utf8");
const parsed = parseCookieInput(raw);
if (!parsed.cookies["__Secure-1PSID"]) {
  console.error("No __Secure-1PSID cookie. Set GEMINI_COOKIES, or GEMINI_PSID and GEMINI_PSIDTS, or pass --cookies-file. See the top of this file.");
  process.exit(2);
}
const authuser = opt("authuser") != null ? Number(opt("authuser")) : parsed.authuser;

const out = opt("out") || fs.mkdtempSync(path.join(os.tmpdir(), "gemini-probe-"));
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (name, text) => { fs.writeFileSync(path.join(out, name), text, { mode: 0o600 }); return path.join(out, name); };
say(`Saving raw output to ${out} (it contains your session; delete it afterwards).`);

const session = new GeminiWebSession({ cookies: parsed.cookies, authuser, onCookies: () => {} });

/* ---------- every string/number in a JSON tree, with its path ---------- */
function dump(value, prefix = "", rows = []) {
  if (Array.isArray(value)) value.forEach((v, i) => dump(v, `${prefix}[${i}]`, rows));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => dump(v, `${prefix}.${k}`, rows));
  else if (typeof value === "string" || typeof value === "number") rows.push(`${prefix} = ${JSON.stringify(typeof value === "string" ? value.slice(0, 90) : value)}`);
  return rows;
}

function pathDump(rawBody) {
  const rows = [];
  const cleaned = String(rawBody).replace(/^\)\]\}'\s*\n?/, "");
  let n = 0;
  for (const line of cleaned.split("\n")) {
    if (!line.trim().startsWith("[")) continue;
    let outer;
    try { outer = JSON.parse(line); } catch { continue; }
    for (const entry of outer) {
      if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
      n++;
      rows.push(`--- frame ${n}: entry[5] = ${JSON.stringify(entry[5] ?? null)?.slice(0, 120)}`);
      if (typeof entry[2] === "string") { try { dump(JSON.parse(entry[2]), "inner", rows); } catch { rows.push("(inner is not JSON)"); } }
    }
  }
  return rows.join("\n");
}

/* a raw StreamGenerate call, so the answer can be saved whole. It never waits
   longer than `deadlineMs`: a reply still arriving then is returned as it is
   (timedOut: true), and a line says it is still waiting every 10 seconds. */
async function rawStream(prompt, header, { deadlineMs = 75000 } = {}) {
  const qs = new URLSearchParams({ bl: session.bl || "", _reqid: String(session.reqId), rt: "c", hl: "en" });
  if (session.sid) qs.set("f.sid", session.sid);
  session.reqId += 100000;
  const t0 = Date.now();
  let partial = "";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deadlineMs);
  const waiting = setInterval(() => say(`  … waiting ${Math.round((Date.now() - t0) / 1000)}s, ${partial.length} bytes so far`), 10000);
  try {
  const res = await session.request({
    url: `${session.base}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${qs}`,
    method: "POST",
    headers: session._headers({
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      Accept: "*/*",
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "X-Same-Domain": "1",
      ...modelHeaders(header),
    }),
    body: session._body(prompt),
    timeoutMs: 120000,
    signal: ac.signal,
    onChunk: (c) => { partial += c; },
  });
  session._absorb(res.headers);
  return { ...res, ms: Date.now() - t0 };
  } catch (e) {
    if (ac.signal.aborted) return { status: 200, headers: {}, body: partial, ms: Date.now() - t0, timedOut: true };
    throw e;
  } finally {
    clearTimeout(timer);
    clearInterval(waiting);
  }
}

/* ---------- 1. the session ---------- */
head("1. The app page");
let html = "";
try {
  await session.init();
  ok(`signed in: page token ${session.at.slice(0, 6)}…, build label "${session.bl}", session id "${session.sid}"`);
  if (!session.bl) note("no build label (cfb2h) found: requests fall back to a built-in one, which may go stale");
  if (!session.sid) note("no session id (FdrFJe) found: sent without f.sid; if replies fail with 400, this is the first suspect");
} catch (e) {
  bad(e.message);
  note("If this says the sign-in expired: run geminiProbe.cmd (or ./geminiProbe.sh) to sign in again in a window, or re-copy the cookies right after using gemini.google.com in the browser.");
  process.exit(1);
}
{
  const r = await session.request({ url: `${session.base}/app`, headers: session._headers({ Accept: "text/html" }) });
  html = r.body || "";
  note(`page saved: ${save("app.html", html)} (${html.length} chars)`);
}

/* ---------- 2. the model hunt ---------- */
head("2. Model hints in the page");
{
  const found = [];
  for (const m of html.matchAll(/["']([0-9a-f]{16})["']/g)) {
    const at = m.index;
    found.push(`${m[1]}   …${html.slice(Math.max(0, at - 120), at).replace(/\s+/g, " ")}[${m[1]}]${html.slice(at + 18, at + 120).replace(/\s+/g, " ")}…`);
  }
  const words = [];
  for (const m of html.matchAll(/(Argon|Flash|Thinking|Deep Think|Gemini \d(?:\.\d)? ?(?:Pro|Flash|Ultra)?)/g)) {
    words.push(`${m[1]}  …${html.slice(Math.max(0, m.index - 60), m.index + 80).replace(/\s+/g, " ")}…`);
  }
  save("model-candidates.txt", [`# 16-hex strings (${found.length})`, ...new Set(found), "", `# picker words (${words.length})`, ...new Set(words)].join("\n"));
  if (found.length || words.length) ok(`${found.length} hash-like strings and ${words.length} picker words: see model-candidates.txt`);
  else bad("nothing model-like in the page: models cannot be scraped; use \"Learn models\" or copy the header from DevTools (see below)");
  note("DevTools fallback: gemini.google.com → pick a model → send a message → Network → StreamGenerate → Request Headers → copy x-goog-ext-525001261-jspb");
}

/* ---------- 3. cookie rotation ---------- */
head("3. Cookie rotation");
try {
  const before = session.cookies["__Secure-1PSIDTS"];
  const changed = await session.rotate();
  ok(changed ? `rotated (__Secure-1PSIDTS ${before === session.cookies["__Secure-1PSIDTS"] ? "same" : "changed"})` : "answered, no new cookie (normal if rotated recently)");
} catch (e) {
  bad(e.message);
}

/* ---------- 4. replies ---------- */
head("4. Replies");
const tests = [{ label: "default", header: "" }];
for (const [slug, m] of Object.entries(KNOWN_MODELS)) tests.push({ label: `${slug} (built-in hash)`, header: m.header });
for (const h of (opt("models") || "").split(",").map((x) => x.trim()).filter(Boolean)) tests.push({ label: `custom ${h.slice(0, 24)}`, header: h });

const chats = [];
const worked = [];
let n = 0;
for (const t of tests) {
  n++;
  try {
    const res = await rawStream("Reply with exactly: PROBE-OK", t.header);
    const file = save(`stream-${n}-${t.label.replace(/\W+/g, "_")}.txt`, res.body || "");
    if (res.status >= 400) { bad(`${t.label}: HTTP ${res.status} (${res.ms} ms) ${String(res.body).slice(0, 160).replace(/\s+/g, " ")}`); continue; }
    const p = parseGeminiWebStream(res.body);
    if (res.timedOut) note(`${t.label}: the reply had not finished after ${Math.round(res.ms / 1000)}s; using what arrived (${(res.body || "").length} bytes)`);
    if (p.text) {
      worked.push(t);
      if (p.model) {
        const asked = t.header ? t.label.replace(/ \(built-in hash\)$/, "") : "";
        if (t.header && /^custom /.test(t.label)) note(`${t.label}: the app says it answered with "${p.model}": check that is the model you picked`);
        else if (t.header && !servedModelMatches(p.model, asked)) bad(`${t.label}: asked for ${asked} but the app answered with "${p.model}". The header no longer picks that model.`);
        else note(`the app says it answered with "${p.model}"${t.header ? " ✔ matches what was asked" : " (the account's default)"}`);
      }
      ok(`${t.label}: "${p.text.slice(0, 60).replace(/\s+/g, " ")}" (${res.ms} ms)${/PROBE-OK/.test(p.text) ? "" : "  ← not the exact answer; the model may differ or add words"}`);
      if (p.cid) chats.push(p.cid);
      if (flag("fixture")) {
        const dir = path.join(HERE, "..", "..", "tests", "fixtures", "gemini-web");
        fs.mkdirSync(dir, { recursive: true });
        const scrub = (res.body || "").replaceAll(session.at, "TOKEN").replace(/\b(c|r|rc)_[0-9a-f]{8,}/g, "$1_ID");
        fs.writeFileSync(path.join(dir, `stream-${t.label.replace(/\W+/g, "_")}.txt`), scrub);
      }
    } else {
      const err = p.errorCode ? `error code ${p.errorCode}` : "no text";
      bad(`${t.label}: ${err} (${res.ms} ms). If the header was learned from an old capture, it may be stale.`);
    }
    note(`raw: ${file}`);
    const rows = pathDump(res.body);
    save(`paths-${n}.txt`, rows);
    const lines = rows.split("\n");
    const nonNull = lines.filter((l) => /^inner/.test(l)).slice(0, 14);
    nonNull.forEach((l) => note(`  ${l}`));
    if (lines.length > nonNull.length + 4) note(`  … all ${lines.length} paths in paths-${n}.txt`);
  } catch (e) {
    bad(`${t.label}: ${e.message}`);
  }
}

/* thoughts: only a thinking model shows them */
head("5. Thoughts");
{
  /* only models that answered above, and each is given at most 90 s */
  if (flag("no-thoughts")) note("skipped (--no-thoughts)");
  else if (!worked.length) note("no model answered above, so there is nothing to test");
  else note("a thinking model can take a minute; this step stops each one after 90 s (skip it with --no-thoughts)");
  for (const t of flag("no-thoughts") ? [] : worked) {
    try {
      const res = await rawStream("A bat and a ball cost 1.10 together; the bat costs 1.00 more than the ball. Think it through, then answer with the ball's price.", t.header, { deadlineMs: 90000 });
      if (res.timedOut) note(`${t.label}: still going after 90s; looking at what arrived (${(res.body || "").length} bytes)`);
      const p = parseGeminiWebStream(res.body);
      if (p.thoughts) ok(`${t.label}: thoughts found at candidate[37][0][0] (${p.thoughts.length} chars)`);
      else note(`${t.label}: no thoughts at candidate[37][0][0]. Look in the path dump (paths-*.txt) for a long string near the reply; if there is one, parseGeminiWebStream's path needs changing.`);
      save(`thoughts-${t.label.replace(/\W+/g, "_")}.txt`, `${res.body}\n\n${pathDump(res.body)}`);
      if (p.cid) chats.push(p.cid);
    } catch (e) {
      bad(`${t.label}: ${e.message}`);
    }
  }
}

/* ---------- 6. how long a prompt may be ---------- */
if (opt("long")) {
  head("6. Input limit");
  const max = Number(opt("long")) || 200000;
  let good = 0;
  for (let size = 20000; size <= max; size *= 2) {
    const filler = "The quick brown fox jumps over the lazy dog. ".repeat(Math.ceil(size / 45)).slice(0, size);
    try {
      const res = await rawStream(`${filler}\n\nIgnore the text above and reply with exactly: LONG-OK`, tests.find((t) => t.header)?.header || "");
      const p = parseGeminiWebStream(res.body);
      if (res.status < 400 && p.text) { good = size; ok(`${size} chars accepted (${res.ms} ms)`); if (p.cid) chats.push(p.cid); }
      else { bad(`${size} chars: ${res.status >= 400 ? `HTTP ${res.status}` : p.errorCode ? `error ${p.errorCode}` : "empty"}`); break; }
    } catch (e) {
      bad(`${size} chars: ${e.message}`);
      break;
    }
  }
  note(`largest accepted: ${good} chars (≈ ${Math.round(good / 4)} tokens). Set the model's context_length (GEMINI_CTX in bridge.mjs) below that.`);
}

/* ---------- 7. cleaning up ---------- */
if (flag("delete")) {
  head("7. Deleting the probe chats");
  for (const cid of [...new Set(chats)]) {
    const done = await session.deleteChat(cid);
    (done ? ok : bad)(`${cid}: ${done ? "delete request accepted" : "refused"}`);
  }
  note("Open gemini.google.com and check the chats are really gone: an accepted request is not proof. If they are not, deleting is not working and the Bridge's NOVA_BRIDGE_GEMINI_DELETE should stay off.");
} else if (chats.length) {
  head("7. Chats left behind");
  note(`${new Set(chats).size} probe chats are in your Gemini history. Re-run with --delete to try removing them, or delete them in the app.`);
}

say(`\nDone. Share paths-*.txt and model-candidates.txt (not the raw stream files, which hold ids) if something needs fixing.\nDelete ${out} when finished: it holds your session.`);
