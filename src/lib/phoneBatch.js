import { completeText } from "./api.js";
import { ROOT_ANCHOR, cleanAnchor, isRootAnchor } from "./anchor.js";
import { parseModelJson } from "./json.js";
import {
  BALANCE_BANDS, NPC_CAP, POST_CAP, REPLIES_PER_POST, STORY_CAP, TEXT_LIMITS, THREAD_LINES, TOPIC_CAP, TRAIT_EXTRA_CAP, TRAIT_KEYS, TRAIT_MAX, WEALTH_MEANING, YOU,
  TX_CATEGORIES, cleanHandle, closenessOf, isCloser, officialTier, planDm, threadState, threadStreak, cleanTraits, emptyHandset, normalizeHandset, parseCount, phoneAccounts, receive, repliesAfter, setMe, slug, traitsOf, transfer, visiblePhone,
} from "./phone.js";
import { LEGACY_REPLY_MINUTES, SKIP_MINUTES, STORY_MINUTES, ageUnits, clockNowOf, clockOf, lastWtOf, legacyMinutes, phoneGapOf, spanLabel, syncMessagesOf, timeLabel } from "./phoneClock.js";
import { applyEvent, birthStats, clampModelNumber, newPot, ownPostPot, ownReplySlots, responseChance, rng, statsOf } from "./phoneStats.js";
import { scopeOf } from "./scope.js";

/* ---------- the phone's model requests ----------

   Two requests feed the phone:

   - profile: once per account, the traits that matter on social media
     (fame, looks, job, hobby, body and a few others), read from the cards
     and the story; stored on the account and fed into every batch as
     [Profile]. A manual trait is never overwritten.
   - batch: one builder, phoneBatch({ mode }), for seed | setup | refresh |
     more | respond | replies | world (a refresh with `sync` is a Sync to
     chat: it also carries the story since the phone was last synced and
     asks how long it took, "elapsed"). One prompt, one JSON format; the
     modes differ in budget and closing instruction. parseBatch reads the answer leniently, mergeBatch
     folds it into the handset (pure; the caller runs it inside update()).

   Requests go through the activity store: runProfile/runPhoneBatch take an
   injected `requester`, and activityRequester() makes the real one on top of
   completeText (which registers the job). Nothing here touches app data. */

/* ---------- small helpers ---------- */

const isRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const clean = (x, max) => str(x).replace(/\s+/g, " ").trim().slice(0, max).trim();
const cut = (t, max) => { const s = str(t).replace(/\s+/g, " ").trim(); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
const listOf = (v) => (Array.isArray(v) ? v.filter(isRecord) : []);
const fameOf = (x) => { const n = typeof x === "string" ? Number(x.trim()) : x; return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : null; };
const asHandset = (h) => normalizeHandset(h) || emptyHandset("off");
const capLines = (lines, max) => {
  const out = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > max) break;
    out.push(l);
    used += l.length + 1;
  }
  return out.join("\n");
};

export const FAME_MEANING = ["private person", "locally known", "public figure", "star"];
/* Plausible follower counts by tier, for a number the model writes. */
export const FOLLOWER_BANDS = [[0, 1500], [300, 30000], [10000, 3000000], [300000, 300000000]];

/* ---------- budgets (output tokens; counts are targets) ---------- */

/* setup: the seed for a chat already under way (the phone switched on
   later); it uses the seed's budget and adds to what is there */
/* world: a time skip (a day, a week, a month) across the world */
export const BATCH_MODES = ["seed", "refresh", "more", "respond", "replies", "setup", "world"];
export const SKIP_SPANS = ["day", "week", "month"];
/* `thread`: replies asked for under the top posts (up to `per` each under the
   `top` first ones); `replies`: how many a "replies" request asks for */
export const BUDGETS = Object.freeze({
  off: { seed: { maxTokens: 700, posts: 5, stories: 2, dms: 1, thread: { per: 2, top: 2 } }, refresh: null, more: { maxTokens: 600, posts: 4, stories: 0, dms: 0 }, respond: { maxTokens: 300, slots: 3 }, replies: { maxTokens: 400, replies: 3 } },
  light: { seed: { maxTokens: 900, posts: 6, stories: 3, dms: 2, thread: { per: 3, top: 2 } }, refresh: { maxTokens: 500, posts: 3, stories: 0, dms: 1, thread: { per: 3, top: 2 } }, more: { maxTokens: 700, posts: 5, stories: 0, dms: 0 }, respond: { maxTokens: 400, slots: 4 }, replies: { maxTokens: 400, replies: 3 } },
  lively: { seed: { maxTokens: 1600, posts: 10, stories: 5, dms: 3, thread: { per: 5, top: 3 } }, refresh: { maxTokens: 900, posts: 5, stories: 2, dms: 2, thread: { per: 5, top: 3 } }, more: { maxTokens: 1200, posts: 8, stories: 0, dms: 0 }, respond: { maxTokens: 600, slots: 6 }, replies: { maxTokens: 600, replies: 5 } },
});
/* a Sync to chat: at most this many of the story's messages, newest kept,
   and room for that many more output tokens when it carries over 6 */
export const SYNC_MESSAGES = 16;
export const SYNC_CHARS = 4000;
export const SYNC_EXTRA_TOKENS = 300;
export const PROFILE_MAX_TOKENS = 700;

/* The budget for a level and mode; a refresh asked for on Off (a manual one)
   uses Light's. Always { maxTokens, posts, stories, dms, slots }. */
export function budgetOf(level, mode) {
  const lv = BUDGETS[level] ? level : "off";
  /* setup: the seed's; world (time skip): the seed's, or the refresh's on Off */
  const m = mode === "setup" ? "seed" : mode === "world" ? (lv === "off" ? "refresh" : "seed") : BATCH_MODES.includes(mode) ? mode : "refresh";
  const b = BUDGETS[lv][m] || BUDGETS.light[m];
  return { posts: 0, stories: 0, dms: 0, slots: BUDGETS[lv].respond.slots, ...b };
}

/* ---------- the story's people ---------- */

/* Every story character with its key, handle, card text and whether it is
   in the scene now: what profile and batch requests take as `characters`.
   Host and linked cards are in the scene; others when named in the last 4
   messages. Once an hour or more has passed on the phone since the last
   story message, nobody is in that scene any more. */
export function storyPeople({ chat, character, ensemble = [], universe, handset, userName = "You", messages } = {}) {
  const acc = phoneAccounts({ chat, character, ensemble, universe, userName, handset });
  const msgs = Array.isArray(messages) ? messages : chat?.messages || [];
  const gap = phoneGapOf(asHandset(handset ?? chat?.handset), msgs);
  const moved = gap !== null && gap >= 60;
  const recent = msgs.slice(-4).map((m) => `${m?.speaker || ""} ${m?.content || ""}`).join(" ").toLowerCase();
  const cards = new Map();
  const cardText = (c) => [c?.description, c?.personality && `Personality: ${c.personality}`, c?.scenario && `Scenario: ${c.scenario}`].filter((x) => typeof x === "string" && x.trim()).join("\n");
  if (universe) for (const c of universe.characters || []) cards.set(`uni:${c.id || slug(c.name)}`, { card: cardText(c), tagline: c.tagline });
  if (character) cards.set(`char:${character.id}`, { card: cardText(character), tagline: character.tagline, host: true });
  for (const c of ensemble || []) if (c?.id) cards.set(`char:${c.id}`, { card: cardText(c), tagline: c.tagline, host: true });
  for (const m of scopeOf(chat).cast) if (!m.characterId && m.id) cards.set(`cast:${m.id}`, { card: str(m.description) });
  return acc.list.filter((p) => p.story).map((p) => {
    const c = cards.get(p.key) || {};
    const first = p.name.split(/\s+/)[0].toLowerCase();
    return {
      key: p.key, name: p.name, handle: p.handle, role: p.role || "",
      card: c.card || p.role || "", ...(c.tagline ? { tagline: c.tagline } : {}),
      present: !moved && (!!c.host || (first.length > 1 && recent.includes(first))),
    };
  });
}

/* ---------- profiles ---------- */

const traitName = (k) => str(k).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 24);
const profiled = (rec) => {
  const from = rec?.traitsFrom || {};
  return Object.keys(from).some((k) => k !== "fame" || from[k] !== "inferred");
};

/* Keys (YOU first) that have no profile yet. */
export function profileKeys(handset, characters = []) {
  const h = asHandset(handset);
  const out = [];
  if (!profiled(h.me)) out.push(YOU);
  for (const c of characters) if (c?.key && !profiled(h.people[c.key])) out.push(c.key);
  return out;
}

const PROFILE_SYSTEM =
  "You read character descriptions from a roleplay story and write the facts that would shape each person's social-media presence.\n" +
  "For every listed key return: fame (0 private person, 1 locally known, 2 public figure, 3 star), wealth (0 modest, 1 comfortable, 2 wealthy, 3 very rich), looks, job, hobby, body (physical state: health, build, injuries, pregnancy, age if notable), and in \"other\" up to 12 short fields that matter online (e.g. relationship, city, age, style, reputation, fandom). Each value at most 8 words.\n" +
  "Facts stated in the text are \"stated\". Anything not stated, infer from what is there and mark it \"inferred\". Never invent a famous career for someone the text shows as ordinary.\n" +
  "Reply with ONE JSON object and nothing else, no code fence:\n" +
  '{"accounts":[{"key":"","fame":0,"wealth":0,"looks":"","job":"","hobby":"","body":"","other":{"field":"value"},"from":{"fame":"inferred","wealth":"inferred","job":"stated"}}]}\n' +
  "Use exactly the keys given. Leave out a field you cannot say anything about.";

/* The profile prompt: { system, user }. `characters`: storyPeople(). Only
   `keys` are asked for (default: all of them). */
export function profilePrompt({ persona, userName, characters = [], story = "", keys } = {}) {
  const u = userName || persona?.name || "You";
  const want = new Set(keys || [YOU, ...characters.map((c) => c.key)]);
  const parts = [];
  if (story) parts.push(`[Story]\n${cut(story, 800)}`);
  if (want.has(YOU)) {
    const card = [persona?.tagline && `Tagline: ${persona.tagline}`, persona?.description].filter(Boolean).join("\n");
    parts.push(`[key: ${YOU}] ${u} (the phone's owner)\n${cut(card, 1500) || "No description."}`);
  }
  const chars = characters.filter((c) => want.has(c.key)).slice(0, 8);
  const each = chars.length > 4 ? 500 : 800;
  for (const c of chars) {
    const card = [c.tagline && `Tagline: ${c.tagline}`, c.card].filter(Boolean).join("\n");
    parts.push(`[key: ${c.key}] ${c.name}\n${cut(card, each) || "No description."}`);
  }
  parts.push(`Return the profile for every key: ${[...want].filter((k) => k === YOU || chars.some((c) => c.key === k)).join(", ")}.`);
  return { system: PROFILE_SYSTEM, user: parts.join("\n\n") };
}

export function profileRequest(opts = {}) {
  return { ...profilePrompt(opts), maxTokens: PROFILE_MAX_TOKENS };
}

/* One account's traits from the answer: { key, traits, from }. */
function readProfile(x, keyHint) {
  if (!isRecord(x)) return null;
  const key = str(x.key ?? x.id ?? keyHint).trim();
  if (!key) return null;
  const raw = {};
  const fame = fameOf(x.fame);
  if (fame !== null) raw.fame = fame;
  const wealth = fameOf(x.wealth ?? x.money);
  if (wealth !== null) raw.wealth = wealth;
  for (const k of TRAIT_KEYS) { const v = clean(x[k], TRAIT_MAX); if (v) raw[k] = v; }
  let extra = 0;
  const other = isRecord(x.other) ? x.other : isRecord(x.traits) ? x.traits : {};
  for (const [k0, v0] of Object.entries(other)) {
    const k = traitName(k0);
    const v = clean(v0, TRAIT_MAX);
    if (!k || !v || k === "fame" || k === "wealth" || TRAIT_KEYS.includes(k) || raw[k] || extra >= TRAIT_EXTRA_CAP) continue;
    raw[k] = v;
    extra++;
  }
  const traits = cleanTraits(raw);
  if (fame === null) delete traits.fame;
  if (wealth === null) delete traits.wealth;
  const fromIn = isRecord(x.from) ? x.from : isRecord(x.traitsFrom) ? x.traitsFrom : {};
  const fromNorm = {};
  for (const [k, v] of Object.entries(fromIn)) fromNorm[traitName(k)] = v;
  const from = {};
  for (const k of Object.keys(traits)) from[k] = fromNorm[k] === "stated" ? "stated" : "inferred";
  return Object.keys(traits).length ? { key, traits, from } : null;
}

/* The profile answer: { accounts: [{ key, traits, from }] }, or null when
   there is no JSON object. Also takes { "<key>": {...} } and "profiles". */
export function parseProfile(text) {
  let value;
  try { value = isRecord(text) ? text : parseModelJson(text).value; } catch { return null; }
  if (!isRecord(value)) return null;
  const list = Array.isArray(value.accounts) ? value.accounts : Array.isArray(value.profiles) ? value.profiles : null;
  const out = [];
  if (list) for (const x of list) { const p = readProfile(x); if (p) out.push(p); }
  else for (const [k, x] of Object.entries(value)) { const p = readProfile(x, k); if (p) out.push(p); }
  return { accounts: out };
}

/* A person added or changed, through the handset normalizer (phone.js has
   no person writer). `fields` merge over the stored person. */
export function upsertPerson(handset, key, fields = {}) {
  const h = asHandset(handset);
  if (!/^(char|cast|uni|npc):./.test(key || "")) return h;
  const cur = h.people[key] || {};
  const merged = { ...cur, ...fields, key };
  if (!cleanHandle(merged.handle)) merged.handle = slug(merged.name || key.replace(/^\w+:/, ""));
  const out = normalizeHandset({ ...h, people: { ...h.people, [key]: merged } });
  return out || h;
}

/* Profile traits merged into a handset. Manual fields stay; `characters`
   (storyPeople) give a new account its handle and name. */
export function mergeProfile(handset, parsed, { characters = [] } = {}) {
  let h = asHandset(handset);
  const byKey = new Map(characters.map((c) => [c.key, c]));
  for (const p of parsed?.accounts || []) {
    if (p.key === YOU) {
      const manual = h.me.traitsFrom || {};
      const pick = (src) => {
        const t = {};
        for (const [k, v] of Object.entries(p.traits)) if (p.from[k] === src && manual[k] !== "manual") t[k] = v;
        return t;
      };
      for (const src of ["stated", "inferred"]) {
        const t = pick(src);
        if (Object.keys(t).length) h = setMe(h, { traits: t, from: src });
      }
      continue;
    }
    const c = byKey.get(p.key);
    const cur = h.people[p.key];
    if (!cur && !c) continue;
    const from = { ...(cur?.traitsFrom || {}) };
    const traits = { ...(cur ? traitsOf(cur) : {}) };
    for (const [k, v] of Object.entries(p.traits)) {
      if (from[k] === "manual") continue;
      traits[k] = v;
      from[k] = p.from[k];
    }
    h = upsertPerson(h, p.key, {
      ...(cur ? {} : { handle: c.handle || slug(c.name), name: c.name }),
      traits, fame: traits.fame, traitsFrom: from,
    });
  }
  return h;
}

/* ---------- reading a batch ---------- */

const POST_ALIASES = ["posts", "feed", "murmur", "tweets", "glimpse", "photos"];
const pickFirst = (x, keys) => { for (const k of keys) if (x[k] !== undefined && x[k] !== null && x[k] !== "") return x[k]; return undefined; };
const idOf = (v) => str(v).trim().replace(/^#/, "");

function readPost(x, depth = 0) {
  if (!isRecord(x)) return null;
  const out = {
    id: idOf(x.id),
    by: str(pickFirst(x, ["by", "author", "user", "from", "handle"])).trim(),
    text: str(pickFirst(x, ["text", "caption", "content", "body"])),
    photo: str(pickFirst(x, ["photo", "picture", "image"])),
    replyTo: idOf(pickFirst(x, ["replyTo", "reply_to", "on", "parent"])),
    quote: idOf(x.quote ?? x.quotes),
    repost: idOf(x.repost ?? x.reposts),
    story: idOf(x.story ?? x.aboutStory ?? x.onStory),
    slot: str(x.slot).trim(),
  };
  if (x.heat !== undefined) out.heat = x.heat;
  if (x.ago !== undefined) out.ago = x.ago;
  const kids = Array.isArray(x.replies) ? x.replies : Array.isArray(x.comments) ? x.comments : [];
  out.replies = depth < 3 ? kids.map((k) => readPost(k, depth + 1)).filter(Boolean) : [];
  return out;
}

/* A batch answer as plain lists with canonical keys (aliases folded), or
   null when there is no JSON object at all. Accepts an object already parsed.
   Never throws; a cut-off answer keeps its finished items. */
export function parseBatch(text) {
  let value;
  if (isRecord(text)) value = text;
  else {
    try { value = parseModelJson(text).value; } catch { return null; }
  }
  if (!isRecord(value)) return null;
  const posts = [];
  for (const k of POST_ALIASES) for (const x of listOf(value[k])) { const p = readPost(x); if (p) posts.push(p); }
  /* top-level "comments": replies with their own target */
  for (const x of listOf(value.comments)) { const p = readPost(x); if (p) posts.push(p); }
  const stories = listOf(value.stories).map((x) => ({
    id: idOf(x.id),
    by: str(pickFirst(x, ["by", "author", "user", "from", "handle"])).trim(),
    text: str(pickFirst(x, ["text", "caption", "content"])),
    photo: str(pickFirst(x, ["photo", "picture", "image"])),
    heat: x.heat,
    ...(x.ago !== undefined ? { ago: x.ago } : {}),
    replies: (Array.isArray(x.replies) ? x.replies : Array.isArray(x.comments) ? x.comments : []).map((k) => readPost(k, 1)).filter(Boolean),
  }));
  const dms = [...listOf(value.dms), ...listOf(value.messages)].map((x) => ({
    from: str(pickFirst(x, ["from", "by", "author", "user", "handle"])).trim(),
    text: str(pickFirst(x, ["text", "content", "message"])),
    slot: str(x.slot).trim(),
    ...(x.end === true || x.end === "true" ? { end: true } : {}),
    ...(x.ago !== undefined ? { ago: x.ago } : {}),
  }));
  const accounts = [...listOf(value.accounts), ...listOf(value.people), ...listOf(value.users)].map((x) => ({
    handle: str(pickFirst(x, ["handle", "user", "username"])).trim(),
    name: str(x.name).trim(),
    bio: str(x.bio),
    fame: fameOf(x.fame),
    verified: x.verified === true || x.verified === "true",
    role: str(x.role),
    ...(x.followers !== undefined ? { followers: x.followers } : {}),
  }));
  const events = listOf(value.events).map((x) => ({
    post: idOf(x.post), what: str(x.what ?? x.event).trim().toLowerCase(),
    account: str(x.account).trim(), ...(x.followers !== undefined ? { followers: x.followers } : {}),
  }));
  const topics = (Array.isArray(value.topics) ? value.topics : []).map((t) => clean(isRecord(t) ? t.text ?? t.topic : t, 140)).filter(Boolean);
  const me = isRecord(value.me) ? { fame: fameOf(value.me.fame), followers: value.me.followers } : null;
  const payments = [...listOf(value.payments), ...listOf(value.transactions), ...listOf(value.bank)].map((x) => ({
    from: str(pickFirst(x, ["from", "payer", "by"])).trim(),
    to: str(pickFirst(x, ["to", "payee"])).trim(),
    amount: x.amount,
    note: str(pickFirst(x, ["note", "what", "memo", "text"])),
    category: str(pickFirst(x, ["category", "kind", "type"])).trim().toLowerCase(),
  }));
  /* a time skip's answer: the new time and what changed */
  const time = clean(pickFirst(value, ["time", "now", "date"]), 120);
  const summary = clean(pickFirst(value, ["summary", "happened", "meanwhile"]), 400);
  /* a Sync to chat's answer: the story minutes the synced messages took */
  const elapsed = elapsedOf(value.elapsed);
  return { me, accounts, posts, stories, dms, events, topics, payments, ...(time ? { time } : {}), ...(summary ? { summary } : {}), ...(elapsed !== null ? { elapsed } : {}) };
}

/* "elapsed": a finite number, or a string that starts with one; else null */
function elapsedOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/* What the UI shows while a seed streams: the finished items of a partial
   answer (an empty batch when nothing is readable yet). */
export function previewBatch(partialText) {
  return parseBatch(partialText) || { me: null, accounts: [], posts: [], stories: [], dms: [], events: [], topics: [], payments: [] };
}

/* A streamed answer read item by item: `push(fullSoFar)` returns the batch
   made of the items that are complete so far (each list's finished
   objects, in the order written: a post shows only once its closing brace,
   nested replies included, has arrived), or null when nothing new finished
   since the last call. Incremental: each call scans only the new text. */
export function streamPreview() {
  let pos = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let started = false;
  let cut = -1;
  let shown = -1;
  let source = "";
  return (full) => {
    const text = str(full);
    if (!text.startsWith(source.slice(0, Math.min(source.length, text.length)))) { pos = 0; depth = 0; inStr = false; esc = false; started = false; cut = -1; shown = -1; }
    source = text;
    for (; pos < text.length; pos++) {
      const ch = text[pos];
      if (!started) { if (ch === "{") { started = true; depth = 1; } continue; }
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        /* an item of a top-level list (or a top-level object) just closed */
        if (ch === "}" && depth <= 2 && depth >= 1) cut = pos;
      }
    }
    if (cut <= shown) return null;
    shown = cut;
    const start = text.indexOf("{");
    return parseBatch(text.slice(start, cut + 1)) || null;
  };
}

/* ---------- who wrote it ---------- */

/* Handle/name to key: known accounts first ("Mara Vol" = @Mara_Vol =
   mara_vol), YOU for the persona, else a new npc key. */
export function accountResolver(handset, { accounts, characters = [], userName = "You" } = {}) {
  const h = asHandset(handset);
  const handles = new Map();
  const names = new Map();
  const add = (key, handle, name) => {
    if (!key) return;
    const ch = cleanHandle(handle);
    if (ch && !handles.has(ch)) handles.set(ch, key);
    if (name) { const s = slug(name); if (!names.has(s)) names.set(s, key); }
  };
  for (const c of characters) add(c.key, c.handle, c.name);
  for (const p of accounts?.list || []) add(p.key, p.handle, p.name);
  for (const p of Object.values(h.people)) add(p.key, p.handle, p.name);
  const you = new Set([YOU, slug(userName), cleanHandle(userName)].filter(Boolean));
  const first = slug(String(userName).split(/\s+/)[0] || "");
  return (raw) => {
    const s = str(raw).trim().replace(/^@+/, "").trim();
    if (!s) return { key: null };
    if (s === YOU || /^(char|cast|uni|npc):./.test(s)) {
      if (s === YOU) return { key: YOU };
      if (h.people[s] || characters.some((c) => c.key === s) || accounts?.list?.some((p) => p.key === s)) return { key: s };
    }
    const ch = cleanHandle(s);
    const sl = slug(s);
    if (you.has(ch) || you.has(sl)) return { key: YOU };
    const known = (ch && handles.get(ch)) || handles.get(sl) || names.get(sl) || (accounts?.keyOf?.(ch || sl) ?? null);
    if (known === YOU) return { key: YOU };
    if (known) return { key: known };
    /* a bare first name of the persona ("Ana" for "Ana Reyes") with no other match */
    if (first.length > 2 && sl === first && !names.has(sl)) return { key: YOU };
    const handle = ch || sl;
    return { key: `npc:${handle}`, handle, name: /\s/.test(s) || /[A-Z]/.test(s) ? s.slice(0, 60) : handle, fresh: true };
  };
}

/* ---------- merging a batch ---------- */

const HEAT_WORDS = { low: 0.6, quiet: 0.6, normal: 1, medium: 1, high: 2, hot: 2.2, viral: 3 };
const heatOf = (v) => (typeof v === "string" && HEAT_WORDS[v.trim().toLowerCase()] !== undefined ? HEAT_WORDS[v.trim().toLowerCase()] : Number.isFinite(Number(v)) ? Number(v) : undefined);
/* minutes old: 12, "15m", "2h", "3d", "2w", "just now"; at most a month */
const AGO_MAX = 43200;
/* how far back a seed or setup may place what is on the phone: 3 days */
export const SEED_WINDOW = 4320;
function agoOf(v) {
  if (Number.isFinite(v)) return Math.max(0, Math.min(AGO_MAX, Math.round(v)));
  const m = str(v).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|months?)?(?:\s*ago)?$/);
  if (!m) return 0;
  const u = m[2] || "m";
  const unit = u.startsWith("mo") ? 43200 : u[0] === "w" ? 10080 : u[0] === "d" ? 1440 : u[0] === "h" ? 60 : 1;
  return Math.max(0, Math.min(AGO_MAX, Math.round(Number(m[1]) * unit)));
}

function bump(list, id, field) {
  return list.map((p) => (p.id !== id ? p : {
    ...p,
    stats: { ...p.stats, [field]: (p.stats?.[field] || 0) + 1 },
    pot: { ...p.pot, [field]: Math.max((p.stats?.[field] || 0) + 1, (p.pot?.[field] || 0) + 1) },
  }));
}

/* A batch answer folded into the handset; pure, for update()'s functional
   updater. Options:
     mode        seed | refresh | more | respond (seed: anchored at ROOT_ANCHOR)
     anchor      the message the batch ran after (ignored for seed)
     accounts    phoneAccounts() result; characters: storyPeople(); userName
     messages    the chat's messages (ages for events)
     owed        the slots the request was built with (owedSlots)
     answered    ids of the persona's items the request answered; anything
                 the persona did while it ran stays pending
     post        replies mode: the post id every item answers
     now         time stamp for payments (default Date.now())
     clockNow    the phone's in-world minute for this batch (phoneClock.js;
                 default: the handset's clock now, phoneJob passes the
                 advanced one)
     window      minutes this batch covers: refresh, respond and world items
                 go up inside it (default: since the clock's last check);
                 seed and setup reach back SEED_WINDOW, more goes older
                 than the oldest post shown
   Bad items are dropped singly; anything by the persona is dropped. A new
   post starts at a visible share of its pot (birthStats), t0 its age now.
   Every new item gets `at` (clockNow - ago); items stored before the clock
   get theirs here from the old reply clock. New posts keep the model's
   order (newest first), their "ago" made monotone so the order shown while
   streaming is the order stored. */
export function mergeBatch(handset, parsed, { mode = "refresh", anchor, accounts, characters = [], userName = "You", messages = [], owed = [], answered, post: postId, now, clockNow, window } = {}) {
  const h0 = asHandset(handset);
  const nowMin = Number.isFinite(clockNow) ? clockNow : clockNowOf(h0, messages);
  const win = mode === "seed" || mode === "setup" ? SEED_WINDOW : mode === "more" ? AGO_MAX
    : Math.min(AGO_MAX, Math.max(0, Number.isFinite(window) ? window : nowMin - clockOf(h0).last));
  /* items stored before the clock: their `at` from the old reply clock */
  const legacyAt = (x) => (Number.isFinite(x.at) ? x : { ...x, at: Math.round(nowMin - legacyMinutes(x, messages)) });
  const lineAt = (m) => (Number.isFinite(m.at) ? m : { ...m, at: Math.round(nowMin - (repliesAfter(m.anchor, messages) ?? 0) * LEGACY_REPLY_MINUTES) });
  const h = { ...h0, posts: h0.posts.map(legacyAt), stories: h0.stories.map(legacyAt), threads: Object.fromEntries(Object.entries(h0.threads).map(([k, l]) => [k, l.map(lineAt)])) };
  /* an item's age now in statsOf units */
  const ageNow = (x) => (Number.isFinite(x.at) ? Math.max(0, nowMin - x.at) / LEGACY_REPLY_MINUTES : ageUnits(x, null, messages));
  const p = parseBatch(parsed) || parseBatch({});
  const onlyReplies = mode === "replies";
  const at = mode === "seed" || mode === "setup" ? ROOT_ANCHOR : cleanAnchor(anchor);
  if (!at) return h0;
  const n = h.tick.n + 1;
  const resolve = accountResolver(h, { accounts, characters, userName });
  const people = { ...h.people };
  let npcs = Object.keys(people).filter((k) => k.startsWith("npc:")).length;
  const charByKey = new Map(characters.map((c) => [c.key, c]));
  const slots = new Map((owed || []).map((s) => [s.id, s]));
  const filled = new Set();
  const strict = mode === "respond" && h.level !== "lively";

  /* the key for a raw handle, adding the account; null drops the item */
  const author = (raw, info = {}) => {
    const r = resolve(raw);
    if (!r.key || r.key === YOU) return null;
    if (!people[r.key]) {
      if (r.fresh) {
        if (npcs >= NPC_CAP) return null;
        npcs++;
      }
      const c = charByKey.get(r.key);
      const handle = r.handle || c?.handle || accounts?.handleOf?.(r.key) || slug(c?.name || r.key.replace(/^\w+:/, ""));
      const name = clean(info.name, 60) || r.name || c?.name || accounts?.nameOf?.(r.key) || handle;
      const person = { key: r.key, handle, name };
      if (info.bio) person.bio = info.bio;
      /* fame on the person too: newPot reads it before the handset is
         normalised; an official account (outlet, league, club, verified) is
         at least a public figure */
      const floor = officialTier({ role: info.role, name, handle, bio: info.bio, verified: info.verified });
      const fame = Math.max(info.fame ?? 0, floor);
      if ((info.fame !== null && info.fame !== undefined) || floor) { person.fame = fame; person.traits = { fame }; person.traitsFrom = { fame: "inferred" }; }
      if (info.verified) person.verified = true;
      if (info.role) person.role = info.role;
      if (info.followers !== undefined) {
        const f = clampModelNumber(info.followers, FOLLOWER_BANDS[fame]);
        if (f !== null) person.followers = f;
      }
      people[r.key] = person;
    }
    return r.key;
  };
  const fameOfKey = (key) => traitsOf(people[key] || {}).fame;

  /* new accounts first, so their fame shapes their posts' counts */
  for (const a of p.accounts) {
    if (!a.handle && !a.name) continue;
    const r = resolve(a.handle || a.name);
    if (!r.key || r.key === YOU || people[r.key]) continue;
    author(a.handle || a.name, { name: a.name, bio: clean(a.bio, 160), fame: a.fame, verified: a.verified, role: clean(a.role, 40), followers: a.followers });
  }

  let posts = h.posts;
  const fresh = [];
  const temp = new Map();
  let i = 0;
  const newId = (c) => `${c}${n.toString(36)}_${(i++).toString(36)}`;
  const findPost = (raw) => {
    const id = idOf(raw);
    if (!id) return null;
    const real = temp.get(id) || id;
    return fresh.find((q) => q.id === real) || posts.find((q) => q.id === real) || null;
  };
  const rootOf = (raw) => {
    let t = findPost(raw);
    for (let k = 0; t && (t.kind === "reply" || t.kind === "repost") && k < 4; k++) t = findPost(t.ref);
    return t && t.kind !== "reply" && t.kind !== "repost" ? t : null;
  };
  const bumpAll = (id, field) => { posts = bump(posts, id, field); const b = bump(fresh, id, field); fresh.splice(0, fresh.length, ...b); };
  const repliesTo = (id) => posts.filter((q) => q.kind === "reply" && q.ref === id).length + fresh.filter((q) => q.kind === "reply" && q.ref === id).length;
  const repeat = (by, text, kind) => text && [...posts, ...fresh].some((q) => q.by === by && q.text === text && q.kind === kind);
  const personaTarget = (t) => !!t && t.by === YOU;
  let topCount = 0;
  const topMax = Math.max(4, budgetOf(h.level, mode).posts * 2);
  /* stories first, so posts and comments can point at them; an account's
     story starts at a share of its likes (fame band) */
  const newStories = [];
  const storyTemp = new Map();
  for (const st of p.stories) {
    if (strict || onlyReplies) break;
    const by = author(st.by);
    const text = clean(st.text, TEXT_LIMITS.post);
    const photo = clean(st.photo, TEXT_LIMITS.photo);
    if (!by || (!text && !photo)) continue;
    const id = newId("s");
    if (st.id) storyTemp.set(st.id, id);
    const heat = heatOf(st.heat);
    const potLikes = newPot({ id, tick: n }, traitsOf(people[by] || {}), heat !== undefined ? { heat } : {}).likes;
    const likes = birthStats({ likes: potLikes }).likes;
    newStories.push({ id, by, text, ...(photo ? { photo } : {}), stats: { likes, replies: 0 }, pot: { likes: Math.max(likes, potLikes) }, tick: n, anchor: at, at: Math.round(nowMin - Math.min(agoOf(st.ago), win, STORY_MINUTES - 60)), _replies: st.replies || [] });
  }
  let stories = [...newStories, ...h.stories];
  const findStory = (raw) => {
    const id = idOf(raw);
    if (!id) return null;
    const real = storyTemp.get(id) || id;
    return stories.find((x) => x.id === real) || null;
  };
  const replyTarget = onlyReplies ? rootOf(postId) : null;
  if (onlyReplies && !replyTarget) return h0;
  let replyCount = 0;
  const replyMax = onlyReplies ? budgetOf(h.level, "replies").replies * 2 : Infinity;

  const place = (x, parentId) => {
    const slot = x.slot && slots.get(x.slot);
    const by = author(x.by || (slot && slot.by && (accounts?.handleOf?.(slot.by) || people[slot.by]?.handle || charByKey.get(slot.by)?.handle)) || "");
    if (!by) return;
    const text = clean(x.text, TEXT_LIMITS.post);
    const photo = clean(x.photo, TEXT_LIMITS.photo);
    let kind = "post";
    let target = null;
    const replyRaw = onlyReplies ? replyTarget.id : parentId || x.replyTo || (slot && !x.quote && !x.repost ? slot.to : "");
    if (onlyReplies) {
      target = rootOf(replyRaw);
      if (!target || replyCount >= replyMax || repliesTo(target.id) >= REPLIES_PER_POST) return;
      kind = "reply";
    } else if (x.repost && !text && !photo) {
      target = findPost(x.repost);
      if (!target || target.kind === "repost") return;
      kind = "repost";
    } else if (replyRaw && (target = rootOf(replyRaw))) {
      kind = "reply";
      if (repliesTo(target.id) >= REPLIES_PER_POST) return;
    } else if (replyRaw && (target = findStory(replyRaw))) {
      /* a comment on a story */
      kind = "reply";
      if (repliesTo(target.id) >= REPLIES_PER_POST) return;
    } else if (x.quote && (target = findPost(x.quote)) && target.kind !== "repost") {
      kind = "quote";
    } else if (x.story && (target = findStory(x.story))) {
      /* a post about a story: kind post, ref the story */
      kind = "post";
    } else target = null;
    if (kind !== "repost" && !text && !photo) return;
    if (repeat(by, text, kind)) return;
    if (strict && !(slot || personaTarget(target) || personaTarget(replyRaw && findPost(replyRaw)))) return;
    if (kind !== "reply") {
      if (topCount >= topMax) return;
      topCount++;
    } else if (onlyReplies) replyCount++;
    const id = newId(kind === "reply" ? "c" : "p");
    if (x.id) temp.set(x.id, id);
    const item = { id, by, text, kind };
    if (target) item.ref = target.id;
    if (photo) item.photo = photo;
    item.tick = n;
    const heat = heatOf(x.heat);
    item.pot = newPot(item, traitsOf(people[by] || {}), heat !== undefined ? { heat } : {});
    /* first numbers: a share of the pot, replies too (the count follows the
       stats; the stored replies are only the ones written out). A reply
       has no replies of its own (threads are flat) */
    if (kind === "reply") item.pot = { ...item.pot, replies: 0 };
    item.stats = birthStats(item.pot);
    /* raw minutes old; `at` and t0 come below, once the batch is in */
    item.ago = agoOf(x.ago);
    item.anchor = at;
    fresh.push(item);
    /* a quote or repost adds one to its target; a stored reply does not
       (the reply count already follows the stats, never below the stored) */
    if (target && (kind === "quote" || kind === "repost") && !stories.includes(target)) bumpAll(target.id, kind === "quote" ? "quotes" : "reposts");
    if (slot) filled.add(slot.id);
    for (const k of x.replies || []) place(k, id);
  };
  for (const st of newStories) {
    for (const k of st._replies) { try { place(k, st.id); } catch { /* skip */ } }
  }
  stories = stories.map(({ _replies: _r, ...st }) => st).slice(0, STORY_CAP);
  for (const x of p.posts) {
    try { place(x); } catch { /* one bad item never drops the batch */ }
  }
  /* in the model's order (newest first): top-level posts' "ago" made
     monotone (never newer than the one before) inside the batch's window;
     a reply goes up between its parent and now */
  const tops = posts.filter((q) => q.kind !== "reply" && Number.isFinite(q.at));
  const oldest = tops.length ? Math.min(...tops.map((q) => q.at)) : nowMin;
  const atOf = (id) => (fresh.find((q) => q.id === id) || posts.find((q) => q.id === id) || stories.find((q) => q.id === id))?.at;
  const kids = new Map();
  let prevAgo = 0;
  let rank = 0;
  for (const q of fresh) {
    if (q.kind === "reply") {
      const pa = atOf(q.ref);
      const base = Number.isFinite(pa) ? Math.min(pa, nowMin) : nowMin - win;
      const k = kids.get(q.ref) || 0;
      kids.set(q.ref, k + 1);
      const want = q.ago > 0 ? nowMin - q.ago : base + ((nowMin - base) * (k + 1)) / (k + 2);
      q.at = Math.round(Math.max(base, Math.min(nowMin, want)));
    } else {
      const ago = Math.max(Math.min(q.ago, win), prevAgo);
      prevAgo = ago;
      q.at = mode === "more" ? Math.min(nowMin - ago, oldest - ++rank) : Math.round(nowMin - ago);
    }
    q.ago = Math.max(0, nowMin - q.at);
    q.t0 = q.ago / LEGACY_REPLY_MINUTES;
  }
  posts = (mode === "more" ? [...posts, ...fresh] : [...fresh, ...posts]).slice(0, POST_CAP);


  /* messages */
  const threads = { ...h.threads };
  const wait = { ...h.dmWait };
  const doneDm = answered ? new Set(answered) : null;
  /* owed DMs the model left empty on purpose ("text":""): nothing comes */
  const silent = new Set();
  let reopened = 0;
  const isDmSlot = (s) => !!s && (s.kind === "dm" || s.kind === "transfer");
  const slotFor = (slot, key) => (slot && !filled.has(slot.id) && isDmSlot(slot) ? slot : null) || (owed || []).find((s) => isDmSlot(s) && s.by === key && !filled.has(s.id) && !silent.has(s.id));
  for (const d of onlyReplies ? [] : p.dms) {
    const slot = d.slot && slots.get(d.slot);
    const text = clean(d.text, TEXT_LIMITS.dm);
    if (!text) {
      const s = slotFor(slot, slot?.by || resolve(d.from).key);
      if (s) silent.add(s.id);
      continue;
    }
    const slotHandle = slot?.by ? (accounts?.handleOf?.(slot.by) || people[slot.by]?.handle || charByKey.get(slot.by)?.handle) : "";
    /* an owed slot's answer is its person's, even under a handle nobody has */
    const named = d.from ? resolve(d.from) : null;
    let from;
    if (isDmSlot(slot) && slot.by && slot.by !== YOU && (!named?.key || named.fresh)) {
      from = slot.by;
      if (!people[from]) { const handle = cleanHandle(slotHandle) || slug(String(from).replace(/^\w+:/, "")); people[from] = { key: from, handle, name: charByKey.get(from)?.name || accounts?.nameOf?.(from) || handle }; }
    } else from = author(d.from || slotHandle);
    if (!from) continue;
    const dmSlot = slotFor(slot, from);
    if (strict && !dmSlot) continue;
    /* etiquette: in a thread that already has lines, a DM comes only through
       an owed slot (the answer the clock reached, a "left on read" nudge, a
       transfer's reaction): one per slot, so never a second message in the
       same batch. Only an empty thread can be opened freely; a closed one
       (it ended, nobody owes anybody) reopens on a refresh or a time skip
       six hours or more later, one a batch. */
    const list = threads[from] || [];
    const lastAt = list.length ? list.at(-1).at : null;
    if (list.length && !dmSlot) {
      const state = threadState({ threads, dmWait: wait }, from, nowMin);
      const owesThem = state.last.from !== YOU && !state.last.end && !isCloser(state.last.text);
      const ok = (mode === "refresh" || mode === "world") && state.closed && !owesThem && !(wait[from] && wait[from].due !== null)
        && Number.isFinite(lastAt) && nowMin - lastAt >= 360 && reopened++ === 0;
      if (!ok) continue;
    }
    if (dmSlot) filled.add(dmSlot.id);
    /* an answer goes before what the persona wrote while it was being
       written (lines the request did not answer): those stay owed, a new
       streak with its own wait */
    let cut = list.length;
    if (dmSlot && doneDm) { const k = list.findIndex((m) => m.from === YOU && !doneDm.has(m.id)); if (k >= 0) cut = k; }
    const head = list.slice(0, cut);
    const tail = list.slice(cut);
    const prevAt = head.length ? head.at(-1).at : null;
    const want = dmSlot ? Math.min(nowMin, Number.isFinite(dmSlot.dueAt) ? dmSlot.dueAt : nowMin) : nowMin - Math.min(agoOf(d.ago), win);
    let lineAt = Number.isFinite(prevAt) ? Math.max(prevAt, want) : want;
    if (tail.length && Number.isFinite(tail[0].at)) lineAt = Math.min(lineAt, tail[0].at);
    const line = { id: newId("d"), from, text, tick: n, anchor: at, at: Math.round(lineAt), ...(d.end || isCloser(text) ? { end: true } : {}) };
    threads[from] = [...head, line, ...tail].slice(-THREAD_LINES);
    if (tail.length) wait[from] = planDm({ me: h.me, people }, from, tail[0], threads[from]);
    else delete wait[from];
  }

  /* world events */
  for (const e of onlyReplies ? [] : p.events) {
    try {
      if (e.post && ["viral", "ratio", "fades"].includes(e.what)) {
        const post = posts.find((q) => q.id === (temp.get(e.post) || e.post));
        if (!post) continue;
        const age = ageNow(post);
        const next = applyEvent(post, e.what, { author: post.by === YOU ? traitsOf(h.me) : traitsOf(people[post.by] || {}), age });
        posts = posts.map((q) => (q.id === post.id ? next : q));
      } else if (e.account && e.followers !== undefined) {
        const r = resolve(e.account);
        if (!r.key || r.key === YOU || !people[r.key]) continue;
        const v = parseCount(e.followers);
        if (v === null) continue;
        const rel = /^\s*[+-]/.test(str(e.followers));
        const band = FOLLOWER_BANDS[fameOfKey(r.key)];
        const f = clampModelNumber((rel ? people[r.key].followers || 0 : 0) + v, band);
        if (f !== null) people[r.key] = { ...people[r.key], followers: f };
      }
    } catch { /* skip */ }
  }

  /* the persona's standing: the seed may set it, unless a profile or the owner did */
  let me = h.me;
  if ((mode === "seed" || mode === "setup") && p.me) {
    const fromFame = h.me.traitsFrom?.fame;
    const fame = p.me.fame !== null && p.me.fame !== undefined && !fromFame ? p.me.fame : traitsOf(h.me).fame;
    const followers = !h.me.followers && p.me.followers !== undefined ? clampModelNumber(p.me.followers, FOLLOWER_BANDS[fame]) : null;
    if (fame !== traitsOf(h.me).fame || followers !== null) {
      me = setMe(h, { ...(fame !== traitsOf(h.me).fame ? { fame } : {}), ...(followers !== null ? { followers } : {}), from: "inferred" }).me;
    }
  }

  const topics = p.topics.length && !strict && !onlyReplies ? p.topics.slice(0, TOPIC_CAP) : h.world.topics;

  /* money the story moves (wages, bills, refunds, wires): only to or from
     the persona; payers and payees not on the phone stay names */
  let money = { ...h, people, me };
  if (!strict && !onlyReplies && (h.level !== "off" || mode === "world")) {
    const party = (raw) => {
      const r = resolve(raw);
      if (!r.key) return null;
      if (r.key === YOU) return { key: YOU };
      if (people[r.key] || charByKey.has(r.key)) return { key: r.key, name: people[r.key]?.name || charByKey.get(r.key)?.name };
      return { key: "", name: clean(raw, 60) };
    };
    const ceiling = BALANCE_BANDS[traitsOf(me).wealth][1];
    const t = Number.isFinite(now) ? now : Date.now();
    let made = 0;
    for (const x of p.payments || []) {
      if (made >= 3) break;
      try {
        const from = party(x.from);
        const to = party(x.to);
        const amount = parseCount(x.amount);
        if (!from || !to || amount === null || amount <= 0 || (from.key === YOU) === (to.key === YOU)) continue;
        const note = clean(x.note, 140);
        const category = TX_CATEGORIES.includes(x.category) ? x.category : "other";
        const before = money;
        if (to.key === YOU) money = receive(money, { from: from.key, fromName: from.name, amount: Math.min(amount, ceiling), note, t, world: true, category, anchor: at, at: Math.round(nowMin) });
        else money = transfer(money, { to: to.key, toName: to.name, amount, note, t, world: true, category, anchor: at, at: Math.round(nowMin) });
        if (money !== before) made++;
      } catch { /* skip */ }
    }
  }
  /* the batch's tick: payments it made belong to it */
  const bank = { ...money.bank, tx: money.bank.tx.map((x) => (x.world && x.tick > n ? { ...x, tick: n } : x)) };

  /* the persona's own items come alive with the batch that answers them: a
     pot from the persona's fame and followers, the first share shown now
     (they stayed at zero until this refresh). Seed, setup, more and replies
     leave them. */
  const activates = mode === "refresh" || mode === "respond";
  const doneSet = answered ? new Set(answered) : null;
  const wakes = (x) => activates && x.by === YOU && x.tick > h.tick.n && x.tick <= n && (!doneSet || doneSet.has(x.id));
  const meT = traitsOf(me);
  posts = posts.map((q) => {
    if (!wakes(q) || q.kind === "repost") return q;
    const own = ownPostPot(meT, me.followers, `${q.id}:own`);
    const scale = q.kind === "reply" ? 0.3 : 1;
    const pot = { likes: Math.round(own.likes * scale), reposts: Math.round(own.reposts * scale), replies: q.kind === "reply" ? q.pot.replies : Math.max(q.pot.replies, own.replies), quotes: Math.round(own.quotes * scale) };
    for (const k of ["likes", "reposts", "quotes", "replies"]) pot[k] = Math.max(pot[k], q.stats[k]);
    const stats = { ...q.stats };
    const born = birthStats(pot);
    for (const k of ["likes", "reposts", "quotes", "replies"]) stats[k] = Math.max(stats[k], born[k]);
    return { ...q, pot, stats, t0: ageNow(q) };
  });
  stories = stories.map((x) => {
    if (!wakes(x)) return x;
    const pot = ownPostPot(meT, me.followers, `${x.id}:story`).likes;
    const likes = Math.max(x.stats.likes, birthStats({ likes: pot }).likes, pot > 0 ? 1 : 0);
    return { ...x, stats: { ...x.stats, likes }, pot: { likes: Math.max(likes, pot) } };
  });
  /* stories already up (and the persona's, once answered) gain likes with every refresh or skip:
     40% of the way to their ceiling */
  if (mode === "refresh" || mode === "world" || mode === "respond") {
    stories = stories.map((x) => {
      if ((x.by === YOU && x.tick > h.tick.n) || !x.pot || x.tick >= n || x.stats.likes >= x.pot.likes) return x;
      return { ...x, stats: { ...x.stats, likes: Math.min(x.pot.likes, x.stats.likes + Math.max(1, Math.round((x.pot.likes - x.stats.likes) * 0.4))) } };
    });
  }
  /* story likes owed by code: named likers and the crowd */
  for (const sl of owed || []) {
    if (sl.kind !== "story-like") continue;
    stories = stories.map((x) => {
      if (x.id !== sl.to) return x;
      const likedBy = sl.by && !(x.likedBy || []).includes(sl.by) ? [...(x.likedBy || []), sl.by] : x.likedBy;
      return { ...x, ...(likedBy ? { likedBy } : {}), stats: { ...x.stats, likes: x.stats.likes + (sl.by ? 1 : sl.count || 0) } };
    });
  }

  /* the persona's items: what this batch did not answer stays new */
  let pending = false;
  const later = (x) => ((pending = true), { ...x, tick: n + 1 });
  if (answered) {
    const done = new Set(answered);
    posts = posts.map((q) => (q.by === YOU && q.tick >= n && !done.has(q.id) ? later(q) : q));
    stories = stories.map((q) => (q.by === YOU && q.tick >= n && !done.has(q.id) ? later(q) : q));
    for (const [key, list] of Object.entries(threads)) threads[key] = list.map((m) => (m.from === YOU && m.tick >= n && !done.has(m.id) ? later(m) : m));
  }
  /* an owed DM answer the batch did not write: none comes, except that a
     story character's first miss is offered once more. A "left on read"
     nudge is offered once: unwritten, the conversation is over */
  for (const s of owed || []) {
    if (s.kind !== "dm" || (filled.has(s.id) && !silent.has(s.id))) continue;
    if (s.what === "answer") {
      const w = wait[s.by];
      if (!w || w.line !== s.line) continue;
      wait[s.by] = silent.has(s.id) || !s.story || w.miss ? { ...w, due: null } : { ...w, miss: 1 };
    } else if (s.what === "left-on-read" && s.line && threads[s.by]) {
      threads[s.by] = threads[s.by].map((m) => (m.id === s.line ? { ...m, end: true } : m));
    }
  }

  /* the refresh count (Light: every 4 replies) moves only with a refresh or
     a time skip; respond and more leave it */
  const lastMsgId = isRootAnchor(at) || (mode !== "refresh" && mode !== "world") ? h.tick.lastMsgId : at.id;
  const { error: _e, ...tick } = h.tick;
  const next = {
    ...h, me, people, posts, stories, threads, world: { topics }, bank, dmWait: wait,
    tick: { ...tick, n, lastMsgId, pending, seeded: true },
  };
  return normalizeHandset(next) || h0;
}

/* How many new items a merge would add (posts, stories, DM lines). */
export function batchItems(handset, parsed, opts = {}) {
  const before = asHandset(handset);
  const after = mergeBatch(before, parsed, opts);
  const lines = (x) => Object.values(x.threads).reduce((s, l) => s + l.length, 0);
  const ids = new Set([...before.posts, ...before.stories].map((q) => q.id));
  return after.posts.filter((q) => !ids.has(q.id)).length + after.stories.filter((q) => !ids.has(q.id)).length + Math.max(0, lines(after) - lines(before));
}

/* ---------- owed responses (decided in code) ---------- */

/* The responses the persona's actions since the last batch earn, rolled
   with responseChance and rng (seed: `seed` or the tick). `actions` adds
   likes and reposts, which leave no item: [{ kind: "like"|"repost", post }].
   Slots: { id, kind: "reply"|"dm"|"notice", by (key or null), to (post id),
   story (a story character) }, capped by the level's respond budget.
   DMs follow handset.dmWait: an answer is owed only once the phone's clock
   (`clockNow`, default the handset's now) reaches its `due` minute
   ({ what: "answer", dueAt, sentAt, closer, lines, line }); a close
   person's question the persona read and never answered may earn one
   nudge some hours later ({ what: "left-on-read", dueAt, askedAt, ask,
   line }). `only: "dm"` keeps just those (a time skip's). */
export function owedSlots(opts = {}) {
  return owedPlan(opts).slots;
}

/* owedSlots and what the cap left out: { slots, overflow }, overflow being
   [{ src }] (the persona's item, which stays pending) or [{ action }] (a
   like or repost, kept for the next batch). */
export function owedPlan({ handset, messages = [], characters = [], actions = [], seed, clockNow, only } = {}) {
  const h = asHandset(handset);
  const v = visiblePhone(h, messages);
  const now = Number.isFinite(clockNow) ? clockNow : clockNowOf(h, messages);
  const dmOnly = only === "dm";
  const story = new Set(characters.map((c) => c.key));
  const isStory = (k) => typeof k === "string" && (story.has(k) || /^(char|cast|uni):/.test(k));
  const me = h.me;
  const P = traitsOf(me).fame;
  const byId = new Map(v.posts.map((q) => [q.id, q]));
  const raw = [];
  const roll = (tag) => rng(`${seed ?? h.tick.n}:${tag}`)();
  const between = (lo, hi, tag) => lo + Math.floor(roll(tag) * (hi - lo + 1));
  const storyById = new Map(v.stories.map((x) => [x.id, x]));
  for (const q of dmOnly ? [] : v.posts) {
    if (q.by !== YOU || q.tick <= h.tick.n) continue;
    const target = q.ref ? byId.get(q.ref) : null;
    const onStory = q.kind === "reply" && !target && q.ref ? storyById.get(q.ref) : null;
    if (onStory && onStory.by !== YOU) {
      /* the persona commented on someone's story: they may answer */
      const c = responseChance(me, personOf(h, onStory.by), "reply", { storyCharacter: isStory(onStory.by) });
      if (roll(`${q.id}:story`) < c) raw.push({ kind: "story-reply", by: onStory.by, to: onStory.id, story: isStory(onStory.by), src: q.id });
    } else if (q.kind === "reply" && target && target.by !== YOU) {
      const c = responseChance(me, personOf(h, target.by), "reply", { storyCharacter: isStory(target.by) });
      if (roll(`${q.id}:reply`) < c) raw.push({ kind: "reply", by: target.by, to: q.id, story: isStory(target.by), src: q.id });
    } else if (q.kind === "quote" && target) {
      if (target.by !== YOU) {
        const c = responseChance(me, personOf(h, target.by), "quote", { storyCharacter: isStory(target.by) });
        if (roll(`${q.id}:quote`) < c) raw.push({ kind: "reply", by: target.by, to: q.id, story: isStory(target.by), src: q.id });
      }
      const [lo, hi] = [[0, 1], [1, 2], [2, 4], [3, 6]][P];
      for (let k = between(lo, hi, `${q.id}:onlookers`); k > 0; k--) raw.push({ kind: "reply", by: null, to: q.id, src: q.id });
    } else if (q.kind === "post") {
      const replies = ownReplySlots(me, `${q.id}:own`);
      for (let k = 0; k < replies; k++) raw.push({ kind: "reply", by: null, to: q.id, ...(P >= 2 ? { crowd: true } : {}), src: q.id });
    }
  }
  for (const a of dmOnly ? [] : actions || []) {
    const q = byId.get(a?.post);
    if (!q || q.by === YOU || !["like", "repost"].includes(a.kind)) continue;
    const c = responseChance(me, personOf(h, q.by), a.kind, { storyCharacter: isStory(q.by) });
    if (roll(`${q.id}:${a.kind}`) < c) raw.push({ kind: "notice", by: q.by, to: q.id, what: a.kind, story: isStory(q.by), action: { kind: a.kind, post: a.post } });
  }
  /* the persona's new story: likes (code-only, not capped) from story
     characters and the crowd by fame; comments by fame (a private person
     gets a few from friends, a star many) */
  const storyLikes = [];
  for (const x of dmOnly ? [] : v.stories) {
    if (x.by !== YOU || x.tick <= h.tick.n) continue;
    for (const c of characters) if (roll(`${x.id}:like:${c.key}`) < 0.35 + 0.15 * P) storyLikes.push({ kind: "story-like", by: c.key, to: x.id, story: true });
    const [lo, hi] = [[0, 2], [1, 3], [2, 5], [4, 8]][P];
    for (let k = between(lo, hi, `${x.id}:comments`); k > 0; k--) raw.push({ kind: "story-reply", by: null, to: x.id, ...(P >= 2 ? { crowd: true } : {}), src: x.id });
    for (const c of characters) if (roll(`${x.id}:comment:${c.key}`) < 0.25) raw.push({ kind: "story-reply", by: c.key, to: x.id, story: true, src: x.id });
  }
  /* a transfer the persona made since the last batch: the payee reacts in a
     DM (a story character always; others by the DM rule) */
  for (const x of dmOnly ? [] : h.bank.tx) {
    if (x.kind !== "sent" || x.world || !x.to || x.tick <= h.tick.n) continue;
    const c = responseChance(me, personOf(h, x.to), "dm", { storyCharacter: isStory(x.to) });
    const note = x.note ? { note: x.note } : {};
    if (isStory(x.to)) raw.push({ kind: "transfer", by: x.to, thread: x.to, story: true, amount: x.amount, ...note, src: x.id });
    else if (roll(`${x.id}:transfer`) < c) raw.push({ kind: "dm", by: x.to, thread: x.to, story: false, what: "transfer", amount: x.amount, ...note, src: x.id });
  }
  const presentNow = new Set(characters.filter((c) => c.present).map((c) => c.key));
  for (const [key, list] of Object.entries(v.threads)) {
    const w = h.dmWait[key];
    let lastTheirsAt = -1;
    for (let k = list.length - 1; k >= 0; k--) if (list[k].from !== YOU) { lastTheirsAt = k; break; }
    const src = w ? list.findIndex((m) => m.id === w.line) : -1;
    if (src >= 0 && src > lastTheirsAt) {
      /* the persona's unanswered streak: owed only once the clock reaches
         the minute decided when it was sent */
      if (w.due !== null && w.due <= now) {
        const mine = list.slice(lastTheirsAt + 1).filter((m) => m.from === YOU);
        raw.push({
          kind: "dm", by: key, thread: key, story: isStory(key), what: "answer", dueAt: w.due, sentAt: w.sent,
          ...(isCloser(mine.at(-1)?.text) ? { closer: true } : {}), lines: mine.slice(-2).map((m) => m.text), line: w.line, src: w.line,
        });
      }
      continue;
    }
    /* left on read: their one line, a question, opened by the persona and
       never answered. Only someone close (a friend, a story character) not
       in the scene now reacts, once, rolled once by the line, some hours
       after they asked; fans, brands, strangers and outlets never do */
    const lastTheirs = list.at(-1);
    if (!lastTheirs || lastTheirs.from === YOU || lastTheirs.end || !/\?/.test(lastTheirs.text) || !Number.isFinite(lastTheirs.at) || presentNow.has(key)) continue;
    const streak = threadStreak(h, key);
    if (streak.theirs !== 1 || !streak.read) continue;
    const close = closenessOf(h, key, list);
    if (close < 2) continue;
    const r = rng(`${lastTheirs.id}:read`);
    if (r() >= (close >= 3 ? 0.4 : 0.2)) continue;
    const [lo, hi] = close >= 3 ? [240, 720] : [480, 1440];
    const dueAt = lastTheirs.at + Math.round(lo + (hi - lo) * r());
    if (now < dueAt) continue;
    raw.push({ kind: "dm", by: key, thread: key, story: isStory(key), what: "left-on-read", dueAt, askedAt: lastTheirs.at, ask: cut(lastTheirs.text, 80), line: lastTheirs.id });
  }
  /* story characters' DMs first, then named authors, then the crowd */
  const rank = (s) => ((s.kind === "dm" || s.kind === "transfer") && s.story ? 0 : s.by ? 1 : 2);
  const cap = budgetOf(h.level, "respond").slots;
  /* within a rank, the cap is shared round-robin across the persona's items
     (the k-th answer to each item before any item's k+1-th) */
  const nth = new Map();
  const turn = raw.map((x) => { const key = x.src || x.to || ""; const t = nth.get(key) || 0; nth.set(key, t + 1); return t; });
  const sorted = raw.map((s, k) => [s, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || turn[a[1]] - turn[b[1]] || a[1] - b[1]).map(([s]) => s);
  const strip = ({ src: _s, action: _a, ...slot }) => slot;
  const slots = [...sorted.slice(0, cap).map((s, k) => ({ id: `r${k + 1}`, ...strip(s) })), ...storyLikes.map((s, k) => ({ id: `l${k + 1}`, ...s }))];
  const kept = new Set(sorted.slice(0, cap).map((s) => s.src).filter(Boolean));
  const overflow = [];
  for (const s of sorted.slice(cap)) {
    if (s.action) overflow.push({ action: s.action });
    else if (s.src && !kept.has(s.src)) overflow.push({ src: s.src });
  }
  return { slots, overflow };
}
const personOf = (h, key) => h.people[key] || null;

/* ---------- the batch request ---------- */

const knowledge = (u) =>
  "Who knows what:\n" +
  "- Every account writes in its own voice, from its own life, and knows only what it saw, was told, or what is public. Nobody knows another person's thoughts or conversations they were not part of. Rumours stay uncertain.\n" +
  `- Story characters post only if they would, as they are right now in the story. Someone busy, asleep, or in the scene with ${u} stays quiet or posts later.\n` +
  `- This phone shows only what ${u} can see: public posts and stories, and messages sent to ${u}.\n` +
  `- Never write anything as ${u}: no posts, replies, stories or messages from them.`;

const worldGoesOn = (u) =>
  `The world goes on regardless of the conversation. Most of the feed is not about the story's scene: it follows ${u}'s life and fame. ` +
  `For a star: verified outlets, clubs, fans and critics posting about their work, gossip, and requests and offers in DMs. ` +
  `For a public figure: press, colleagues, fans and the odd critic. For a locally known person: their scene, regulars, local accounts. ` +
  `For a private person: the people around them, local accounts and posts that have nothing to do with them. ` +
  "Accounts reply to and quote each other freely. Running storylines in the feed move on.";

const FORMAT =
  "Reply with ONE JSON object and nothing else, no code fence. Every key is optional; leave out what you do not need:\n" +
  '{"me":{"fame":0,"followers":"1.2K"},\n' +
  ' "accounts":[{"handle":"","name":"","bio":"one line","fame":0,"verified":false,"role":"one word, e.g. outlet, fan, friend"}],\n' +
  ' "posts":[{"id":"a","by":"handle","text":"","photo":"what a picture shows, if any","replyTo":"id","quote":"id","repost":"id","heat":1,"ago":"15m","slot":"r1","replies":[{"by":"handle","text":""}]}],\n' +
  ' "stories":[{"id":"s1","by":"handle","text":"","photo":"","replies":[{"by":"handle","text":"a comment"}]}],\n' +
  ' "dms":[{"from":"handle","text":"","slot":"r2","end":false,"ago":"2h"}],\n' +
  ' "events":[{"post":"id","what":"viral|ratio|fades"},{"account":"handle","followers":"+12k"}],\n' +
  ' "topics":["running storyline in the feed, one line"],\n' +
  ' "payments":[{"from":"handle or payer","to":"handle or payee","amount":120,"note":"wages"}]}\n' +
  "List in \"accounts\" only accounts not already known. Handles: 2-20 of a-z 0-9 _ with no @. Posts newest first. " +
  "\"id\" is your own short label; replyTo and quote take one of yours or a #id from [On the phone] (without #). " +
  "A comment on a story is a post with replyTo the story id; a post about a story sets \"story\" to its id. Famous accounts talk about famous people's stories; most stories are not discussed. " +
  "DMs are conversations that end: a goodnight, an \"ok, see you\", a reaction, or no answer at all closes one. " +
  "Nobody messages again while the owner has not answered their last message, and nobody writes into a closed conversation unless something new in the story or the world gives them a real reason. " +
  "Mark a DM that closes the conversation with \"end\":true. An owed DM may be nothing: give its slot with \"text\":\"\". " +
  "heat 0.5-3 says how much attention a post gets; ago is how long ago it went up. Never write counts of likes. " +
  "\"payments\" records money to or from the phone's owner (@you) only when the story or the feed gives a reason (wages, a bill, a refund, a wire), in whole units. " +
  "A photo is described, not shown. Use the story's language, names, places and era; hashtags and emoji only where that person would. Never use em-dashes.";

function closing(mode, u, b, level, owed, post, span, minutes, sync) {
  const want = [b.posts && `about ${b.posts} posts`, b.stories && `${b.stories} stories`, b.dms && `${b.dms} DM${b.dms > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  const thread = b.thread ? ` Under the top ${b.thread.top} posts write up to ${b.thread.per} replies each, nested in "replies", from different accounts reacting to the post and to each other.` : "";
  if (mode === "replies") {
    return `Write ${b.replies} more replies to #${post?.id} only, nothing else: each a post with "replyTo":"${post?.id}", from different accounts, reacting to the post and to the replies already there. Never repeat a reply.`;
  }
  if (mode === "world") {
    const long = span || spanLabel(minutes);
    return `${span ? `A ${span}` : `About ${long}`} passes in the story, with no scene played out. Write what happened in that ${long} across the world: news, people's lives, money (in "payments"), posts and stories on ${u}'s phone, DMs from people who would write in that time, arrivals or departures in the story's places: up to ${want}, and the owed items in [Owed].${thread} ` +
      `Give posts an "ago" inside that ${long}. Return "time": one line with the new time and date in the story, and "summary": one or two sentences of what changed, for the story to pick up. Advance the running topics.`;
  }
  if (mode === "setup") {
    return `${u}'s phone was just switched on in a story already under way. Write the feed as it stands now, after everything in [Story so far], [Where the story stands] and [Latest in the story]: ${want}.${thread} ` +
      "People and outlets react to what has happened so far as far as they could know it; most of the feed still goes on with their own lives. Do not repeat anything already in [On the phone]. " +
      `Return "me" with ${u}'s fame tier and follower count as fits [Profile], "accounts" for every new account you use, and 2-4 "topics" running in the feed. ` +
      `For fame 2 or more, include requests and offers in DMs from people ${u} does not know.`;
  }
  if (mode === "seed") {
    return `This is the first look at ${u}'s phone, as the story begins. Write the feed as it stands: ${want}.${thread} ` +
      `Return "me" with ${u}'s fame tier and follower count as fits [Profile], "accounts" for every account you use, and 2-4 "topics" running in the feed. ` +
      `${u}'s fame decides who shows up: for fame 2 or more, include requests and offers in DMs from people ${u} does not know.`;
  }
  if (mode === "more") return `Write older posts further down the feed, from before everything in [On the phone]: ${want}. Give each an "ago" older than the posts shown.`;
  if (mode === "respond") {
    const only = level === "lively" ? "Then you may add one or two other items if they fit." : "Write only the owed items, nothing else.";
    return `Write the owed items in [Owed], each with its "slot" id: replies as posts with replyTo, DM answers as dms. ${owed.length ? "" : "Nothing is owed: return {}. "}${only}`;
  }
  if (sync) {
    return `Return "elapsed": the whole minutes of story time these messages covered (a conversation: minutes; a drive, a night, "the next morning": hours). ` +
      `Then write what appeared on the phone in that time: posts and stories reacting to what happened (only what people could know), DMs from people who would text about it, and the owed items: up to ${want}.${thread} Give posts an "ago" inside that time. Advance the running topics.`;
  }
  const passed = Number.isFinite(minutes) && minutes >= 1
    ? ` About ${spanLabel(minutes)} passed since the phone was last checked; give each post an "ago" inside that time; stories already up may get a few comments (posts with replyTo the story id).`
    : "";
  return `Write what appeared since the phone was last checked: up to ${want}, fewer if this stretch was quiet, and any owed items. New DMs start new conversations; a closed one is reopened only for a real new reason, at most one.${thread}${passed} Advance the running topics.`;
}

/* a thread's state for the prompt (phone.js threadState) */
function stateText(state, u) {
  if (!state) return "empty";
  if (state.closed) return `over, ended ${spanLabel(state.since ?? 0)} ago; nobody writes here without a new reason`;
  return state.turn === "you" ? `waiting on ${u}; they do not write again` : `${u} wrote last; answers come only through [Owed]`;
}

const speakerOf = (m, u, charLabel) => (m.role === "user" ? u : m.role === "system" ? "Narrator" : m.speaker || charLabel);
function latestLines(messages, u, charLabel, count, max) {
  const out = [];
  let used = 0;
  for (const m of (messages || []).filter((x) => x && str(x.content).trim()).slice(-count).reverse()) {
    const room = max - used;
    if (room < 80) break;
    let line = `${speakerOf(m, u, charLabel)}: ${str(m.content).replace(/\s+/g, " ").trim()}`;
    if (line.length > room) line = `…${line.slice(line.length - room + 1)}`;
    out.unshift(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

const traitLine = (t, from = {}) => {
  const parts = [`fame ${t.fame} (${FAME_MEANING[t.fame]})`, `wealth ${t.wealth} (${WEALTH_MEANING[t.wealth]})${from.wealth === "inferred" ? " (inferred)" : ""}`];
  for (const [k, v] of Object.entries(t)) if (k !== "fame" && k !== "wealth") parts.push(`${k}: ${v}${from[k] === "inferred" ? " (inferred)" : ""}`);
  return parts.join("; ");
};

/* The batch request: { system, user, maxTokens, mode, level, owed, budget }.
     mode        seed | refresh | more | respond
     handset     the chat's handset (default: chat.handset)
     chat        messages, scene notes, memory
     persona     { name, description }; userName overrides the name
     characters  storyPeople()
     world       { story, log }: the story's premise and the universe's world log
     slots       owed slots (default: owedSlots() from the persona's actions)
     actions     likes and reposts since the last batch, for owedSlots
     budget      overrides budgetOf(level, mode)
     seed        rng seed for the owed slots
     clockNow    the phone's in-world minute the batch is written at (refresh
                 and world: after the step; default the handset's now): DM
                 answers are owed once it reaches their minute
     minutes     in-world minutes the batch covers (refresh: since the phone
                 was last checked; world: the skip); `span` (day | week |
                 month) is the old name for a world skip's
     sync        a refresh that is a Sync to chat: true (the story since the
                 phone was last synced, from the handset's clock) or
                 { lines } (that story as "Speaker: text" lines) */
export function phoneBatch({ mode = "refresh", handset, chat, persona, userName, characters = [], world = {}, slots, actions, budget, seed, messages, post, span, minutes, clockNow, sync } = {}) {
  const h = asHandset(handset ?? chat?.handset);
  const m = BATCH_MODES.includes(mode) ? mode : "refresh";
  const u = userName || persona?.name || "You";
  const msgs = Array.isArray(messages) ? messages : chat?.messages || [];
  const now = Number.isFinite(clockNow) ? clockNow : clockNowOf(h, msgs);
  const b = { ...budgetOf(h.level, m), ...(isRecord(budget) ? budget : {}) };
  /* a Sync to chat: the story since the phone was last synced (refresh only) */
  const charLabel = characters[0]?.name || "Narrator";
  const syncing = m === "refresh" && !!sync;
  const syncMsgs = syncing ? syncMessagesOf(h, msgs).filter((x) => x && str(x.content).trim()) : [];
  const syncText = !syncing ? "" : isRecord(sync) && typeof sync.lines === "string" ? sync.lines : latestLines(syncMsgs, u, charLabel, SYNC_MESSAGES, SYNC_CHARS);
  if (syncing && syncMsgs.length > 6 && !isRecord(budget)) b.maxTokens += SYNC_EXTRA_TOKENS;
  const plan = Array.isArray(slots) ? { slots, overflow: [] }
    : m === "seed" || m === "setup" || m === "more" || m === "replies" ? { slots: [], overflow: [] }
      : owedPlan({ handset: h, messages: msgs, characters, actions, seed, clockNow: now, ...(m === "world" ? { only: "dm" } : {}) });
  const target = m === "replies" ? h.posts.find((q) => q.id === (isRecord(post) ? post.id : post)) || null : null;
  const owed = plan.slots;
  const v = visiblePhone(h, msgs);
  const byKey = new Map(characters.map((c) => [c.key, c]));
  const handleOf = (key) => (key === YOU ? YOU : h.people[key]?.handle || byKey.get(key)?.handle || slug(String(key).replace(/^\w+:/, "")));
  const at = (key) => `@${handleOf(key)}`;
  const S = [];

  /* [Phone owner] and [Profile] */
  const meT = traitsOf(h.me);
  S.push(`[Phone owner]\n${u} (@${YOU}). ${cut(persona?.description, 500) || ""}\nFame ${meT.fame}: ${FAME_MEANING[meT.fame]}. Followers: ${h.me.followers}.`.replace(/ \n/, "\n"));
  const present = characters.filter((c) => c.present);
  const profileFor = (present.length ? present : characters).slice(0, 6);
  const prof = [`${u}: ${traitLine(meT, h.me.traitsFrom)}`];
  for (const c of profileFor) {
    const p = h.people[c.key];
    if (p && Object.keys(p.traitsFrom || {}).length) prof.push(`${c.name} (@${handleOf(c.key)}): ${traitLine(traitsOf(p), p.traitsFrom)}`);
  }
  S.push(`[Profile]\n${capLines(prof.map((l) => cut(l, 400)), 1400)}`);

  /* [Story], [People in the story] */
  const story = cut(world.story, 600) || (characters[0]?.card ? `${characters[0].name}: ${cut(characters[0].card, 400)}` : "");
  if (story) S.push(`[Story]\n${story}`);
  if (characters.length) {
    S.push(`[People in the story]\n${capLines(characters.slice(0, 16).map((c) => cut(`@${handleOf(c.key)} ${c.name}${c.role ? `: ${c.role}` : ""} (${c.present ? "in the scene now" : "elsewhere"})`, 140)), 1400)}`);
  }

  /* [Where the story stands], [Latest in the story], [Happening in the world] */
  const sceneLive = chat?.scene?.text?.trim() && (!chat.scene.lastId || msgs.some((x) => x.id === chat.scene.lastId));
  const stands = sceneLive ? chat.scene.text.trim() : str(chat?.memory?.summary).trim();
  /* time passed on the phone since the last story message */
  const lastWt = lastWtOf(msgs);
  const gap = h.tick.seeded && lastWt !== null ? now - lastWt : 0;
  const passedLine = gap >= 15 ? `About ${spanLabel(gap)} has passed since the last story message; people are no longer in that scene unless they said so.` : "";
  if (stands || passedLine) S.push(`[Where the story stands]\n${[stands && cut(stands, 800), passedLine].filter(Boolean).join("\n")}`);
  /* setup reads the chat's memory too: the summary of the story so far */
  const summary = str(chat?.memory?.summary).trim();
  if (m === "setup" && summary && summary !== stands) S.push(`[Story so far]\n${cut(summary, 1200)}`);
  if (syncText) S.push(`[The story since ${u}'s phone was last checked]\n${syncText}`);
  const latest = syncText ? "" : latestLines(msgs, u, charLabel, h.level === "lively" || m === "setup" ? 8 : 4, 2500);
  if (latest) S.push(`[Latest in the story]\n${latest}`);
  const log = Array.isArray(world.log) ? world.log : [];
  if (log.length) S.push(`[Happening in the world]\n${log.slice(-3).map((e) => `- ${cut(e?.text ?? e, 200)}`).join("\n")}`);

  /* [Running in the feed] */
  if (h.world.topics.length) S.push(`[Running in the feed]\n${h.world.topics.map((t) => `- ${t}`).join("\n")}`);

  /* [On the phone]: newest posts with counts; open threads */
  const onPhone = [];
  for (const q of v.posts.slice(0, 12)) {
    const s = statsOf(q, ageUnits(q, h, msgs));
    const where = q.kind === "reply" ? ` reply to #${q.ref}` : q.kind === "quote" ? ` quote of #${q.ref}` : q.kind === "repost" ? ` repost of #${q.ref}` : "";
    const body = q.photo ? `[photo: ${cut(q.photo, 60)}] ${q.text}` : q.text;
    onPhone.push(`#${q.id} ${at(q.by)}${where}: ${cut(body, 100)} (${s.likes} likes, ${s.replies} replies)`);
  }
  const open = [];
  const owedDm = new Set(owed.filter((s) => s.kind === "dm" || s.kind === "transfer").map((s) => s.by));
  const ago = (x) => { if (!Number.isFinite(x.at)) return ""; const t = timeLabel(now - x.at); return t === "now" ? " (just now)" : ` (${t} ago)`; };
  for (const [key, list] of Object.entries(v.threads)) {
    if (!owedDm.has(key) && !list.some((x) => x.tick > h.tick.n - 3)) continue;
    open.push(`Messages with ${at(key)} (${stateText(threadState(v, key, now), u)}):\n${list.slice(-4).map((x) => `  ${x.from === YOU ? u : at(x.from)}${ago(x)}: ${cut(x.text, 110)}`).join("\n")}`);
  }
  const storyLines = v.stories.slice(0, 6).map((x) => `story #${x.id} ${at(x.by)}: ${cut(x.photo ? `[photo: ${cut(x.photo, 50)}] ${x.text}` : x.text, 90)} (${x.stats?.likes || 0} likes, ${x.stats?.replies || 0} comments)`);
  S.push(`[On the phone]\n${onPhone.length ? capLines(onPhone, 1800) : "Nothing yet."}${storyLines.length ? `\n${capLines(storyLines, 700)}` : ""}${open.length ? `\n${capLines(open, 900)}` : ""}`);

  /* [Bank]: the persona's money, for payments and DMs that fit it */
  if (m !== "replies") {
    const tx = h.bank.tx.slice(0, 5).map((x) => x.kind === "sent" ? `- sent ${x.amount} to ${x.to ? at(x.to) : x.toName}${x.note ? `: ${cut(x.note, 60)}` : ""}` : `- received ${x.amount} from ${x.from ? at(x.from) : x.fromName}${x.note ? `: ${cut(x.note, 60)}` : ""}`);
    S.push(`[Bank]\n${u}'s balance: ${h.bank.balance} (${WEALTH_MEANING[meT.wealth]}).${tx.length ? `\n${tx.join("\n")}` : ""}`);
  }

  /* [Thread]: the one post a replies request answers */
  if (target) {
    const kids = v.posts.filter((q) => q.kind === "reply" && q.ref === target.id).slice(0, 8).reverse();
    S.push(`[Thread]\n#${target.id} ${at(target.by)}: ${cut(target.photo ? `[photo: ${cut(target.photo, 60)}] ${target.text}` : target.text, 200)}${kids.length ? `\n${kids.map((q) => `  ${at(q.by)}: ${cut(q.text, 120)}`).join("\n")}` : "\n  (no replies yet)"}`);
  }

  /* [{user} did] */
  if (m !== "seed" && m !== "setup" && m !== "replies") {
    const did = [];
    for (const q of [...v.posts].reverse()) {
      if (q.by !== YOU || q.tick <= h.tick.n) continue;
      if (q.kind === "reply") did.push(`- replied to #${q.ref} (#${q.id}): ${cut(q.text, 160)}`);
      else if (q.kind === "quote") did.push(`- quoted #${q.ref} (#${q.id}): ${cut(q.text, 160)}`);
      else did.push(`- posted (#${q.id})${q.photo ? ` a photo [${cut(q.photo, 100)}]` : ""}: ${cut(q.text, 160)}`);
    }
    for (const x of v.stories) if (x.by === YOU && x.tick > h.tick.n) did.push(`- posted a story (#${x.id})${x.photo ? ` [${cut(x.photo, 80)}]` : ""}: ${cut(x.text, 120)}`);
    for (const a of actions || []) if (["like", "repost"].includes(a?.kind) && a.post) did.push(`- ${a.kind === "like" ? "liked" : "reposted"} #${a.post}`);
    for (const x of h.bank.tx) if (x.kind === "sent" && !x.world && x.tick > h.tick.n) did.push(`- sent ${x.amount} to ${at(x.to)}${x.note ? `: ${cut(x.note, 100)}` : ""}`);
    /* only the DMs answered now: the others wait for their minute */
    for (const s of owed) if (s.what === "answer") did.push(`- messaged ${at(s.by)}: ${cut(s.lines.join(" / "), 160)}`);
    if (did.length) S.push(`[${u} did]\n${capLines(did, 700)}`);
  }

  /* [Owed] */
  const written = owed.filter((s) => s.kind !== "story-like");
  if (written.length) {
    const who = (s) => (s.by ? at(s.by) : s.crowd ? "a fan or critic" : `someone who follows ${u}`);
    const lines = written.map((s) => {
      if (s.kind === "story-reply") return `${s.id}: ${who(s)} comments on the story #${s.to} (a post with replyTo "${s.to}")`;
      if (s.what === "left-on-read") {
        return `${s.id}: ${who(s)} asked ${u} "${s.ask}" ${spanLabel(now - s.askedAt)} ago; ${u} read it and never answered. One message in character (a nudge, worry, hurt or annoyance, as they would), or nothing ("text":"") (dm)`;
      }
      if (s.kind === "transfer" || (s.kind === "dm" && s.what === "transfer")) return `${s.id}: ${who(s)} reacts to the ${s.amount} ${u} sent them (dm)`;
      if (s.kind === "dm" && s.what === "answer") {
        const late = (s.dueAt ?? 0) - (s.sentAt ?? 0);
        const said = (s.lines || []).map((t) => cut(t, 120)).join(" / ");
        return `${s.id}: ${who(s)} answers ${u}'s message: "${said}" (dm${late >= 60 ? `; they read and answer it ${spanLabel(late)} after it was sent, and the answer can show that` : ""})` +
          (s.closer ? `. ${u}'s line closed the conversation: a short sign-off or a reaction, or nothing ("text":"")` : "");
      }
      if (s.kind === "dm") return `${s.id}: ${who(s)} answers ${u}'s message (dm)`;
      if (s.kind === "notice") return `${s.id}: ${who(s)} reacts to ${u}'s ${s.what || "like"} of #${s.to} (a reply to #${s.to} or a dm)`;
      return `${s.id}: ${who(s)} replies to #${s.to}`;
    });
    const dmNote = written.some((s) => s.kind === "dm" || s.kind === "transfer") ? "\nEach owed DM is one message; add \"end\":true when it closes the conversation." : "";
    S.push(`[Owed]\n${lines.join("\n")}${dmNote}`);
  }

  /* [Money]: a transfer a story character reacts to */
  const paid = owed.filter((x) => x.kind === "transfer");
  if (paid.length) {
    S.push(`[Money]\n${paid.map((x) => `${u} sent ${x.amount}${x.note ? ` (${cut(x.note, 80)})` : ""} to ${byKey.get(x.by)?.name || at(x.by)}.`).join("\n")}\n` +
      "React to the amount in character: thanks, surprise, guilt, suspicion or refusal, depending on who they are and how much it is.");
  }

  /* respond: a story character's DM gets their card and the thread */
  for (const s of owed.filter((x) => (x.kind === "dm" || x.kind === "transfer") && x.story && (x.kind === "dm" || !owed.some((y) => y.kind === "dm" && y.by === x.by))).slice(0, 2)) {
    const c = byKey.get(s.by);
    const thread = (v.threads[s.by] || []).slice(-10).map((x) => `${x.from === YOU ? u : c?.name || at(s.by)}: ${cut(x.text, 200)}`);
    const state = threadState(v, s.by, now);
    S.push(`[Texting ${c?.name || at(s.by)} (${at(s.by)})]\n${cut(c?.card, 600) || "A person from the story."}\n` +
      `Thread, last lines:\n${thread.join("\n") || "(empty)"}\n` +
      `${state ? `Thread state: ${stateText(state, u)}.\n` : ""}` +
      `${c?.name || "They"} knows what they witnessed in the story and everything in this thread, nothing else. They text the way they would, and react to where they are now (beside ${u}, busy, asleep) as the latest story shows. They may end the conversation (mark "end":true) or send nothing.`);
  }

  /* a world skip's length: `minutes`, else the span's (a day by default);
     its span name only when the minutes are exactly one */
  const skipMin = m === "world" ? (Number.isFinite(minutes) && minutes > 0 ? minutes : SKIP_MINUTES[span] || SKIP_MINUTES.day) : null;
  const skipSpan = m === "world" ? SKIP_SPANS.find((k) => SKIP_MINUTES[k] === skipMin) || null : null;
  S.push(closing(m, u, b, h.level, owed, target, skipSpan, m === "world" ? skipMin : minutes, syncing));
  const system = [`You run the social media on ${u}'s phone in an ongoing roleplay story, logged in as ${u}.`, worldGoesOn(u), knowledge(u), FORMAT].join("\n\n");
  return { system, user: S.join("\n\n"), maxTokens: b.maxTokens, mode: m, level: h.level, owed, overflow: plan.overflow, budget: b, ...(target ? { post: target.id } : {}), ...(m === "world" ? { minutes: skipMin, ...(skipSpan ? { span: skipSpan } : {}) } : {}), ...(syncing ? { sync: true } : {}) };
}

/* ---------- running them (through the activity store) ---------- */

/* The real requester: completeText with the caller's activity handle (a
   sideCall handle, or { kind: "phone", label: "Phone", owner: { chatId } }).
   `onText(fullSoFar)` gets the streamed text. */
export function activityRequester({ settings, activity, signal, temperature = 0.9 } = {}) {
  return async ({ system, user, maxTokens, onText }) => {
    let acc = "";
    return completeText({
      settings, activity, signal, system, user, maxTokens, temperature, stream: true,
      onProgress: (t) => { if (typeof t === "string" && t) { acc += t; onText?.(acc); } },
    });
  };
}

const textOf = (res) => (typeof res === "string" ? res : str(res?.text));
const NUDGE = "\n\nYour last answer could not be used. Reply with ONE JSON object only, starting with { , holding at least a few posts.";

/* The profile call: { parsed, request, responses } or { error, request, responses }. */
export async function runProfile({ requester, ...opts } = {}) {
  const req = profileRequest(opts);
  try {
    const res = await requester(req);
    const parsed = parseProfile(textOf(res));
    if (!parsed) return { error: { message: "The profile could not be read.", mode: "profile", at: Date.now() }, request: req, responses: [res] };
    return { parsed, request: req, responses: [res] };
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return { error: { message: str(e?.message) || "Couldn't update", mode: "profile", at: Date.now() }, request: req, responses: [] };
  }
}

/* One batch: the request, the call, one retry with a nudge when a seed or
   more answer has no JSON or no usable item. Returns
     { parsed, owed, overflow, mode, request, responses, retried }   merge with mergeBatch
       (overflow: owedPlan's, what the slot cap left for the next batch)
     { error: { message, mode, at }, ... }                  set tick.error
   `onPreview(parsed)` gets previewBatch() of the streamed text, at most every
   `previewMs`. `mergeOpts` (accounts, characters, userName, anchor) check
   that an answer has a usable item. Aborts are rethrown. */
export async function runPhoneBatch({ requester, onPreview, previewMs = 0, mergeOpts = {}, ...opts } = {}) {
  const req = phoneBatch(opts);
  const h = asHandset(opts.handset ?? opts.chat?.handset);
  const responses = [];
  const strict = req.mode === "seed" || req.mode === "setup" || req.mode === "more" || req.mode === "replies";
  /* each finished item goes to onPreview as soon as its closing brace
     arrives (streamPreview), at most every `previewMs` when items finish
     faster than that; the final merge is the caller's, once */
  let last = 0;
  const stream = streamPreview();
  let held = null;
  const onText = onPreview ? (full) => {
    const next = stream(full);
    if (next) held = next;
    const now = Date.now();
    if (!held || now - last < previewMs) return;
    last = now;
    onPreview(held);
    held = null;
  } : undefined;
  const fail = (message) => ({ error: { message, mode: req.mode, at: Date.now() }, mode: req.mode, owed: req.owed, overflow: req.overflow, request: req, responses });
  const usable = (parsed) => batchItems(h, parsed, { mode: req.mode, anchor: mergeOpts.anchor || ROOT_ANCHOR, owed: req.owed, userName: opts.userName || opts.persona?.name, characters: opts.characters, ...(req.post ? { post: req.post } : {}), ...mergeOpts }) > 0;
  for (let attempt = 0; attempt < (strict ? 2 : 1); attempt++) {
    let res;
    try {
      res = await requester({ system: req.system, user: attempt ? req.user + NUDGE : req.user, maxTokens: req.maxTokens, onText });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return fail(str(e?.message) || "Couldn't update");
    }
    responses.push(res);
    const parsed = parseBatch(textOf(res));
    if (parsed && (!strict || usable(parsed))) {
      onPreview?.(parsed);
      return { parsed, owed: req.owed, overflow: req.overflow, mode: req.mode, request: req, responses, retried: attempt > 0 };
    }
    if (!strict) return fail("The phone update could not be read.");
  }
  return fail("Couldn't update the phone.");
}
