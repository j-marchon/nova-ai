/* ---------- SillyTavern macros ----------

   Presets written for SillyTavern carry more than {{char}} and {{user}}:
   author's notes, dice, and variables that one block sets and another reads
   later in the same prompt or on a later turn. Sent as they are, all of that
   reached the model as literal braces, dice never rolled and every variable
   read as its own name.

   runMacros does what SillyTavern does with them, in one pass from left to
   right, so a block reads what the blocks before it set:

     {{// note}}             removed, contents not run
     {{trim}}                removed with the line breaks around it
     {{noop}}  {{newline}}   nothing / a line break
     {{user}}  {{char}}      the names
     {{setvar::x::v}}        sets x, prints nothing
     {{getvar::x}}           prints x ({{getvar::x::fallback}} when unset)
     {{addvar::x::v}}        adds v to x (numbers add, text appends)
     {{incvar::x}} {{decvar::x}}  ±1, prints the new value
     {{roll:1d20}}           a dice roll: NdS+M, or just S for 1dS
     {{random::a::b}}        one of the options ({{random:a,b}} too)
     {{pick::a::b}}          one of the options, the same one every time
     {{if x}}…{{else}}…{{/if}}  a branch: x is a value, a macro name
                             ({{if description}}) or .var / $var; "", 0,
                             false and off are false, ! inverts
     {{.x}} {{$x}}           a chat / global variable, with = += -= ++ --
                             ||= ??= || ?? == != > >= < <= as SillyTavern has
     {{hasvar::x}} {{deletevar::x}}  and the global forms of every var macro
     {{time}} {{date}} {{weekday}} {{isotime}} {{isodate}}  the clock
     {{space}} {{reverse::t}}  a space / t backwards
     {{description}} {{persona}} {{lastUserMessage}} …  from `fields`
                             (see FIELD), when the caller passes them

   Arguments are run before the macro that holds them, so
   {{setvar::r::{{roll::1d20}}}} stores the number rolled. Anything not
   listed is left exactly as written. Variables live in `vars`, a plain
   object the caller keeps per chat; it is changed in place. Global ones
   live in `globals`.
   shortcut: without `globals` the global variables are kept with the chat's; pass a store shared by every chat to make them global. */

const SEP = "::";

/* Index of the "}}" closing a macro whose body starts at `from`, counting
   macros nested inside it; -1 when it never closes. */
function closeOf(src, from) {
  let depth = 1;
  for (let i = from; i < src.length - 1; i++) {
    if (src[i] === "{" && src[i + 1] === "{") { depth++; i++; }
    else if (src[i] === "}" && src[i + 1] === "}") {
      if (--depth === 0) return i;
      i++;
    }
  }
  return -1;
}

/* `s` split on "::" outside nested macros. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("{{", i)) { depth++; i++; }
    else if (s.startsWith("}}", i)) { depth = Math.max(0, depth - 1); i++; }
    else if (depth === 0 && s.startsWith(SEP, i)) { out.push(s.slice(start, i)); start = i + SEP.length; i += SEP.length - 1; }
  }
  out.push(s.slice(start));
  return out;
}

/* 1d20, 2d6+3, d100, 20 */
export function rollDice(spec, random = Math.random) {
  const s = String(spec || "").replace(/\s+/g, "");
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?$/i) || s.match(/^()(\d+)([+-]\d+)?$/);
  if (!m) return "";
  const count = Math.min(100, Number(m[1] || 1));
  const sides = Number(m[2]);
  if (!sides) return "";
  let total = Number(m[3] || 0);
  for (let i = 0; i < count; i++) total += 1 + Math.floor(random() * sides);
  return String(total);
}

const TRIM = "\u0000trim\u0000";

function expand(src, ctx) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const j = src.indexOf("{{", i);
    if (j < 0) { out += src.slice(i); break; }
    out += src.slice(i, j);
    const k = closeOf(src, j + 2);
    /* a "{{" that never closes is text, and what follows is read on, as in SillyTavern */
    if (k < 0) { out += "{{"; i = j + 2; continue; }
    const raw = src.slice(j + 2, k);
    i = k + 2;
    if (raw.trimStart().startsWith("//")) continue;
    /* flags: # keeps a block's whitespace; ! ? ~ change nothing here, as in SillyTavern */
    const flags = raw.match(/^\s*([!?~#]*)\s*/);
    const body = flags[1] && !SHORTHAND.test(raw) ? raw.slice(flags[0].length) : raw;
    const keep = flags[1].includes("#");
    /* {{name …}}content{{/name}}: the content is the macro's last argument */
    const name = opensBlock(body);
    const close = name ? closing(src, i, name) : null;
    if (close) {
      const content = src.slice(i, close.at);
      i = close.after;
      out += name === "if" ? ifBlock(body, content, ctx, keep) : one(body, ctx, j, scoped(expand(content, ctx), keep));
      continue;
    }
    out += one(body, ctx, j);
  }
  return out;
}

/* ---------- blocks: {{name}}…{{/name}} ---------- */

const flagless = (body) => body.replace(/^\s*[!?~#]*\s*/, "");

/* How many arguments a macro takes, its block content included; one given
   them all already ({{setvar::x::1}}) opens no block, as in SillyTavern. */
const MAX_ARGS = { if: 2, setvar: 2, addvar: 2, setglobalvar: 2, addglobalvar: 2, setvarkey: 3, setvarindex: 3, reverse: 1, trim: 0, noop: 0, newline: 0, space: 0, user: 0, char: 0, else: 0 };

/* The name of the block {{body}} would open, or null. */
function opensBlock(body) {
  const m = flagless(body).match(/^([a-z_]+)(?:(::|:|\s+)([\s\S]*))?$/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const given = m[2] ? (name === "if" ? 1 : splitArgs(m[3]).length) : 0;
  return name in MAX_ARGS && given >= MAX_ARGS[name] ? null : name;
}

/* Each macro in src from `from` on, with how deep it sits in blocks named `name`. */
function* macrosIn(src, from, name) {
  const shut = new RegExp(`^/${name}\\s*$`, "i");
  let depth = 0;
  for (let i = src.indexOf("{{", from); i >= 0; i = src.indexOf("{{", i)) {
    const k = closeOf(src, i + 2);
    if (k < 0) return;
    const body = flagless(src.slice(i + 2, k));
    if (shut.test(body)) depth--;
    yield { body, at: i, after: k + 2, depth };
    if (opensBlock(body) === name) depth++;
    i = k + 2;
  }
}

/* The {{/name}} closing a block whose content starts at `from`. */
function closing(src, from, name) {
  for (const m of macrosIn(src, from, name)) if (m.depth < 0) return m;
  return null;
}

/* A block's content as SillyTavern passes it on: trimmed, and its common
   indentation removed, unless the # flag keeps it as written. */
function scoped(text, keep) {
  if (keep) return text;
  const lines = text.split("\n");
  const indent = (l) => l.match(/^[ \t]*/)[0].length;
  const base = indent(lines.find((l) => l.trim()) || "");
  return (base ? lines.map((l) => l.slice(Math.min(base, indent(l)))).join("\n") : text).trim();
}

const falsy = (v) => v === "" || ["off", "false", "0"].includes(String(v).trim().toLowerCase());

function ifBlock(open, content, ctx, keep) {
  let cond = open.replace(/^\s*if(?:::|:)?/i, "").trim();
  const inverted = cond.startsWith("!");
  if (inverted) cond = cond.slice(1).trim();
  cond = expand(cond, ctx);
  const shorthand = cond.match(/^([.$])([a-zA-Z](?:[\w-]*\w)?)$/);
  if (shorthand) cond = String(store(ctx, shorthand[1] === "$")[shorthand[2]] ?? "");
  else if (/^[a-z_]+$/i.test(cond)) {
    /* a macro named bare, as in {{if description}} */
    const r = one(cond, ctx, 0);
    if (r !== `{{${cond}}}`) cond = r;
  }
  const split = [...macrosIn(content, 0, "if")].find((m) => m.depth === 0 && /^else\s*$/i.test(m.body));
  const yes = split ? content.slice(0, split.at) : content;
  const no = split ? content.slice(split.after) : "";
  return scoped(expand(falsy(cond) !== inverted ? no : yes, ctx), keep);
}

/* ---------- the rest ---------- */

const store = (ctx, global) => (global ? ctx.globals || ctx.vars : ctx.vars);

/* {{name}} → the caller's `fields` key; SillyTavern's aliases included */
const FIELD = {
  description: "description", chardescription: "description",
  personality: "personality", charpersonality: "personality",
  scenario: "scenario", charscenario: "scenario",
  persona: "persona",
  mesexamples: "mesExamples", mesexamplesraw: "mesExamples",
  charprompt: "charPrompt", charinstruction: "charInstruction", charjailbreak: "charInstruction",
  creatornotes: "creatorNotes", charcreatornotes: "creatorNotes",
  charversion: "charVersion", char_version: "charVersion",
  greeting: "greeting", charfirstmessage: "greeting",
  lastmessage: "lastMessage", lastusermessage: "lastUserMessage", lastcharmessage: "lastCharMessage",
  model: "model", input: "input", summary: "summary",
};

/* FNV-1a, for {{pick}}: the same text at the same place picks the same */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pad = (n) => String(n).padStart(2, "0");

/* {{.x}}, {{$x = 5}}, {{.x++}} … as SillyTavern's variable shorthand does it */
function shorthand(m, ctx) {
  const [, sigil, key, op = "", raw] = m;
  const vars = store(ctx, sigil === "$");
  const value = () => expand(raw.trim(), ctx);
  const cur = vars[key];
  const n = (v) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : NaN);
  const cmp = (f) => { const a = n(cur), b = n(value()); return Number.isNaN(a) || Number.isNaN(b) ? "false" : String(f(a, b)); };
  switch (op) {
    case "": return String(cur ?? "");
    case "=": vars[key] = value(); return "";
    case "++": case "--": vars[key] = String((Number.isNaN(n(cur)) ? 0 : n(cur)) + (op === "++" ? 1 : -1)); return vars[key];
    case "+=": { const v = value(); vars[key] = !Number.isNaN(n(cur ?? 0)) && !Number.isNaN(n(v)) ? String(n(cur ?? 0) + n(v)) : `${cur ?? ""}${v}`; return ""; }
    case "-=": { const v = n(value()); if (!Number.isNaN(v)) vars[key] = String((Number.isNaN(n(cur)) ? 0 : n(cur)) - v); return ""; }
    case "||": return cur == null || falsy(cur) ? value() : String(cur);
    case "??": return key in vars ? String(cur) : value();
    case "||=": if (cur == null || falsy(cur)) { vars[key] = value(); return vars[key]; } return String(cur);
    case "??=": if (!(key in vars)) { vars[key] = value(); return vars[key]; } return String(cur);
    case "==": return String(String(cur ?? "") === value());
    case "!=": return String(String(cur ?? "") !== value());
    case ">": return cmp((a, b) => a > b);
    case ">=": return cmp((a, b) => a >= b);
    case "<": return cmp((a, b) => a < b);
    case "<=": return cmp((a, b) => a <= b);
    default: return "";
  }
}
const SHORTHAND = /^\s*([.$])([a-zA-Z](?:[\w-]*\w)?)\s*(\+\+|--|\+=|-=|\|\|=|\?\?=|\|\||\?\?|==|!=|>=|<=|>|<|=)?([\s\S]*)$/;

/* `block`: the content of {{name}}…{{/name}}, already run, as the last argument */
function one(body, ctx, at, block) {
  const sh = body.match(SHORTHAND);
  if (sh) return shorthand(sh, ctx);
  const m = body.match(/^\s*([a-z_]+)\s*(::|:|\s+)?([\s\S]*)$/i);
  if (!m) return `{{${expand(body, ctx)}}}`;
  let name = m[1].toLowerCase();
  const rest = block == null ? m[3] || "" : [m[3], block].filter(Boolean).join(SEP);
  const args = () => [...(m[3] || block == null ? splitArgs(m[3] || "").map((a) => expand(a, ctx)) : []), ...(block == null ? [] : [block])];
  /* the global forms work on `globals`, the same way */
  const global = /globalvar/.test(name);
  if (global) name = name.replace("global", "");
  const vars = store(ctx, global);
  const num = (v) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const field = FIELD[name];
  if (field && !m[2] && block == null) return ctx.fields ? expand(String(ctx.fields[field] ?? ""), ctx) : `{{${body}}}`;
  const now = ctx.now || new Date();
  switch (name) {
    case "trim": return TRIM;
    /* no world-info outlets in Nova: empty, as SillyTavern leaves one nothing fills */
    case "noop": case "else": case "outlet": return "";
    case "newline": return "\n";
    case "space": return " ";
    case "user": case "notchar": return m[2] ? `{{${body}}}` : ctx.user ?? `{{${body}}}`;
    case "char": case "group": case "charifnotgroup": return m[2] ? `{{${body}}}` : ctx.char ?? `{{${body}}}`;
    case "time": return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    case "date": return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    case "weekday": return now.toLocaleDateString("en-US", { weekday: "long" });
    case "isotime": return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    case "isodate": return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    case "reverse": return [...expand(rest, ctx)].reverse().join("");
    case "pick": {
      const raw = expand(rest, ctx);
      const opts = raw.includes(SEP) ? raw.split(SEP) : raw.split(",");
      return opts[hash(`${ctx.seed ?? ""}-${body}-${at}`) % opts.length].trim();
    }
    /* a key or index of a variable holding JSON (an object or a list) */
    case "getvarkey": case "getvarindex": {
      const [key, idx = ""] = args();
      const raw = vars[key.trim()];
      let v;
      try { v = JSON.parse(raw)?.[idx.trim()]; } catch { return raw == null ? "" : String(raw); }
      return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    case "setvarkey": case "setvarindex": {
      const [key, idx = "", ...v] = args();
      const k = key.trim(), at = idx.trim();
      try {
        const obj = JSON.parse(vars[k] ?? "null") ?? (Number.isNaN(Number(at)) ? {} : []);
        obj[at] = v.join(SEP);
        vars[k] = JSON.stringify(obj);
      } catch { /* not JSON: left as it is, as in SillyTavern */ }
      return "";
    }
    case "hasvar": case "varexists": return String(args()[0].trim() in vars);
    case "deletevar": case "flushvar": delete vars[args()[0].trim()]; return "";
    case "setvar": {
      const [key, ...v] = args();
      if (key.trim()) vars[key.trim()] = v.join(SEP);
      return "";
    }
    case "getvar": {
      const [key, ...fallback] = args();
      const v = vars[key.trim()];
      return v == null || v === "" ? fallback.join(SEP) : String(v);
    }
    case "addvar": {
      const [key, ...v] = args();
      const k = key.trim();
      if (!k) return "";
      const add = v.join(SEP);
      const a = num(vars[k] ?? 0);
      const b = num(add);
      vars[k] = a != null && b != null ? String(a + b) : `${vars[k] ?? ""}${add}`;
      return "";
    }
    case "incvar":
    case "decvar": {
      const k = args()[0].trim();
      if (!k) return "";
      vars[k] = String((num(vars[k]) ?? 0) + (name === "incvar" ? 1 : -1));
      return vars[k];
    }
    case "roll": return rollDice(expand(rest, ctx), ctx.random);
    case "random": {
      const raw = expand(rest, ctx);
      const opts = raw.includes(SEP) ? raw.split(SEP) : raw.split(",");
      return opts.length ? opts[Math.floor(ctx.random() * opts.length)].trim() : "";
    }
    default:
      return `{{${expand(body, ctx)}}}`;
  }
}

export function runMacros(text, { vars = {}, globals, user, char, fields, seed, now, random = Math.random } = {}) {
  const s = String(text ?? "");
  if (!s.includes("{{")) return s;
  return expand(s, { vars, globals, user, char, fields, seed, now, random }).replace(/(?:\r?\n)*\u0000trim\u0000(?:\r?\n)*/g, "");
}

/* Author's notes out, everything else untouched: what an import keeps, so
   the saved prompt is the part the model reads and the macros that still
   have work to do. */
export function stripComments(text) {
  const src = String(text ?? "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const j = src.indexOf("{{", i);
    if (j < 0) { out += src.slice(i); break; }
    const k = closeOf(src, j + 2);
    /* a "{{" that never closes is text, and what follows is read on */
    if (k < 0) { out += src.slice(i, j + 2); i = j + 2; continue; }
    const body = src.slice(j + 2, k);
    out += src.slice(i, j);
    if (!body.trimStart().startsWith("//")) out += src.slice(j, k + 2);
    i = k + 2;
  }
  return out;
}
