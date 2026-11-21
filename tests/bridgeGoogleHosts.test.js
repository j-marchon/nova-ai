import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

/* Antigravity's hosts, against a fake Google. The production host answers
   429 to accounts it does not serve; before the fix, any 404 or passing 503
   on the account's own host fell through to it and reached Nova as a false
   "rate limit" on every reply. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-bridge-hosts-"));
process.env.NOVA_BRIDGE_KEY = "test-bridge-key";
process.env.NOVA_BRIDGE_HOME = TMP;
process.env.NOVA_BRIDGE_AUTH_FILE = path.join(TMP, "auth.json");
const SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com";
fs.writeFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, JSON.stringify({
  antigravity: { access_token: "ya29.test", expires_at: Date.now() + 3600e3, project: "p-test", source: "oauth", host: SANDBOX },
}));
const { server } = await import("../bridge/bridge.mjs");

const realFetch = globalThis.fetch;
let base;
beforeAll(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => vi.unstubAllGlobals());

const googleError = (status, message, details = []) =>
  new Response(JSON.stringify({ error: { code: status, message, details } }), { status });
const reply = () => new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }] } })}\n\n`, { status: 200 });

/* answer(host, n) gives each Google host's reply to its n-th chat request */
function google(answer) {
  const seen = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, { ...init, headers: { ...init.headers, Authorization: "Bearer test-bridge-key" } });
    const host = new URL(u).origin;
    seen.push(host);
    return answer(host, seen.filter((h) => h === host).length);
  }));
  return seen;
}
const chat = (model) => fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "hi" }] }),
});

it("reports a model the account's host lacks as missing, not as the production host's 429", async () => {
  google((host) => host === "https://cloudcode-pa.googleapis.com"
    ? googleError(429, "Resource has been exhausted (e.g. check quota).")
    : googleError(404, "Requested entity was not found."));
  const r = await chat("antigravity/gemini-3.8-flash");
  expect(r.status).toBe(404);
  expect((await r.json()).error.message).toMatch(/does not offer this model/);
});

it("asks the account's own host again while the model is only busy", async () => {
  const seen = google((host, n) => host === SANDBOX && n === 1
    ? googleError(429, "Busy", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0.05s" }])
    : host === SANDBOX ? reply() : googleError(429, "Resource has been exhausted (e.g. check quota)."));
  const r = await chat("antigravity/gemini-3.8-flash-medium");
  expect(r.status).toBe(200);
  expect(await r.text()).toMatch(/Hello/);
  expect(seen).toEqual([SANDBOX, SANDBOX]);
});

it("passes on a real quota wait, with Retry-After, instead of sitting through it", async () => {
  const seen = google(() => googleError(429, "Quota exhausted", [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" },
  ]));
  const r = await chat("antigravity/gemini-3.8-flash-medium");
  expect(r.status).toBe(429);
  expect(r.headers.get("retry-after")).toBe("3600");
  expect((await r.json()).error.message).toMatch(/QUOTA_EXHAUSTED/);
  /* one try per host, no waiting */
  expect(seen.filter((h) => h === SANDBOX)).toHaveLength(1);
});
