import { uid } from "./util.js";
import { estTokens } from "./window.js";

/* ---------- lorebooks ----------

   Entries of world knowledge — a place, a faction, a spell, a person — that
   are sent only when the conversation is about them. An entry has keywords;
   when one turns up in the last few messages, its text goes into the prompt.

   WHY THIS IS CACHE-FRIENDLY

   The old lorebook (the one dropped from Nova earlier) spliced matched
   entries into the middle of the system prompt. The provider caches the
   longest prefix it has seen, so every turn where the set of matches changed
   reprocessed the whole prompt — the character, the style, and the entire
   conversation — on exactly the busiest turns.

   Now there are two places an entry can go, and neither moves the prefix:

     always-on entries   in the system block, after the cards. They change
                         only when you edit the book, so the block is the
                         same bytes turn after turn.
     keyword entries     at the very end, riding on your latest message next
                         to the scene notes and the reply-style line. That
                         part is rebuilt every turn anyway and is never in
                         the cache, so a match costs only its own tokens.

   Matches are listed in a fixed order (book, then entry order), so the same
   set of matches always produces the same text.

   Shapes:
     book  = { id, name, description, entries: [entry] }
     entry = { id, comment, keys: [], secondaryKeys: [], content,
               enabled, constant, selective, logic, caseSensitive, order }

   `selective` means a keyword alone is not decisive: the secondary keys are
   checked too, as `logic` says (SillyTavern's selective logic, below).
   `order` decides who wins when the budget runs out — higher goes first —
   and where an entry sits in the list, lower first.

   SillyTavern's finer controls ride on the entry under its own names, and an
   entry without them behaves as it always did:
     probability, useProbability   chance in % to go out when triggered
     sticky, cooldown, delay       timed effects, in messages (selectLore)
     group, groupOverride, groupWeight, useGroupScoring
                                   inclusion groups: one winner per group
     excludeRecursion, preventRecursion, delayUntilRecursion
                                   recursive scan (Settings, off by default)
     scanDepth, matchWholeWords    per-entry overrides; null follows the book */

export const DEFAULT_SCAN_DEPTH = 4;

/* How the secondary keys count, by SillyTavern's numbering (selectiveLogic)
   so files round-trip:
     and_any  at least one of them appears too        0
     not_all  not every one of them appears           1
     not_any  none of them appears                    2
     and_all  every one of them appears too           3 */
export const LORE_LOGIC = ["and_any", "not_all", "not_any", "and_all"];
const logicOf = (v) => (LORE_LOGIC.includes(v) ? v : LORE_LOGIC[Number(v)] || "and_any");
export const DEFAULT_LORE_BUDGET = 800;

const toList = (v) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((k) => String(k ?? "").trim())
    .filter(Boolean);

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

export function newEntry(patch = {}) {
  return {
    id: uid(), comment: "", keys: [], secondaryKeys: [], content: "",
    enabled: true, constant: false, selective: false, logic: "and_any", caseSensitive: false, order: 100,
    ...patch,
  };
}

export function newBook(patch = {}) {
  return { id: uid(), name: "", description: "", entries: [], ...patch };
}

/* One entry from any of the shapes in circulation: Nova's own, a card's
   character_book (V2/V3), or a SillyTavern World Info file. */
export function entryFrom(e) {
  if (!e || typeof e !== "object") return null;
  const keys = toList(e.keys ?? e.key);
  const secondaryKeys = toList(e.secondaryKeys ?? e.secondary_keys ?? e.keysecondary);
  const content = String(e.content ?? "").trim();
  if (!content && !keys.length) return null;
  /* a World Info file says `sticky`, a card's book `extensions.sticky` */
  const x = e.extensions && typeof e.extensions === "object" ? e.extensions : {};
  const pick = (name, ext) => e[name] ?? x[ext];
  const orNull = (v) => (v === true || v === false ? v : null);
  const dur = pick("delayUntilRecursion", "delay_until_recursion");
  return newEntry({
    imported: e.imported || { ...e },
    comment: String(e.comment || e.name || e.title || "").trim(),
    keys,
    secondaryKeys,
    content,
    enabled: e.enabled !== undefined ? e.enabled !== false : e.disable !== true,
    constant: !!e.constant,
    selective: !!e.selective && secondaryKeys.length > 0,
    logic: logicOf(e.logic ?? e.selectiveLogic ?? x.selectiveLogic),
    caseSensitive: !!(e.caseSensitive ?? e.case_sensitive ?? x.case_sensitive),
    order: num(e.order ?? e.insertion_order ?? e.priority, 100),
    probability: num(pick("probability", "probability"), 100),
    useProbability: pick("useProbability", "useProbability") !== false,
    sticky: num(pick("sticky", "sticky"), 0),
    cooldown: num(pick("cooldown", "cooldown"), 0),
    delay: num(pick("delay", "delay"), 0),
    group: String(pick("group", "group") || ""),
    groupOverride: !!pick("groupOverride", "group_override"),
    groupWeight: num(pick("groupWeight", "group_weight"), 100),
    useGroupScoring: orNull(pick("useGroupScoring", "use_group_scoring")),
    excludeRecursion: !!pick("excludeRecursion", "exclude_recursion"),
    preventRecursion: !!pick("preventRecursion", "prevent_recursion"),
    delayUntilRecursion: dur === true ? 1 : num(dur, 0),
    scanDepth: num(pick("scanDepth", "scan_depth"), null),
    matchWholeWords: orNull(pick("matchWholeWords", "match_whole_words")),
  });
}

/* The SillyTavern fields above, back under the names each format uses. */
const stFields = (e) => ({
  probability: e.probability ?? 100,
  useProbability: e.useProbability !== false,
  sticky: e.sticky || 0,
  cooldown: e.cooldown || 0,
  delay: e.delay || 0,
  group: e.group || "",
  groupOverride: !!e.groupOverride,
  groupWeight: e.groupWeight ?? 100,
  useGroupScoring: e.useGroupScoring ?? null,
  excludeRecursion: !!e.excludeRecursion,
  preventRecursion: !!e.preventRecursion,
  delayUntilRecursion: e.delayUntilRecursion || 0,
  scanDepth: e.scanDepth ?? null,
  matchWholeWords: e.matchWholeWords ?? null,
});
const cardExtNames = {
  groupOverride: "group_override", groupWeight: "group_weight", useGroupScoring: "use_group_scoring",
  excludeRecursion: "exclude_recursion", preventRecursion: "prevent_recursion",
  delayUntilRecursion: "delay_until_recursion", scanDepth: "scan_depth", matchWholeWords: "match_whole_words",
};

/* A whole book from any of those shapes. `entries` may be an array (cards,
   Nova) or an object keyed by uid (SillyTavern World Info). Null when there
   is nothing usable in it. */
export function bookFrom(raw, fallbackName = "Lorebook") {
  if (!raw || typeof raw !== "object") return null;
  const src = raw.data && typeof raw.data === "object" && raw.data.entries ? raw.data : raw;
  const list = Array.isArray(src.entries) ? src.entries : src.entries && typeof src.entries === "object" ? Object.values(src.entries) : [];
  const entries = list.map(entryFrom).filter(Boolean);
  if (!entries.length) return null;
  return newBook({
    name: String(src.name || "").trim() || fallbackName,
    description: String(src.description || "").trim(),
    entries,
  });
}

/* Parse an imported file's text. Throws with a readable message. */
export function parseLorebook(text, fallbackName) {
  let json;
  try { json = JSON.parse(String(text || "").replace(/^﻿/, "")); }
  catch { throw new Error("That file is not JSON."); }
  /* a whole character card with a book inside it counts too */
  const inner = json?.data?.character_book || json?.character_book || json;
  const book = bookFrom(inner, fallbackName);
  if (!book) throw new Error("No lorebook entries found in that file.");
  return book;
}

/* For a card: the V2 character_book shape. */
export function toCharacterBook(book) {
  if (!book?.entries?.length) return undefined;
  return {
    name: book.name || "",
    description: book.description || "",
    extensions: {},
    entries: book.entries.map((e, i) => ({
      id: i,
      keys: e.keys,
      secondary_keys: e.secondaryKeys,
      comment: e.comment,
      content: e.content,
      enabled: e.enabled !== false,
      constant: !!e.constant,
      selective: !!e.selective,
      case_sensitive: !!e.caseSensitive,
      insertion_order: e.order ?? 100,
      extensions: {
        ...(e.imported?.extensions || {}),
        selectiveLogic: LORE_LOGIC.indexOf(logicOf(e.logic)),
        case_sensitive: !!e.caseSensitive,
        ...Object.fromEntries(Object.entries(stFields(e)).map(([k, v]) => [cardExtNames[k] || k, v])),
      },
    })),
  };
}

/* For a file: SillyTavern's World Info shape, which every frontend reads. */
export function toWorldInfo(book) {
  const entries = {};
  (book?.entries || []).forEach((e, i) => {
    entries[i] = {
      ...(e.imported || {}),
      uid: i,
      key: e.keys,
      keysecondary: e.secondaryKeys,
      comment: e.comment,
      content: e.content,
      constant: !!e.constant,
      selective: !!e.selective,
      selectiveLogic: LORE_LOGIC.indexOf(logicOf(e.logic)),
      order: e.order ?? 100,
      position: 0,
      disable: e.enabled === false,
      caseSensitive: !!e.caseSensitive,
      ...stFields(e),
    };
  });
  return { name: book?.name || "", description: book?.description || "", entries };
}

/* ---------- matching ---------- */

/* "/pattern/flags" is a regular expression. Anything else matches as a
   whole word when it is made of letters and digits ("Vale" does not fire on
   "valley"), and as plain text otherwise ("St. Mary's"). An entry whose
   matchWholeWords is false matches every key as plain text. */
export function keyMatches(key, text, caseSensitive, plain = false) {
  return matcherOf(key, caseSensitive, plain)(scanOf(text));
}

/* The text being scanned, lowercased at most once however many keys are
   looked for in it. */
const scanOf = (text) => ({
  text,
  _lower: null,
  get lower() {
    if (this._lower === null) this._lower = text.toLowerCase();
    return this._lower;
  },
});

/* Each key compiled once: a lorebook is scanned every turn, and a long one
   has hundreds of keys. Keyed by the key and its case setting. */
const matchers = new Map();
const MATCHERS_MAX = 5000;

function matcherOf(key, caseSensitive, plain) {
  if (typeof key !== "string") return compileKey(key, caseSensitive, plain);
  const id = (caseSensitive ? "1" : "0") + (plain ? "p" : "w") + key;
  let m = matchers.get(id);
  if (!m) {
    if (matchers.size >= MATCHERS_MAX) matchers.clear();
    m = compileKey(key, caseSensitive, plain);
    matchers.set(id, m);
  }
  return m;
}

function compileKey(key, caseSensitive, plain) {
  const re = /^\/(.+)\/([a-z]*)$/i.exec(key);
  if (re) {
    const flags = !caseSensitive && !re[2].includes("i") ? `${re[2]}i` : re[2];
    let rx;
    try { rx = new RegExp(re[1], flags); }
    catch { return () => false; }
    /* a key written with /g or /y keeps a position between tests; start
       each one from the top, as a fresh pattern would */
    return (s) => {
      rx.lastIndex = 0;
      try { return rx.test(s.text); }
      catch { return false; }
    };
  }
  const k = caseSensitive ? key : key.toLowerCase();
  const textOf = caseSensitive ? (s) => s.text : (s) => s.lower;
  if (plain || !/^[\p{L}\p{N}][\p{L}\p{N}\s'-]*$/u.test(k)) return (s) => textOf(s).includes(k);
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u");
  return (s) => word.test(textOf(s));
}

export function triggered(e, text) {
  return triggeredIn(e, scanOf(text));
}

const hitsOf = (e, keys, scan) => keys.map((k) => matcherOf(k, e.caseSensitive, e.matchWholeWords === false)(scan));

function triggeredIn(e, scan) {
  if (!e.keys?.length) return false;
  if (!e.keys.some((k) => matcherOf(k, e.caseSensitive, e.matchWholeWords === false)(scan))) return false;
  if (!e.selective || !e.secondaryKeys?.length) return true;
  const hit = hitsOf(e, e.secondaryKeys, scan);
  switch (logicOf(e.logic)) {
    case "and_all": return hit.every(Boolean);
    case "not_any": return !hit.some(Boolean);
    case "not_all": return !hit.every(Boolean);
    default: return hit.some(Boolean);
  }
}

/* The text the keywords are looked for in: the last `depth` messages, not
   counting those hidden from the AI. */
export function scanText(history, depth = DEFAULT_SCAN_DEPTH) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < Math.max(1, depth); i--) {
    if (!history[i].hidden) out.push(history[i].content || "");
  }
  return out.reverse().join("\n");
}

/* Which entries go out this turn.

   Always-on entries come first and are not subject to the budget's
   ordering games: they are part of the fixed block. Keyword entries are then
   added by priority (higher order first) until the budget is spent, and
   returned in a stable reading order.

   The rest follows SillyTavern's checkWorldInfo:
     recursion   with `recursion` > 0, what went out is scanned too, for up
                 to that many more passes (excludeRecursion, preventRecursion
                 and delayUntilRecursion as there)
     chance      an entry with a probability under 100 goes out that often
     groups      of the entries sharing a group, one goes out: a sticky one,
                 else the top-scored, else the prioritized, else a weighted
                 roll
     timed       sticky, cooldown and delay, counted in messages; `timed` is
                 the chat's record and the next one comes back as `timed`,
                 for the caller to save

   The rolls are seeded by the point in the chat (`rng` is for tests), so the
   preview, a retry and a swipe from the same message all draw the same. */
/* While `fn` runs, the same books over the same history are selected once:
   the token breakdown asks for the selection and then builds the request,
   which asks again. Nothing is kept once it returns. */
let loreMemo = null;
export function withLoreMemo(fn) {
  const outer = loreMemo;
  loreMemo = outer || [];
  try { return fn(); }
  finally { loreMemo = outer; }
}

export function selectLore(books, history, { depth = DEFAULT_SCAN_DEPTH, budget = DEFAULT_LORE_BUDGET, recursion = 0, timed, rng = seededRoll } = {}) {
  const opts = { depth, budget, recursion: Number(recursion) || 0, timed, rng };
  if (!loreMemo) return selectFresh(books, history, opts);
  const same = (m) => m.books === books && m.history === history && Object.keys(opts).every((k) => m.opts[k] === opts[k]);
  const hit = loreMemo.find(same);
  if (hit) return hit.out;
  const out = selectFresh(books, history, opts);
  loreMemo.push({ books, history, opts, out });
  return out;
}

/* A number in [0, 1) that is always the same for the same seed. */
function seededRoll(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const chanceOf = (e) => (e.useProbability === false ? 100 : num(e.probability, 100));
const delayLevel = (e) => (e.delayUntilRecursion === true ? 1 : Number(e.delayUntilRecursion) || 0);
const groupsOf = (e) => String(e.group || "").split(",").map((g) => g.trim()).filter(Boolean);
/* An always-on entry that comes and goes rides with the keyword entries at
   the end, so the fixed block stays the same bytes turn after turn. */
const steady = (e) => chanceOf(e) >= 100 && !(e.sticky > 0) && !(e.cooldown > 0) && !(e.delay > 0) && !groupsOf(e).length;

/* SillyTavern's timed effects, in message counts:
   { sticky: { key: { start, end, protected } }, cooldown: { … } }.
   One started at this length or later belongs to a turn being redone (a
   retry, a swipe, deleted messages) and is dropped, so nothing counts twice.
   A sticky entry that runs out starts its cooldown. */
function timedNow(timed, len, byKey) {
  const next = { sticky: {}, cooldown: {} };
  for (const type of ["sticky", "cooldown"]) {
    for (const [k, v] of Object.entries(timed?.[type] || {})) {
      if (!v || typeof v !== "object" || next[type][k]) continue;
      if (len <= v.start && !v.protected) continue;
      const e = byKey.get(k);
      /* a book not in play now: kept until it would have run out */
      if (!e) { if (len < v.end) next[type][k] = v; continue; }
      if (!(e[type] > 0)) continue;
      if (len < v.end) next[type][k] = v;
      else if (type === "sticky" && e.cooldown > 0) next.cooldown[k] = { start: len, end: len + Number(e.cooldown), protected: true };
    }
  }
  return next;
}

/* How many of its keys an entry finds; secondary keys add to it under
   "any", and under "all" when all of them are there (SillyTavern's getScore). */
function scoreOf(e, scan) {
  if (!e.keys?.length) return 0;
  const p = hitsOf(e, e.keys, scan).filter(Boolean).length;
  const sk = e.secondaryKeys || [];
  if (!sk.length) return p;
  const s = hitsOf(e, sk, scan).filter(Boolean).length;
  const logic = logicOf(e.logic);
  return logic === "and_any" || (logic === "and_all" && s === sk.length) ? p + s : p;
}

/* Of the candidates sharing a group, keep one (filterByInclusionGroups). */
function inclusionGroups(now, kept, isSticky, score, roll) {
  const groups = new Map();
  for (const x of now) for (const g of groupsOf(x.e)) groups.set(g, [...(groups.get(g) || []), x]);
  if (!groups.size) return now;
  const out = new Set();
  const dropAllBut = (list, win) => list.forEach((x) => x !== win && out.add(x));
  for (const [g, list] of groups) {
    const stuck = list.filter(isSticky);
    if (stuck.length) { list.forEach((x) => stuck.includes(x) || out.add(x)); continue; }
    if (kept.some((x) => groupsOf(x.e).includes(g))) { dropAllBut(list, null); continue; }
    let live = list;
    if (list.some((x) => x.e.useGroupScoring)) {
      const scores = list.map(score);
      const top = Math.max(...scores);
      live = list.filter((x, i) => !x.e.useGroupScoring || scores[i] >= top);
      dropAllBut(list.filter((x) => !live.includes(x)), null);
    }
    if (live.length < 2) continue;
    let win = live.filter((x) => x.e.groupOverride).sort((a, b) => (b.e.order ?? 100) - (a.e.order ?? 100))[0];
    if (!win) {
      const weight = (x) => num(x.e.groupWeight, 100);
      let r = roll(`group:${g}`) * live.reduce((n, x) => n + weight(x), 0);
      win = live.find((x) => (r -= weight(x)) <= 0);
    }
    if (win) dropAllBut(live, win);
  }
  return now.filter((x) => !out.has(x));
}

function selectFresh(books, history, { depth, budget, recursion, timed, rng }) {
  const all = [];
  const byKey = new Map();
  (books || []).forEach((b, bi) =>
    (b?.entries || []).forEach((e, ei) => {
      if (!e || e.enabled === false || !String(e.content || "").trim()) return;
      const x = { e, bi, ei, key: `${b.id ?? bi}.${e.id ?? ei}` };
      all.push(x);
      byKey.set(x.key, e);
    })
  );
  const stable = (a, b) => (a.e.order ?? 100) - (b.e.order ?? 100) || a.bi - b.bi || a.ei - b.ei;
  const len = history.length;
  const seed = `${len}|${history.at(-1)?.id ?? ""}`;
  const roll = (s) => rng(`${seed}|${s}`);
  const next = timedNow(timed, len, byKey);
  const isSticky = (x) => !!next.sticky[x.key];

  const constant = all.filter((x) => x.e.constant && steady(x.e)).sort(stable);
  const seen = new Set(constant);
  let left = budget - constant.reduce((n, x) => n + estTokens(x.e.content), 0);
  const kept = [];
  /* what went out and may trigger more on the next pass */
  let fed = constant.filter((x) => !x.e.preventRecursion).map((x) => x.e.content);
  let recursed = "";
  const levels = [...new Set(all.map((x) => delayLevel(x.e)).filter(Boolean))].sort((a, b) => a - b);
  let level = levels.shift() || 0;

  for (let pass = 0; ; pass++) {
    const scans = new Map();
    const scanFor = (e) => {
      const d = num(e.scanDepth, depth);
      if (!scans.has(d)) scans.set(d, scanOf(d > 0 ? scanText(history, d) + recursed : ""));
      return scans.get(d);
    };
    const now = all.filter((x) => {
      if (seen.has(x)) return false;
      const e = x.e, stuck = isSticky(x);
      if (e.delay > 0 && len < e.delay) return false;
      if (next.cooldown[x.key] && !stuck) return false;
      if (!stuck && delayLevel(e) && (!pass || delayLevel(e) > level)) return false;
      if (!stuck && pass && e.excludeRecursion) return false;
      return e.constant || stuck || triggeredIn(e, scanFor(e));
    }).sort((a, b) => isSticky(b) - isSticky(a) || (b.e.order ?? 100) - (a.e.order ?? 100) || a.bi - b.bi || a.ei - b.ei);

    for (const x of inclusionGroups(now, kept, isSticky, (y) => scoreOf(y.e, scanFor(y.e)), roll)) {
      seen.add(x);
      const chance = chanceOf(x.e);
      if (chance < 100 && !isSticky(x) && roll(x.key) * 100 >= chance) continue;
      const cost = estTokens(x.e.content);
      if (cost > left) continue;
      left -= cost;
      kept.push(x);
      if (!x.e.preventRecursion) fed.push(x.e.content);
    }
    if (pass >= recursion) break;
    if (!fed.length) {
      if (!levels.length) break;
      level = levels.shift();
    }
    recursed += fed.map((t) => `\n${t}`).join("");
    fed = [];
  }

  for (const x of kept) {
    for (const type of ["sticky", "cooldown"]) {
      if (x.e[type] > 0 && !next[type][x.key]) next[type][x.key] = { start: len, end: len + Number(x.e[type]) };
    }
  }
  return {
    constant: constant.map((x) => x.e),
    triggered: kept.sort(stable).map((x) => x.e),
    timed: Object.keys(next.sticky).length || Object.keys(next.cooldown).length ? next : undefined,
  };
}

/* The books in play for a chat: those embedded in its cards (the host's,
   then each linked Scope member's, `ensemble`), then the ones attached to
   the chat, each once. */
export function chatBooks({ chat, character, ensemble, universe, lorebooks }) {
  const out = [];
  const seen = new Set();
  const add = (b) => {
    if (!b?.entries?.length) return;
    const key = b.id || b;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(b);
  };
  if (character) add(character.lorebook);
  /* an imported universe can carry a book of its own */
  if (universe) add(universe.lorebook);
  for (const c of ensemble || []) add(c.lorebook);
  for (const id of chat?.lorebookIds || []) add((lorebooks || []).find((b) => b.id === id));
  return out;
}

/* How an entry is labelled in lists: its title, or its first keys. */
export const entryLabel = (e) => e.comment?.trim() || e.keys?.slice(0, 3).join(", ") || "Untitled entry";
