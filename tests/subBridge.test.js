import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_PROVIDERS,
  estimateTokens,
  extractChatGptAccountId,
  geminiWebError,
  jwtExpiry,
  nextPacificMidnight,
  pacificDay,
  parseCodexSseLine,
  parseGeminiWebStream,
  parseGoogleCodeAssistSseLine,
  parseOpenAISseLine,
  resolveSubscriptionModel,
  servedModelMatches,
  summarizeQuota,
  toCodexResponsesPayload,
  toClaudeCodePrompt,
  toGeminiWebPrompt,
  toGoogleCodeAssistPayload,
} from "../src/lib/subBridge.js";

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const chat = [
  { role: "system", content: "You are Mira, a sharp-tongued ship's engineer." },
  { role: "system", content: "Never write the user's actions." },
  { role: "assistant", content: "*The hatch hisses open.*" },
  { role: "user", content: "Hello" },
  { role: "user", content: [{ type: "text", text: "Anyone here?" }] },
];

describe("Subscription Gateway (subBridge)", () => {
  it("offers Claude where GitHub Copilot was, and the Gemini app, but not the discontinued Gemini CLI sign-in", () => {
    expect(SUBSCRIPTION_PROVIDERS.map((p) => p.id)).toEqual(["antigravity", "claude", "openai", "gemini-web"]);
    /* Claude connects in the Bridge window only, behind its warning */
    expect(SUBSCRIPTION_PROVIDERS.find((p) => p.id === "claude").auth).toBe("bridge");
  });

  describe("resolveSubscriptionModel", () => {
    it("routes prefixed OpenRouter-style model IDs to their upstream", () => {
      expect(resolveSubscriptionModel("antigravity/claude-sonnet-4-5")).toEqual({ provider: "antigravity", upstreamModel: "claude-sonnet-4-5" });
      expect(resolveSubscriptionModel("claude/sonnet")).toEqual({ provider: "claude", upstreamModel: "sonnet" });
      expect(resolveSubscriptionModel("openai/gpt-5")).toEqual({ provider: "openai", upstreamModel: "gpt-5" });
    });

    it("routes model ids saved under the old Gemini CLI prefixes like bare ids", () => {
      expect(resolveSubscriptionModel("gemini/gemini-2.5-pro")).toEqual({ provider: "antigravity", upstreamModel: "gemini-2.5-pro" });
      expect(resolveSubscriptionModel("google/gemini-2.5-pro", ["gemini-web"])).toEqual({ provider: "gemini-web", upstreamModel: "gemini-2.5-pro" });
    });

    it("routes a model saved under GitHub Copilot, now gone, to whatever serves it", () => {
      expect(resolveSubscriptionModel("copilot/claude-sonnet-4.5", ["claude"])).toEqual({ provider: "claude", upstreamModel: "sonnet" });
      expect(resolveSubscriptionModel("copilot/claude-sonnet-4.5", ["antigravity"])).toEqual({ provider: "antigravity", upstreamModel: "claude-sonnet-4.5" });
      expect(resolveSubscriptionModel("copilot/gpt-4.1", ["openai"])).toEqual({ provider: "openai", upstreamModel: "gpt-4.1" });
    });

    it("sends Gemini 4 Argon to Antigravity by thinking tier", () => {
      expect(resolveSubscriptionModel("antigravity/gemini-4-argon-high")).toEqual({ provider: "antigravity", upstreamModel: "gemini-4-argon-high" });
      expect(resolveSubscriptionModel("antigravity/gemini-4-argon")).toEqual({ provider: "antigravity", upstreamModel: "gemini-4-argon-medium" });
      expect(resolveSubscriptionModel("gemini-4-argon", ["claude"])).toEqual({ provider: "antigravity", upstreamModel: "gemini-4-argon-medium" });
      expect(resolveSubscriptionModel("google/gemini-4-argon-low", ["claude", "antigravity"])).toEqual({ provider: "antigravity", upstreamModel: "gemini-4-argon-low" });
    });

    it("sends Argon to the Gemini app when it is connected (Antigravity refuses trial accounts)", () => {
      expect(resolveSubscriptionModel("gemini-web/gemini-4-argon")).toEqual({ provider: "gemini-web", upstreamModel: "gemini-4-argon" });
      expect(resolveSubscriptionModel("gemini-4-argon", ["antigravity", "gemini-web"])).toEqual({ provider: "gemini-web", upstreamModel: "gemini-4-argon" });
      expect(resolveSubscriptionModel("google/gemini-4-argon-low", ["antigravity", "gemini-web"]).provider).toBe("gemini-web");
      /* an explicit prefix still means what it says */
      expect(resolveSubscriptionModel("antigravity/gemini-4-argon", ["antigravity", "gemini-web"])).toEqual({ provider: "antigravity", upstreamModel: "gemini-4-argon-medium" });
    });

    it("uses the Gemini app for other Gemini models only as a fallback", () => {
      expect(resolveSubscriptionModel("gemini-3-flash", ["gemini-web"]).provider).toBe("gemini-web");
      expect(resolveSubscriptionModel("gemini-3-flash", ["gemini-web", "antigravity"]).provider).toBe("antigravity");
      expect(resolveSubscriptionModel("gemini-3-flash", ["gemini-web", "claude"]).provider).toBe("gemini-web");
    });

    it("sends bare ids to a connected provider that serves them", () => {
      expect(resolveSubscriptionModel("gemini-2.5-flash", ["claude", "antigravity"]).provider).toBe("antigravity");
      expect(resolveSubscriptionModel("gpt-5", ["claude", "openai"]).provider).toBe("openai");
      expect(resolveSubscriptionModel("claude-sonnet-4.5", ["antigravity"]).provider).toBe("antigravity");
      expect(resolveSubscriptionModel("claude-sonnet-4.5", ["antigravity", "claude"])).toEqual({ provider: "claude", upstreamModel: "sonnet" });
      expect(resolveSubscriptionModel("claude-opus-4-5", ["claude"])).toEqual({ provider: "claude", upstreamModel: "claude-opus-4-5" });
      expect(resolveSubscriptionModel("", ["claude"]).provider).toBe("claude");
    });
  });

  describe("Code Assist (Gemini CLI & Antigravity)", () => {
    it("preserves explicit Gemini effort and leaves unspecified thinking at the model default", () => {
      for (const effort of ["low", "medium", "high"]) {
        expect(toGoogleCodeAssistPayload(chat, "gemini-3.8-flash", "p", { reasoning_effort: effort }).request.generationConfig.thinkingConfig.thinkingLevel).toBe(effort.toUpperCase());
      }
      expect(toGoogleCodeAssistPayload(chat, "gemini-3.8-flash").request.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
      expect(toGoogleCodeAssistPayload(chat, "gemini-3.8-flash", "p", { reasoning_effort: "low", extra_body: { google: { thinking_config: { thinking_level: "high", include_thoughts: false } } } }).request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "HIGH", includeThoughts: false });
    });
    it("passes the whole system prompt as systemInstruction and keeps the turns", () => {
      const p = toGoogleCodeAssistPayload(chat, "gemini-2.5-pro", "proj-1", { temperature: 1.1, top_p: 0.9, max_tokens: 800 });
      expect(p.project).toBe("proj-1");
      expect(p.model).toBe("gemini-2.5-pro");
      expect(p.request.systemInstruction.parts[0].text).toBe("You are Mira, a sharp-tongued ship's engineer.\n\nNever write the user's actions.");
      expect(p.request.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
      expect(p.request.contents[2].parts[0].text).toBe("Hello\n\nAnyone here?");
      expect(p.request.generationConfig).toMatchObject({ temperature: 1.1, topP: 0.9, maxOutputTokens: 800, thinkingConfig: { includeThoughts: true } });
    });

    it("asks only thinking models for their thoughts", () => {
      expect(toGoogleCodeAssistPayload(chat, "claude-sonnet-4-5").request.generationConfig.thinkingConfig).toBeUndefined();
      /* Argon refuses small thinking budgets, so none is set */
      expect(toGoogleCodeAssistPayload(chat, "gemini-4-argon-high").request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true });
    });

    it("parses thoughts, text, finish reasons and usage", () => {
      const line = `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text: "Hi" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 3, totalTokenCount: 10 } } })}`;
      expect(parseGoogleCodeAssistSseLine(line)).toEqual({
        content: "Hi",
        reasoning: "hmm",
        finishReason: "length",
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });
      const safety = `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [] }, finishReason: "PROHIBITED_CONTENT" }] } })}`;
      expect(parseGoogleCodeAssistSseLine(safety).finishReason).toBe("content_filter");
    });

    it("turns a blocked prompt into an error instead of an empty reply", () => {
      const line = `data: ${JSON.stringify({ response: { promptFeedback: { blockReason: "SAFETY" } } })}`;
      expect(parseGoogleCodeAssistSseLine(line)).toEqual({ error: "Google blocked the prompt (SAFETY)." });
      expect(parseGoogleCodeAssistSseLine(": keepalive")).toBeNull();
    });
  });

  describe("Claude (Claude Code)", () => {
    it("keeps the whole system prompt apart and lays the conversation out turn by turn", () => {
      const p = toClaudeCodePrompt(chat);
      expect(p.system).toBe("You are Mira, a sharp-tongued ship's engineer.\n\nNever write the user's actions.");
      expect(p.prompt).toContain("<assistant>\n*The hatch hisses open.*\n</assistant>");
      expect(p.prompt).toContain("<user>\nHello\n\nAnyone here?\n</user>");
      expect(p.prompt).not.toContain("sharp-tongued");
    });

    it("sends a lone first message as it is", () => {
      expect(toClaudeCodePrompt([{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }])).toEqual({ system: "Be brief.", prompt: "hi" });
    });

    it("parses OpenAI-style deltas, reasoning and errors", () => {
      expect(parseOpenAISseLine('data: {"choices":[{"delta":{"content":"Hi","reasoning_text":"why"},"finish_reason":"stop"}]}'))
        .toEqual({ content: "Hi", reasoning: "why", finishReason: "stop", usage: null });
      expect(parseOpenAISseLine('data: {"error":{"message":"nope"}}')).toEqual({ error: "nope" });
      expect(parseOpenAISseLine("data: [DONE]")).toBeNull();
    });
  });

  describe("ChatGPT Codex", () => {
    it("puts the system prompt in instructions, or first as a developer message", () => {
      const p = toCodexResponsesPayload(chat, "gpt-5");
      expect(p.instructions).toBe("You are Mira, a sharp-tongued ship's engineer.\n\nNever write the user's actions.");
      expect(p).toMatchObject({ store: false, stream: true, reasoning: { effort: "medium", summary: "auto" } });
      expect(p).not.toHaveProperty("max_output_tokens");
      expect(p.input.map((m) => m.role)).toEqual(["assistant", "user"]);
      expect(p.input[0].content[0].type).toBe("output_text");

      const d = toCodexResponsesPayload(chat, "gpt-5", { reasoning_effort: "low" }, { asDeveloper: true });
      expect(d.input[0]).toEqual({ type: "message", role: "developer", content: [{ type: "input_text", text: p.instructions }] });
      expect(d.reasoning.effort).toBe("low");
    });

    it("parses text, reasoning, cut-off replies and failures", () => {
      expect(parseCodexSseLine('data: {"type":"response.output_text.delta","delta":"Hi"}')).toEqual({ content: "Hi", reasoning: "", finishReason: null });
      expect(parseCodexSseLine('data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}').reasoning).toBe("plan");
      expect(parseCodexSseLine('data: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":6,"total_tokens":10}}}'))
        .toMatchObject({ finishReason: "stop", usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } });
      expect(parseCodexSseLine('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}').finishReason).toBe("length");
      expect(parseCodexSseLine('data: {"type":"response.failed","response":{"error":{"message":"usage limit"}}}')).toEqual({ error: "usage limit" });
    });

    it("reads the ChatGPT account id and token expiry from JWTs", () => {
      expect(extractChatGptAccountId({ id_token: jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-1" } }) })).toBe("acc-1");
      expect(jwtExpiry(jwt({ exp: 2000000000 }))).toBe(2000000000000);
      expect(jwtExpiry("not-a-jwt")).toBe(0);
    });
  });
  describe("Gemini app translators", () => {
    const frame = (inner) => JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
    const snap = (text, thoughts) => frame([null, ["c_9", "r_9"], null, null, [["rc_9", [text], ...Array(35).fill(null), ...(thoughts ? [[[thoughts]]] : [])]]]);
    const wire = (...frames) => `)]}'\n\n${frames.map((f) => `${f.length}\n${f}\n`).join("")}`;

    it("frames the system prompt and the turns as text, since the web app has no system field", () => {
      const p = toGeminiWebPrompt(chat);
      expect(p).toContain("<instructions>\nYou are Mira, a sharp-tongued ship's engineer.\n\nNever write the user's actions.\n</instructions>");
      expect(p).toContain("<assistant>\n*The hatch hisses open.*\n</assistant>");
      expect(p).toContain("<user>\nHello\n\nAnyone here?\n</user>");
      expect(p.trim().endsWith("Now write the next <assistant> message.")).toBe(true);
    });

    it("notes pictures as placeholders", () => {
      expect(toGeminiWebPrompt([{ role: "user", content: "look", images: ["data:image/png;base64,AA"] }])).toContain("look\n[Attached image 1]");
    });

    it("keeps the latest snapshot's text, thoughts and ids", () => {
      const r = parseGeminiWebStream(wire(snap("He"), snap("Hello", "thinking…"), snap("Hello there", "thinking…")));
      expect(r).toMatchObject({ text: "Hello there", thoughts: "thinking…", cid: "c_9", rid: "r_9", rcid: "rc_9", errorCode: 0 });
    });

    it("ignores a line still arriving and finds an error code", () => {
      expect(parseGeminiWebStream(`)]}'\n\n10\n[["wrb.fr",nu`).text).toBe("");
      const err = parseGeminiWebStream(wire(JSON.stringify([["wrb.fr", null, null, null, null, [3, null, [[1037]]]]])));
      expect(err).toMatchObject({ text: "", errorCode: 1037 });
    });

    it("maps error codes to statuses", () => {
      expect(geminiWebError(1037).status).toBe(429);
      expect(geminiWebError(1052).status).toBe(404);
      expect(geminiWebError(1060).status).toBe(429);
      expect(geminiWebError(0).status).toBe(502);
    });

    it("reads the model that answered, and tells when it is not the one asked for", () => {
      const cand = ["rc_9", ["Hi"]];
      const raw = wire(frame([null, ["c_9", "r_9"], null, null, [cand], ...Array(37).fill(null), "4 Argon"]));
      expect(parseGeminiWebStream(raw)).toMatchObject({ text: "Hi", model: "4 Argon" });
      expect(servedModelMatches("4 Argon", "gemini-4-argon")).toBe(true);
      expect(servedModelMatches("4 Argon", "Gemini 4 Argon")).toBe(true);
      expect(servedModelMatches("3.5 Flash-Lite", "gemini-4-argon")).toBe(false);
      expect(servedModelMatches("", "gemini-4-argon")).toBe(true); /* no name given: nothing to compare */
    });

    it("estimates tokens at four characters each", () => {
      expect(estimateTokens("12345678")).toBe(2);
      expect(estimateTokens("")).toBe(0);
    });
  });
  describe("usage limits", () => {
    const NOW = Date.parse("2026-11-18T12:00:00Z");
    const at = (h) => new Date(NOW + h * 3600000).toISOString();

    it("tells the 5-hour allowance from the weekly one by how far off its reset is", () => {
      const q = summarizeQuota([
        ["gemini-3-flash", { displayName: "Gemini 3 Flash", quotaInfo: { remainingFraction: 0.8, resetTime: at(3) } }],
        ["gemini-3-pro-high", { displayName: "Gemini 3 Pro", quotaInfo: { remainingFraction: 0.25, resetTime: at(4) } }],
        ["gemini-4-argon-medium", { displayName: "Gemini 4 Argon", quotaInfo: { remainingFraction: 0.9, resetTime: at(70) } }],
      ], NOW);
      expect(q.windows).toEqual([
        { id: "5h", label: "5-hour", remaining: 0.25, resetsAt: at(3), models: 2 },
        { id: "weekly", label: "Weekly", remaining: 0.9, resetsAt: at(70), models: 1 },
      ]);
      expect(q.models.find((m) => m.id === "gemini-4-argon-medium")).toMatchObject({ window: "weekly", remaining: 0.9 });
    });

    it("reads a used-up allowance (a reset time and no fraction) as empty, and skips what has no quota", () => {
      const q = summarizeQuota([
        ["claude-sonnet-4-5", { quotaInfo: { resetTime: at(100) } }],
        ["gemini-3-flash", { displayName: "Gemini 3 Flash" }],
        ["gemini-embed-1", { quotaInfo: { remainingFraction: 1, resetTime: at(1) } }],
        ["gemini-4-argon-disabled", { quotaInfo: { remainingFraction: 0, resetTime: at(1) } }],
      ], NOW);
      expect(q.models).toEqual([{ id: "claude-sonnet-4-5", name: "claude-sonnet-4-5", remaining: 0, resetsAt: at(100), window: "weekly" }]);
      expect(summarizeQuota([], NOW)).toEqual({ windows: [], models: [] });
    });

    it("counts the Gemini app's day in Pacific time", () => {
      expect(pacificDay(Date.parse("2026-11-18T07:59:00Z"))).toBe("2026-11-17");
      expect(pacificDay(Date.parse("2026-11-18T08:01:00Z"))).toBe("2026-11-18");
      expect(nextPacificMidnight(Date.parse("2026-11-18T07:00:00Z"))).toBe(Date.parse("2026-11-18T08:00:00Z"));
      expect(nextPacificMidnight(Date.parse("2026-11-18T08:00:00Z"))).toBe(Date.parse("2026-11-19T08:00:00Z"));
    });
  });
});
