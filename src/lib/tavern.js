/* ---------- SillyTavern chat-completion presets ----------

   A SillyTavern preset is a list of prompt blocks, each one switched on or
   off, with a place to go:

     - relative: in the system prompt, in the preset's order. A block placed
       after the Chat History marker goes after the conversation instead.
     - in-chat at depth N: N messages up from the newest. Depth 0 is after
       the newest message, the last thing the model reads; presets put their
       "last-mile" reminders and their chain of thought there for that
       reason.

   and a trigger list saying which kinds of generation it fires on. An empty
   list means all of them. Nova sends ordinary replies only, so a block
   meant only for Impersonate, Continue or a background ("quiet") request is
   left out; sent every turn, Impersonate's block told the model to write
   your message instead of the character's.

   readTavernPreset turns the enabled blocks into the three places Nova
   has:
     text     the system prompt ([Style])
     post     after the conversation, on the newest message
     inject   [{ depth, text }] for blocks deeper than that
   Author's notes ({{// …}}) are removed; every other macro is kept for
   runMacros (macros.js) to run when the prompt is sent, since dice and
   variables have to change from turn to turn. */

import { runMacros, stripComments } from "./macros.js";

const ROLES = ["system", "user", "assistant"];

const clean = (t) =>
  stripComments(t)
    .replace(/^\s*(?:\{\{trim\}\}\s*)+/i, "")
    .replace(/(?:\s*\{\{trim\}\})+\s*$/i, "")
    .trim();

/* Which kinds of generation a block fires on. SillyTavern's list names
   normal, continue, impersonate, quiet (background requests), swipe and
   regenerate; swipe and regenerate are ordinary replies for Nova. An empty
   list means all of them. */
const kindsOf = (p) => {
  const t = Array.isArray(p.injection_trigger) ? p.injection_trigger : [];
  if (!t.length) return null;
  return new Set(t.map((k) => (k === "swipe" || k === "regenerate" ? "normal" : k)));
};
const firesOn = (p, kind) => {
  const k = kindsOf(p);
  return !k || k.has(kind);
};
/* The block runs on an ordinary reply. */
const firesOnReply = (p) => firesOn(p, "normal");

/* The marker blocks a preset places its text around: where Nova's own
   sections of the card, the persona and the world go, in the preset's order. */
export const MARKERS = ["worldInfoBefore", "worldInfoAfter", "personaDescription", "charDescription", "charPersonality", "scenario", "dialogueExamples"];

export function readTavernPreset(o) {
  const all = (o.prompts || []).filter((x) => x && typeof x === "object");
  const byId = new Map(all.map((x) => [x.identifier || x.name, x]));
  const order = Array.isArray(o.prompt_order)
    ? o.prompt_order.reduce((a, b) => ((b?.order?.length || 0) > (a?.order?.length || 0) ? b : a), null)?.order
    : null;
  const entries = order
    ? order.filter((e) => e && e.enabled !== false).map((e) => byId.get(e.identifier)).filter(Boolean)
    : all.filter((x) => x.enabled !== false);

  const sys = [];
  const after = [];
  /* the system part in order, with the marker positions kept: the preset's
     labels sit right before the card, persona and world sections they name */
  const layout = [];
  /* depth → role → texts, so a depth is sent the way SillyTavern sends it:
     system blocks, then user, then assistant */
  const deep = new Map();
  /* blocks for one kind of request only (Impersonate, Continue), in order */
  const only = { impersonate: [], continue: [] };
  let pastHistory = false;
  for (const p of entries) {
    if (p.identifier === "chatHistory") { pastHistory = true; continue; }
    if (p.marker) {
      if (!pastHistory && MARKERS.includes(p.identifier)) layout.push({ marker: p.identifier });
      else if (pastHistory && p.identifier === "worldInfoAfter") layout.push({ marker: p.identifier, after: true });
      continue;
    }
    if (typeof p.content !== "string") continue;
    const text = clean(p.content);
    if (!text) continue;
    if (!firesOnReply(p)) {
      for (const kind of Object.keys(only)) if (firesOn(p, kind)) only[kind].push(text);
      continue;
    }
    if (Number(p.injection_position) === 1) {
      const depth = Math.max(0, Math.round(Number(p.injection_depth) || 0));
      const role = ROLES.includes(p.role) ? p.role : "system";
      if (!deep.has(depth)) deep.set(depth, { system: [], user: [], assistant: [] });
      deep.get(depth)[role].push(text);
    } else {
      (pastHistory ? after : sys).push(text);
      if (!pastHistory) layout.push({ text });
    }
  }

  const at = (d) => (deep.has(d) ? ROLES.flatMap((r) => deep.get(d)[r]) : []);
  const post = [...at(0), ...after].join("\n\n");
  const inject = [...deep.keys()].filter((d) => d > 0).sort((a, b) => b - a).map((depth) => ({ depth, text: at(depth).join("\n\n") }));
  const scripts = o.extensions?.regex_scripts;
  const out = { text: sys.join("\n\n"), post, inject, regex: tavernRegex(scripts), display: tavernRegex(scripts, "display"), saved: tavernRegex(scripts, "saved") };
  if (layout.some((x) => x.marker)) out.layout = layout;
  /* what the preset says for the other kinds of request */
  const modes = {};
  const imp = [String(o.impersonation_prompt || "").trim(), ...only.impersonate].filter(Boolean).join("\n\n");
  if (imp) modes.impersonate = imp;
  /* Nova's own Continue line already says what the nudge says */
  const cont = only.continue.join("\n\n");
  if (cont) modes.continue = cont;
  if (Object.keys(modes).length) out.modes = modes;
  const formats = {};
  for (const [k, from] of [["scenario", "scenario_format"], ["personality", "personality_format"], ["world", "wi_format"]]) {
    if (typeof o[from] === "string" && o[from].trim() && o[from].trim() !== "{0}") formats[k] = o[from];
  }
  if (Object.keys(formats).length) out.formats = formats;
  return out;
}

/* ---------- regex scripts ----------

   A regex script is a find-and-replace SillyTavern runs on messages. Each
   one says whose messages (yours, the AI's), and how far it reaches:

     display only   changes how a message looks, not what is saved or sent
     prompt only    changes what is sent to the model, not what you see
     neither        rewrites the saved message itself

   Prompt-only scripts keep the context lean: they cut old tracker blocks,
   leaked thinking and image prompts out of the history before it is sent,
   while the chat on screen keeps every word. Display-only scripts are the
   other half: they turn what the model wrote (trackers, colour tags) into
   styled HTML in the bubble, see html.js. Scripts that rewrite the saved
   message are not kept. minDepth / maxDepth limit a script to messages that
   far up from the newest (0), so the latest few replies can stay whole. */

/* A pattern with its {{macros}} stood in for, only to tell whether it
   compiles. */
const subbed = (find) => String(find || "").replace(/\{\{[^{}]*\}\}/g, "x");

/* "/pattern/flags" → RegExp, or null when it does not compile. Read the
   way SillyTavern's regexFromString reads it, so a script does here what it
   does there: a pattern without slashes has no flags (it replaces the first
   match only), and unknown flags make the whole string the pattern. */
export function regexFrom(s) {
  const src = String(s || "");
  try {
    const m = src.match(/(\/?)(.+)\1([a-z]*)/i);
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return new RegExp(src);
    return new RegExp(m[2], m[3]);
  } catch {
    return null;
  }
}

/* Display scripts run on every bubble on every render, so each pattern is
   compiled once. String.replace resets a global pattern's lastIndex, so a
   shared one is safe. */
const compiled = new Map();
const regexOf = (s) => {
  if (!compiled.has(s)) compiled.set(s, regexFrom(s));
  return compiled.get(s);
};

/* ST placement codes: 1 your input, 2 the AI's output, 6 the AI's thinking
   (kept on a reply, never sent: display and saved scripts reach it). */
const PLACE_ROLES = { 1: "user", 2: "assistant", 6: "reasoning" };

/* kind: "prompt" (prompt-only scripts) or "display" (display-only) */
const KIND = {
  display: (x) => x.markdownOnly,
  prompt: (x) => x.promptOnly,
  /* neither: the script rewrites the message itself, as it is saved */
  saved: (x) => !x.markdownOnly && !x.promptOnly,
};

export function tavernRegex(scripts, kind = "prompt") {
  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter((x) => x && !x.disabled && KIND[kind](x) && regexFrom(subbed(x.findRegex)))
    .map((x) => ({
      name: String(x.scriptName || "Regex"),
      find: String(x.findRegex),
      /* 1: {{macros}} in the pattern are filled in; 2: and escaped */
      sub: [1, 2].includes(Number(x.substituteRegex)) ? Number(x.substituteRegex) : 0,
      replace: String(x.replaceString ?? ""),
      trim: Array.isArray(x.trimStrings) ? x.trimStrings.filter((t) => typeof t === "string" && t) : [],
      roles: [...new Set((x.placement || []).map((p) => PLACE_ROLES[p]).filter(Boolean))],
      minDepth: Number.isFinite(x.minDepth) && x.minDepth >= 0 ? x.minDepth : null,
      maxDepth: Number.isFinite(x.maxDepth) && x.maxDepth >= 0 ? x.maxDepth : null,
    }))
    .filter((x) => x.roles.length);
}

/* A regex file exported from SillyTavern (one script or a list of them),
   which presets often ship beside the preset itself, as the three kinds
   above; null when the text is not one. */
export function regexFile(raw) {
  let json;
  try { json = JSON.parse(String(raw || "").replace(/^\uFEFF/, "")); } catch { return null; }
  const items = Array.isArray(json) ? json : [json];
  if (!items.length || !items.every((x) => x && typeof x === "object" && typeof x.findRegex === "string")) return null;
  return { regex: tavernRegex(items), display: tavernRegex(items, "display"), saved: tavernRegex(items, "saved") };
}

/* A card's character's note (SillyTavern's depth_prompt), or null when
   empty. SillyTavern's defaults: depth 4, system. */
export function depthPromptOf(n) {
  if (!n || typeof n !== "object" || typeof n.prompt !== "string" || !n.prompt.trim()) return null;
  const depth = Number(n.depth);
  return {
    prompt: n.prompt,
    depth: Number.isFinite(depth) && n.depth !== "" && n.depth != null ? Math.max(0, Math.round(depth)) : 4,
    role: ROLES.includes(n.role) ? n.role : "system",
  };
}

/* `add` on top of `old`, a script of the same name replaced (loaded again) */
export const mergeRegex = (old, add) => [...(old || []).filter((r) => !add.some((a) => a.name === r.name)), ...add];

/* The scripts of one kind ("prompt", "display", "saved") a chat runs: the
   active prompt's, then the character's own (kept as SillyTavern scripts on
   the card), in SillyTavern's order. Switched-off ones are left out. */
const STYLE_KEY = { prompt: "regex", display: "display", saved: "saved" };
export function chatRegex(style, character, kind) {
  const all = [...(style?.[STYLE_KEY[kind]] || []), ...tavernRegex(character?.regexScripts, kind)];
  return all.filter((r) => !r.disabled);
}

/* A pattern whose {{macros}} are filled in from the chat (substituteRegex).
   Mode 2 escapes what they became, so a name with a dot or a bracket in it
   matches itself. */
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function patternFor(rule, ctx) {
  if (!rule.sub || !ctx) return rule.find;
  return rule.find.replace(/\{\{[^{}]*\}\}/g, (m) => {
    const v = runMacros(m, { user: ctx.user, char: ctx.char });
    return rule.sub === 2 ? escapeRe(v) : v;
  });
}

/* One script on one text. The replacement takes $1, $<name> and {{match}}
   (the whole match), with the script's trim strings taken out of them; then,
   as in SillyTavern, its macros ({{char}}, {{user}}, variables) are run. */
function runOne(text, rule, ctx) {
  const re = regexOf(patternFor(rule, ctx));
  if (!re) return text;
  const macros = (s) => runMacros(s, { user: ctx?.user, char: ctx?.char, vars: ctx?.vars });
  const trims = (rule.trim || []).map(macros);
  const cut = (s) => trims.reduce((a, t) => a.split(t).join(""), s ?? "");
  return text.replace(re, (...hit) => {
    const named = typeof hit[hit.length - 1] === "object" ? hit[hit.length - 1] : null;
    const groups = hit.slice(0, named ? -3 : -2);
    return macros(rule.replace.replace(/\{\{match\}\}|\$(\d+)|\$<([^>]+)>/gi, (m, n, name) =>
      m.toLowerCase() === "{{match}}" ? cut(groups[0]) : n != null ? cut(groups[Number(n)]) : cut(named?.[name])));
  });
}

/* The scripts in reach of one message, run in order. `depth` counts up
   from the newest message (0). `ctx` ({ user, char }) fills the macros in
   patterns that ask for it; a rule list can carry its own as `.ctx`. */
export function applyRegex(text, rules, role, depth, ctx) {
  let out = String(text ?? "");
  const names = ctx || rules?.ctx;
  for (const r of rules || []) {
    if (r.disabled || !r.roles.includes(role)) continue;
    if (r.minDepth != null && depth < r.minDepth) continue;
    if (r.maxDepth != null && depth > r.maxDepth) continue;
    out = runOne(out, r, names);
  }
  return out;
}

/* The history as it is to be sent, with the prompt-only scripts run on
   each message in reach. The messages passed in are not changed. */
export function applyPromptRegex(history, rules, ctx) {
  if (!rules?.length) return history;
  const n = history.length;
  return history.map((m, i) => {
    const content = applyRegex(m.content || "", rules, m.role, n - 1 - i, ctx);
    return content === (m.content || "") ? m : { ...m, content };
  });
}
