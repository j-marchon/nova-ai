import { afterEach, describe, expect, it, vi } from "vitest";
import { activeModel, completeText, endpointFor, fetchProviderModels, hasKey, sourceOf, streamChat } from "../src/lib/api.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { clearActivity, startActivity } from "../src/lib/activity.js";
import { BRIDGE_LOCAL, bridgeCandidates, bridgeUrl, isLoopbackBase, newProvider, presetForKey, presetForUrl, providersFromLegacy } from "../src/lib/providers.js";

const base = () => JSON.parse(JSON.stringify(emptyData.settings));
const withProvider = (p, extra = {}) => ({ ...base(), providers: [p], activeProvider: p.id, ...extra });

/* A fetch that records the request and answers with an SSE stream. */
function stubStream(frames) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
    return new Response(new Blob([text]).stream(), { status: 200 });
  }));
  return calls;
}

afterEach(() => { clearActivity(); vi.unstubAllGlobals(); });

describe("moving off the three fixed sources", () => {
  it("keeps an OpenRouter key, model and favourites", () => {
    const d = normalizeData({ settings: { apiKey: "sk-or-v1-abc", model: "x/y:free", favoriteModels: ["a/b"] } });
    expect(d.settings.providers).toHaveLength(2);
    expect(d.settings.providers[0]).toMatchObject({ id: "nova-bridge", name: "Nova Bridge" });
    expect(d.settings.providers[1]).toMatchObject({ id: "openrouter", key: "sk-or-v1-abc", model: "x/y:free", favorites: ["a/b"] });
    expect(d.settings.activeProvider).toBe("openrouter");
    expect(d.settings.apiKey).toBeUndefined();
    expect(d.settings.favoriteModels).toBeUndefined();
  });

  it("keeps Google in use, with its own key and model", () => {
    const { providers, activeProvider } = providersFromLegacy({ apiKey: "sk-or-v1-a", source: "google", googleKey: "AIzaX", googleModel: "gemma-3" });
    expect(activeProvider).toBe("google");
    expect(providers.find((p) => p.id === "google")).toMatchObject({ key: "AIzaX", model: "gemma-3" });
  });

  it("turns a server address into a local custom provider holding the shared key", () => {
    const s = providersFromLegacy({ apiKey: "koboldpass", baseUrl: "http://192.168.1.5:5001/v1" });
    const server = s.providers.find((p) => p.preset === "custom");
    expect(s.activeProvider).toBe(server.id);
    expect(server).toMatchObject({ base: "http://192.168.1.5:5001/v1", key: "koboldpass", local: true });
    /* the key was the server's, not OpenRouter's */
    expect(s.providers[0].key).toBe("");
    expect(sourceOf({ ...base(), ...s })).toBe("local");
    expect(activeModel({ ...base(), ...s })).toBe("local");
  });

  it("starts a fresh install on OpenRouter with no model picked and no key", () => {
    const s = base();
    expect(sourceOf(s)).toBe("openrouter");
    expect(activeModel(s)).toBe("");
    expect(hasKey(s)).toBe(false);
  });

  it("leaves already-migrated settings alone", () => {
    const g = newProvider("groq", { key: "gsk_1", model: "llama" });
    const d = normalizeData({ settings: { providers: [g], activeProvider: "groq" } });
    expect(d.settings.providers).toEqual([expect.objectContaining({ preset: "nova-bridge" }), expect.objectContaining({ id: "groq", key: "gsk_1", model: "llama" })]);
    expect(d.settings.activeProvider).toBe("groq");
  });

  it("always puts one Nova Bridge first, under its plain name", () => {
    const b = { ...newProvider("nova-bridge"), name: "Nova Bridge (Subscriptions)", key: "k" };
    const g = newProvider("groq");
    const d = normalizeData({ settings: { providers: [g, b], activeProvider: "groq" } });
    expect(d.settings.providers.map((p) => p.preset)).toEqual(["nova-bridge", "groq"]);
    expect(d.settings.providers[0]).toMatchObject({ name: "Nova Bridge", key: "k" });
  });
});

describe("recognising keys and addresses", () => {
  it("names the service a key belongs to, longest prefix first", () => {
    expect(presetForKey("sk-or-v1-123")?.id).toBe("openrouter");
    expect(presetForKey("sk-ant-api03-x")?.id).toBe("anthropic");
    expect(presetForKey("gsk_abc")?.id).toBe("groq");
    expect(presetForKey("nvapi-abc")?.id).toBe("nvidia");
    expect(presetForKey("sk-plain")).toBeNull();
  });

  it("names the service an address belongs to", () => {
    expect(presetForUrl("https://openrouter.ai/api/v1")?.id).toBe("openrouter");
    expect(presetForUrl("https://example.com/v1")).toBeNull();
  });
});

describe("requests to other services", () => {
  it("sends a listed service a plain OpenAI request with none of OpenRouter's fields", async () => {
    const calls = stubStream([{ choices: [{ delta: { content: "Hi" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
    const s = withProvider(newProvider("groq", { key: "gsk_1", model: "llama-3.3" }), { sessionId: "c1" });
    let out = "";
    await streamChat({ settings: s, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hey" }], onToken: (t) => { out += t; }, sessionId: "c1", activity: { kind: "Reply", owner: { chatId: "c1" } }, expectedTokens: 100 });
    expect(out).toBe("Hi");
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].init.headers.Authorization).toBe("Bearer gsk_1");
    expect(calls[0].body.model).toBe("llama-3.3");
    for (const k of ["provider", "session_id", "models", "reasoning", "min_p", "top_k", "activity", "expectedTokens"]) expect(calls[0].body[k]).toBeUndefined();
    expect(calls[0].init.headers["X-Title"]).toBeUndefined();
  });

  it("sends the thinking switch to every model on OpenRouter", async () => {
    for (const model of ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash", "xiaomi/mimo-v2.6", "meta-llama/llama-3.3-70b"]) {
      const calls = stubStream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
      await streamChat({ settings: withProvider(newProvider("openrouter", { key: "sk-or-1", model })), messages: [{ role: "user", content: "hi" }], onToken: () => {} });
      expect(calls[0].body.reasoning).toEqual({ enabled: false });
    }
  });

  it("remembers thinking per model", async () => {
    const { thinkingOn, withThinking } = await import("../src/lib/styles.js");
    const on = (model, extra) => withProvider(newProvider("openrouter", { key: "sk-or-1", model }), extra);
    const glm = withThinking(on("z-ai/glm-4.7-flash", { thinking: true }), false);
    expect(thinkingOn(glm)).toBe(false);
    /* another model keeps the old app-wide switch until it is flipped */
    expect(thinkingOn({ ...glm, providers: [{ ...glm.providers[0], model: "qwen/qwen3" }] })).toBe(true);
  });

  it("refuses to send without a model rather than letting the service guess", async () => {
    const s = withProvider(newProvider("groq", { key: "gsk_1" }));
    await expect(streamChat({ settings: s, messages: [{ role: "user", content: "x" }], onToken: () => {} })).rejects.toThrow(/No model picked for Groq/);
  });

  it("speaks Anthropic's format to Anthropic-compatible providers", async () => {
    const calls = stubStream([
      { type: "message_start", message: { model: "claude-haiku-5-5", usage: { input_tokens: 12 } } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
      { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const s = withProvider(newProvider("anthropic", { key: "sk-ant-1", model: "claude-haiku-5-5" }), { thinking: true });
    let out = "";
    let thought = "";
    const res = await streamChat({
      settings: s,
      /* a chat that opens on the character's greeting */
      messages: [{ role: "system", content: "You are Mira." }, { role: "assistant", content: "Hello." }, { role: "user", content: "Hi" }],
      onToken: (t) => { out += t; },
      onReasoning: (t) => { thought += t; },
      activity: startActivity({ kind: "Reply" }),
    });
    expect(out).toBe("Hello");
    expect(thought).toBe("hmm");
    expect(res).toMatchObject({ finishReason: "length", servedBy: "claude-haiku-5-5", tokensIn: 12, tokensOut: 5, sawThinking: true });

    const { url, init, body } = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-1");
    expect(init.headers["anthropic-version"]).toBeTruthy();
    expect(init.headers.Authorization).toBeUndefined();
    expect(body.system).toBe("You are Mira.");
    expect(body).not.toHaveProperty("activity");
    expect(body.messages[0].role).toBe("user");
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    /* the newest Claude models refuse sampling parameters */
    expect(body.temperature).toBeUndefined();
  });

  it("returns one-shot text from an Anthropic-compatible relay", async () => {
    const calls = stubStream([
      { type: "content_block_delta", delta: { type: "text_delta", text: "Notes." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
    ]);
    const relay = newProvider("custom", { name: "Relay", base: "https://relay.example.com/v1/", protocol: "anthropic", key: "r1", model: "some-model" });
    const res = await completeText({ settings: withProvider(relay), system: "s", user: "u", activity: { kind: "Notes" } });
    expect(res.text).toBe("Notes.");
    expect(calls[0].url).toBe("https://relay.example.com/v1/messages");
    expect(calls[0].init.headers.Authorization).toBe("Bearer r1");
    /* not a Claude id, so the sampler is sent as asked */
    expect(calls[0].body.temperature).toBe(0.3);
    expect(calls[0].body).not.toHaveProperty("activity");
  });

  it("names the service when it rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })));
    const s = withProvider(newProvider("xai", { key: "xai-1", model: "grok" }));
    await expect(streamChat({ settings: s, messages: [{ role: "user", content: "x" }], onToken: () => {} })).rejects.toThrow(/xAI rejected the key/);
  });
});

describe("model lists", () => {
  it("lists a custom server's models after the ids typed in by hand, without prices it did not report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m-a" }, { id: "text-embedding-3" }, { id: "typed" }] }), { status: 200 })));
    const p = newProvider("custom", { base: "https://x.example.com/v1", models: ["typed"] });
    const list = await fetchProviderModels(p, { fresh: true });
    expect(list.map((m) => m.id)).toEqual(["m-a", "typed"]);
    expect(list.every((m) => m.pricing === null)).toBe(true);
  });

  it("reads OpenRouter-shaped prices and free models wherever they appear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: "a", pricing: { prompt: "0.000001", completion: "0.000002" } },
      { id: "b", pricing: { prompt: "0", completion: "0" } },
      { id: "c", pricing: { prompt: "-1", completion: "-1" } },
    ] }), { status: 200 })));
    const list = await fetchProviderModels(newProvider("nanogpt", { key: "sk-nano-1" }), { fresh: true });
    expect(list.find((m) => m.id === "a").pricing).toEqual({ prompt: 0.000001, completion: 0.000002 });
    expect(list.find((m) => m.id === "b").free).toBe(true);
    expect(list.find((m) => m.id === "c").pricing).toBeNull();
  });

  it("reports an unreachable service by name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(fetchProviderModels(newProvider("cerebras", { key: "csk-1" }), { fresh: true })).rejects.toThrow(/Could not reach Cerebras/);
  });

  it("points each listed service at its own address", () => {
    const ep = endpointFor(withProvider(newProvider("nvidia", { key: "nvapi-1", model: "m" })));
    expect(ep.base).toBe("https://integrate.api.nvidia.com/v1");
    expect(ep.src).toBe("nvidia");
  });
});

describe("fine tuning per model", () => {
  const on = (model) => ({ ...withProvider(newProvider("openrouter", { key: "k", model })), stylePreset: "neutral" });

  it("keeps separate values for each model", async () => {
    const { styleTuning, withTuning } = await import("../src/lib/styles.js");
    const neutral = { id: "neutral", temperature: 0.95, maxTokens: 700 };
    let glm = on("z-ai/glm-4.6");
    glm = withTuning(glm, "neutral", { ...styleTuning(glm, neutral), on: true, temperature: 0.6 });
    const kimi = { ...glm, providers: [{ ...glm.providers[0], model: "moonshotai/kimi-k2" }] };
    expect(styleTuning(glm, neutral)).toMatchObject({ on: true, temperature: 0.6 });
    expect(styleTuning(kimi, neutral)).toMatchObject({ on: false, temperature: 0.95 });
  });

  it("moves the old single set under the model in use", () => {
    const s = on("z-ai/glm-4.6");
    const d = normalizeData({ settings: { ...s, styleTuning: { neutral: { on: true, temperature: 0.7 } } } });
    expect(d.settings.styleTuning).toBeUndefined();
    expect(d.settings.modelTuning["z-ai/glm-4.6"].neutral).toMatchObject({ on: true, temperature: 0.7 });
  });
});

describe("custom prompts", () => {
  it("preserves user-saved prompts even when their bundled original is removed", () => {
    const d = normalizeData({ settings: { ...base(), stylePreset: "custom", customStyleId: "evening-truth", customStyles: [{ id: "evening-truth", name: "Evening Truth", text: "old" }, { id: "imp-1", name: "Mine", text: "x" }] } });
    expect(d.settings.customStyles.map((x) => x.id)).toEqual(["evening-truth", "imp-1"]);
    expect(d.settings.customStyleId).toBe("evening-truth");
  });
});

describe("services that refuse web pages", () => {
  const nvidia = () => withProvider(newProvider("nvidia", { key: "nvapi-1", model: "nvidia/nemotron" }));

  it("sends NVIDIA through native HTTP in the app, and reads the buffered stream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const calls = [];
    const text = [{ choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }]
    .map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
    vi.stubGlobal("window", { Capacitor: {
    isNativePlatform: () => true,
    Plugins: { CapacitorHttp: { request: async (o) => { calls.push(o); return { status: 200, headers: {}, data: text }; } } },
    } });
    let out = "";
    const r = await streamChat({ settings: nvidia(), messages: [{ role: "user", content: "hi" }], onToken: (t) => { out += t; } });
    expect(out).toBe("Hello");
    expect(r.finishReason).toBe("stop");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({ url: "https://integrate.api.nvidia.com/v1/chat/completions", method: "POST", responseType: "text" });
    expect(calls[0].headers.Authorization).toBe("Bearer nvapi-1");
    expect(calls[0].data.model).toBe("nvidia/nemotron");
  });

  it("keeps other services on fetch in the app", async () => {
    const calls = stubStream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    const request = vi.fn();
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { request } } } });
    await streamChat({ settings: withProvider(newProvider("groq", { key: "gsk_1", model: "m" })), messages: [{ role: "user", content: "hi" }], onToken: () => {} });
    expect(calls).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("Nova Bridge addresses", () => {
  it("fills out a typed address", () => {
    expect(bridgeUrl("192.168.1.5")).toBe("http://192.168.1.5:5005/v1");
    expect(bridgeUrl("192.168.1.5:6000")).toBe("http://192.168.1.5:6000/v1");
    expect(bridgeUrl("http://pc.local:5005/v1/")).toBe("http://pc.local:5005/v1");
    expect(bridgeUrl("")).toBe("");
    expect(bridgeUrl("desktop-pc")).toBe("http://desktop-pc:5005/v1");
    expect(bridgeUrl("pc.tail1234.ts.net")).toBe("http://pc.tail1234.ts.net:5005/v1");
    /* a tunnel's own address keeps its port */
    expect(bridgeUrl("https://bridge.example.com")).toBe("https://bridge.example.com/v1");
  });

  it("tells this device from another", () => {
    expect(isLoopbackBase(BRIDGE_LOCAL)).toBe(true);
    expect(isLoopbackBase("http://192.168.1.5:5005/v1")).toBe(false);
  });

  it("tries the saved address first, the page's host on a phone, localhost last", () => {
    expect(bridgeCandidates({ saved: BRIDGE_LOCAL, pageHost: "192.168.1.5", lan: "192.168.1.5" }))
      .toEqual([BRIDGE_LOCAL, "http://192.168.1.5:5005/v1"]);
    expect(bridgeCandidates({ pageHost: "localhost" })).toEqual([BRIDGE_LOCAL]);
    expect(bridgeCandidates({ lan: "http://10.0.0.2:5005/v1" })).toEqual(["http://10.0.0.2:5005/v1", BRIDGE_LOCAL]);
  });
});
