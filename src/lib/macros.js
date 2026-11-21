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

   Arguments are run before the macro that holds them, so
   {{setvar::r::{{roll::1d20}}}} stores the number rolled. Anything not
   listed is left exactly as written. Variables live in `vars`, a plain
   object the caller keeps per chat; it is changed in place. */

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
    if (k < 0) { out += src.slice(j); break; }
    const body = src.slice(j + 2, k);
    if (!body.trimStart().startsWith("//")) out += one(body, ctx);
    i = k + 2;
  }
  return out;
}

function one(body, ctx) {
  const m = body.match(/^\s*([a-z_]+)\s*(::|:|\s+)?([\s\S]*)$/i);
  if (!m) return `{{${expand(body, ctx)}}}`;
  const name = m[1].toLowerCase();
  const rest = m[3] || "";
  const args = () => splitArgs(rest).map((a) => expand(a, ctx));
  const vars = ctx.vars;
  const num = (v) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  switch (name) {
    case "trim": return TRIM;
    case "noop": return "";
    case "newline": return "\n";
    case "user": return m[2] ? `{{${body}}}` : ctx.user ?? "{{user}}";
    case "char": return m[2] ? `{{${body}}}` : ctx.char ?? "{{char}}";
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

export function runMacros(text, { vars = {}, user, char, random = Math.random } = {}) {
  const s = String(text ?? "");
  if (!s.includes("{{")) return s;
  return expand(s, { vars, user, char, random }).replace(/(?:\r?\n)*\u0000trim\u0000(?:\r?\n)*/g, "");
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
    if (k < 0) { out += src.slice(i); break; }
    const body = src.slice(j + 2, k);
    out += src.slice(i, j);
    if (!body.trimStart().startsWith("//")) out += src.slice(j, k + 2);
    i = k + 2;
  }
  return out;
}
