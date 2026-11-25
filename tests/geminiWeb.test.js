import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GeminiWebError, GeminiWebSession, appModelHeader, cookieHeader, modelHeaders, parseCookieInput, parseGeminiModelList } from "../bridge/gemini-web.mjs";

/* The bridge reads its sign-ins at import: an empty home and a throwaway store. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-gemini-test-"));
process.env.NOVA_BRIDGE_KEY = "test-bridge-key";
process.env.NOVA_BRIDGE_HOME = TMP;
process.env.NOVA_BRIDGE_AUTH_FILE = path.join(TMP, "auth.json");
/* a test must never read or open a real browser */
process.env.NOVA_BRIDGE_GEMINI_BROWSER = "none";
fs.writeFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "{}");
const { server, bridgeInfo, bridgeSetBrowserSignIn, bridgeSetGeminiTransport, bridgeSignOut } = await import("../bridge/bridge.mjs");

/* ---------- a fake gemini.google.com ---------- */

const frame = (inner) => JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
const snap = (text, thoughts) => frame([null, ["c_1", "r_1"], null, null, [["rc_1", [text], ...Array(35).fill(null), ...(thoughts ? [[[thoughts]]] : [])]]]);
const wire = (...frames) => `)]}'\n\n${frames.map((f) => `${f.length}\n${f}\n`).join("")}`;
/* a snapshot that also names the model that answered (inner[42]) */
const snapAs = (text, model) => frame([null, ["c_1", "r_1"], null, null, [["rc_1", [text]]], ...Array(37).fill(null), model]);
const errorFrame = (code) => JSON.stringify([["wrb.fr", null, null, null, null, [3, null, [[code]]]]]);
const PAGE = `<html>${"x".repeat(2500)} "SNlM0e":"page-token" "cfb2h":"boq_build" "FdrFJe":"-123456" </html>`;

/* The app's model list (batchexecute otAQ7b), trimmed from a live Pro
   account's answer (Nov 2026): [24] is [policy, entries], an entry
   [info, levels, _, surfaces]. Surface [1] is the picker; [2] repeats models
   for another screen. 4 Carbon carries the upgrade marker (info[14]). */
const LEVELS = [[1, "Low", "Fast and efficient"], [4, "Medium", "Balanced depth"], [2, "High", "Extra thorough"]];
const entry = (mode, short, long, desc, levels, surfaces, upsell = null) =>
  [["", mode, false, null, short, long, null, false, null, null, false, null, desc, [2, 140], upsell, levels.length > 1 ? 2 : 1], levels, null, surfaces];
const MODEL_LIST = (() => {
  const inner = Array(25).fill(null);
  inner[24] = ["neon_pro_policy", [
    [["", 6, false, null, "Auto", "Adapts to your needs", null, false, null, null, false, null, "Auto", [2, 140], null, 1], null, 1, [1]],
    entry(1, "4 Hydrogen", "4 Hydrogen", "Everyday help", LEVELS, [1]),
    entry(1, "4 Hydrogen", "4 Hydrogen", "Everyday help", [[1, "Standard"]], [2]),
    entry(3, "Neon", "4 Neon", "Deeper analysis", LEVELS, [1]),
    entry(8, "Carbon", "4 Carbon", "Complex tasks", [[1, "Standard"]], [1], [1, "gemini-4-carbon"]),
    entry(8, "Carbon", "4 Carbon", "Complex tasks", [[1, "Standard"]], [2], [1, "gemini-4-carbon"]),
  ]];
  return wire(JSON.stringify([["wrb.fr", "otAQ7b", JSON.stringify(inner), null, null, null, "generic"]]));
})();
const DELETED = wire(JSON.stringify([["wrb.fr", "GzXR5e", "[]", null, null, null, "generic"]]));

function fakeGoogle() {
  const g = {
    log: [],
    page: { status: 200, headers: {}, body: PAGE },
    stream: () => ({ status: 200, headers: {}, body: wire(snap("Hel"), snap("Hello there")) }),
    rotate: () => ({ status: 200, headers: { "set-cookie": ["__Secure-1PSIDTS=rotated; Path=/; Secure; HttpOnly"] }, body: "" }),
    models: () => ({ status: 200, headers: {}, body: MODEL_LIST }),
    deleted: [],
  };
  g.request = async (o) => {
    g.log.push(o);
    const u = new URL(o.url);
    if (u.pathname.endsWith("/app")) return g.page;
    if (u.pathname === "/RotateCookies") return g.rotate(o);
    if (u.pathname.endsWith("/batchexecute")) {
      const rpc = u.searchParams.get("rpcids");
      if (rpc === "otAQ7b") return g.models(o);
      if (rpc === "GzXR5e") {
        g.deleted.push(JSON.parse(JSON.parse(new URLSearchParams(o.body).get("f.req"))[0][0][1])[0]);
        return { status: 200, headers: {}, body: DELETED };
      }
    }
    if (u.pathname.endsWith("/StreamGenerate")) {
      const r = g.stream(o);
      if (r.status < 400) {
        /* arrive in two pieces, as a real stream would */
        const half = Math.floor(r.body.length / 2);
        o.onChunk?.(r.body.slice(0, half));
        o.onChunk?.(r.body.slice(half));
      }
      return r;
    }
    return { status: 404, headers: {}, body: "" };
  };
  return g;
}

const COOKIES = { "__Secure-1PSID": "psid-value", "__Secure-1PSIDTS": "psidts-value" };

describe("Gemini app client (gemini-web.mjs)", () => {
  describe("parseCookieInput", () => {
    it("reads a whole Cookie header", () => {
      expect(parseCookieInput("Cookie: __Secure-1PSID=a; __Secure-1PSIDTS=b; NID=c").cookies).toEqual({ "__Secure-1PSID": "a", "__Secure-1PSIDTS": "b", NID: "c" });
    });
    it("reads DevTools rows", () => {
      expect(parseCookieInput("__Secure-1PSID\tg.a000abc\t.google.com\n__Secure-1PSIDTS\tsidts-1\t.google.com").cookies).toEqual({ "__Secure-1PSID": "g.a000abc", "__Secure-1PSIDTS": "sidts-1" });
    });
    it("reads a JSON export", () => {
      expect(parseCookieInput(JSON.stringify([{ name: "__Secure-1PSID", value: "a", domain: ".google.com" }, { name: "SID", value: "s" }])).cookies).toEqual({ "__Secure-1PSID": "a", SID: "s" });
      expect(parseCookieInput('{"__Secure-1PSID":"a"}').cookies).toEqual({ "__Secure-1PSID": "a" });
    });
    it("reads the two bare values and an account number", () => {
      expect(parseCookieInput("g.a000abcdefghijklmnop\nsidts-xyz-abcdefghijklmnop")).toEqual({ cookies: { "__Secure-1PSID": "g.a000abcdefghijklmnop", "__Secure-1PSIDTS": "sidts-xyz-abcdefghijklmnop" }, authuser: 0 });
      expect(parseCookieInput("__Secure-1PSID=a; authuser=2")).toEqual({ cookies: { "__Secure-1PSID": "a" }, authuser: 2 });
    });
    it("finds nothing in nothing", () => {
      expect(parseCookieInput("").cookies).toEqual({});
    });
  });

  it("names the model with a header, or none for the default", () => {
    expect(modelHeaders("")).toEqual({});
    expect(modelHeaders("95a4c0abcba24364")).toEqual({ "x-goog-ext-525001261-jspb": '[1,null,null,null,"95a4c0abcba24364",null,null,0,[4]]' });
    expect(modelHeaders("[1,null,null,null,\"zz\"]")["x-goog-ext-525001261-jspb"]).toBe('[1,null,null,null,"zz"]');
  });

  it("reads the app's picker: one row per thinking level, locked models marked, other screens left out", () => {
    const rows = parseGeminiModelList(MODEL_LIST);
    expect(rows.map((m) => [m.slug, m.name, m.locked])).toEqual([
      ["auto", "Auto", false],
      ["4-hydrogen-low", "4 Hydrogen (Low)", false],
      ["4-hydrogen-medium", "4 Hydrogen (Medium)", false],
      ["4-hydrogen-high", "4 Hydrogen (High)", false],
      ["4-neon-low", "4 Neon (Low)", false],
      ["4-neon-medium", "4 Neon (Medium)", false],
      ["4-neon-high", "4 Neon (High)", false],
      ["4-carbon", "4 Carbon", true],
    ]);
    /* the model by its mode and level at 14 and 15, as the app sends it */
    expect(JSON.parse(rows.find((m) => m.slug === "4-hydrogen-medium").header).slice(14)).toEqual([1, 4]);
    expect(JSON.parse(rows.find((m) => m.slug === "auto").header).slice(14)).toEqual([6, null]);
    expect(parseGeminiModelList(")]}'\n\n12\n[[\"e\",4]]\n")).toBeNull();
  });

  it("needs the __Secure-1PSID cookie", () => {
    expect(() => new GeminiWebSession({ cookies: { NID: "x" } })).toThrow(GeminiWebError);
  });

  describe("session", () => {
    it("takes the page token, build label and session id from the app page", async () => {
      const g = fakeGoogle();
      const s = new GeminiWebSession({ cookies: COOKIES, request: g.request });
      await s.init();
      expect(s).toMatchObject({ at: "page-token", bl: "boq_build", sid: "-123456", ready: true });
      expect(g.log[0].url).toBe("https://gemini.google.com/app");
      expect(g.log[0].headers.Cookie).toBe(cookieHeader(COOKIES));
    });

    it("uses /u/N for another account", async () => {
      const g = fakeGoogle();
      await new GeminiWebSession({ cookies: COOKIES, authuser: 2, request: g.request }).init();
      expect(g.log[0].url).toBe("https://gemini.google.com/u/2/app");
    });

    it("knows an expired sign-in by the redirect or the missing token", async () => {
      const g = fakeGoogle();
      g.page = { status: 302, headers: { location: "https://accounts.google.com/ServiceLogin?x=1" }, body: "" };
      await expect(new GeminiWebSession({ cookies: COOKIES, request: g.request }).init()).rejects.toMatchObject({ status: 401 });
      g.page = { status: 200, headers: {}, body: "<html>sign in</html>" };
      await expect(new GeminiWebSession({ cookies: COOKIES, request: g.request }).init()).rejects.toMatchObject({ status: 401 });
      g.page = { status: 200, headers: {}, body: `<html>${"x".repeat(3000)}</html>` };
      await expect(new GeminiWebSession({ cookies: COOKIES, request: g.request }).init()).rejects.toMatchObject({ status: 502 });
    });

    it("merges every cookie Google hands back and reports the set", async () => {
      const g = fakeGoogle();
      const seen = [];
      const s = new GeminiWebSession({ cookies: COOKIES, request: g.request, onCookies: (c) => seen.push(c) });
      expect(await s.rotate()).toBe(true);
      expect(s.cookies).toEqual({ ...COOKIES, "__Secure-1PSIDTS": "rotated" });
      expect(seen).toHaveLength(1);
      g.rotate = () => ({ status: 200, headers: {}, body: "" });
      expect(await s.rotate()).toBe(false);
      g.rotate = () => ({ status: 401, headers: {}, body: "" });
      await expect(s.rotate()).rejects.toMatchObject({ status: 401 });
    });

    it("streams growing snapshots and sends the prompt, token and model header", async () => {
      const g = fakeGoogle();
      const s = new GeminiWebSession({ cookies: COOKIES, request: g.request });
      const snaps = [];
      const r = await s.stream({ prompt: "PROMPT TEXT", header: "abc123abc123", onSnapshot: (p) => snaps.push(p.text) });
      expect(r).toMatchObject({ text: "Hello there", cid: "c_1" });
      expect(snaps.at(-1)).toBe("Hello there");
      const post = g.log.find((o) => o.method === "POST");
      const form = new URLSearchParams(post.body);
      expect(form.get("at")).toBe("page-token");
      expect(JSON.parse(JSON.parse(form.get("f.req"))[1])[0][0]).toBe("PROMPT TEXT");
      expect(post.headers["x-goog-ext-525001261-jspb"]).toContain("abc123abc123");
      expect(post.url).toContain("f.sid=-123456");
      expect(post.url).toContain("bl=boq_build");
    });

    it("gets a fresh page token and tries once more when nothing was shown yet", async () => {
      const g = fakeGoogle();
      let tries = 0;
      const good = g.stream;
      g.stream = (o) => (++tries === 1 ? { status: 400, headers: {}, body: "bad token" } : good(o));
      const s = new GeminiWebSession({ cookies: COOKIES, request: g.request });
      expect((await s.stream({ prompt: "hi" })).text).toBe("Hello there");
      expect(tries).toBe(2);
      expect(g.log.filter((o) => o.url.endsWith("/app")).length).toBe(2);
    });

    it("does not retry once text has appeared, or on a quota answer", async () => {
      const g = fakeGoogle();
      g.stream = () => ({ status: 429, headers: {}, body: "" });
      await expect(new GeminiWebSession({ cookies: COOKIES, request: g.request }).stream({ prompt: "hi" })).rejects.toMatchObject({ status: 429 });
      expect(g.log.filter((o) => o.method === "POST" && o.url.includes("StreamGenerate")).length).toBe(1);
    });

    it("asks the app for its models with the app's own client header", async () => {
      const g = fakeGoogle();
      const models = await new GeminiWebSession({ cookies: COOKIES, request: g.request }).listModels();
      expect(models.map((m) => m.slug)).toContain("4-carbon");
      const call = g.log.find((o) => o.url.includes("rpcids=otAQ7b"));
      expect(call.headers["x-goog-ext-525001261-jspb"]).toBe(appModelHeader());
      expect(JSON.parse(new URLSearchParams(call.body).get("f.req"))).toEqual([[["otAQ7b", "[1]", null, "generic"]]]);
    });

    it("deletes a chat, and says so only when the app's delete answered", async () => {
      const g = fakeGoogle();
      const s = new GeminiWebSession({ cookies: COOKIES, request: g.request });
      await s.init();
      expect(await s.deleteChat("abc123")).toBe(true);
      expect(g.deleted).toEqual(["c_abc123"]);
      const real = g.request;
      s.request = async (o) => (o.url.includes("GzXR5e") ? { status: 200, headers: {}, body: wire(JSON.stringify([["er", null, null, null, null, 400]])) } : real(o));
      expect(await s.deleteChat("c_abc123")).toBe(false);
    });

    it("turns an error code inside a 200 answer into an error", async () => {
      const g = fakeGoogle();
      g.stream = () => ({ status: 200, headers: {}, body: wire(errorFrame(1037)) });
      await expect(new GeminiWebSession({ cookies: COOKIES, request: g.request }).stream({ prompt: "hi" })).rejects.toMatchObject({ status: 429, code: 1037 });
    });
  });
});

/* ---------- the bridge, against the fake ---------- */

describe("Gemini app in Nova Bridge", () => {
  let base;
  let g;
  const AUTH = { Authorization: "Bearer test-bridge-key" };
  const post = (route, body, headers = AUTH) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const chat = (body) => post("/v1/chat/completions", body);
  const health = async () => (await fetch(`${base}/health`, { headers: AUTH })).json();
  const messages = [{ role: "system", content: "You are Mira." }, { role: "user", content: "Who are you?" }];

  beforeAll(async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    g = fakeGoogle();
    bridgeSetGeminiTransport(g.request);
  });
  afterAll(async () => {
    bridgeSignOut("gemini-web");
    bridgeSetGeminiTransport(null);
    await new Promise((r) => server.close(r));
  });

  it("will not sign in without the cookies, nor with ones Google refuses", async () => {
    let r = await post("/auth/gemini-web/token", { token: "just some words" });
    expect(r.status).toBe(400);
    g.page = { status: 302, headers: { location: "https://accounts.google.com/x" }, body: "" };
    r = await post("/auth/gemini-web/token", { token: "__Secure-1PSID=bad" });
    expect(r.status).toBe(401);
    g.page = { status: 200, headers: {}, body: PAGE };
    expect((await health()).providers["gemini-web"].connected).toBe(false);
  });

  it("refuses the browser sign-in when there is no login window", async () => {
    const r = await post("/auth/gemini-web/start", {});
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/paste your gemini\.google\.com cookies/);
  });

  it("treats Connect pressed twice as one sign-in, and tells the window when the cookies are refused", async () => {
    let opened = 0;
    let finish;
    const prompt = "Finish signing in in Firefox, then select Sign in again.";
    bridgeSetBrowserSignIn(() => {
      if (++opened === 1) return { retryMessage: prompt };
      return new Promise((r) => { finish = r; });
    });
    await post("/auth/gemini-web/start", {});
    expect(bridgeInfo().subscriptions.find((p) => p.id === "gemini-web").flow?.message).toBe(prompt);
    await post("/auth/gemini-web/start", {});
    const again = await (await post("/auth/gemini-web/start", {})).json();
    expect(again.status).toBe("pending");
    expect(opened).toBe(2);
    expect(bridgeInfo().subscriptions.find((p) => p.id === "gemini-web").flow).toMatchObject({ status: "pending", message: expect.stringMatching(/Google sign-in/) });
    g.page = { status: 302, headers: { location: "https://accounts.google.com/x" }, body: "" };
    finish({ cookies: { "__Secure-1PSID": "refused" }, authuser: 0 });
    await new Promise((r) => setTimeout(r, 30));
    expect(bridgeInfo().subscriptions.find((p) => p.id === "gemini-web").flow).toMatchObject({ status: "error", message: expect.stringMatching(/expired/) });
    g.page = { status: 200, headers: {}, body: PAGE };
    bridgeSetBrowserSignIn(null);
  });

  it("opens the sign-in window when the browser's saved sign-in has ended", async () => {
    const calls = [];
    g.page = { status: 302, headers: { location: "https://accounts.google.com/x" }, body: "" };
    bridgeSetBrowserSignIn(({ skipSaved }) => {
      calls.push(skipSaved);
      if (!skipSaved) return { cookies: { "__Secure-1PSID": "ended" }, authuser: 0, saved: true };
      g.page = { status: 200, headers: {}, body: PAGE };
      return { cookies: { "__Secure-1PSID": "fresh" }, authuser: 0 };
    });
    await post("/auth/gemini-web/start", {});
    await new Promise((r) => setTimeout(r, 30));
    await vi.waitFor(() => expect(bridgeInfo().subscriptions.find((p) => p.id === "gemini-web").connected).toBe(true));
    expect(calls).toEqual([false, true]);
    expect(bridgeInfo().subscriptions.find((p) => p.id === "gemini-web").connected).toBe(true);
    bridgeSetBrowserSignIn(null);
  });

  it("signs in with pasted cookies and never shows them", async () => {
    const r = await post("/auth/gemini-web/token", { token: "__Secure-1PSID=secret-psid-value; __Secure-1PSIDTS=secret-psidts-value" });
    expect(r.status).toBe(200);
    const h = await health();
    expect(h.providers["gemini-web"]).toMatchObject({ connected: true, source: "manual", problem: null });
    expect(JSON.stringify(h)).not.toMatch(/secret-psid|page-token/);
    expect(fs.readFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "utf8")).toContain("secret-psid-value");
    expect(fs.statSync(process.env.NOVA_BRIDGE_AUTH_FILE).mode & 0o077).toBe(0);
  });

  it("lists exactly the models the app's picker offers this plan, and nothing else", async () => {
    const d = await (await fetch(`${base}/v1/models`, { headers: AUTH })).json();
    const rows = d.data.filter((m) => m.id.startsWith("gemini-web/"));
    expect(rows.map((m) => m.id).sort()).toEqual(["auto", "4-hydrogen-low", "4-hydrogen-medium", "4-hydrogen-high", "4-neon-low", "4-neon-medium", "4-neon-high"].map((x) => `gemini-web/${x}`).sort());
    expect(rows.find((m) => m.id === "gemini-web/4-neon-high")).toMatchObject({ pricing: { prompt: "0", completion: "0" } });
  });

  it("streams a reply, framing the system prompt in text and naming the model by header", async () => {
    g.log.length = 0;
    const r = await chat({ model: "gemini-web/4-neon-high", stream: true, messages });
    expect(r.status).toBe(200);
    const text = await r.text();
    const deltas = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]);
    expect(deltas.join("")).toBe("Hello there");
    expect(text).toMatch(/"finish_reason":"stop"/);
    expect(text).toMatch(/"usage":\{"prompt_tokens":\d+,"completion_tokens":3/);
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    const post = g.log.find((o) => o.method === "POST" && o.url.includes("StreamGenerate"));
    const prompt = JSON.parse(JSON.parse(new URLSearchParams(post.body).get("f.req"))[1])[0][0];
    expect(prompt).toContain("<instructions>\nYou are Mira.\n</instructions>");
    expect(prompt).toContain("<user>\nWho are you?\n</user>");
    expect(post.headers["x-goog-ext-525001261-jspb"]).toBe(appModelHeader(3, 2));
  });

  it("deletes each chat from the Gemini history after its reply", async () => {
    g.deleted.length = 0;
    expect((await chat({ model: "gemini-web/default", messages })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(g.deleted).toEqual(["c_1"]);
  });

  it("sends no model header for the account default, and answers without streaming", async () => {
    g.log.length = 0;
    const r = await chat({ model: "gemini-web/default", messages });
    const d = await r.json();
    expect(d).toMatchObject({ object: "chat.completion", provider: "gemini-web", choices: [{ message: { content: "Hello there" }, finish_reason: "stop" }] });
    const post = g.log.find((o) => o.method === "POST" && o.url.includes("StreamGenerate"));
    expect(post.headers["x-goog-ext-525001261-jspb"]).toBeUndefined();
  });

  it("sends a bare Argon id to the Gemini app once it is learned, and shows thoughts as reasoning", async () => {
    await post("/auth/gemini-web/models", { slug: "gemini-4-argon", name: "Gemini 4 Argon", header: "feedfacefeedface" });
    g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hi", "let me think"), snap("Hi there", "let me think")) });
    const d = await (await chat({ model: "gemini-4-argon", messages })).json();
    expect(d).toMatchObject({ provider: "gemini-web", choices: [{ message: { content: "Hi there", reasoning: "let me think" } }] });
  });

  it("warns when the app answers with another model than the one asked for", async () => {
    await post("/auth/gemini-web/models", { slug: "gemini-4-argon", name: "Gemini 4 Argon", header: "feedfacefeedface" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      g.stream = () => ({ status: 200, headers: {}, body: wire(snapAs("Hi", "4 Argon")) });
      expect((await chat({ model: "gemini-web/gemini-4-argon", messages })).status).toBe(200);
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/Gemini app answered with/));
      g.stream = () => ({ status: 200, headers: {}, body: wire(snapAs("Hi", "3.5 Flash-Lite")) });
      expect((await chat({ model: "gemini-web/gemini-4-argon", messages })).status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/asked for gemini-4-argon but the Gemini app answered with "3\.5 Flash-Lite"/));
      warn.mockClear();
      expect((await chat({ model: "gemini-web/default", messages })).status).toBe(200);
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/Gemini app answered with/));
    } finally {
      warn.mockRestore();
    }
  });

  it("makes a refusal Google puts inside a 200 answer a real HTTP error", async () => {
    g.stream = () => ({ status: 200, headers: {}, body: wire(errorFrame(1037)) });
    const r = await chat({ model: "gemini-web/default", stream: true, messages });
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toMatch(/usage limit/);
  });

  describe("while the app's model list cannot be read", () => {
    let warn;
    beforeAll(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      g.models = () => ({ status: 500, headers: {}, body: "" });
      bridgeSetGeminiTransport(g.request);
    });
    afterAll(() => {
      g.models = () => ({ status: 200, headers: {}, body: MODEL_LIST });
      bridgeSetGeminiTransport(g.request);
      warn.mockRestore();
    });
    const listed = async () => (await (await fetch(`${base}/v1/models`, { headers: AUTH })).json()).data.map((m) => m.id).filter((id) => id.startsWith("gemini-web/")).sort();

    it("lists nothing rather than guess, while learned models still answer", async () => {
      await post("/auth/gemini-web/models", { slug: "hydrogen-4", name: "Hydrogen 4", header: "56fdd199312815e2" });
      expect(await listed()).toEqual([]);
      g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hi", "")) });
      expect((await chat({ model: "gemini-web/hydrogen-4", messages })).status).toBe(200);
    });

    it("stops offering a learned model Google refuses, until it is learned again", async () => {
      g.stream = () => ({ status: 200, headers: {}, body: wire(errorFrame(1052)) });
      expect((await chat({ model: "gemini-web/hydrogen-4", messages })).status).toBe(404);
      /* refused now without asking Google again */
      g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hi", "")) });
      expect((await (await chat({ model: "gemini-web/hydrogen-4", messages })).json()).error.message).toMatch(/stopped accepting/);
      g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Back", ""))});
      const learned = await post("/auth/gemini-web/models", { slug: "hydrogen-4", name: "Hydrogen 4", header: "feedfacefeedface" });
      expect(learned.status).toBe(200);
      g.log.length = 0;
      expect((await (await chat({ model: "gemini-web/hydrogen-4", messages })).json()).choices[0].message.content).toBe("Back");
      const used = g.log.find((o) => o.method === "POST" && o.url.includes("StreamGenerate"));
      expect(used.headers["x-goog-ext-525001261-jspb"]).toContain("feedfacefeedface");
    });

    it("learns and forgets models, checking what it is given", async () => {
      expect((await post("/auth/gemini-web/models", { slug: "x y", header: "feedfacefeedface" })).status).toBe(400);
      expect((await post("/auth/gemini-web/models", { slug: "gemini-4-flash", header: "not a header" })).status).toBe(400);
      expect((await post("/auth/gemini-web/models", { slug: "default", header: "feedfacefeedface" })).status).toBe(400);
      expect((await post("/auth/gemini-web/models", { slug: "gemini-4-flash", name: "Gemini 4 Flash", header: "0123456789abcdef" })).status).toBe(200);
      expect((await chat({ model: "gemini-web/gemini-4-flash", messages })).status).toBe(200);
      expect((await post("/auth/gemini-web/models", { remove: "gemini-4-flash" })).status).toBe(200);
      expect((await chat({ model: "gemini-web/gemini-4-flash", messages })).status).toBe(404);
    });
  });

  it("never hides a model the app lists, even after a refusal", async () => {
    g.stream = () => ({ status: 200, headers: {}, body: wire(errorFrame(1052)) });
    expect((await chat({ model: "gemini-web/4-neon-low", messages })).status).toBe(404);
    const ids = (await (await fetch(`${base}/v1/models`, { headers: AUTH })).json()).data.map((m) => m.id);
    expect(ids).toContain("gemini-web/4-neon-low");
    g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hello there", "")) });
    expect((await chat({ model: "gemini-web/4-neon-low", messages })).status).toBe(200);
  });

  it("keeps the rotated cookie in the store", async () => {
    await post("/auth/gemini-web/token", { token: "__Secure-1PSID=secret-psid-value" });
    g.stream = () => ({ status: 200, headers: { "set-cookie": ["__Secure-1PSIDTS=fresh-from-stream; Path=/"] }, body: wire(snap("ok", "")) });
    await chat({ model: "gemini-web/default", messages });
    expect(fs.readFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, "utf8")).toContain("fresh-from-stream");
  });

  it("says the sign-in expired, and shows it on /health", async () => {
    g.stream = () => ({ status: 401, headers: {}, body: "" });
    g.page = { status: 302, headers: { location: "https://accounts.google.com/ServiceLogin" }, body: "" };
    const r = await chat({ model: "gemini-web/default", messages });
    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toMatch(/expired/);
    expect((await health()).providers["gemini-web"].problem).toMatch(/expired/);
    g.page = { status: 200, headers: {}, body: PAGE };
  });

  it("counts the day's prompts for the Usage tab, and notes a limit being hit", async () => {
    await post("/auth/gemini-web/token", { token: "__Secure-1PSID=secret-psid-value" });
    const usage = async () => (await (await fetch(`${base}/v1/usage`, { headers: AUTH })).json()).providers["gemini-web"];
    const before = (await usage()).requests;
    g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hello there", "")) });
    await chat({ model: "gemini-web/default", messages });
    await chat({ model: "gemini-web/4-neon-low", messages });
    const u = await usage();
    expect(u).toMatchObject({ kind: "counted", requests: before + 2 });
    expect(u.byModel).toMatchObject({ default: expect.any(Number), "4-neon-low": expect.any(Number) });
    expect(u.tokensOut).toBeGreaterThan(0);
    expect(Date.parse(u.resetsAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(u.resetsAt) - Date.now()).toBeLessThanOrEqual(86400000);
    g.stream = () => ({ status: 200, headers: {}, body: wire(errorFrame(1037)) });
    await chat({ model: "gemini-web/default", messages });
    expect((await usage()).limitHitAt).toMatch(/^20\d\d-/); /* also set by the earlier quota test in this file: only checked that it is recorded */
    expect((await usage()).requests).toBe(before + 2);
    g.stream = () => ({ status: 200, headers: {}, body: wire(snap("Hello there", "")) });
  });

  it("signs out", async () => {
    expect((await post("/auth/gemini-web/logout", {})).status).toBe(200);
    expect((await health()).providers["gemini-web"].connected).toBe(false);
    const r = await chat({ model: "gemini-web/default", messages });
    expect(r.status).toBe(401);
  });
});
