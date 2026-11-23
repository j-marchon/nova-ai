/* ============================================================
   Subscription Gateway Core Translators & Catalog
   ============================================================
   Pure protocol translation between OpenAI Chat Completions (what Nova speaks)
   and the subscription upstreams Nova Bridge signs in to:
     1. Google Antigravity         (cloudcode-pa v1internal:streamGenerateContent)
     2. Claude Pro / Max           (the Claude Code CLI on the Bridge's computer)
     3. ChatGPT Plus / Pro (Codex) (chatgpt.com/backend-api/codex/responses)
     4. Gemini app                 (gemini.google.com web session, chat only)

   Claude runs through the official Claude Code program the user is signed in
   to (bridge/claude-code.mjs), never with its tokens: Anthropic only accepts
   a subscription from Claude Code itself, and its terms forbid using one
   from other apps, so the Bridge warns before connecting it. The Gemini CLI
   sign-in is absent:
   Google stopped serving it to personal accounts and points them to
   Antigravity, which serves the same models.

   Key guarantee: Nova's full system prompt is ALWAYS passed into the upstream's
   native system instruction field — never flattened into a fake user transcript.
   The one exception is the Gemini app: its web protocol has no system field, so
   the prompt is framed in text there (toGeminiWebPrompt).
   Shared by bridge.mjs (Node) and the Providers panel (browser): no Node APIs.
   ============================================================ */

export const SUBSCRIPTION_PROVIDERS = [
  {
    id: "antigravity",
    name: "Google Antigravity",
    studentOffer: "Any Google account; more with Google AI Pro",
    description: "Signs in like the Antigravity app. Available models are fetched from your account; access depends on your plan.",
    auth: "browser",
  },
  {
    id: "claude",
    name: "Claude",
    studentOffer: "Claude Pro or Max · through Claude Code on the computer",
    description: "Runs Claude Code on the Bridge's computer, signed in to your plan. Connect it in the Bridge window.",
    auth: "bridge",
  },
  {
    id: "openai",
    name: "ChatGPT Plus / Pro",
    studentOffer: "Signs in like the Codex CLI",
    description: "Signs in like the Codex CLI. Turn on device code sign-in under ChatGPT → Settings → Security first.",
    auth: "device",
  },
  {
    id: "gemini-web",
    name: "Gemini app",
    studentOffer: "Google AI Pro, trials included · uses gemini.google.com",
    description: "Uses your gemini.google.com session for chat only, so models a trial blocks elsewhere can work. The models are the ones the Gemini app's own picker offers your account.",
    auth: "browser",
    tokenHint: "Or paste your gemini.google.com cookies (__Secure-1PSID …)",
  },
];

export const PROVIDER_IDS = SUBSCRIPTION_PROVIDERS.map((p) => p.id);

/* Legacy model metadata for context sizes and routing compatibility.
   Never used to advertise availability; the bridge discovers that upstream. */
export const SUBSCRIPTION_MODELS = {
  antigravity: [
    { id: "antigravity/gemini-3-pro-high", name: "Gemini 3 Pro High", ctx: 1048576 },
    { id: "antigravity/gemini-3-flash", name: "Gemini 3 Flash", ctx: 1048576 },
    { id: "antigravity/gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)", ctx: 1048576 },
    { id: "antigravity/gemini-4-argon-high", name: "Gemini 4 Argon (High)", ctx: 1048576 },
    { id: "antigravity/claude-sonnet-4-5", name: "Claude Sonnet 4.5", ctx: 200000 },
    { id: "antigravity/gpt-oss-120b-medium", name: "GPT-OSS 120B", ctx: 131072 },
  ],
  claude: [
    { id: "claude/opus", name: "Claude Opus", ctx: 200000 },
    { id: "claude/sonnet", name: "Claude Sonnet", ctx: 200000 },
    { id: "claude/haiku", name: "Claude Haiku", ctx: 200000 },
  ],
  openai: [
    { id: "openai/gpt-5", name: "GPT-5", ctx: 272000 },
    { id: "openai/gpt-5-codex", name: "GPT-5 Codex", ctx: 272000 },
  ],
  /* the Gemini app's models are known and learned at runtime (bridge.mjs) */
  "gemini-web": [],
};

const PROVIDER_NAME = { antigravity: "Antigravity", claude: "Claude", openai: "ChatGPT", "gemini-web": "Gemini app" };

/* One picker row, OpenRouter-shaped: "<provider>/<model>", price 0. */
export function modelEntry(provider, upstreamId, { name, ctx } = {}) {
  return {
    id: `${provider}/${upstreamId}`,
    object: "model",
    name: `${name || upstreamId} (${PROVIDER_NAME[provider] || provider})`,
    owned_by: provider,
    context_length: ctx || null,
    pricing: { prompt: "0", completion: "0" },
  };
}

/* Antigravity only serves Argon by thinking tier (-low, -medium, -high); a
   bare "gemini-4-argon" (as the old Gemini Web bridge saved it) is a 404
   there, so it gets Google's default tier. */
const argonTier = (id) => (/^gemini-4-argon$/i.test(id) ? "gemini-4-argon-medium" : id);

/* Route a model ID ("antigravity/gemini-3-flash", "claude/sonnet", or a
   bare "gemini-3-flash") to { provider, upstreamModel }. Bare ids go to the
   first connected provider that plausibly serves them. */
export function resolveSubscriptionModel(modelId = "", connected = []) {
  let raw = String(modelId || "").trim();
  const slash = raw.indexOf("/");
  if (slash > 0) {
    const prefix = raw.slice(0, slash).toLowerCase();
    const rest = raw.slice(slash + 1);
    if (PROVIDER_IDS.includes(prefix)) return { provider: prefix, upstreamModel: prefix === "antigravity" ? argonTier(rest) : rest };
    /* GitHub Copilot was replaced by Claude: a model saved under it is
       routed like a bare id, to whatever now serves it */
    if (prefix === "copilot") raw = rest;
    /* "gemini/…" and "google/…" were the Gemini CLI channel, now gone: a
       model saved under them is routed like a bare id */
    if (prefix === "gemini" || prefix === "google") raw = rest;
  }
  const has = (p) => connected.includes(p);
  const pick = (...order) => order.find(has) || order[0];
  /* Antigravity refuses trial accounts for Argon, the Gemini app does not */
  if (/^gemini-4-argon/i.test(raw)) return has("gemini-web") ? { provider: "gemini-web", upstreamModel: raw } : { provider: "antigravity", upstreamModel: argonTier(raw) };
  if (/^gemini/i.test(raw)) return { provider: pick("antigravity", "gemini-web"), upstreamModel: raw };
  if (/^(claude|opus|sonnet|haiku)/i.test(raw)) return has("claude") || !has("antigravity") ? { provider: "claude", upstreamModel: claudeAlias(raw) } : { provider: "antigravity", upstreamModel: raw };
  if (/^gpt-oss/i.test(raw)) return { provider: "antigravity", upstreamModel: raw };
  if (/^(gpt-|o\d|codex)/i.test(raw)) return { provider: "openai", upstreamModel: raw };
  const fallback = connected[0] || "antigravity";
  const first = SUBSCRIPTION_MODELS[fallback]?.[0]?.id.split("/").slice(1).join("/");
  return { provider: fallback, upstreamModel: raw || first };
}

/* A Claude model as Claude Code names it: its own alias ("opus") or a full
   id ("claude-sonnet-4-5"); a family named in a longer id ("claude-sonnet-4.5"
   from another channel) falls back to that family's alias. */
function claudeAlias(raw) {
  const id = String(raw || "").toLowerCase();
  if (/^(opus|sonnet|haiku)$/.test(id) || /^claude-[a-z]+-\d+(-\d+)*(-\d{8})?$/.test(id)) return id;
  return (id.match(/opus|sonnet|haiku/) || ["sonnet"])[0];
}

/* Normalize message content (string or OpenAI content parts array) to string. */
export function textOfContent(content) {
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  return String(content ?? "");
}

/* Split OpenAI messages into { systemPrompt, turns } while preserving every
   instruction block and merging consecutive same-role messages cleanly. */
export function splitSystemAndTurns(messages = []) {
  const sys = [];
  const turns = [];
  for (const m of messages) {
    const text = textOfContent(m?.content).trim();
    if (!text && (!m?.images || !m.images.length)) continue;
    if (m.role === "system" || m.role === "developer") {
      sys.push(text);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role && (!m.images || !m.images.length) && (!prev.images || !prev.images.length)) {
      prev.content += `\n\n${text}`;
    } else {
      turns.push({ role, content: text, ...(m.images?.length ? { images: m.images } : {}) });
    }
  }
  return {
    systemPrompt: sys.join("\n\n"),
    turns,
  };
}

/* Every SSE parser takes one raw line and returns null (nothing to emit) or
   { content, reasoning, finishReason, usage } or { error }. */
function sseData(line) {
  const t = String(line || "").trim();
  if (!t.startsWith("data:")) return null;
  const raw = t.slice(5).trim();
  if (!raw || raw === "[DONE]") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ---------- 1. Antigravity (Code Assist protocol) ---------- */

const thinks = (model) => /^gemini-(2\.5|[3-9])/i.test(model);

export function toGoogleCodeAssistPayload(messages = [], model = "gemini-2.5-pro", project = "", params = {}) {
  const { systemPrompt, turns } = splitSystemAndTurns(messages);
  const contents = turns.map((t) => {
    const parts = [];
    if (t.content) parts.push({ text: t.content });
    if (t.images && t.images.length) {
      for (const img of t.images) {
        const raw = typeof img === "string" ? img : img.url || "";
        const match = raw.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        } else {
          const name = typeof img === "string" ? "image" : img.name || "image";
          parts.push({ text: "[Attached image: " + name + "]" });
        }
      }
    }
    if (!parts.length) parts.push({ text: "" });
    return {
      role: t.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  /* Gemini requires the conversation to open with a user turn */
  if (!contents.length) {
    contents.push({ role: "user", parts: [{ text: "(Begin.)" }] });
  } else if (contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "(The scene begins.)" }] });
  }

  const upstream = model.replace(/^models\//, "");
  const generationConfig = {};
  if (params.temperature != null) generationConfig.temperature = Number(params.temperature);
  if (params.top_p != null) generationConfig.topP = Number(params.top_p);
  if (params.top_k != null && Number(params.top_k) > 0) generationConfig.topK = Math.round(Number(params.top_k));
  if (params.max_tokens != null && Number(params.max_tokens) > 0) {
    generationConfig.maxOutputTokens = Number(params.max_tokens);
  }
  /* stream the model's thoughts too, so Nova can show them like OpenRouter's reasoning */
  if (thinks(upstream)) {
    const supplied = params.extra_body?.google?.thinking_config || {};
    const effort = supplied.thinking_level || params.reasoning_effort;
    generationConfig.thinkingConfig = {
      includeThoughts: supplied.include_thoughts ?? true,
      ...(["low", "medium", "high"].includes(String(effort).toLowerCase()) ? { thinkingLevel: String(effort).toUpperCase() } : {}),
    };
  }

  const request = {
    contents,
    generationConfig,
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  if (systemPrompt) {
    request.systemInstruction = {
      role: "user",
      parts: [{ text: systemPrompt }],
    };
  }

  const envelope = { model: upstream, request };
  if (project) envelope.project = project;
  return envelope;
}

const GOOGLE_FINISH = { STOP: "stop", MAX_TOKENS: "length", SAFETY: "content_filter", PROHIBITED_CONTENT: "content_filter", BLOCKLIST: "content_filter", RECITATION: "content_filter", SPII: "content_filter" };

/* Parse a single SSE line from v1internal:streamGenerateContent?alt=sse */
export function parseGoogleCodeAssistSseLine(line) {
  const data = sseData(line);
  if (!data) return null;
  if (data.error) return { error: data.error.message || "Google stream error" };
  const inner = data?.response || data;
  const blocked = inner?.promptFeedback?.blockReason;
  if (blocked) return { error: `Google blocked the prompt (${blocked}).` };
  const candidate = inner?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  let content = "";
  let reasoning = "";
  for (const p of parts) {
    if (typeof p?.text !== "string") continue;
    if (p.thought) reasoning += p.text;
    else content += p.text;
  }
  const fr = candidate?.finishReason;
  const finishReason = fr ? GOOGLE_FINISH[fr] || "stop" : null;
  const u = inner?.usageMetadata;
  const usage = u
    ? {
        prompt_tokens: Number(u.promptTokenCount || 0),
        completion_tokens: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0),
        total_tokens: Number(u.totalTokenCount || 0),
      }
    : null;
  return { content, reasoning, finishReason, usage };
}

/* ---------- 2. Claude (through the Claude Code CLI) ----------

   Claude Code takes one system prompt (Nova's, whole, through its own
   system-prompt option) and one prompt on stdin. A single user turn goes in
   as it is; a longer conversation is laid out turn by turn for Claude to
   write the next assistant message. */

export function toClaudeCodePrompt(messages = []) {
  const { systemPrompt, turns } = splitSystemAndTurns(messages);
  const pics = (t) => (t.images || []).map((_, i) => `[Attached image ${i + 1}]`).join("\n");
  const text = (t) => [t.content, pics(t)].filter(Boolean).join("\n");
  if (!turns.length) return { system: systemPrompt, prompt: "(Continue.)" };
  if (turns.length === 1 && turns[0].role === "user") return { system: systemPrompt, prompt: text(turns[0]) };
  const body = turns.map((t) => `<${t.role}>\n${text(t)}\n</${t.role}>`).join("\n\n");
  return {
    system: systemPrompt,
    prompt: `<conversation>\n${body}\n</conversation>\n\nWrite the next <assistant> message. Output only its text, without the tags.`,
  };
}

export function parseOpenAISseLine(line) {
  const f = sseData(line);
  if (!f) return null;
  if (f.error) return { error: f.error.message || String(f.error) };
  const choice = f.choices?.[0];
  const d = choice?.delta || {};
  return {
    content: typeof d.content === "string" ? d.content : "",
    reasoning: d.reasoning_content || d.reasoning || d.reasoning_text || "",
    finishReason: choice?.finish_reason || null,
    usage: f.usage || null,
  };
}

/* ---------- 3. ChatGPT Codex Responses ---------- */

/* The Codex backend takes the system prompt as top-level `instructions`.
   With asDeveloper, it goes in as the first input message instead (the
   developer role, which models treat as system-level) — the fallback for when
   the backend refuses custom instructions for a model. */
export function toCodexResponsesPayload(messages = [], model = "gpt-5", params = {}, { asDeveloper = false } = {}) {
  const { systemPrompt, turns } = splitSystemAndTurns(messages);
  const input = turns.map((t) => ({
    type: "message",
    role: t.role,
    content: [
      {
        type: t.role === "assistant" ? "output_text" : "input_text",
        text: t.content,
      },
    ],
  }));
  if (!input.some((m) => m.role === "user")) {
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "(Begin.)" }],
    });
  }
  if (asDeveloper && systemPrompt) {
    input.unshift({ type: "message", role: "developer", content: [{ type: "input_text", text: systemPrompt }] });
  }
  /* Codex requires store:false and stream:true and rejects samplers and
     max_output_tokens, so those are dropped. */
  const effort = ["minimal", "low", "medium", "high"].includes(params.reasoning_effort) ? params.reasoning_effort : "medium";
  return {
    model,
    instructions: asDeveloper || !systemPrompt ? "You are a helpful assistant." : systemPrompt,
    input,
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort, summary: "auto" },
    store: false,
    stream: true,
  };
}

export function parseCodexSseLine(line) {
  const ev = sseData(line);
  if (!ev) return null;
  if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
    return { content: ev.delta, reasoning: "", finishReason: null };
  }
  if (
    (ev.type === "response.reasoning_summary_text.delta" || ev.type === "response.reasoning_text.delta") &&
    typeof ev.delta === "string"
  ) {
    return { content: "", reasoning: ev.delta, finishReason: null };
  }
  if (ev.type === "response.completed" || ev.type === "response.incomplete") {
    const u = ev.response?.usage;
    const cut = ev.type === "response.incomplete";
    return {
      content: "",
      reasoning: "",
      finishReason: cut ? (ev.response?.incomplete_details?.reason === "content_filter" ? "content_filter" : "length") : "stop",
      usage: u
        ? {
            prompt_tokens: Number(u.input_tokens || 0),
            completion_tokens: Number(u.output_tokens || 0),
            total_tokens: Number(u.total_tokens || 0),
          }
        : null,
    };
  }
  if (ev.type === "response.failed") {
    return { error: ev.response?.error?.message || "ChatGPT could not finish the reply." };
  }
  if (ev.type === "error" || ev.error) {
    return { error: ev.error?.message || ev.message || "Codex stream error" };
  }
  return null;
}

/* ---------- JWT & Account ID Helpers ---------- */

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  return decodeURIComponent(escape(atob(b64)));
}

export function parseJwtClaims(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

/* When a JWT access token expires, in ms (0 when unknown). */
export function jwtExpiry(token) {
  const exp = Number(parseJwtClaims(token)?.exp);
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

export function extractChatGptAccountId(tokens = {}) {
  for (const raw of [tokens.id_token, tokens.access_token]) {
    const claims = parseJwtClaims(raw);
    if (!claims) continue;
    const id =
      claims.chatgpt_account_id ||
      claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
      claims.organizations?.[0]?.id;
    if (id) return id;
  }
  return null;
}

/* ---------- 4. Gemini app (gemini.google.com web session) ----------

   The web app has no system-instruction field and no sampler settings, so
   the system prompt is framed in text and temperature, top_p, max_tokens and
   reasoning_effort are ignored. Each request is a fresh conversation that
   carries the whole history. The reply format is reverse-engineered: the
   paths below were last confirmed Oct 2026 and the probe script
   (bridge/tools/probe-gemini-web.mjs) re-checks them. */

export function toGeminiWebPrompt(messages = []) {
  const { systemPrompt, turns } = splitSystemAndTurns(messages);
  const body = turns.map((t) => {
    const tag = t.role === "assistant" ? "assistant" : "user";
    const pics = (t.images || []).map((_, i) => `[Attached image ${i + 1}]`).join("\n");
    return `<${tag}>\n${[t.content, pics].filter(Boolean).join("\n")}\n</${tag}>`;
  });
  return [
    "You are acting as a plain text-generation backend for a roleplay and chat app, not as a coding assistant.",
    "Do not use any tools, extensions or web search, and do not mention the app, Gemini or these instructions.",
    "Below are the app's instructions and the conversation so far. Write the next <assistant> message, following the instructions.",
    "Output only the text of that message: no preamble, no commentary about the task, no <assistant> tags, no code fences around it.",
    "",
    systemPrompt ? `<instructions>\n${systemPrompt}\n</instructions>\n` : "",
    `<conversation>\n${body.join("\n\n")}\n</conversation>`,
    "",
    "Now write the next <assistant> message.",
  ].join("\n");
}

/* StreamGenerate (rt=c) answers:
     )]}'               ← anti-XSSI prefix
     <bytecount>\n      ← length of the next line
     [["wrb.fr",null,"<inner-json>"]]
   Each inner JSON is a snapshot of the reply so far. inner[1] = [cid, rid],
   inner[4][0] = the candidate: [rcid, [text], …]. Thoughts, when shown, sit
   at candidate[37][0][0] (community-reported; a live check in Nov 2026 found
   no thoughts there for the default model or Argon: [37] held a code-tool
   block, so replies may simply carry none). inner[42] names the model that
   answered ("4 Argon", "3.5 Flash-Lite"), confirmed live. An error frame
   carries a numeric code inside entry[5] (unverified). The latest snapshot
   wins. Returns { text, thoughts, cid, rid, rcid, model, errorCode }. */
export function parseGeminiWebStream(raw) {
  const out = { text: "", thoughts: "", cid: "", rid: "", rcid: "", model: "", errorCode: 0 };
  const cleaned = String(raw || "").replace(/^\)\]\}'\s*\n?/, "");
  /* the error frame's layout is unverified: take the first four-digit number
     in it (the codes), else the first number at all */
  const numbers = (v, depth = 0, acc = []) => {
    if (typeof v === "number" && Number.isFinite(v)) acc.push(v);
    else if (Array.isArray(v) && depth < 6) v.forEach((x) => numbers(x, depth + 1, acc));
    return acc;
  };
  const firstNumber = (v) => { const all = numbers(v); return all.find((n) => n >= 1000) || all[0] || 0; };
  for (const line of cleaned.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("[")) continue;
    let outer;
    try { outer = JSON.parse(t); } catch { continue; } // a line still arriving
    if (!Array.isArray(outer)) continue;
    for (const entry of outer) {
      if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
      if (typeof entry[2] !== "string") {
        const code = firstNumber(entry[5]);
        if (code) out.errorCode = code;
        continue;
      }
      let inner;
      try { inner = JSON.parse(entry[2]); } catch { continue; }
      const cand = inner?.[4]?.[0];
      const text = cand?.[1]?.[0];
      if (typeof text === "string" && text) out.text = text;
      const thoughts = cand?.[37]?.[0]?.[0];
      if (typeof thoughts === "string" && thoughts) out.thoughts = thoughts;
      if (typeof inner?.[42] === "string" && inner[42]) out.model = inner[42];
      if (typeof inner?.[1]?.[0] === "string") out.cid = inner[1][0];
      if (typeof inner?.[1]?.[1] === "string") out.rid = inner[1][1];
      if (typeof cand?.[0] === "string") out.rcid = cand[0];
    }
  }
  return out;
}

/* The web app's numeric error codes → what Nova should see (community-
   reported; unverified): 1037 usage limit, 1050/1052 model header refused,
   1060 IP temporarily blocked. */
export function geminiWebError(code) {
  const c = Number(code) || 0;
  if (c === 1037) return { status: 429, message: "Gemini app usage limit reached for this account." };
  if (c === 1050 || c === 1052) return { status: 404, message: "The Gemini app refused this model. Re-learn models in the Bridge window, or use gemini-web/default." };
  if (c === 1060) return { status: 429, message: "Google has temporarily blocked this connection. Wait a while and try again." };
  return { status: 502, message: c ? `The Gemini app returned error ${c}.` : "The Gemini app returned an error." };
}

/* Did the app answer with the model that was asked for? `served` is the name it
   gives ("4 Argon"), `wanted` ours ("gemini-4-argon" or "Gemini 4 Argon"): they
   match when one, stripped to letters and digits, contains the other. */
export function servedModelMatches(served, wanted) {
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(served);
  const b = norm(wanted);
  return !a || !b || a.includes(b) || b.includes(a);
}

export const estimateTokens = (text) => Math.ceil(String(text || "").length / 4);

/* ---------- 5. Usage limits ----------

   Antigravity attaches a quota to each model it lists (quotaInfo:
   { remainingFraction, resetTime }, field names as community tools read them,
   not documented by Google). It has a 5-hour rolling allowance and, on top, a
   weekly cap; the API gives one reset time per model, so which of the two a
   figure belongs to is told from how far away its reset is. A missing
   remainingFraction next to a resetTime means the allowance is used up. */

const HOUR = 3600000;
export const QUOTA_WINDOWS = [
  { id: "5h", label: "5-hour" },
  { id: "weekly", label: "Weekly" },
];
const quotaWindow = (ms) => (ms == null ? "unknown" : ms <= 5.5 * HOUR ? "5h" : ms <= 8 * 24 * HOUR ? "weekly" : "longer");

export function summarizeQuota(rows = [], now = Date.now()) {
  const models = [];
  for (const [id, m] of rows) {
    const q = m?.quotaInfo || m?.quota;
    if (!id || !q || /embed|image|tab_|chat_\d|-disabled$/i.test(id)) continue;
    const reset = Date.parse(q.resetTime || q.reset_time || "");
    const hasReset = Number.isFinite(reset);
    let remaining = Number(q.remainingFraction ?? q.remaining_fraction);
    if (!Number.isFinite(remaining)) {
      if (!hasReset) continue;
      remaining = 0;
    }
    models.push({
      id,
      name: m.displayName || m.label || id,
      remaining: Math.min(1, Math.max(0, remaining)),
      resetsAt: hasReset ? new Date(reset).toISOString() : null,
      window: quotaWindow(hasReset ? reset - now : null),
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  const windows = [];
  for (const w of QUOTA_WINDOWS) {
    const inside = models.filter((m) => m.window === w.id);
    if (!inside.length) continue;
    const resets = inside.map((m) => m.resetsAt).filter(Boolean).sort();
    windows.push({
      ...w,
      /* the fullest bar is the model closest to running out */
      remaining: Math.min(...inside.map((m) => m.remaining)),
      resetsAt: resets[0] || null,
      models: inside.length,
    });
  }
  return { windows, models };
}

/* The Gemini app counts its prompts per day and resets at midnight Pacific
   time (as the app says it does). */
const PACIFIC = "America/Los_Angeles";
export const pacificDay = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC }).format(ms);

export function nextPacificMidnight(ms = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return ms + (86400 - (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second))) * 1000;
}
