import { afterEach, describe, expect, it, vi } from "vitest";
import { completeJson, completeText, streamChat } from "../src/lib/api.js";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { emptyData } from "../src/lib/data.js";
import { newProvider } from "../src/lib/providers.js";

const settingsFor = (preset = "groq", extra = {}) => {
  const provider = newProvider(preset, { ...(preset === "custom" ? { base: "http://localhost:1234/v1" } : {}), key: "test-key", model: preset === "anthropic" ? "claude-sonnet-4-6" : "chat-model" });
  return { ...structuredClone(emptyData.settings), providers: [provider], activeProvider: provider.id, ...extra };
};
const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const requests = [
  ["streamChat", (opts) => streamChat({ messages: [{ role: "user", content: "Hello" }], ...opts })],
  ["completeText", (opts) => completeText({ system: "System", user: "Hello", stream: true, ...opts })],
  ["completeJson", (opts) => completeJson({ system: "Return JSON", user: "Hello", ...opts })],
];

function streamResponse() {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    init.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    return new Response(body, { status: 200 });
  }));
  return {
    push: (delta) => controller.enqueue(new TextEncoder().encode(frame(delta))),
    close: () => controller.close(),
  };
}

afterEach(() => {
  clearActivity();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(requests)("%s activity", (_name, request) => {
  it("creates and finishes one default job without retaining the response", async () => {
    const stream = streamResponse();
    const done = request({ settings: settingsFor() });
    expect(activity.get()).toHaveLength(1);
    expect(activity.get()[0]).toMatchObject({ kind: "Model request", status: "running" });
    stream.push({ content: '{"ok":true}' });
    stream.close();
    await done;
    expect(activity.get()).toHaveLength(1);
    expect(activity.get()[0]).toMatchObject({ status: "done", percent: 100, result: undefined });
  });

  it("owns metadata jobs and preserves their owner", async () => {
    const stream = streamResponse();
    const done = request({ settings: settingsFor(), activity: { kind: "Draft", label: "New card", owner: { cardKind: "character" } } });
    stream.push({ content: '{"ok":true}' });
    stream.close();
    await done;
    expect(activity.get()).toHaveLength(1);
    expect(activity.get()[0]).toMatchObject({ kind: "Draft", label: "New card", owner: { cardKind: "character" }, status: "done" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("activity");
    expect(body).not.toHaveProperty("expectedTokens");
  });

  it("reports Thinking then Writing and caps progress before caller-owned completion", async () => {
    const stream = streamResponse();
    const handle = startActivity({ kind: "Outer job" });
    const phases = vi.spyOn(handle, "phase");
    const progress = vi.spyOn(handle, "progress");
    const onReasoning = vi.fn(), onToken = vi.fn(), onProgress = vi.fn();
    const done = request({ settings: settingsFor(), activity: handle, expectedTokens: 100, onReasoning, onToken, onProgress });
    stream.push({ reasoning_content: "Let me think" });
    await vi.waitFor(() => expect(activity.get()[0].phase).toBe("Thinking"));
    stream.push({ content: '{"text":"' + "x".repeat(26) }); // 35 chars / 3.5 / 100 = 10%.
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(10));
    stream.push({ content: "x".repeat(2000) + '"}' });
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(95));
    expect(activity.get()[0].status).toBe("running");
    stream.close();
    await done;
    expect(phases.mock.calls.map(([phase]) => phase)).toEqual(["Thinking", "Writing"]);
    expect(onReasoning).toHaveBeenCalledWith("Let me think");
    expect([...onToken.mock.calls, ...onProgress.mock.calls].filter(([value]) => value).length).toBe(2);
    expect(progress.mock.calls.every(([percent]) => percent <= 95)).toBe(true);
    expect(activity.get()).toHaveLength(1);
    expect(activity.get()[0].status).toBe("running");
    handle.done();
    expect(activity.get()[0].percent).toBe(100);
  });

  it.each(["caller", "handle"])("merges cancellation from the %s signal", async (source) => {
    streamResponse();
    const handle = startActivity({ kind: "Outer job" });
    const caller = new AbortController();
    const done = request({ settings: settingsFor(), activity: handle, signal: caller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const sentSignal = fetch.mock.calls[0][1].signal;
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    if (source === "caller") caller.abort();
    else handle.cancel();
    await rejected;
    expect(sentSignal.aborted).toBe(true);
    expect(source === "caller" ? handle.signal.aborted : caller.signal.aborted).toBe(false);
  });

  it("does not send a request with a pre-aborted caller signal", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const caller = new AbortController();
    caller.abort();
    await expect(request({ settings: settingsFor(), signal: caller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(activity.get()).toEqual([]);
  });

  it("removes its automatic job when the caller cancels a running request", async () => {
    streamResponse();
    const caller = new AbortController();
    const done = request({ settings: settingsFor(), signal: caller.signal });
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    caller.abort();
    await rejected;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(activity.get()).toEqual([]);
  });

  it("fails an automatic job on provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 })));
    await expect(request({ settings: settingsFor() })).rejects.toThrow(/Groq/);
    expect(activity.get()[0]).toMatchObject({ status: "error", error: expect.stringContaining("Groq") });
  });
});

it("uses the sent max_tokens budget for default progress", async () => {
  const stream = streamResponse();
  const handle = startActivity();
  const progress = vi.spyOn(handle, "progress");
  const done = completeText({ settings: settingsFor(), system: "s", user: "u", stream: true, maxTokens: 100, activity: handle });
  stream.push({ content: "x".repeat(21) });
  stream.close();
  await done;
  expect(progress).toHaveBeenCalledWith(10); // 21 / 3.5 / (100 * 0.6).
});

it.each(["openrouter", "google", "groq", "custom", "anthropic"])("uses writerModel for %s without a chat model", async (preset) => {
  const settings = settingsFor(preset, { writerModel: "writer-model" });
  settings.providers[0].model = "";
  settings.providers[0].models = [];
  const content = '{"ok":true}';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    preset === "anthropic"
      ? `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: content } })}\n\n`
      : frame({ content }),
    { status: 200 },
  )));
  expect(await completeJson({ settings, system: "s", user: "u" })).toEqual({ ok: true });
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("writer-model");
});
