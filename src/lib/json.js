/* ---------- reading a model's JSON answer (contract C1) ----------

   Models wrap JSON in prose, fences, <think> blocks, smart quotes and raw
   newlines, and they get cut off at the token cap. parseModelJson tries, in
   order:

     1. strip closed and unclosed <think|thinking|thought> blocks, and the
        <plan> block Card Studio asks for before the JSON (braces inside it
        are ignored; an unclosed one ends at the first line opening JSON);
     2. each fenced block, then the whole text;
     3. every balanced, string-aware block starting at a "{" (or "[");
     4. the block as is, then with control characters escaped inside strings;
     5. smart-quote and trailing-comma repair, outside strings only, then the
        old global repair as a last resort;
     6. salvage of a truncated reply: close the open brackets and keep the
        items that finished.

   It returns {value, truncated, repaired} or throws ModelJsonError. */

export class ModelJsonError extends SyntaxError {
  constructor(message, raw, reason) {
    super(message);
    this.name = "ModelJsonError";
    this.raw = raw;
    this.reason = reason;
  }
}

const MESSAGES = {
  empty: "The model returned nothing.",
  "no-json": "The model did not return usable JSON. Try again, or try a different model.",
  "not-object": "The reply is not a JSON object.",
  "not-array": "The reply is not a JSON array.",
  malformed: "The model's reply was malformed. Try again, or try a different model.",
};

const MAX_STARTS = 40;
const OPEN_QUOTES = new Set(["“", "”"]);

export function stripThinking(text) {
  const s = String(text ?? "");
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr && c === "<") {
      const tag = /^<(think|thinking|thought|plan)>/i.exec(s.slice(i));
      if (tag) {
        const close = s.toLowerCase().indexOf(`</${tag[1].toLowerCase()}>`, i + tag[0].length);
        if (close < 0) {
          /* an unclosed plan still has the answer after it: resume at the first line that opens the JSON */
          const resume = tag[1].toLowerCase() === "plan" ? s.slice(i + tag[0].length).search(/\n\s*[{[]/) : -1;
          if (resume < 0) break;
          i += tag[0].length + resume;
          continue;
        }
        i = close + tag[1].length + 2;
        continue;
      }
    }
    out += c;
    if (esc) esc = false;
    else if (inStr && c === "\\") esc = true;
    else if (c === '"') inStr = !inStr;
  }
  return out.trim();
}

function fencedBlocks(s) {
  const out = [];
  const re = /```[^\n`]*\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(s))) if (m[1].trim()) out.push(m[1].trim());
  return out;
}

function tryParse(s) {
  try { return { ok: true, value: JSON.parse(s) }; } catch { return { ok: false }; }
}

/** The first balanced block opening at `start`, string- and escape-aware, or "". */
function balancedAt(s, start) {
  const stack = [];
  let inStr = false, quote = "", esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (quote === '"' ? c === '"' : (c === '"' || OPEN_QUOTES.has(c))) inStr = false;
      continue;
    }
    if (c === '"' || OPEN_QUOTES.has(c)) { inStr = true; quote = c === '"' ? '"' : c; continue; }
    if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return "";
      if (!stack.length) return s.slice(start, i + 1);
    }
  }
  return "";
}

/** The first balanced {...} block, or "". */
export function firstObjectBlock(s) {
  const start = s.indexOf("{");
  return start < 0 ? "" : balancedAt(s, start);
}

/**
 * One pass that is only ever active outside or inside strings as appropriate: smart quotes that delimit become
 * ", real control characters inside strings are escaped, and trailing commas before } or ] are dropped.
 * Curly quotes that sit inside a "..." string are content and are left alone.
 */
export function repairOutsideStrings(s) {
  const out = [];
  let inStr = false, smart = false, esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) { esc = false; out.push(c); continue; }
      if (c === "\\") { esc = true; out.push(c); continue; }
      if (smart ? (c === '"' || OPEN_QUOTES.has(c)) : c === '"') { inStr = false; out.push('"'); continue; }
      if (c === "\n") out.push("\\n");
      else if (c === "\r") out.push("\\r");
      else if (c === "\t") out.push("\\t");
      else if (c < " ") { /* drop other control characters */ }
      else out.push(c);
      continue;
    }
    if (c === '"') { inStr = true; smart = false; out.push(c); continue; }
    if (OPEN_QUOTES.has(c)) { inStr = true; smart = true; out.push('"'); continue; }
    if (c === "}" || c === "]") {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      if (j >= 0 && out[j] === ",") out.splice(j, 1);
    }
    out.push(c);
  }
  return out.join("");
}

/* The old blunt repair, kept as the last resort: quotes everywhere, then trailing commas everywhere. */
function globalRepair(block) {
  return repairOutsideStrings(block.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"))
    .replace(/,\s*([}\]])/g, "$1");
}

/**
 * A reply cut off at the token cap has no balanced block. Keep everything up to the last complete value and
 * close the brackets still open. "" when nothing is usable. Expects text already through repairOutsideStrings.
 */
function truncatedBlock(s, start) {
  const stack = [];
  let inStr = false, esc = false, cut = -1, closers = "";
  // Only close the root and arrays: closing an unfinished object would invent a record.
  const safe = () => stack.every((c, i) => i === 0 || c === "]");
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") stack.push("}");
    else if (c === "[") {
      stack.push("]");
      if (safe()) { cut = i + 1; closers = [...stack].reverse().join(""); }
    }
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return "";
      if (stack.length && safe()) { cut = i + 1; closers = [...stack].reverse().join(""); }
    } else if (c === "," && safe()) {
      /* a finished item of the root or of an array; a comma inside a nested object would keep half a record */
      cut = i; closers = [...stack].reverse().join("");
    }
  }
  if (stack.length && !inStr && safe()) {
    const closed = s.slice(start) + [...stack].reverse().join("");
    if (tryParse(closed).ok) return closed;
  }
  if (!stack.length || cut < 0) return "";
  return s.slice(start, cut).replace(/,\s*$/, "") + closers;
}

function startsOf(s, open) {
  const out = [];
  for (let i = s.indexOf(open); i >= 0 && out.length < MAX_STARTS; i = s.indexOf(open, i + 1)) out.push(i);
  return out;
}

/* Strict-to-lenient reading of one balanced block. */
function readBlock(block) {
  const raw = tryParse(block);
  if (raw.ok) return { value: raw.value, repaired: false };
  const fixed = tryParse(repairOutsideStrings(block));
  if (fixed.ok) return { value: fixed.value, repaired: true };
  const global = tryParse(globalRepair(block));
  if (global.ok) return { value: global.value, repaired: true };
  return null;
}

const rootOk = (v, root) => root === "array" ? Array.isArray(v) : !!v && typeof v === "object" && !Array.isArray(v);

/**
 * @param {string} text
 * @param {{root?: "object"|"array"}} [opts]
 * @returns {{value: any, truncated: boolean, repaired: boolean}}
 * @throws {ModelJsonError}
 */
export function parseModelJson(text, { root = "object" } = {}) {
  const raw = String(text ?? "");
  const fail = (reason) => { throw new ModelJsonError(MESSAGES[reason], raw, reason); };
  const clean = stripThinking(raw);
  if (!clean) fail("empty");
  const open = root === "array" ? "[" : "{";

  const unchanged = tryParse(clean);
  if (unchanged.ok) {
    if (!rootOk(unchanged.value, root)) fail(root === "array" ? "not-array" : "not-object");
    return { value: unchanged.value, truncated: false, repaired: false };
  }
  const candidates = [...fencedBlocks(clean), clean];
  let wrongRoot = false;

  for (const cand of candidates) {
    const whole = readBlock(cand);
    if (whole) {
      if (rootOk(whole.value, root)) return { value: whole.value, truncated: false, repaired: whole.repaired };
      wrongRoot = true;
      continue;
    }
    for (const start of startsOf(cand, open)) {
      const block = balancedAt(cand, start);
      if (block) {
        const got = readBlock(block);
        if (got && rootOk(got.value, root)) return { value: got.value, truncated: false, repaired: got.repaired };
        continue;
      }
      /* Never closes: a reply cut off at the token cap. Taken here, before any later start, so the finished
         items inside it are not mistaken for the whole answer. */
      const cut = truncatedBlock(repairOutsideStrings(cand.slice(start)), 0);
      const got = cut && tryParse(cut);
      if (got && got.ok && rootOk(got.value, root)) return { value: got.value, truncated: true, repaired: true };
    }
  }

  if (wrongRoot) fail(root === "array" ? "not-array" : "not-object");
  fail(candidates.some((c) => c.includes(open)) ? "malformed" : "no-json");
}

/**
 * A one-shot "return only the corrected JSON" message for a caller whose first parse failed.
 * @param {string} raw the model's earlier reply
 * @returns {{system: string, user: string}}
 */
export function repairJsonRequest(raw) {
  const text = stripThinking(raw);
  return {
    system: "You repair broken JSON. Reply with the corrected JSON only: no prose, no code fences, no comments. Keep every value that is present; close anything left open; do not invent new content.",
    user: `This JSON is malformed or cut off. Return only the corrected JSON.\n\n${text}`,
  };
}
