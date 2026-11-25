import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendTo, completeText } from "../src/lib/api.js";
import { findBridge, sweepPlan } from "../src/lib/bridgeFind.js";
import { emptyData } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";
import { BRIDGE_LOCAL, newProvider } from "../src/lib/providers.js";

/* The bridge reads its sign-ins at import: point it at an empty home and a
   throwaway store, so no real CLI sign-in on this machine is touched. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-bridge-test-"));
delete process.env.NOVA_GOOGLE_CLIENT_ID;
delete process.env.NOVA_GOOGLE_CLIENT_SECRET;
process.env.NOVA_BRIDGE_KEY = "test-bridge-key";
/* Claude is a stand-in Claude Code program that answers from a scenario */
const FAKE_CLAUDE = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-claude.mjs");
process.env.NOVA_BRIDGE_CLAUDE_BIN = FAKE_CLAUDE;
process.env.FAKE_CLAUDE_LOG = path.join(TMP, "claude.log");
process.env.FAKE_CLAUDE_SCENARIO = path.join(TMP, "claude.json");
process.env.NOVA_BRIDGE_ORIGINS = "http://localhost:5173,capacitor://localhost,https://localhost";
process.env.NOVA_BRIDGE_HOME = TMP;
/* no real Antigravity sign-in from this computer's keychain */
process.env.NOVA_BRIDGE_AGY_CRED = "none";
/* Claude Code's saved claude.ai sign-in, which the model list is read with */
process.env.CLAUDE_CONFIG_DIR = path.join(TMP, ".claude");
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR);
fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat-test", expiresAt: Date.now() + 3600000 } }));
process.env.NOVA_BRIDGE_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, JSON.stringify({ claude: { source: "claude-code" } }));
const { server, originAllowed, bridgeDevice, bridgeSignOut, networkOf } = await import("../bridge/bridge.mjs");

afterEach(() => vi.unstubAllGlobals());

const HEALTH = { ok: true, name: "DESKTOP-PC", lan: "http://192.168.1.20:5005/v1", providers: {} };

/* a network where only the given hosts run the bridge */
function network(alive) {
  const seen = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const host = new URL(url).hostname;
    seen.push(host);
    if (alive.includes(host)) {
      if (url.endsWith("/health")) return new Response(JSON.stringify(HEALTH), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello from the bridge" } }] }), { status: 200 });
    }
    throw new TypeError("Failed to fetch");
  }));
  return seen;
}

describe("finding Nova Bridge", () => {
  it("retries a transient disconnect at the same bridge address", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.endsWith("/health")) return new Response(JSON.stringify(HEALTH));
      if (++attempts === 1) throw new TypeError("Failed to fetch");
      return new Response("reconnected");
    }));
    const response = await sendTo({ base: "http://192.168.1.20:5005/v1", src: "nova-bridge" }, {}, "/chat/completions");
    expect(await response.text()).toBe("reconnected");
    expect(attempts).toBe(2);
  });

  it("sweeps the phone's own network first, then known and common ones", () => {
    expect(sweepPlan({ own: ["192.168.4.33"], known: ["http://10.0.0.7:5005/v1"] }).slice(0, 3))
      .toEqual(["192.168.4", "10.0.0", "192.168.1"]);
    expect(sweepPlan({ own: ["100.64.0.2"] })[0]).toBe("192.168.1");
  });

  it("finds it at a likely address without searching", async () => {
    network(["localhost"]);
    const hit = await findBridge({ saved: BRIDGE_LOCAL });
    expect(hit).toMatchObject({ base: BRIDGE_LOCAL, health: { name: "DESKTOP-PC" } });
  });

  it("does not sweep the network from a browser", async () => {
    const seen = network([]);
    expect(await findBridge({ saved: BRIDGE_LOCAL })).toBeNull();
    expect(seen).toEqual(["localhost"]);
  });

  it("in the app, finds it by broadcast", async () => {
    network(["192.168.1.20"]);
    const discover = vi.fn(async () => ({ found: [{ host: "192.168.1.20", port: 5005 }], addresses: [{ address: "192.168.1.40" }] }));
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { NovaLan: { discover } } } });
    const hit = await findBridge({ saved: "http://192.168.1.9:5005/v1" });
    expect(discover).toHaveBeenCalled();
    expect(hit.base).toBe("http://192.168.1.20:5005/v1");
  });

  it("in the app, sweeps its own network when broadcasts go unanswered", async () => {
    const seen = network(["192.168.7.150"]);
    const discover = vi.fn(async () => ({ found: [], addresses: [{ address: "192.168.7.40" }] }));
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { NovaLan: { discover } } } });
    const hit = await findBridge({});
    expect(hit.base).toBe("http://192.168.7.150:5005/v1");
    expect(seen.some((h) => h.startsWith("192.168.1."))).toBe(false);
  });

  it("a request that cannot reach the bridge finds it again and retries there", async () => {
    network(["192.168.1.20"]);
    const moved = vi.fn();
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true, Plugins: { NovaLan: { discover: async () => ({ found: [{ host: "192.168.1.20" }], addresses: [] }) } } },
      dispatchEvent: (e) => moved(e.detail),
    });
    vi.stubGlobal("CustomEvent", class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
    const bridge = newProvider("nova-bridge", { base: "http://192.168.1.9:5005/v1", model: "claude/sonnet" });
    const settings = { ...JSON.parse(JSON.stringify(emptyData.settings)), providers: [bridge], activeProvider: bridge.id };
    const r = await completeText({ settings, system: "s", user: "u" });
    expect(r.text).toBe("hello from the bridge");
    expect(moved).toHaveBeenCalledWith(expect.objectContaining({ base: "http://192.168.1.20:5005/v1" }));
  });
});

describe("who may call the bridge", () => {
  it("lets Nova's own origins through and refuses other web pages", () => {
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("http://localhost:5173")).toBe(true);
    expect(originAllowed("capacitor://localhost")).toBe(true);
    expect(originAllowed("https://localhost")).toBe(true);
    expect(originAllowed("http://192.168.1.40:5173")).toBe(false);
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("http://localhost.evil.example")).toBe(false);
    expect(originAllowed("null")).toBe(false);
  });

  it("lets the desktop app's own origin through with home-network trust off", () => {
    expect(originAllowed("http://127.0.0.1:47615")).toBe(true);
    expect(originAllowed("http://localhost:47615")).toBe(true);
    /* only that port: other local pages still have to be allowed */
    expect(originAllowed("http://127.0.0.1:47616")).toBe(false);
  });
});

it("never forwards an existing credential to a newly discovered bridge address", async () => {
  const original = "http://192.168.44.44:5005/v1";
  const sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    if (new Headers(init.headers || {}).has("Authorization")) { sent.push(String(url)); throw new TypeError("Offline"); }
    if (String(url).startsWith("http://localhost:5005/") && String(url).endsWith("/health")) return new Response(JSON.stringify(HEALTH));
    throw new TypeError("Offline");
  }));
  await expect(sendTo({ src: "nova-bridge", base: original }, {}, "/chat/completions", { headers: { Authorization: "Bearer private-device-key" } })).rejects.toThrow();
  expect(sent).toEqual([`${original}/chat/completions`]);
});

it("rejects a manually changed paired endpoint before sending a credential", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(sendTo({ src: "nova-bridge", base: "https://other.test/v1", credentialBase: "https://approved.test/v1" }, {}, "/chat/completions", { headers: { Authorization: "Bearer private-device-key" } })).rejects.toThrow(/Request device access/);
  expect(fetch).not.toHaveBeenCalled();
});

/* ---------- the server, with Claude through a stand-in Claude Code ---------- */

describe("Nova Bridge server", () => {
  let base;
  const realFetch = globalThis.fetch;
  const KEY = { Authorization: "Bearer test-bridge-key" };
  /* what Claude Code will answer next, and what it was given */
  const scenario = (s) => fs.writeFileSync(process.env.FAKE_CLAUDE_SCENARIO, JSON.stringify(s));
  const runs = () => (fs.existsSync(process.env.FAKE_CLAUDE_LOG) ? fs.readFileSync(process.env.FAKE_CLAUDE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const clearRuns = () => fs.rmSync(process.env.FAKE_CLAUDE_LOG, { force: true });

  beforeAll(async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const chat = (body, headers = KEY) => realFetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const pair = (route, body, headers = {}) => realFetch(`${base}/pair/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("refuses a request from another web page before running any subscription", async () => {
    clearRuns();
    const r = await chat({ model: "claude/sonnet", messages: [{ role: "user", content: "hi" }] }, { ...KEY, Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(runs()).toEqual([]);
    const a = await realFetch(`${base}/auth/claude/logout`, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" });
    expect(a.status).toBe(403);
  });

  it("lists the models Anthropic offers the Claude sign-in, OpenRouter-style and free", async () => {
    const asked = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (!String(url).startsWith("https://api.anthropic.com/")) return realFetch(url, init);
      asked.push(init.headers.Authorization);
      return Response.json({ data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }, { id: "claude-fable-5-2", display_name: "Claude Fable 5.2", max_input_tokens: 1000000 }] });
    }));
    const d = await (await realFetch(`${base}/v1/models`, { headers: KEY })).json();
    expect(d.data.map((m) => m.id).sort()).toEqual(["claude/claude-fable-5-2", "claude/claude-opus-5-5"]);
    expect(d.data.find((m) => m.id === "claude/claude-opus-5-5")).toMatchObject({ context_length: 200000, pricing: { prompt: "0", completion: "0" } });
    expect(d.data.find((m) => m.id === "claude/claude-fable-5-2").context_length).toBe(1000000);
    expect(asked).toEqual(["Bearer sk-ant-oat-test"]);
  });

  it("streams the reply with the whole system prompt as Claude Code's own, and no tools", async () => {
    clearRuns();
    scenario({ deltas: ["Hel", "lo"], stop: "max_tokens", usage: { input_tokens: 9, output_tokens: 2 } });
    const system = "You are Mira.\n\n<rules>Stay in character.</rules>";
    const r = await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "system", content: system }, { role: "user", content: "hi" }] });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await r.text();
    const frames = text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)));
    expect(frames.map((f) => f.choices[0].delta.content || "").join("")).toBe("Hello");
    const last = frames[frames.length - 1];
    expect(last.choices[0].finish_reason).toBe("length");
    expect(last.usage).toMatchObject({ prompt_tokens: 9, completion_tokens: 2 });
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    const [run] = runs();
    expect(run).toMatchObject({ model: "sonnet", system, prompt: "hi" });
    expect(run.args).toEqual(expect.arrayContaining(["--tools", "", "--strict-mcp-config", "--setting-sources", "--no-session-persistence"]));
  });

  it("answers without streaming when Nova does not ask for a stream", async () => {
    scenario({ deltas: ["{\"ok\":true}"] });
    const d = await (await chat({ model: "claude/haiku", messages: [{ role: "user", content: "json" }] })).json();
    expect(d.object).toBe("chat.completion");
    expect(d.choices[0].message.content).toBe("{\"ok\":true}");
  });

  it("passes Claude's refusal on as a real HTTP error", async () => {
    scenario({ error: "Claude AI usage limit reached" });
    const r = await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toMatch(/usage limit/);
  });

  it("says which subscription is not connected", async () => {
    const r = await chat({ model: "antigravity/gemini-3-flash", stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toMatch(/Antigravity is not connected/);
  });

  it("reports Claude Code dying mid-reply as an error frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scenario({ deltas: ["Hi"], die: true });
    const text = await (await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "user", content: "hi" }] })).text();
    expect(text).toMatch(/"error":\{"code":502/);
    warn.mockRestore();
  });

  it("connects Claude only from the Bridge window, never over the network", async () => {
    const r = await realFetch(`${base}/auth/claude/start`, { method: "POST", headers: KEY, body: "{}" });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/Bridge window/);
    expect((await realFetch(`${base}/auth/claude/token`, { method: "POST", headers: KEY, body: JSON.stringify({ token: "x" }) })).status).toBe(400);
  });

  it("requires host OAuth credentials before starting a Google sign-in", async () => {
    const r = await realFetch(`${base}/auth/antigravity/start`, { method: "POST", headers: KEY, body: "{}" });
    expect(r.status).toBe(503);
    expect((await r.json()).error.message).toContain("NOVA_GOOGLE_CLIENT_ID");
  });

  it("refuses a pasted Google address when no sign-in is waiting", async () => {
    const r = await realFetch(`${base}/auth/antigravity/callback`, { method: "POST", headers: KEY, body: JSON.stringify({ url: "http://localhost:51121/oauth-callback?code=abc&state=x" }) });
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toMatch(/No Google sign-in is waiting/);
  });

  it("rejects unauthenticated loopback clients", async () => {
    const response = await realFetch(`${base}/v1/models`);
    expect(response.status).toBe(401);
    const health = await realFetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).providers).toEqual({});
  });

  it("shows sign-ins on /health", async () => {
    const h = await (await realFetch(`${base}/health`, { headers: KEY })).json();
    expect(h.providers.claude).toMatchObject({ connected: true, source: "claude-code" });
    expect(h.providers.antigravity.connected).toBe(false);
    expect(h.providers.copilot).toBeUndefined();
    expect(h.locked).toBe(true);
  });

  it("approves individual devices without granting subscription management and revokes them", async () => {
    const token = "d".repeat(64);
    const request = await (await pair("request", { token, name: "Phone" })).json();
    expect(request.status).toBe("pending");
    const headers = { Authorization: `Bearer ${token}` };
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(401);
    bridgeDevice(request.id, "approve");
    expect((await (await pair("status", { id: request.id, token })).json()).status).toBe("approved");
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(200);
    expect((await (await realFetch(`${base}/health`, { headers })).json()).management).toBe(false);
    expect((await realFetch(`${base}/auth/claude/logout`, { method: "POST", headers, body: "{}" })).status).toBe(403);
    bridgeDevice(request.id, "revoke");
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(401);
  });

  it("approves Nova on this computer's desktop app as it asks, and nothing else that way", async () => {
    const token = "a1".repeat(32);
    const desktop = await (await pair("request", { token, name: "Nova desktop" }, { Origin: "http://127.0.0.1:47615" })).json();
    expect(desktop.status).toBe("approved");
    expect((await realFetch(`${base}/v1/models`, { headers: { Origin: "http://127.0.0.1:47615", Authorization: `Bearer ${token}` } })).status).toBe(200);
    /* the dev server, or any other local page, still waits for approval */
    const other = await (await pair("request", { token: "b2".repeat(32), name: "Nova browser" }, { Origin: "http://localhost:5173" })).json();
    expect(other.status).toBe("pending");
  });

  it("blocks a device: it is cut off and cannot ask again until unblocked", async () => {
    const token = "c3".repeat(32);
    const headers = { Authorization: `Bearer ${token}` };
    const request = await (await pair("request", { token, name: "Stranger" })).json();
    bridgeDevice(request.id, "approve");
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(200);
    bridgeDevice(request.id, "block");
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(401);
    const again = await pair("request", { token, name: "Stranger" });
    expect(again.status).toBe(403);
    expect((await again.json()).error.message).toMatch(/blocked/);
    bridgeDevice(request.id, "unblock");
    expect((await pair("request", { token, name: "Stranger" })).status).toBe(200);
  });

  it("answers only its own local networks", () => {
    expect(networkOf("8.8.8.8")).toBeNull();
    expect(networkOf("100.64.1.2")).toBeNull();
    const own = Object.values(os.networkInterfaces()).flat().find((n) => n?.family === "IPv4" && !n.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(n.address) && n.netmask >= "255.255.0.0");
    if (own) expect(networkOf(own.address)).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
  });

  it("limits unconfigured origins to discovery and pairing, then scopes their credentials", async () => {
    const origin = "https://phone.example";
    const token = "e".repeat(64);
    const headers = { Origin: origin, "Content-Type": "application/json" };
    expect((await realFetch(`${base}/health`, { headers })).status).toBe(200);
    expect((await realFetch(`${base}/v1/models`, { headers })).status).toBe(403);
    expect((await realFetch(`${base}/pair/request`, { method: "OPTIONS", headers })).status).toBe(204);
    const request = await (await realFetch(`${base}/pair/request`, { method: "POST", headers, body: JSON.stringify({ token, name: "New phone" }) })).json();
    expect(request.status).toBe("pending");
    expect(originAllowed(origin)).toBe(false);
    bridgeDevice(request.id, "approve");
    expect(originAllowed(origin)).toBe(true);
    const health = await realFetch(`${base}/health`, { headers: { ...headers, Authorization: `Bearer ${token}` } });
    expect((await health.json()).management).toBe(false);
    expect((await realFetch(`${base}/v1/models`, { headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}` } })).status).toBe(401);
    bridgeDevice(request.id, "revoke");
    expect(originAllowed(origin)).toBe(false);
    expect((await realFetch(`${base}/pair/request`, { method: "POST", headers: { Origin: "null" }, body: "{}" })).status).toBe(403);
  });

  it("stops Claude Code mid-reply when its device is blocked", async () => {
    const token = "9".repeat(64);
    const request = await (await pair("request", { token, name: "Streaming phone" })).json();
    bridgeDevice(request.id, "approve");
    clearRuns();
    scenario({ deltas: ["Hi"], hang: true });
    const response = await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "user", content: "hi" }] }, { Authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(runs()).toHaveLength(1));
    const { pid } = runs()[0];
    bridgeDevice(request.id, "block");
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    await response.body.cancel().catch(() => {});
    bridgeDevice(request.id, "unblock");
  });

  it("disconnects Claude for the Bridge without signing Claude Code out", () => {
    bridgeSignOut("claude");
    const saved = JSON.parse(fs.readFileSync(process.env.NOVA_BRIDGE_AUTH_FILE));
    expect(saved.claude).toBeNull();
    expect(saved.skipCli).toContain("claude");
  });
});

/* ---------- syncing devices through the Bridge ---------- */

describe("Bridge sync", () => {
  let base;
  const realFetch = globalThis.fetch;
  const KEY = { Authorization: "Bearer test-bridge-key" };
  beforeAll(async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  const lib = (name) => makeBackup({ ...emptyData, characters: [{ id: "c1", name }] }, "3.2.4");

  it("is empty at first, and refuses a caller with no credential", async () => {
    expect(await (await realFetch(`${base}/v1/sync`, { headers: KEY })).json()).toEqual({ rev: 0 });
    expect((await realFetch(`${base}/v1/sync`)).status).toBe(401);
    expect((await realFetch(`${base}/v1/sync/data`, { headers: KEY })).status).toBe(404);
  });

  it("stores what a device sends and hands it back whole", async () => {
    const body = lib("Juno");
    const put = await realFetch(`${base}/v1/sync`, { method: "PUT", body, headers: { ...KEY, "X-Nova-Device": "Nova%20desktop", "X-Nova-Summary": "1%20character", "X-Nova-Base-Rev": "0" } });
    const meta = await put.json();
    expect(put.status).toBe(200);
    expect(meta).toMatchObject({ rev: 1, device: "Nova desktop", summary: "1 character", bytes: Buffer.byteLength(body) });
    const got = await realFetch(`${base}/v1/sync/data`, { headers: KEY });
    expect(got.headers.get("X-Nova-Rev")).toBe("1");
    expect(readBackup(await got.text()).state.characters[0].name).toBe("Juno");
  });

  it("refuses a send based on an older copy, unless sent anyway", async () => {
    const stale = await realFetch(`${base}/v1/sync`, { method: "PUT", body: lib("Wren"), headers: { ...KEY, "X-Nova-Base-Rev": "0" } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).rev).toBe(1);
    const forced = await realFetch(`${base}/v1/sync`, { method: "PUT", body: lib("Wren"), headers: KEY });
    expect((await forced.json()).rev).toBe(2);
  });

  it("refuses something that is not a Nova backup and keeps the last copy", async () => {
    const bad = await realFetch(`${base}/v1/sync`, { method: "PUT", body: '{"hello":1}', headers: KEY });
    expect(bad.status).toBe(400);
    const meta = await (await realFetch(`${base}/v1/sync`, { headers: KEY })).json();
    expect(meta.rev).toBe(2);
  });
});
