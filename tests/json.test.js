import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelJsonError, parseModelJson, repairJsonRequest } from "../src/lib/json.js";
import { completeJson } from "../src/lib/api.js";
import { newProvider } from "../src/lib/providers.js";

const obj = (t) => parseModelJson(t, { root: "object" });

describe("parseModelJson", () => {
  it("reads clean JSON untouched", () => {
    expect(obj('{"a":1}')).toEqual({ value: { a: 1 }, truncated: false, repaired: false });
  });
  it.each(["```hello", "```json\n{}\n```", "Use <think>quiet</think> here", "<thinking>literal", "<thought>x</thought>", 'say "hi" <think>x</think>']) (
    "preserves literal content: %s", (body) => {
      expect(obj(JSON.stringify({ body }))).toEqual({ value: { body }, truncated: false, repaired: false });
    },
  );
  it("keeps reasoning tags in a fenced JSON string", () => {
    expect(obj('```json\n{"body":"<think>quiet</think>"}\n```').value).toEqual({ body: "<think>quiet</think>" });
  });
  it.each(["", '{"body":"finished"},']) (
    "drops an unfinished record after its nested container (%s)", (prefix) => {
      const result = obj(`{"posts":[${prefix}{"body":"one","meta":{"a":1},"rest":"cut`);
      expect(result.value).toEqual({ posts: prefix ? [{ body: "finished" }] : [] });
      expect(result.truncated).toBe(true);
    },
  );
  it.each(['{"a":1', '{"a":1,"b":2', '{"a":true', '{"a":null', '{"a":"done"']) (
    "keeps a complete final object scalar: %s", (raw) => {
      expect(obj(raw)).toEqual({ value: JSON.parse(raw + "}"), truncated: true, repaired: true });
    },
  );
  it.each(['[1', '[1,2', '[true,false,null', '["done"']) (
    "keeps complete final array scalars: %s", (raw) => {
      expect(parseModelJson(raw, { root: "array" })).toEqual({ value: JSON.parse(raw + "]"), truncated: true, repaired: true });
    },
  );
  it("drops an incomplete final scalar", () => {
    expect(obj('{"a":1,"b":tru').value).toEqual({ a: 1 });
    expect(parseModelJson('[1,2e', { root: "array" }).value).toEqual([1]);
  });
  it("salvages a truncated object, keeping finished items", () => {
    const r = obj('{"posts":[{"b":"one"},{"b":"two"},{"b":"thr');
    expect(r.value).toEqual({ posts: [{ b: "one" }, { b: "two" }] });
    expect(r.truncated).toBe(true);
  });
  it("keeps finished scalar fields when cut mid-way", () => {
    expect(obj('{"a":1,"b":2,"c":').value).toEqual({ a: 1, b: 2 });
  });
  it("escapes a raw newline and tab inside a string", () => {
    const r = obj('{"body":"line one\nline two\tend"}');
    expect(r.value.body).toBe("line one\nline two\tend");
    expect(r.repaired).toBe(true);
  });
  it("strips a closed <think> preamble", () => {
    expect(obj('<think>maybe {"x":0} first</think>{"a":1}').value).toEqual({ a: 1 });
  });
  it("strips <thought> and <thinking> blocks too", () => {
    expect(obj('<thought>hm</thought>\n<thinking>ok</thinking>{"a":2}').value).toEqual({ a: 2 });
  });
  it("rejects an unclosed <think> with nothing after it", () => {
    expect(() => obj('<think>still reasoning {"a":1}')).toThrow(ModelJsonError);
    try { obj("<think>still reasoning"); } catch (e) { expect(e.reason).toBe("empty"); }
  });
  it("skips prose that contains { before the JSON", () => {
    expect(obj('Use {name} as a placeholder. Here: {"a":1}').value).toEqual({ a: 1 });
  });
  it("ignores prose containing } after the JSON", () => {
    expect(obj('{"a":{"b":"}"}} hope that helps :} {"c":1}').value).toEqual({ a: { b: "}" } });
  });
  it("tries each fenced block", () => {
    const t = 'Example:\n```text\nnot json\n```\nAnswer:\n```json\n{"a":3}\n```';
    expect(obj(t).value).toEqual({ a: 3 });
  });
  it("reads an unclosed fence", () => {
    expect(obj('```json\n{"a":4}').value).toEqual({ a: 4 });
  });
  it("treats curly quotes inside a string as content", () => {
    const r = obj('{"body":"she said “hi” and left"}');
    expect(r.value.body).toBe("she said “hi” and left");
    expect(r.repaired).toBe(false);
  });
  it("repairs curly quotes used as delimiters", () => {
    expect(obj("{“posts”: [“it's fine”]}").value).toEqual({ posts: ["it's fine"] });
  });
  it("removes trailing commas outside strings only", () => {
    expect(obj('{"a":[1,2,],"b":"x,]",}').value).toEqual({ a: [1, 2], b: "x,]" });
  });
  it("reads an array root", () => {
    expect(parseModelJson('Here: [{"a":1},{"a":2},]', { root: "array" }).value).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("salvages a truncated array root", () => {
    const r = parseModelJson('[{"a":1},{"a":2},{"a"', { root: "array" });
    expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
    expect(r.truncated).toBe(true);
  });
  it("rejects a non-object root", () => {
    expect(() => obj("[1,2]")).toThrow(SyntaxError);
    try { obj("[1,2]"); } catch (e) { expect(e.reason).toBe("not-object"); }
    expect(() => obj("42")).toThrow(ModelJsonError);
  });
  it("rejects an object when an array is wanted", () => {
    expect(() => parseModelJson('{"a":1}', { root: "array" })).toThrow(ModelJsonError);
  });
  it("throws ModelJsonError with raw and reason on garbage", () => {
    try { obj("no json here"); throw new Error("no throw"); } catch (e) {
      expect(e).toBeInstanceOf(ModelJsonError);
      expect(e.raw).toBe("no json here");
      expect(e.reason).toBe("no-json");
    }
    expect(() => obj("{ broken: ")).toThrow(ModelJsonError);
  });
});

describe("Card Studio <plan> blocks", () => {
  it("ignores a leading plan, even one with braces and quotes in it", () => {
    expect(obj('<plan>Brief wants {a keeper} and "Edda". Plan: name, description.</plan>\n{"name":"Edda"}').value).toEqual({ name: "Edda" });
    expect(obj('<PLAN>{ "decoy": 1 }</PLAN>{"name":"Edda"}').value).toEqual({ name: "Edda" });
  });
  it("resumes at the JSON after an unclosed plan", () => {
    expect(obj('<plan>1. name {x}\n2. description\n{"name":"Edda","description":"A keeper."}').value).toEqual({ name: "Edda", description: "A keeper." });
  });
  it("keeps a literal <plan> inside a JSON string", () => {
    expect(obj(JSON.stringify({ body: "<plan>x</plan>" })).value).toEqual({ body: "<plan>x</plan>" });
  });
  it("leaves the plan out of a repair request", () => {
    expect(repairJsonRequest('<plan>secret</plan>{"a":').user).not.toContain("secret");
  });
});

describe("completeJson detail budget", () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = async (preset, opts, extra = {}) => {
    const provider = newProvider(preset, { model: extra.model || "test/model", key: "test", ...(preset === "nova-bridge" || preset === "custom" ? { base: "http://localhost:1234/v1" } : {}) });
    const settings = { providers: [provider], activeProvider: provider.id, ...extra.settings };
    const content = '{"a":1}';
    const sse = preset === "anthropic"
      ? `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: content } })}\n\n`
      : `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    await completeJson({ settings, system: "s", user: "u", ...opts });
    return JSON.parse(fetch.mock.calls[0][1].body);
  };
  it("keeps the old budget and no effort without a detail level", async () => {
    const body = await run("openrouter", {});
    expect(body.max_tokens).toBe(16000 + 4000);
    expect(body.reasoning).toEqual({});
    expect(body.reasoning_effort).toBeUndefined();
  });
  it("sends budget and effort to OpenRouter", async () => {
    const body = await run("openrouter", { maxTokens: 3000, effort: "low" });
    expect(body.max_tokens).toBe(3000 + 2000);
    expect(body.reasoning).toEqual({ effort: "low" });
  });
  it("turns OpenRouter reasoning off when thinking is off, keeping only the budget", async () => {
    const body = await run("openrouter", { maxTokens: 9500, effort: "high" }, { settings: { writerThinking: false } });
    expect(body.max_tokens).toBe(9500);
    expect(body.reasoning).toEqual({ enabled: false });
  });
  it("sends reasoning_effort to the bridge and to OpenAI-format reasoning ids", async () => {
    expect((await run("nova-bridge", { maxTokens: 16000, effort: "high" })).reasoning_effort).toBe("high");
    expect((await run("custom", { maxTokens: 8000, effort: "medium" }, { model: "gpt-5-mini" })).reasoning_effort).toBe("medium");
    const plain = await run("custom", { maxTokens: 8000, effort: "medium" }, { model: "llama-3" });
    expect(plain.reasoning_effort).toBeUndefined();
    expect(plain.max_tokens).toBe(8000);
  });
  it("Gemini keeps its thinking flag and gets only the budget", async () => {
    const body = await run("google", { maxTokens: 8000, effort: "high" }, { model: "gemini-2.5-pro" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.extra_body).toBeTruthy();
    expect(body.max_tokens).toBe(8000 + 6000 + 6000);
  });
  it("Claude gets the budget, plus room for high effort when it thinks", async () => {
    expect((await run("anthropic", { maxTokens: 3000, effort: "low" }, { model: "claude-opus-4-1" })).max_tokens).toBe(3000);
    expect((await run("anthropic", { maxTokens: 16000, effort: "high" }, { model: "claude-sonnet-5" })).max_tokens).toBe(16000 + 2000 + 6000);
  });
});

describe("repairJsonRequest", () => {
  it("builds a one-shot correction message", () => {
    const m = repairJsonRequest('<think>x</think>{"a":');
    expect(m.system).toMatch(/corrected JSON only/);
    expect(m.user).toContain('{"a":');
    expect(m.user).not.toContain("think");
  });
});

describe("completeJson finish reason", () => {
  afterEach(() => vi.unstubAllGlobals());
  const settings = { providers: [{ id: "p", preset: "openrouter", model: "test/model", key: "test" }], activeProvider: "p" };
  function reply(text, finishReason, error = null) {
    const frames = [
      { choices: [{ delta: { content: text } }] },
      { choices: [{ delta: {}, finish_reason: finishReason }] },
      ...(error ? [{ error }] : []),
      { usage: { completion_tokens: 5 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )));
    return completeJson({ settings, system: "Return JSON", user: "Write a card" });
  }
  it("returns a successful streamed object", async () => {
    const value = await reply('{"a":1}', "stop");
    expect(value).toEqual({ a: 1 });
    expect(value.truncated).toBe(false);
  });
  it("preserves length after a later usage frame", async () => {
    const value = await reply('{"a":1}', "length");
    expect(value.truncated).toBe(true);
    expect(Object.keys(value)).toEqual(["a"]);
  });
  it("salvages JSON cut off by the length limit", async () => {
    const value = await reply('{"a":1', "length");
    expect(value).toEqual({ a: 1 });
    expect(value.truncated).toBe(true);
  });
  it.each(["length", "stop"])("attaches truncation to a parse error (%s)", async (reason) => {
    await expect(reply("not JSON", reason)).rejects.toMatchObject({ name: "ModelJsonError", raw: "not JSON", truncated: reason === "length" });
  });
  it("keeps provider stream errors", async () => {
    await expect(reply('{"a":1}', "stop", { message: "provider unavailable", code: 503 })).rejects.toThrow("No provider could serve this model right now.");
  });
});
