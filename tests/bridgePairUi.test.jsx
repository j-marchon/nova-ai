// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProvidersPanel } from "../src/components/ProvidersPanel.jsx";
import { findBridgeOnce, probe } from "../src/lib/bridgeFind.js";

vi.mock("../src/lib/bridgeFind.js", async (original) => ({
  ...await original(), findBridgeOnce: vi.fn(), probe: vi.fn(),
}));
vi.mock("../src/lib/api.js", () => ({ fetchProviderModels: vi.fn().mockResolvedValue([]) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = "https://bridge.example/v1";
const locked = { ok: true, locked: true };
let root, host, saved, approved, terminal, fetchMock, changeSettings;
const button = (label) => [...host.querySelectorAll("button")].find((b) => b.textContent === label);
const response = (data) => ({ ok: true, json: async () => data });
function Harness({ initial }) {
  const [settings, setSettings] = useState(initial);
  changeSettings = setSettings;
  saved = settings;
  return <ProvidersPanel settings={settings} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} />;
}
const mount = async (providers = []) => {
  await act(async () => root.render(<Harness initial={{ providers, bridgeCardOpen: true }} />));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  findBridgeOnce.mockReset().mockResolvedValue({ base, health: locked });
  probe.mockReset().mockResolvedValue(locked);
  approved = false;
  terminal = "approved";
  fetchMock = vi.fn(async (url, options) => {
    if (url.endsWith("/pair/request")) return response({ id: "request-1", code: "123456", status: "pending", expiresAt: Date.now() + 300000 });
    if (url.endsWith("/pair/status")) { approved = terminal === "approved"; return response({ status: terminal, code: "123456" }); }
    if (url.endsWith("/health")) return response(approved && options.headers.Authorization ? { ok: true, locked: true, management: false, providers: { claude: { connected: true } } } : locked);
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("saves a device key before requesting access, polls the comparison code and uses desktop approval", async () => {
  await mount();
  await act(async () => button("Request access").click());
  const entry = saved.providers[0];
  expect(entry.key).toMatch(/^[a-f0-9]{64}$/);
  expect(entry.pairedBase).toBe(base);
  expect(saved.activeProvider).toBe(entry.id);
  const request = fetchMock.mock.calls.find(([url]) => url.endsWith("/pair/request"));
  expect(JSON.parse(request[1].body)).toEqual({ token: entry.key, name: "Nova browser" });
  expect(request[1].headers.Authorization).toBeUndefined();
  expect(host.textContent).toContain("123456");
  expect(host.textContent).toContain("Only approve a matching code");
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  const poll = fetchMock.mock.calls.find(([url]) => url.endsWith("/pair/status"));
  expect(JSON.parse(poll[1].body)).toEqual({ id: "request-1", token: entry.key });
  expect(saved.providers[0].key).toBe(entry.key);
  expect(host.textContent).toContain("Manage subscription connections in the Nova Bridge window");
  expect(button("Connect")).toBeUndefined();
  expect(button("Disconnect")).toBeUndefined();
});

it.each(["expired", "rejected"])("resumes a saved request, reports %s and generates a new key on retry", async (status) => {
  terminal = status;
  const token = "a".repeat(64);
  await mount([{ id: "bridge", preset: "nova-bridge", name: "Bridge", base, pairedBase: base, key: token }]);
  expect(findBridgeOnce).not.toHaveBeenCalled();
  expect(probe).toHaveBeenCalledWith(base);
  expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith("/pair/request"))[1].body).token).toBe(token);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(host.textContent).toContain(status === "expired" ? "This request expired" : "Access was rejected or revoked");
  await act(async () => button("Request access again").click());
  expect(saved.providers[0].key).not.toBe(token);
});

it("requires a fresh pairing after editing the base and never sends the old device key to the new host", async () => {
  const token = "a".repeat(64);
  const moved = "https://other-bridge.example/v1";
  await mount([{ id: "bridge", preset: "nova-bridge", name: "Bridge", base, pairedBase: base, key: token }]);
  fetchMock.mockClear();
  await act(async () => changeSettings((settings) => ({ ...settings, providers: settings.providers.map((p) => ({ ...p, base: moved })) })));
  const calls = fetchMock.mock.calls.filter(([url]) => url.startsWith("https://other-bridge.example/"));
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(([url, options]) => url.endsWith("/health") && !options.headers.Authorization)).toBe(true);
  expect(button("Request access").disabled).toBe(false);
  await act(async () => button("Request access").click());
  expect(saved.providers[0].key).not.toBe(token);
  expect(saved.providers[0].pairedBase).toBe(moved);
  const request = fetchMock.mock.calls.find(([url]) => url === "https://other-bridge.example/pair/request");
  expect(JSON.parse(request[1].body).token).toBe(saved.providers[0].key);
});

it("stops polling while closed or hidden and resumes its saved request when reopened", async () => {
  await mount();
  await act(async () => button("Request access").click());
  const token = saved.providers[0].key;
  const cardToggle = host.querySelector("button[aria-expanded]");
  await act(async () => cardToggle.click());
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/pair/status"))).toHaveLength(0);
  await act(async () => cardToggle.click());
  const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith("/pair/request"));
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1][1].body).token).toBe(token);
  await act(async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/pair/status"))).toHaveLength(0);
});
