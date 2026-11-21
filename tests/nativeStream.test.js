import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "../src/lib/api.js";
import { emptyData } from "../src/lib/data.js";
import { newProvider } from "../src/lib/providers.js";
import { clearActivity, startActivity } from "../src/lib/activity.js";

const nvidia = () => {
  const p = newProvider("nvidia", { key: "nvapi-1", model: "nvidia/nemotron" });
  return { ...JSON.parse(JSON.stringify(emptyData.settings)), providers: [p], activeProvider: p.id };
};
const frame = (content, finish_reason) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;
const tick = () => new Promise((r) => setTimeout(r, 0));

/* A stand-in for NovaHttpPlugin: records calls and lets the test push the
   reply's lines whenever it likes, the way the native side does. */
function fakeNovaHttp() {
  const listeners = { chunk: new Set(), end: new Set(), error: new Set() };
  const plugin = {
    calls: [],
    cancel: vi.fn(async () => {}),
    addListener: vi.fn(async (name, fn) => {
      listeners[name].add(fn);
      return { remove: async () => listeners[name].delete(fn) };
    }),
    stream: vi.fn(async (opts) => {
      plugin.calls.push(opts);
      return { status: 200, headers: { "content-type": "text/event-stream" } };
    }),
    emit(name, data) {
      for (const fn of [...listeners[name]]) fn({ id: plugin.calls.at(-1).id, ...data });
    },
    listening: () => listeners.chunk.size + listeners.end.size + listeners.error.size,
  };
  return plugin;
}

function useNative(plugin) {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { NovaHttp: plugin, CapacitorHttp: { request: vi.fn() } } } });
  return fetchSpy;
}

afterEach(() => { clearActivity(); vi.unstubAllGlobals(); });

describe("streaming from services that refuse web pages", () => {
  it("delivers tokens as the native side sends them", async () => {
    const plugin = fakeNovaHttp();
    const fetchSpy = useNative(plugin);
    const tokens = [];
    const activity = startActivity({ kind: "Native reply", owner: { chatId: "c1" } });
    const done = streamChat({ settings: nvidia(), messages: [{ role: "user", content: "hi" }], onToken: (t) => tokens.push(t), activity, expectedTokens: 100 });

    await vi.waitFor(() => expect(plugin.calls).toHaveLength(1));
    const req = plugin.calls[0];
    expect(req).toMatchObject({ url: "https://integrate.api.nvidia.com/v1/chat/completions", method: "POST" });
    expect(req.headers.authorization).toBe("Bearer nvapi-1");
    expect(JSON.parse(req.body).model).toBe("nvidia/nemotron");
    expect(JSON.parse(req.body)).not.toHaveProperty("activity");
    expect(JSON.parse(req.body)).not.toHaveProperty("expectedTokens");

    plugin.emit("chunk", { text: frame("Hel") });
    await vi.waitFor(() => expect(tokens.join("")).toBe("Hel"));
    /* a frame split across two chunks still reads as one */
    const second = frame("lo", "stop");
    plugin.emit("chunk", { text: second.slice(0, 12) });
    plugin.emit("chunk", { text: second.slice(12) + "data: [DONE]\n\n" });
    plugin.emit("end", {});

    const r = await done;
    expect(tokens.join("")).toBe("Hello");
    expect(r.finishReason).toBe("stop");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.Capacitor.Plugins.CapacitorHttp.request).not.toHaveBeenCalled();
    expect(plugin.listening()).toBe(0);
  });

  it("cancels the native request when the reply is stopped", async () => {
    const plugin = fakeNovaHttp();
    useNative(plugin);
    const activity = startActivity({ kind: "Native reply" });
    const ctrl = new AbortController();
    const tokens = [];
    const done = streamChat({ settings: nvidia(), messages: [{ role: "user", content: "hi" }], onToken: (t) => tokens.push(t), signal: ctrl.signal, activity });

    await vi.waitFor(() => expect(plugin.calls).toHaveLength(1));
    plugin.emit("chunk", { text: frame("Once") });
    await vi.waitFor(() => expect(tokens).toEqual(["Once"]));
    activity.cancel();

    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(plugin.cancel).toHaveBeenCalledWith({ id: plugin.calls[0].id });
    /* anything the native side still sends is ignored */
    plugin.emit("chunk", { text: frame(" upon") });
    await tick();
    expect(tokens).toEqual(["Once"]);
  });

  it("cancels a request stopped before the headers arrive", async () => {
    const plugin = fakeNovaHttp();
    plugin.stream = vi.fn((opts) => { plugin.calls.push(opts); return new Promise(() => {}); });
    useNative(plugin);
    const ctrl = new AbortController();
    const done = streamChat({ settings: nvidia(), messages: [{ role: "user", content: "hi" }], onToken: () => {}, signal: ctrl.signal });

    await vi.waitFor(() => expect(plugin.calls).toHaveLength(1));
    ctrl.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(plugin.cancel).toHaveBeenCalledWith({ id: plugin.calls[0].id });
  });

  it("reads an error reply's body", async () => {
    const plugin = fakeNovaHttp();
    plugin.stream = vi.fn(async (opts) => {
      plugin.calls.push(opts);
      setTimeout(() => {
        plugin.emit("chunk", { text: JSON.stringify({ error: { message: "bad key" } }) });
        plugin.emit("end", {});
      }, 0);
      return { status: 401, headers: {} };
    });
    useNative(plugin);
    await expect(streamChat({ settings: nvidia(), messages: [{ role: "user", content: "hi" }], onToken: () => {} }))
      .rejects.toThrow();
  });
});
