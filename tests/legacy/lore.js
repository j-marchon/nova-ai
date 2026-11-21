import { uid } from "../../src/lib/util.js";
import { estTokens } from "../../src/lib/window.js";

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
   and where an entry sits in the list, lower first. */

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
  return newEntry({
    imported: e.imported || { ...e },
    comment: String(e.comment || e.name || e.title || "").trim(),
    keys,
    secondaryKeys,
    content,
    enabled: e.enabled !== undefined ? e.enabled !== false : e.disable !== true,
    constant: !!e.constant,
    selective: !!e.selective && secondaryKeys.length > 0,
    logic: logicOf(e.logic ?? e.selectiveLogic ?? e.extensions?.selectiveLogic),
    caseSensitive: !!(e.caseSensitive ?? e.case_sensitive),
    order: num(e.order ?? e.insertion_order ?? e.priority, 100),
  });
}

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
      extensions: { selectiveLogic: LORE_LOGIC.indexOf(logicOf(e.logic)) },
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
    };
  });
  return { name: book?.name || "", description: book?.description || "", entries };
}

/* ---------- matching ---------- */

/* "/pattern/flags" is a regular expression. Anything else matches as a
   whole word when it is made of letters and digits ("Vale" does not fire on
   "valley"), and as plain text otherwise ("St. Mary's"). */
export function keyMatches(key, text, caseSensitive) {
  const re = /^\/(.+)\/([a-z]*)$/i.exec(key);
  if (re) {
    const flags = !caseSensitive && !re[2].includes("i") ? `${re[2]}i` : re[2];
    try { return new RegExp(re[1], flags).test(text); }
    catch { return false; }
  }
  const k = caseSensitive ? key : key.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'-]*$/u.test(k)) return t.includes(k);
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(t);
}

export function triggered(e, text) {
  if (!e.keys?.length) return false;
  if (!e.keys.some((k) => keyMatches(k, text, e.caseSensitive))) return false;
  if (!e.selective || !e.secondaryKeys?.length) return true;
  const hit = e.secondaryKeys.map((k) => keyMatches(k, text, e.caseSensitive));
  switch (logicOf(e.logic)) {
    case "and_all": return hit.every(Boolean);
    case "not_any": return !hit.some(Boolean);
    case "not_all": return !hit.every(Boolean);
    default: return hit.some(Boolean);
  }
}

/* The text the keywords are looked for in: the last `depth` messages. */
export function scanText(history, depth = DEFAULT_SCAN_DEPTH) {
  return history.slice(-Math.max(1, depth)).map((m) => m.content || "").join("\n");
}

/* Which entries go out this turn.

   Always-on entries come first and are not subject to the budget's
   ordering games: they are part of the fixed block. Keyword entries are then
   added by priority (higher order first) until the budget is spent, and
   returned in a stable reading order. */
export function selectLore(books, history, { depth = DEFAULT_SCAN_DEPTH, budget = DEFAULT_LORE_BUDGET } = {}) {
  const all = [];
  (books || []).forEach((b, bi) =>
    (b?.entries || []).forEach((e, ei) => {
      if (e && e.enabled !== false && String(e.content || "").trim()) all.push({ e, bi, ei });
    })
  );
  const stable = (a, b) => (a.e.order ?? 100) - (b.e.order ?? 100) || a.bi - b.bi || a.ei - b.ei;

  const constant = all.filter((x) => x.e.constant).sort(stable);
  const text = scanText(history, depth);
  const hits = all.filter((x) => !x.e.constant && triggered(x.e, text));

  let left = budget - constant.reduce((n, x) => n + estTokens(x.e.content), 0);
  const kept = [];
  for (const x of [...hits].sort((a, b) => (b.e.order ?? 100) - (a.e.order ?? 100) || a.bi - b.bi || a.ei - b.ei)) {
    const cost = estTokens(x.e.content);
    if (cost > left) continue;
    left -= cost;
    kept.push(x);
  }
  return {
    constant: constant.map((x) => x.e),
    triggered: kept.sort(stable).map((x) => x.e),
  };
}

/* The books in play for a chat: those embedded in its cards, then the ones
   attached to the chat, each once. */
export function chatBooks({ chat, character, members, lorebooks }) {
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
  for (const c of members || []) add(c.lorebook);
  for (const id of chat?.lorebookIds || []) add((lorebooks || []).find((b) => b.id === id));
  return out;
}

/* How an entry is labelled in lists: its title, or its first keys. */
export const entryLabel = (e) => e.comment?.trim() || e.keys?.slice(0, 3).join(", ") || "Untitled entry";
