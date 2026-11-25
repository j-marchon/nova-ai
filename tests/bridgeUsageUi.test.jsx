// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage.jsx";
import { findBridgeOnce } from "../src/lib/bridgeFind.js";
import { timeLeft } from "../src/lib/timeLeft.js";

vi.mock("../src/lib/api.js", async (importOriginal) => ({
  ...await importOriginal(), fetchProviderModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/lib/bridgeFind.js", async (importOriginal) => ({
  ...await importOriginal(), findBridgeOnce: vi.fn().mockResolvedValue(null),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-11-18T10:40:00.000Z");
const base = "http://localhost:5005/v1";
const key = "k".repeat(64);
const bridge = { id: "b1", preset: "nova-bridge", name: "Nova Bridge", base, pairedBase: base, key, protocol: "openai", model: "gemini-3-flash" };
const data = (providers = [bridge]) => ({
  settings: { providers, activeProvider: providers[0]?.id },
  appearance: {}, ledger: { tokensIn: 1200, tokensOut: 3400 }, username: "",
});

const USAGE = {
  object: "usage",
  providers: {
    antigravity: {
      connected: true, kind: "quota",
      windows: [
        { id: "5h", label: "5-hour", remaining: 0.6, resetsAt: "2026-11-18T14:00:00.000Z", models: 2 },
        { id: "weekly", label: "Weekly", remaining: 0, resetsAt: "2026-11-21T12:40:00.000Z", models: 1 },
      ],
      models: [
        { id: "gemini-3-flash", name: "Gemini 3 Flash", remaining: 0.6, resetsAt: "2026-11-18T14:00:00.000Z", window: "5h" },
        { id: "claude-sonnet", name: "Claude Sonnet", remaining: 0, resetsAt: "2026-11-21T12:40:00.000Z", window: "weekly" },
      ],
    },
    "gemini-web": {
      connected: true, kind: "counted", day: "2026-11-18", resetsAt: "2026-11-18T17:45:00.000Z",
      requests: 12, tokensIn: 3400, tokensOut: 5200, byModel: { default: 7, "gemini-4-argon": 5 }, limitHitAt: "2026-11-18T09:12:00.000Z",
    },
    claude: { connected: true, kind: "none" },
    openai: { connected: true, kind: "none" },
  },
};

let root, host, fetchMock;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const button = (label) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const bars = () => [...host.querySelectorAll('[role="progressbar"]')];
const bar = (label) => bars().find((b) => b.getAttribute("aria-label") === label);
const openUsage = async (d = data()) => {
  await act(async () => root.render(<SettingsPage data={d} update={() => {}} />));
  await act(async () => button("Usage").click());
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  fetchMock = vi.fn(async () => json(USAGE));
  vi.stubGlobal("fetch", fetchMock);
  findBridgeOnce.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bridge limits in the Usage tab", () => {
  it("asks the saved Bridge with the device key and draws the Antigravity windows", async () => {
    await openUsage();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/usage`);
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);

    const five = bar("5-hour allowance left");
    expect(five.getAttribute("aria-valuenow")).toBe("60");
    expect(five.getAttribute("aria-valuemin")).toBe("0");
    expect(five.getAttribute("aria-valuemax")).toBe("100");
    expect(bar("Weekly allowance left").getAttribute("aria-valuenow")).toBe("0");
    expect(host.textContent).toContain("60% left");
    expect(host.textContent).toContain("0% left");
    expect(host.textContent).toContain("Resets in 3h 20m");
    expect(host.textContent).toContain("Resets in 3d 2h");
    /* the ledger card stays below */
    expect(host.textContent).toContain("1k tokens in");
    expect(host.textContent).not.toContain("does not report spend");
  });

  it("opens the per-model list", async () => {
    await openUsage();
    expect(host.textContent).not.toContain("Gemini 3 Flash");
    const toggle = button("Per model");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("Gemini 3 Flash");
    expect(bar("Gemini 3 Flash allowance left").getAttribute("aria-valuenow")).toBe("60");
    expect(bar("Claude Sonnet allowance left").getAttribute("aria-valuenow")).toBe("0");
  });

  it("shows the Gemini app counts and the lines for providers that report nothing", async () => {
    await openUsage();
    expect(host.textContent).toContain("12 prompts today");
    expect(host.textContent).toContain("~3k tokens in · ~5k out (estimated)");
    expect(host.textContent).toContain("gemini-4-argon");
    expect(host.textContent).toContain("Default");
    expect(host.textContent).toContain("Resets at midnight Pacific time (in 7h 5m)");
    expect(host.textContent).toContain("Limit reached at");
    expect(host.textContent).toContain("Claude does not report usage.");
    expect(host.textContent).toContain("ChatGPT does not report usage.");
  });

  it("says one prompt, and leaves out a limit hit on an earlier day", async () => {
    const gemini = { ...USAGE.providers["gemini-web"], requests: 1, limitHitAt: "2026-11-17T09:12:00.000Z" };
    fetchMock.mockImplementation(async () => json({ providers: { "gemini-web": gemini } }));
    await openUsage();
    expect(host.textContent).toContain("1 prompt today");
    expect(host.textContent).not.toContain("Limit reached");
  });

  it("says when Google reported no quota, and shows its error plainly", async () => {
    fetchMock.mockImplementation(async () => json({ providers: { antigravity: { connected: true, kind: "quota", windows: [], models: [], error: "Google did not answer." } } }));
    await openUsage();
    expect(host.textContent).toContain("Google did not report a quota for this account.");
    expect(host.textContent).toContain("Google did not answer.");
    expect(bars()).toHaveLength(0);
  });

  it("points to the Providers tab when nothing is connected", async () => {
    fetchMock.mockImplementation(async () => json({ object: "usage", providers: {} }));
    await openUsage();
    expect(host.textContent).toContain("Connect a subscription in Settings → Nova Bridge.");
  });

  it("shows a rejected device and recovers on Refresh", async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: { message: "Unauthorized" } }, 401));
    await openUsage();
    expect(host.querySelector('[role="alert"]').textContent).toContain("did not accept this device");
    await act(async () => button("Refresh").click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("12 prompts today");
  });

  it("says the Bridge cannot be found when it is unreachable", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
    await openUsage();
    expect(findBridgeOnce).toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toContain("Could not find Nova Bridge");
  });

  it("refreshes every minute while open and stops after leaving the tab", async () => {
    await openUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => button("You").click());
    await act(async () => vi.advanceTimersByTimeAsync(180000));
    /* the You tab asks the Bridge about sync; only /usage calls count here */
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/usage"))).toHaveLength(2);
  });

  it("does not show Bridge limits for other providers", async () => {
    await openUsage(data([{ id: "o", preset: "openai", name: "OpenAI", key: "sk-x", protocol: "openai" }]));
    expect(host.textContent).not.toContain("Bridge limits");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("timeLeft", () => {
  const now = Date.parse("2026-11-18T10:00:00Z");
  const at = (ms) => new Date(now + ms).toISOString();
  it("reads short, rounding minutes up", () => {
    expect(timeLeft(at(30e3), now)).toBe("1m");
    expect(timeLeft(at(45 * 60e3), now)).toBe("45m");
    expect(timeLeft(at(60 * 60e3), now)).toBe("1h");
    expect(timeLeft(at(200 * 60e3), now)).toBe("3h 20m");
    expect(timeLeft(at(48 * 3600e3), now)).toBe("2d");
    expect(timeLeft(at(52 * 3600e3), now)).toBe("2d 4h");
  });
  it("is empty for past, missing or unreadable times", () => {
    expect(timeLeft(at(-1000), now)).toBe("");
    expect(timeLeft(null, now)).toBe("");
    expect(timeLeft("", now)).toBe("");
    expect(timeLeft("soon", now)).toBe("");
  });
});
