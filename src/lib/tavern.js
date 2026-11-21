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

import { stripComments } from "./macros.js";

const ROLES = ["system", "user", "assistant"];

const clean = (t) =>
  stripComments(t)
    .replace(/^\s*(?:\{\{trim\}\}\s*)+/i, "")
    .replace(/(?:\s*\{\{trim\}\})+\s*$/i, "")
    .trim();

/* The block runs on an ordinary reply. */
const firesOnReply = (p) =>
  !Array.isArray(p.injection_trigger) || !p.injection_trigger.length || p.injection_trigger.includes("normal");

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
  /* depth → role → texts, so a depth is sent the way SillyTavern sends it:
     system blocks, then user, then assistant */
  const deep = new Map();
  let pastHistory = false;
  for (const p of entries) {
    if (p.identifier === "chatHistory") { pastHistory = true; continue; }
    if (p.marker || typeof p.content !== "string" || !firesOnReply(p)) continue;
    const text = clean(p.content);
    if (!text) continue;
    if (Number(p.injection_position) === 1) {
      const depth = Math.max(0, Math.round(Number(p.injection_depth) || 0));
      const role = ROLES.includes(p.role) ? p.role : "system";
      if (!deep.has(depth)) deep.set(depth, { system: [], user: [], assistant: [] });
      deep.get(depth)[role].push(text);
    } else (pastHistory ? after : sys).push(text);
  }

  const at = (d) => (deep.has(d) ? ROLES.flatMap((r) => deep.get(d)[r]) : []);
  const post = [...at(0), ...after].join("\n\n");
  const inject = [...deep.keys()].filter((d) => d > 0).sort((a, b) => b - a).map((depth) => ({ depth, text: at(depth).join("\n\n") }));
  const scripts = o.extensions?.regex_scripts;
  return { text: sys.join("\n\n"), post, inject, regex: tavernRegex(scripts), display: tavernRegex(scripts, "display") };
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

/* "/pattern/flags" → RegExp, or null when it does not compile. */
export function regexFrom(s) {
  const src = String(s || "");
  const m = src.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  try {
    return m ? new RegExp(m[1], m[2]) : src ? new RegExp(src, "g") : null;
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

/* ST placement codes: 1 your input, 2 the AI's output. */
const PLACE_ROLES = { 1: "user", 2: "assistant" };

/* kind: "prompt" (prompt-only scripts) or "display" (display-only) */
export function tavernRegex(scripts, kind = "prompt") {
  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter((x) => x && !x.disabled && (kind === "display" ? x.markdownOnly : x.promptOnly) && regexFrom(x.findRegex))
    .map((x) => ({
      name: String(x.scriptName || "Regex"),
      find: String(x.findRegex),
      replace: String(x.replaceString ?? ""),
      trim: Array.isArray(x.trimStrings) ? x.trimStrings.filter((t) => typeof t === "string" && t) : [],
      roles: [...new Set((x.placement || []).map((p) => PLACE_ROLES[p]).filter(Boolean))],
      minDepth: Number.isFinite(x.minDepth) && x.minDepth >= 0 ? x.minDepth : null,
      maxDepth: Number.isFinite(x.maxDepth) && x.maxDepth >= 0 ? x.maxDepth : null,
    }))
    .filter((x) => x.roles.length);
}

/* One script on one text. The replacement takes $1, $<name> and {{match}}
   (the whole match), with the script's trim strings taken out of them. */
function runOne(text, rule) {
  const re = regexOf(rule.find);
  if (!re) return text;
  const cut = (s) => rule.trim.reduce((a, t) => a.split(t).join(""), s ?? "");
  return text.replace(re, (...hit) => {
    const named = typeof hit[hit.length - 1] === "object" ? hit[hit.length - 1] : null;
    const groups = hit.slice(0, named ? -3 : -2);
    return rule.replace.replace(/\{\{match\}\}|\$(\d+)|\$<([^>]+)>/gi, (m, n, name) =>
      m.toLowerCase() === "{{match}}" ? cut(groups[0]) : n != null ? cut(groups[Number(n)]) : cut(named?.[name]));
  });
}

/* The scripts in reach of one message, run in order. `depth` counts up
   from the newest message (0). */
export function applyRegex(text, rules, role, depth) {
  let out = String(text ?? "");
  for (const r of rules || []) {
    if (!r.roles.includes(role)) continue;
    if (r.minDepth != null && depth < r.minDepth) continue;
    if (r.maxDepth != null && depth > r.maxDepth) continue;
    out = runOne(out, r);
  }
  return out;
}

/* The history as it is to be sent, with the prompt-only scripts run on
   each message in reach. The messages passed in are not changed. */
export function applyPromptRegex(history, rules) {
  if (!rules?.length) return history;
  const n = history.length;
  return history.map((m, i) => {
    const content = applyRegex(m.content || "", rules, m.role, n - 1 - i);
    return content === (m.content || "") ? m : { ...m, content };
  });
}
