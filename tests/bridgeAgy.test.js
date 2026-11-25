import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

/* An Antigravity already signed in on this computer is used at once, with no
   Google client of Nova's: its token is read from the keychain (here a file),
   never copied, and renewed by running agy itself. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-bridge-agy-"));
process.env.NOVA_BRIDGE_KEY = "test-bridge-key";
process.env.NOVA_BRIDGE_HOME = TMP;
process.env.NOVA_BRIDGE_AUTH_FILE = path.join(TMP, "auth.json");
delete process.env.NOVA_GOOGLE_CLIENT_ID;
delete process.env.NOVA_GOOGLE_CLIENT_SECRET;
process.env.NOVA_BRIDGE_AGY_CRED = path.join(TMP, "agy.json");
process.env.NOVA_BRIDGE_AGY_BIN = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "fixtures", "fake-agy.mjs");
fs.writeFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "{}");
fs.writeFileSync(process.env.NOVA_BRIDGE_AGY_CRED, JSON.stringify({
  token: { access_token: "ya29.old", token_type: "Bearer", refresh_token: "1//agy-refresh", expiry: "2026-01-01T00:00:00Z" },
  auth_method: "consumer",
  id_token_email: "someone@example.com",
}));
const { server, agyDiscovered } = await import("../bridge/bridge.mjs");

const realFetch = globalThis.fetch;
let base;
beforeAll(async () => {
  await agyDiscovered;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

it("picks up Antigravity's sign-in without copying its refresh token", () => {
  const saved = JSON.parse(fs.readFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "utf8")).antigravity;
  expect(saved).toMatchObject({ source: "agy", email: "someone@example.com" });
  expect(JSON.stringify(saved)).not.toContain("agy-refresh");
});

it("has agy renew an expired token, once for chats that wait together, and chats with it", async () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, { ...init, headers: { ...init.headers, Authorization: "Bearer test-bridge-key" } });
    calls.push(u);
    expect(init.headers.Authorization).toBe("Bearer ya29.renewed");
    if (u.endsWith(":loadCodeAssist")) return Response.json({ currentTier: { id: "free-tier" }, cloudaicompanionProject: "p-agy" });
    return new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }] } })}\n\n`);
  }));
  const chat = () => fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "antigravity/gemini-3.8-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  const replies = await Promise.all([chat(), chat()]);
  for (const r of replies) {
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/Hello/);
  }
  expect(calls.some((u) => u.includes("oauth2.googleapis.com"))).toBe(false);
  expect(fs.readFileSync(`${process.env.NOVA_BRIDGE_AGY_CRED}.runs`, "utf8")).toBe("models\n");
  vi.unstubAllGlobals();
});

it("lists only the models Antigravity's own picker shows", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, { ...init, headers: { ...init.headers, Authorization: "Bearer test-bridge-key" } });
    if (u.endsWith(":fetchAvailableModels")) return Response.json({
      models: {
        "gemini-4-hydrogen-high": { displayName: "Gemini 4 Hydrogen (High)" },
        "gemini-2.5-flash": { displayName: "Gemini 3.5 Flash Lite" },
        "gemini-4-argon-disabled": { displayName: "Gemini 4 Argon", disabled: true },
        tab_flash_lite_preview: {},
      },
      agentModelSorts: [{ groups: [{ modelIds: ["gemini-4-hydrogen-high", "gemini-4-argon-disabled"] }] }],
    });
    return new Response("{}", { status: 500 });
  }));
  const d = await (await fetch(`${base}/v1/models`)).json();
  expect(d.data.map((m) => m.id)).toEqual(["antigravity/gemini-4-hydrogen-high"]);
  vi.unstubAllGlobals();
});

it("picks the sign-ins on this computer up again from Sign in, after a sign-out here", async () => {
  const { bridgeSignIn, bridgeSignOut } = await import("../bridge/bridge.mjs");
  const store = () => JSON.parse(fs.readFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "utf8"));
  bridgeSignOut("antigravity");
  expect(store().antigravity).toBeNull();
  await bridgeSignIn("antigravity");
  expect(store().antigravity).toMatchObject({ source: "agy", email: "someone@example.com" });
  fs.mkdirSync(path.join(TMP, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(TMP, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: "a", refresh_token: "r" } }));
  bridgeSignOut("openai");
  await bridgeSignIn("openai");
  expect(store().openai).toEqual({ source: "codex-cli" });
});
