import { afterEach, expect, it, vi } from "vitest";
import { providerFetch } from "../src/lib/providerTransport.js";
import { send } from "../src/lib/api.js";
import { resolveImageBackend } from "../src/lib/imageGen.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["http://remote.example", "http://127.0.0.1.example", "http://192.168.1.1.example", "https://name:pass@remote.example", "file:///path"])("rejects %s before transport", async address => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const request of [send, providerFetch]) await expect(request(address)).rejects.toThrow(/HTTPS/);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["http://localhost", "http://127.0.0.1", "http://192.168.1.1", "http://172.31.0.1", "http://10.0.0.1", "http://[::1]", "http://[fd00::1]", "http://studio.local", "https://remote.example"])("permits %s and refuses redirects", async address => {
  vi.stubGlobal("fetch", vi.fn());
  for (const request of [send, providerFetch]) {
    await request(address);
    expect(fetch).toHaveBeenLastCalledWith(address, { redirect: "error" });
  }
});

it("binds image generation to the approved Bridge", () => {
  const provider = { id: "host", preset: "nova-bridge", key: "fixture", pairedBase: "http://localhost:5005/v1", base: "https://elsewhere.example" };
  expect(resolveImageBackend({ providers: [provider] }, { provider: "saved:host" })).toBeNull();
});
