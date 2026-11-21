import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/* Antigravity is signed in already (an unexpired token and a project), so the
   only upstream call is the model catalog, which carries the quotas. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nova-usage-test-"));
process.env.NOVA_BRIDGE_KEY = "test-bridge-key";
process.env.NOVA_BRIDGE_HOME = TMP;
process.env.NOVA_BRIDGE_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.NOVA_BRIDGE_AUTH_FILE, JSON.stringify({
  antigravity: { access_token: "t", refresh_token: "r", expires_at: Date.now() + 3600000, project: "p", source: "manual" },
  claude: { source: "claude-code" },
}));
const { server } = await import("../bridge/bridge.mjs");

const realFetch = globalThis.fetch;
const hours = (h) => new Date(Date.now() + h * 3600000).toISOString();
let catalog;

describe("Usage limits on /v1/usage", () => {
  let base;
  beforeAll(async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const usage = (query = "") => {
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).startsWith(base)) return realFetch(url, init);
      if (String(url).endsWith("v1internal:fetchAvailableModels")) return new Response(JSON.stringify({ models: catalog }));
      throw new TypeError(`unexpected upstream ${url}`);
    }));
    return fetch(`${base}/v1/usage${query}`, { headers: { Authorization: "Bearer test-bridge-key" } }).finally(() => vi.unstubAllGlobals());
  };

  it("needs the key", async () => {
    expect((await realFetch(`${base}/v1/usage`)).status).toBe(401);
  });

  it("shows Antigravity's 5-hour and weekly allowances, and says Claude reports nothing", async () => {
    catalog = {
      "gemini-3-flash": { displayName: "Gemini 3 Flash", quotaInfo: { remainingFraction: 0.6, resetTime: hours(2) } },
      "gemini-4-argon-medium": { displayName: "Gemini 4 Argon", quotaInfo: { resetTime: hours(90) } },
      "gemini-embed": { quotaInfo: { remainingFraction: 1, resetTime: hours(1) } },
    };
    const d = await (await usage()).json();
    expect(d.providers.antigravity).toMatchObject({ kind: "quota" });
    expect(d.providers.antigravity.windows.map((w) => [w.id, w.remaining])).toEqual([["5h", 0.6], ["weekly", 0]]);
    expect(d.providers.antigravity.models.map((m) => m.id)).toEqual(["gemini-3-flash", "gemini-4-argon-medium"]);
    expect(d.providers.antigravity.raw).toBeUndefined();
    expect(d.providers.claude).toEqual({ connected: true, kind: "none" });
    expect(d.providers["gemini-web"]).toBeUndefined();
  });

  it("can show the quota fields as Google sent them, to check the names", async () => {
    const d = await (await usage("?raw=1")).json();
    expect(d.providers.antigravity.raw.find((m) => m.id === "gemini-3-flash")).toEqual({ id: "gemini-3-flash", quotaInfo: catalog["gemini-3-flash"].quotaInfo });
  });
});
