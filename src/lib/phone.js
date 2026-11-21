import { ROOT_ANCHOR, anchorVisible, cleanAnchor, isRootAnchor, looseAnchorOf } from "./anchor.js";
import { parseModelJson } from "./json.js";
import { PHONE_COST, STORY_MINUTES, cleanClock, clockNowOf, emptyClock, ageUnits, lastWtOf, phoneNow, repliesAfter, spanLabel, spendClock, stepOf } from "./phoneClock.js";
import { birthStats, dmReply, newPot, replyPot, rng, statsOf as shownOf } from "./phoneStats.js";
import { scopeOf } from "./scope.js";
import { uid } from "./util.js";

/* ---------- the phone ----------

   The persona's phone in a chat: one social app (Murmur: posts, photos,
   replies, quotes, reposts and stories) and private messages. Everything
   lives on the chat (`chat.handset`, version 2), so backups, branches and
   deletes need nothing of their own. Everything on it is anchored (anchor.js)
   to the message it was written after; the starting feed hangs on
   ROOT_ANCHOR and always shows. What the persona does and what the phone
   writes in answer hang loose (anchor.js looseAnchorOf): they stay while the
   message exists, whatever version shows. Deleting one message moves them
   to the one before (keepPhoneOnDelete); cutting the chat drops them.

   This file is pure: no React, no requests, no app data. The persona's own
   actions (post, message, like, repost, mark seen) are functions from a
   handset to a new one; they never call a model. */

export const HANDSET_VERSION = 2;
export const LEVELS = ["off", "light", "lively"];
export const POST_KINDS = ["post", "reply", "quote", "repost"];

/* caps */
export const POST_CAP = 200;
export const REPLIES_PER_POST = 12;
export const STORY_CAP = 24;
/* a story is gone after this many story replies since it was posted, or
   STORY_MINUTES (a day, phoneClock.js) on the phone's clock */
export const STORY_LIFE = 12;
export const THREAD_CAP = 40;
export const THREAD_LINES = 60;
export const NPC_CAP = 120;
export const IMAGE_CAP = 30;
export const TOPIC_CAP = 6;
export const TEXT_LIMITS = Object.freeze({ post: 280, photo: 300, dm: 500 });
const SEEN_STORIES_CAP = 100;

/* the persona's key: never stored in `people`, never written by the model */
export const YOU = "you";

/* @deprecated: 3.2.0 tick sizes, used only by the old mergeTick/phoneRequest/phoneDue
   until phoneBatch.js and phoneJob.js take over */
export const PHONE_LEVELS = {
  light: { every: 6, murmur: 3, glimpse: 1, messages: 1 },
  lively: { every: 3, murmur: 6, glimpse: 2, messages: 2 },
};
/* @deprecated: the two 3.2.0 apps; v2 has one feed */
export const PHONE_APPS = ["murmur", "glimpse"];
/* @deprecated: old tick budget */
export const PHONE_MAX_TOKENS = 1400;

const isRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const isInt = (x) => Number.isInteger(x) && x >= 0;
const str = (x) => (typeof x === "string" ? x : "");
const nonEmpty = (x) => typeof x === "string" && x.length > 0;
/* one line of model text, trimmed to `max` characters */
const clean = (x, max) => str(x).replace(/\s+/g, " ").trim().slice(0, max).trim();
const cut = (t, max) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
const fameOf = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(3, Math.round(x))) : null);

/* ---------- handles ---------- */

const HANDLE = /^[a-z0-9_.]{2,20}$/;
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* A handle from a name: lowercase latin letters, digits and _, 2-20 long.
   A name with no latin letters gets a stable made-up one. */
export function slug(name) {
  const base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20).replace(/_+$/, "");
  if (base.length >= 2) return base;
  return `${base || "u"}${hash(name).toString(36)}`.slice(0, 12);
}

/* What the model wrote as a handle, or "" when it is not one. */
export function cleanHandle(h) {
  const s = str(h).trim().replace(/^@+/, "").toLowerCase();
  return HANDLE.test(s) ? s : "";
}

/* ---------- counts ---------- */

/* A count as the model or a user writes it: 12, "1,234", "1.2M", "12k",
   "+12k". Signed; null when it is not a number. */
export function parseCount(x) {
  if (Number.isFinite(x)) return Math.round(x);
  const m = str(x).trim().replace(/[,\s_]/g, "").match(/^([+-]?)(\d+(?:\.\d+)?)([kmb]?)$/i);
  if (!m) return null;
  const n = Number(m[2]) * ({ "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[3].toLowerCase()]);
  return Math.round(m[1] === "-" ? -n : n);
}

/* A count for display: 999, 1.2K, 12K, 3.4M. */
export function compactCount(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const fmt = (x, unit) => `${x < 10 ? (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, "") : Math.floor(x)}${unit}`;
  if (v < 1000) return String(v);
  if (v < 1e6) return fmt(v / 1e3, "K");
  if (v < 1e9) return fmt(v / 1e6, "M");
  return fmt(v / 1e9, "B");
}

export const ZERO_STATS = Object.freeze({ likes: 0, reposts: 0, replies: 0, quotes: 0 });
const STAT_KEYS = ["likes", "reposts", "replies", "quotes"];
const cleanStats = (x) => {
  const r = isRecord(x) ? x : {};
  const out = {};
  for (const k of STAT_KEYS) out[k] = Number.isFinite(r[k]) && r[k] > 0 ? Math.round(r[k]) : 0;
  return out;
};
/* the ceiling is never below the floor */
const cleanPot = (x, stats) => {
  const p = cleanStats(x ?? stats);
  for (const k of STAT_KEYS) p[k] = Math.max(p[k], stats[k]);
  return p;
};

/* ---------- profiles ----------

   Every account and the persona carry `traits`: fame (0..3) plus short
   free-form attributes that matter on social media (looks, job, hobby, body
   and up to TRAIT_EXTRA_CAP others), and `traitsFrom` saying where each
   field came from. `fame` on an account and on `me` is a read-through alias
   of traits.fame, so code that reads fame keeps working. */

export const TRAIT_KEYS = ["looks", "job", "hobby", "body"];
export const TRAIT_SOURCES = ["stated", "inferred", "manual"];
export const TRAIT_MAX = 60;
export const TRAIT_EXTRA_CAP = 12;
const TRAIT_NAME = /^[a-z][a-z0-9_]{0,23}$/;

/* Wealth tiers (the persona's money; hidden in the UI, a plain trait here). */
export const WEALTH_MEANING = ["modest", "comfortable", "wealthy", "very rich"];
const tierOf = (x) => { const n = typeof x === "string" && x.trim() ? Number(x.trim()) : x; return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : null; };

/* Traits made valid; fame from traits.fame, else `fame`, else 0; wealth
   (0..3) from traits.wealth, else `wealth`, else 0. */
export function cleanTraits(t, fame, wealth) {
  const r = isRecord(t) ? t : {};
  const out = { fame: fameOf(r.fame) ?? fameOf(fame) ?? 0, wealth: tierOf(r.wealth) ?? tierOf(wealth) ?? 0 };
  for (const k of TRAIT_KEYS) { const v = clean(r[k], TRAIT_MAX); if (v) out[k] = v; }
  let extra = 0;
  for (const [k, raw] of Object.entries(r)) {
    if (k === "fame" || k === "wealth" || TRAIT_KEYS.includes(k) || !TRAIT_NAME.test(k)) continue;
    const v = clean(raw, TRAIT_MAX);
    if (!v || extra >= TRAIT_EXTRA_CAP) continue;
    out[k] = v;
    extra++;
  }
  return out;
}

/* Where each trait came from, only for fields `traits` has. */
function cleanTraitsFrom(x, traits) {
  const out = {};
  if (isRecord(x)) for (const k of Object.keys(traits)) if (TRAIT_SOURCES.includes(x[k])) out[k] = x[k];
  return out;
}

/* An account's (or `me`'s) traits, always with a fame and a wealth (0 when unknown). */
export function traitsOf(account) {
  return cleanTraits(account?.traits, account?.fame, account?.wealth);
}

/* ---------- the bank ----------

   handset.bank = { balance, tx: [{ id, kind: "sent"|"received", amount, note,
   t, tick, source, to?, toName?, from?, fromName?, world?, category?,
   anchor?, at? }], fresh? }. `t` is the real time, `at` the in-world minute. `source`: who the money came from ("you", an
   account key, or "" for a payer known by name only); `category` (world
   payments): wage | wire | bill | refund | gift | other. Whole units,
   no currency. The starting balance is a seeded draw from the persona's
   wealth tier; `fresh` (never used) lets a later wealth trait redraw it. */

export const BANK_TX_CAP = 60;
export const TX_CATEGORIES = ["wage", "wire", "bill", "refund", "gift", "other"];
const SOURCE = /^(you|(npc|char|cast|uni):.+)?$/;
export const BALANCE_BANDS = [[80, 600], [600, 4000], [4000, 40000], [40000, 400000]];
const bankSeed = (me) => { const t = traitsOf(me); return `bank:${t.wealth}:${t.job || ""}:${t.looks || ""}:${t.hobby || ""}`; };

/* The starting balance for a persona (`me`): repeatable, inside its band. */
export function startingBalance(me) {
  const [lo, hi] = BALANCE_BANDS[traitsOf(me).wealth];
  const r = rng(bankSeed(me))();
  return Math.max(lo, Math.min(hi, Math.round(Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * r))));
}
const newBank = (me) => ({ balance: startingBalance(me), tx: [], fresh: true });

function cleanTx(x) {
  if (!isRecord(x) || !nonEmpty(x.id) || !["sent", "received"].includes(x.kind)) return null;
  const amount = Number(x.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const out = { id: x.id, kind: x.kind, amount: Math.round(amount), note: clean(x.note, 140), t: Number.isFinite(x.t) && x.t >= 0 ? x.t : 0, tick: isInt(x.tick) ? x.tick : 0 };
  if (x.kind === "sent") { out.to = str(x.to); out.toName = clean(x.toName, 60); }
  else { out.from = str(x.from); out.fromName = clean(x.fromName, 60); }
  const source = x.source !== undefined ? str(x.source) : x.kind === "sent" ? YOU : out.from;
  out.source = SOURCE.test(source) ? source : "";
  if (x.world === true) out.world = true;
  if (TX_CATEGORIES.includes(x.category)) out.category = x.category;
  const anchor = x.anchor ? cleanAnchor(x.anchor) : null;
  if (anchor) out.anchor = anchor;
  /* the in-world minute it went through (phoneClock.js) */
  if (Number.isFinite(x.at)) out.at = x.at;
  return out;
}

function cleanBank(b, me) {
  if (!isRecord(b) || !Number.isFinite(b.balance)) return newBank(me);
  const tx = (Array.isArray(b.tx) ? b.tx : []).map(cleanTx).filter(Boolean).slice(0, BANK_TX_CAP);
  const out = { balance: Math.max(0, Math.round(b.balance)), tx };
  if (b.fresh === true && !tx.length) out.fresh = true;
  return out;
}

/* ---------- shape ---------- */

export function emptyHandset(level = "off") {
  const me = { fame: 0, followers: 0, traits: { fame: 0, wealth: 0 } };
  return {
    v: HANDSET_VERSION,
    level: LEVELS.includes(level) ? level : "off",
    tick: { n: 0, lastMsgId: null, pending: false, seeded: false },
    clock: emptyClock(),
    me,
    world: { topics: [] },
    people: {},
    posts: [],
    stories: [],
    threads: {},
    seen: { feed: 0, stories: [], messages: {}, bank: 0, mentions: 0 },
    bank: newBank(me),
    dmWait: {},
  };
}

/* The fame an official account starts at: outlets, leagues, clubs, media,
   official and verified accounts are public figures (2); top leagues,
   federations and national or international outlets are stars (3). 0 for
   anyone else. Read from role, name, handle, bio and the verified flag. */
const OFFICIAL = /\b(outlets?|league|club|fc|media|news|press|official|broadcaster|network|magazine|newspaper|channel|federation|team|brand|agency|ministry|government|police|council)\b/i;
const LEAGUE = /\b(bundesliga|premier.?league|la.?liga|serie.?a|ligue.?1|champions.?league|uefa|fifa|nba|nfl|mlb|nhl|olympics?|federation)\b/i;
const NATIONAL = /\b(national|international|bbc|cnn|reuters|associated.?press|guardian|tagesschau|spiegel|times)\b/i;
export function officialTier({ role, name, handle, bio, verified } = {}) {
  const h = str(handle).replace(/[_.]/g, " ");
  const all = [str(role), str(name), h, str(bio)].join(" ");
  const official = verified === true || OFFICIAL.test(str(role)) || OFFICIAL.test(str(name)) || /\b(official|news|fc)\b/i.test(h);
  const league = LEAGUE.test(all) || LEAGUE.test(str(handle));
  if (!official && !league) return 0;
  return league || NATIONAL.test(all) ? 3 : 2;
}

function cleanPerson(key, p) {
  if (!isRecord(p) || key === YOU || !/^(char|cast|uni|npc):./.test(key)) return null;
  const handle = cleanHandle(p.handle);
  if (!handle) return null;
  const person = { key, handle, name: clean(p.name, 60) || handle };
  if (typeof p.bio === "string" && p.bio.trim()) person.bio = clean(p.bio, 160);
  const traits = cleanTraits(p.traits, p.fame);
  const from = cleanTraitsFrom(p.traitsFrom, traits);
  /* an official account is at least a public figure, unless a profile or
     the owner set its fame */
  if (from.fame !== "stated" && from.fame !== "manual") {
    const floor = officialTier({ role: p.role, name: p.name, handle, bio: p.bio, verified: p.verified });
    if (floor > traits.fame) traits.fame = floor;
  }
  person.fame = traits.fame;
  person.traits = traits;
  if (Object.keys(from).length) person.traitsFrom = from;
  if (p.verified === true) person.verified = true;
  const role = clean(p.role, 40);
  if (role) person.role = role;
  const followers = parseCount(p.followers);
  if (followers !== null && followers >= 0) person.followers = followers;
  return person;
}

function cleanPeople(value) {
  const people = {};
  if (!isRecord(value)) return people;
  let npcs = 0;
  for (const [key, p] of Object.entries(value)) {
    const person = cleanPerson(key, p);
    if (!person) continue;
    if (key.startsWith("npc:") && ++npcs > NPC_CAP) continue;
    people[key] = person;
  }
  return people;
}

function cleanLine(m) {
  if (!isRecord(m) || !nonEmpty(m.id) || !nonEmpty(m.from) || typeof m.text !== "string" || !isInt(m.tick)) return null;
  const anchor = cleanAnchor(m.anchor);
  if (!anchor) return null;
  return { id: m.id, from: m.from, text: m.text, tick: m.tick, anchor, ...(Number.isFinite(m.at) ? { at: m.at } : {}), ...(m.end === true ? { end: true } : {}) };
}

/* Threads, each to its newest THREAD_LINES; past THREAD_CAP threads the
   ones quiet longest are dropped. */
function cleanThreads(value) {
  const all = [];
  if (isRecord(value)) {
    for (const [key, list] of Object.entries(value)) {
      if (key === YOU || !key || !Array.isArray(list)) continue;
      const lines = list.map(cleanLine).filter(Boolean).slice(-THREAD_LINES);
      if (lines.length) all.push([key, lines]);
    }
  }
  /* threads with story people are always kept; only the message requests
     from strangers (npc:) are capped, the quietest going first */
  let keep = all;
  const strangers = all.filter(([k]) => k.startsWith("npc:"));
  if (strangers.length > THREAD_CAP) {
    const last = (lines) => Math.max(...lines.map((m) => m.tick));
    const kept = new Set([...strangers].sort((a, b) => last(b[1]) - last(a[1])).slice(0, THREAD_CAP).map(([k]) => k));
    keep = all.filter(([k]) => !k.startsWith("npc:") || kept.has(k));
  }
  return Object.fromEntries(keep);
}

function cleanPost(p) {
  if (!isRecord(p) || !nonEmpty(p.id) || !nonEmpty(p.by) || typeof p.text !== "string" || !isInt(p.tick)) return null;
  const anchor = cleanAnchor(p.anchor);
  if (!anchor) return null;
  let kind = p.kind === undefined ? "post" : p.kind;
  if (!POST_KINDS.includes(kind)) return null;
  const ref = nonEmpty(p.ref) ? p.ref : null;
  if (kind !== "post" && !ref) {
    if (kind === "repost") return null;
    kind = "post";
  }
  const stats = cleanStats(p.stats);
  const out = { id: p.id, by: p.by, text: p.text, kind };
  /* a post may be about a story (ref = the story id) */
  if (ref) out.ref = ref;
  if (nonEmpty(p.photo)) out.photo = p.photo;
  if (nonEmpty(p.image)) out.image = p.image;
  out.stats = stats;
  out.pot = cleanPot(p.pot, stats);
  out.ago = Number.isFinite(p.ago) && p.ago > 0 ? p.ago : 0;
  if (Number.isFinite(p.t0) && p.t0 >= 0) out.t0 = p.t0;
  if (isInt(p.born) && p.born > 0) out.born = p.born;
  if (p.liked === true) out.liked = true;
  if (p.reposted === true) out.reposted = true;
  out.tick = p.tick;
  out.anchor = anchor;
  /* the in-world minute it went up (phoneClock.js); before the chat's start is fine */
  if (Number.isFinite(p.at)) out.at = p.at;
  return out;
}

function cleanStory(s) {
  if (!isRecord(s) || !nonEmpty(s.id) || !nonEmpty(s.by) || typeof s.text !== "string" || !isInt(s.tick)) return null;
  const anchor = cleanAnchor(s.anchor);
  if (!anchor) return null;
  if (!s.text && !nonEmpty(s.photo) && !nonEmpty(s.image)) return null;
  const out = { id: s.id, by: s.by, text: s.text };
  if (nonEmpty(s.photo)) out.photo = s.photo;
  if (nonEmpty(s.image)) out.image = s.image;
  const st = isRecord(s.stats) ? s.stats : {};
  out.stats = { likes: Number.isFinite(st.likes) && st.likes > 0 ? Math.round(st.likes) : 0, replies: Number.isFinite(st.replies) && st.replies > 0 ? Math.round(st.replies) : 0 };
  /* the likes a story is heading for (refreshes move it there) */
  if (isRecord(s.pot) && Number.isFinite(s.pot.likes) && s.pot.likes > 0) out.pot = { likes: Math.max(out.stats.likes, Math.round(s.pot.likes)) };
  const likedBy = [...new Set((Array.isArray(s.likedBy) ? s.likedBy : []).filter((k) => nonEmpty(k) && k !== YOU))].slice(0, STORY_LIKERS);
  if (likedBy.length) out.likedBy = likedBy;
  if (s.liked === true) out.liked = true;
  out.tick = s.tick;
  out.anchor = anchor;
  if (Number.isFinite(s.at)) out.at = s.at;
  return out;
}
const STORY_LIKERS = 24;

/* A story's first likes and ceiling from its author's fame (like a post's
   pot), seeded by its id so it is repeatable. Stories stored before they had
   counts (no `stats`) get theirs here; the persona's own story stays at zero
   until a refresh gives it its reactions. */
export function storyPot(story, author) {
  return { likes: newPot({ id: story.id, tick: story.tick }, traitsOf(author || {})).likes };
}
function storyBirth(rawList, people) {
  return rawList.map((raw) => {
    const st = cleanStory(raw);
    if (!st || st.by === YOU || (isRecord(raw.stats) && st.pot)) return st;
    const pot = st.pot || storyPot(st, people[st.by]);
    const likes = isRecord(raw.stats) ? st.stats.likes : birthStats(pot).likes;
    return { ...st, stats: { ...st.stats, likes }, pot: { likes: Math.max(likes, pot.likes) } };
  }).filter(Boolean);
}

/* Story comments are replies (posts, kind "reply") with ref = the story id;
   a story's comment count is exactly the stored ones. */
function recountStories(stories, posts) {
  const n = new Map();
  for (const p of posts) if (p.kind === "reply" && p.ref) n.set(p.ref, (n.get(p.ref) || 0) + 1);
  return stories.map((s) => (s.stats.replies === (n.get(s.id) || 0) ? s : { ...s, stats: { ...s.stats, replies: n.get(s.id) || 0 } }));
}

function cleanError(e) {
  if (nonEmpty(e)) return { message: clean(e, 200) || "Couldn't update" };
  if (!isRecord(e)) return null;
  const out = { message: clean(e.message, 200) || "Couldn't update" };
  if (nonEmpty(e.mode)) out.mode = clean(e.mode, 20);
  if (isInt(e.at)) out.at = e.at;
  return out;
}

function cleanTick(t, seededDefault) {
  const r = isRecord(t) ? t : {};
  const out = {
    n: isInt(r.n) ? r.n : 0,
    lastMsgId: nonEmpty(r.lastMsgId) ? r.lastMsgId : null,
    pending: r.pending === true,
    seeded: typeof r.seeded === "boolean" ? r.seeded : seededDefault,
  };
  const error = cleanError(r.error);
  if (error) out.error = error;
  return out;
}

function cleanMe(m) {
  const r = isRecord(m) ? m : {};
  const followers = parseCount(r.followers);
  const traits = cleanTraits(r.traits, r.fame);
  const out = { fame: traits.fame, followers: followers !== null && followers > 0 ? followers : 0, traits };
  const from = cleanTraitsFrom(r.traitsFrom, traits);
  if (Object.keys(from).length) out.traitsFrom = from;
  if (typeof r.bio === "string" && r.bio.trim()) out.bio = clean(r.bio, 160);
  if (r.verified === true) out.verified = true;
  return out;
}

function cleanWorld(w) {
  const topics = (isRecord(w) && Array.isArray(w.topics) ? w.topics : []).map((x) => clean(x, 140)).filter(Boolean).slice(0, TOPIC_CAP);
  return { topics };
}

const cleanSeenMessages = (x) => {
  const out = {};
  if (isRecord(x)) for (const [k, v] of Object.entries(x)) if (isInt(v)) out[k] = v;
  return out;
};

/* ---------- version 1 (3.2.0) ---------- */

/* The 3.2.0 display like count, kept here only so a migrated post starts at
   the number it showed before. */
function v1Likes(post, fame = 1) {
  if (!post?.id) return 0;
  const f = Math.max(0, Math.min(3, Number.isFinite(fame) ? Math.round(fame) : 1));
  const [lo, hi] = [[0, 12], [3, 60], [40, 900], [800, 20000]][f];
  return lo + (hash(post.id) % (hi - lo + 1)) + (post.liked ? 1 : 0);
}

function v1Post(p) {
  if (!isRecord(p) || !nonEmpty(p.id) || !PHONE_APPS.includes(p.app) || !nonEmpty(p.by)) return null;
  if (typeof p.text !== "string" || !isInt(p.tick)) return null;
  const anchor = cleanAnchor(p.anchor);
  if (!anchor) return null;
  return { ...p, anchor };
}

/* A 3.2.0 handset (no `v`) as version 2: Murmur posts and Glimpse photos
   become one feed, comments and replies become replies; likes start where
   they showed. */
function migrateV1(value) {
  /* 3.2.0 fame was the model's guess; it becomes traits.fame, "inferred" */
  const rawPeople = isRecord(value.people) ? value.people : {};
  const oldFame = (key) => (isRecord(rawPeople[key]) ? fameOf(rawPeople[key].fame) ?? undefined : undefined);
  const people = cleanPeople(Object.fromEntries(Object.entries(rawPeople).map(([k, p]) =>
    [k, isRecord(p) && fameOf(p.fame) !== null && !isRecord(p.traitsFrom) ? { ...p, traitsFrom: { fame: "inferred" } } : p])));
  const old = (Array.isArray(value.posts) ? value.posts : []).map(v1Post).filter(Boolean).slice(0, POST_CAP);
  const children = new Map();
  for (const p of old) if (nonEmpty(p.replyTo)) children.set(p.replyTo, (children.get(p.replyTo) || 0) + 1);
  const posts = old.map((p) => {
    const stats = { likes: v1Likes(p, oldFame(p.by)), reposts: 0, replies: children.get(p.id) || 0, quotes: 0 };
    const out = { id: p.id, by: p.by, text: p.text, kind: nonEmpty(p.replyTo) ? "reply" : "post" };
    if (out.kind === "reply") out.ref = p.replyTo;
    if (nonEmpty(p.photo)) out.photo = p.photo;
    if (nonEmpty(p.image)) out.image = p.image;
    out.stats = stats;
    out.pot = { ...stats };
    out.ago = 0;
    if (p.liked === true) out.liked = true;
    out.tick = p.tick;
    out.anchor = p.anchor;
    return out;
  });
  const t = cleanTick(value.tick, false);
  const s = isRecord(value.seen) ? value.seen : {};
  const me = cleanMe(null);
  return {
    v: HANDSET_VERSION,
    level: value.level,
    tick: { ...t, seeded: t.n > 0 || posts.length > 0 },
    clock: emptyClock(),
    me,
    world: { topics: [] },
    people,
    posts,
    stories: [],
    threads: cleanThreads(value.threads),
    seen: {
      feed: Math.max(isInt(s.murmur) ? s.murmur : 0, isInt(s.glimpse) ? s.glimpse : 0),
      stories: [],
      messages: cleanSeenMessages(s.messages),
      bank: 0,
      mentions: Math.max(isInt(s.murmur) ? s.murmur : 0, isInt(s.glimpse) ? s.glimpse : 0),
    },
    bank: cleanBank(value.bank, me),
    dmWait: {},
  };
}

/* A stored handset made valid (and brought to version 2), or undefined when
   it is not one. normalizeData runs every chat and backup through this. */
export function normalizeHandset(value) {
  if (!isRecord(value) || !LEVELS.includes(value.level)) return undefined;
  if (value.v === undefined || value.v === 1) return migrateV1(value);
  const posts = recount((Array.isArray(value.posts) ? value.posts : []).map(cleanPost).filter(Boolean).slice(0, POST_CAP));
  const s = isRecord(value.seen) ? value.seen : {};
  const seenStories = [...new Set((Array.isArray(s.stories) ? s.stories : []).filter(nonEmpty))].slice(-SEEN_STORIES_CAP);
  const me = cleanMe(value.me);
  const people = cleanPeople(value.people);
  const threads = cleanThreads(value.threads);
  const tick = cleanTick(value.tick, false);
  const clock = cleanClock(value.clock);
  const feedSeen = isInt(s.feed) ? s.feed : 0;
  const usage = isRecord(value.usage) ? cleanUsage(value.usage) : null;
  return {
    v: HANDSET_VERSION,
    level: value.level,
    tick,
    clock,
    me,
    world: cleanWorld(value.world),
    people,
    posts,
    stories: recountStories(storyBirth((Array.isArray(value.stories) ? value.stories : []).slice(0, STORY_CAP), people), posts),
    threads,
    seen: { feed: feedSeen, stories: seenStories, messages: cleanSeenMessages(s.messages), bank: isInt(s.bank) ? s.bank : 0, mentions: isInt(s.mentions) ? s.mentions : feedSeen },
    bank: cleanBank(value.bank, me),
    dmWait: cleanDmWait(value.dmWait, threads, (key, line, lines) => planDm({ me, people }, key, line, lines), { n: tick.n, last: clock.last }),
    ...(usage ? { usage } : {}),
  };
}

/* ---------- usage (estimated token use of the phone's requests) ----------

   handset.usage = { calls, tokensIn, tokensOut, cost, est, byMode: { [mode]:
   { calls, tokensIn, tokensOut } } }: what this chat's phone requests used.
   `est` counts the calls whose tokens were estimated (the provider reported
   none); `cost` adds only reported costs. Modes: USAGE_MODES. Absent until
   the first request; usageOf always gives a whole one. */
export const USAGE_MODES = ["setup", "profile", "refresh", "sync", "world", "more", "respond", "replies"];
const nonNeg = (x) => (Number.isFinite(x) && x > 0 ? x : 0);
const wholeNonNeg = (x) => Math.round(nonNeg(x));
export const emptyUsage = () => ({ calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, est: 0, byMode: {} });
export function cleanUsage(u) {
  const r = isRecord(u) ? u : {};
  const byMode = {};
  if (isRecord(r.byMode)) {
    for (const [k, m] of Object.entries(r.byMode)) {
      if (!USAGE_MODES.includes(k) || !isRecord(m)) continue;
      byMode[k] = { calls: wholeNonNeg(m.calls), tokensIn: wholeNonNeg(m.tokensIn), tokensOut: wholeNonNeg(m.tokensOut) };
    }
  }
  return { calls: wholeNonNeg(r.calls), tokensIn: wholeNonNeg(r.tokensIn), tokensOut: wholeNonNeg(r.tokensOut), cost: nonNeg(r.cost), est: wholeNonNeg(r.est), byMode };
}
export const usageOf = (handset) => cleanUsage(isRecord(handset) ? handset.usage : null);

/* The handset with one more request counted: { mode, tokensIn, tokensOut,
   cost?, est? } (est: the tokens are estimates). */
export function addUsage(handset, { mode, tokensIn, tokensOut, cost, est = false } = {}) {
  if (!isRecord(handset)) return handset;
  const u = usageOf(handset);
  const tin = wholeNonNeg(tokensIn);
  const tout = wholeNonNeg(tokensOut);
  const byMode = { ...u.byMode };
  if (USAGE_MODES.includes(mode)) {
    const m = byMode[mode] || { calls: 0, tokensIn: 0, tokensOut: 0 };
    byMode[mode] = { calls: m.calls + 1, tokensIn: m.tokensIn + tin, tokensOut: m.tokensOut + tout };
  }
  return { ...handset, usage: { calls: u.calls + 1, tokensIn: u.tokensIn + tin, tokensOut: u.tokensOut + tout, cost: u.cost + nonNeg(cost), est: u.est + (est ? 1 : 0), byMode } };
}

/* ---------- DM waits ----------

   handset.dmWait = { [personKey]: { line, sent, due, seen, miss?, re? } }:
   the persona's first line of the current unanswered streak to that person
   (`line`, its id), the in-world minute it was sent, the minute their answer
   comes (`due`, null: no answer is coming) and the minute they read it
   (`seen`, null: never opened). `miss`: a story character's answer slot went
   unfilled once (it is offered once more); `re`: the one re-roll after a
   follow-up a day later. Decided in code when the line is sent (planDm,
   phoneStats.js dmReply), written by a batch when the phone's clock reaches
   `due` (phoneBatch.js owedPlan). */
export const DM_WAIT_CAP = 60;

const finiteOrNull = (x, min) => (x === null ? null : Number.isFinite(x) && x >= min ? x : undefined);

/* dmWait made valid: only entries whose line is the persona's, in a thread
   that exists. A thread whose last line is the persona's, sent since the
   last batch, with no entry (stored before dmWait) gets one from `plan`,
   seeded by the line id, so it is the same every time. */
function cleanDmWait(value, threads, plan, { n = 0, last = 0 } = {}) {
  const out = [];
  const src = isRecord(value) ? value : {};
  for (const [key, list] of Object.entries(threads)) {
    const w = src[key];
    if (isRecord(w) && nonEmpty(w.line) && Number.isFinite(w.sent)) {
      const line = list.find((m) => m.id === w.line);
      const due = finiteOrNull(w.due, w.sent);
      const seen = finiteOrNull(w.seen, w.sent);
      if (line && line.from === YOU && due !== undefined && seen !== undefined) {
        out.push([key, { line: w.line, sent: w.sent, due, seen, ...(w.miss === 1 ? { miss: 1 } : {}), ...(w.re === 1 ? { re: 1 } : {}) }]);
        continue;
      }
    }
    const tail = list.at(-1);
    if (tail?.from !== YOU || tail.tick <= n) continue;
    /* the first line of the persona's unanswered streak */
    let k = list.length - 1;
    while (k > 0 && list[k - 1].from === YOU) k--;
    const first = list[k];
    const planned = plan(key, { id: first.id, at: Number.isFinite(first.at) ? first.at : last, text: first.text }, list.slice(0, k + 1));
    if (planned) out.push([key, planned]);
  }
  return Object.fromEntries(out.sort((a, b) => b[1].sent - a[1].sent).slice(0, DM_WAIT_CAP));
}

/* Stored counts never below the real children: replies, quotes and reposts
   kept as posts with `ref` to this one. A post's replies follow its stats
   (the count can be far above the stored replies, which are only the ones
   written out): stats.replies never below the stored ones, and the ceiling
   at least replyPot (a share of the likes ceiling), except on the persona's
   own posts not yet woken (no likes ceiling) and on faded posts (ceiling =
   shown). Quotes and reposts never below theirs. */
const CHILD_FIELD = { reply: "replies", quote: "quotes", repost: "reposts" };
function recount(posts) {
  const kids = new Map();
  for (const p of posts) {
    const f = p.ref && CHILD_FIELD[p.kind];
    if (!f) continue;
    const c = kids.get(p.ref) || { replies: 0, quotes: 0, reposts: 0 };
    c[f]++;
    kids.set(p.ref, c);
  }
  return posts.map((p) => {
    const c = kids.get(p.id) || { replies: 0, quotes: 0, reposts: 0 };
    const lift = p.kind !== "reply" && p.kind !== "repost" && !(p.by === YOU && p.pot.likes === 0) && p.pot.likes !== p.stats.likes;
    const replies = Math.max(p.stats.replies, c.replies);
    const potReplies = Math.max(p.pot.replies, replies, lift ? replyPot(p) : 0);
    if (p.stats.replies === replies && p.pot.replies === potReplies && p.stats.quotes >= c.quotes && p.stats.reposts >= c.reposts) return p;
    const stats = { ...p.stats, replies };
    const pot = { ...p.pot, replies: potReplies };
    for (const k of ["quotes", "reposts"]) { stats[k] = Math.max(stats[k], c[k]); pot[k] = Math.max(pot[k], stats[k]); }
    return { ...p, stats, pot };
  });
}

/* The chat's handset, always whole: level "off" when it has none. */
export const handsetOf = (chat) => normalizeHandset(chat?.handset) || emptyHandset("off");
const asHandset = (h) => normalizeHandset(h) || emptyHandset("off");

/* ---------- when it ticks ---------- */

const storyReply = (m) => m?.role === "assistant" && !!String(m.content || "").trim();

/* Story replies after the anchor's message (all of them for ROOT_ANCHOR), or
   null when that message is gone (phoneClock.js). */
export { repliesAfter };

/* @deprecated (phoneJob.js decides in v2). Due when the phone is on and: the
   persona did something on it since the last tick (`pending`), or `every`
   story replies have arrived since the message the last tick ran after, or
   (the first tick) the story has had at least two replies. */
export function phoneDue(chat) {
  const h = handsetOf(chat);
  const lim = PHONE_LEVELS[h.level];
  if (!lim) return false;
  if (h.tick.pending) return true;
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  if (!h.tick.lastMsgId) return messages.filter(storyReply).length >= 2;
  const at = messages.findIndex((m) => m?.id === h.tick.lastMsgId);
  return messages.slice(at + 1).filter(storyReply).length >= lim.every;
}

/* ---------- what is part of the story ---------- */

/* The handset with only the items still part of the story (anchor.js:
   strict ones while their message shows that version, loose ones while it
   exists); stories also go after STORY_LIFE replies or, once the phone is
   set up, STORY_MINUTES on its clock. */
export function visiblePhone(handset, messages) {
  const h = asHandset(handset);
  const threads = {};
  for (const [key, list] of Object.entries(h.threads)) {
    const lines = list.filter((m) => anchorVisible(m.anchor, messages));
    if (lines.length) threads[key] = lines;
  }
  const now = phoneNow(h, messages);
  const expired = (s) => now !== null && Number.isFinite(s.at) && now - s.at >= STORY_MINUTES;
  const stories = h.stories.filter((s) => anchorVisible(s.anchor, messages) && (repliesAfter(s.anchor, messages) ?? STORY_LIFE) < STORY_LIFE && !expired(s));
  return { ...h, posts: h.posts.filter((p) => anchorVisible(p.anchor, messages)), stories, threads };
}

/* ---------- accounts ---------- */

/* The story's people, each with a stable key: the host card and linked
   cards (char:), Scope's side characters (cast:), a universe's characters
   (uni:). */
export function storyCast({ chat, character, ensemble = [], universe }) {
  const out = [];
  const seen = new Set();
  const add = (key, name, role) => {
    const n = String(name || "").trim();
    if (!n || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: n, role: cut(role, 70) });
  };
  if (universe) for (const c of universe.characters || []) add(`uni:${c.id || slug(c.name)}`, c.name, c.description);
  if (character) add(`char:${character.id}`, character.name, character.tagline || character.description);
  for (const c of ensemble || []) if (c?.id) add(`char:${c.id}`, c.name, c.tagline || c.description);
  for (const m of scopeOf(chat).cast) if (!m.characterId && m.id) add(`cast:${m.id}`, m.name, m.description);
  return out;
}

/* Every account the phone knows, with handles that stay the same from one
   tick to the next: a story character keeps the handle it was first given
   (kept in `people`), else one from its name. `keyOf(handle)` gives the key
   (YOU for the persona, null for an unknown handle); `nameOf(key)` the name. */
export function phoneAccounts({ chat, character, ensemble, universe, userName = "You", handset }) {
  const h = asHandset(handset ?? chat?.handset);
  const taken = new Set([YOU, slug(userName)]);
  const list = [];
  const pick = (want) => {
    let base = cleanHandle(want) || "user";
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const c = `${base.slice(0, 20 - String(i).length)}${i}`;
      if (!taken.has(c)) return c;
    }
  };
  /* accounts already made keep their handles; story characters pick around them */
  const npcs = Object.values(h.people).filter((p) => p.key.startsWith("npc:") && !taken.has(p.handle));
  for (const p of npcs) taken.add(p.handle);
  for (const p of storyCast({ chat, character, ensemble, universe })) {
    const handle = pick(h.people[p.key]?.handle || slug(p.name));
    taken.add(handle);
    list.push({ ...p, handle, story: true });
  }
  for (const p of npcs) list.push({ key: p.key, name: p.name, handle: p.handle, role: p.role || p.bio || "" });
  const byHandle = new Map(list.map((p) => [p.handle, p.key]));
  const byKey = new Map(list.map((p) => [p.key, p]));
  const you = slug(userName);
  return {
    list,
    keyOf: (handle) => {
      const x = cleanHandle(handle);
      if (!x) return null;
      if (x === YOU || x === you) return YOU;
      return byHandle.get(x) || null;
    },
    nameOf: (key) => (key === YOU ? userName : byKey.get(key)?.name || h.people[key]?.name || String(key || "").replace(/^\w+:/, "")),
    handleOf: (key) => (key === YOU ? YOU : byKey.get(key)?.handle || h.people[key]?.handle || slug(String(key || "").replace(/^\w+:/, ""))),
  };
}

/* ---------- the old request (deprecated: phoneBatch.js replaces it) ---------- */

const limitsOf = (level) => {
  const lim = PHONE_LEVELS[level] || PHONE_LEVELS.light;
  return { ...lim, comments: lim.glimpse * 2 };
};

/* @deprecated: the 3.2.0 system prompt, in sections. */
export const phoneSystem = {
  intro: (u) =>
    `You run the phones in an ongoing roleplay story. This is ${u}'s phone, logged in as ${u}. ` +
    `Write what has appeared on it since it was last checked: posts on Murmur (a short-post network), photos on Glimpse (a photo-sharing app), and private messages to ${u}.`,
  knowledge: (u) =>
    "Who knows what:\n" +
    "- Every account writes in its own voice, from its own life, and knows only what it saw, was told, or what is public. Nobody knows another person's thoughts, conversations they were not part of, or what happened out of their sight. Rumours stay uncertain.\n" +
    `- The people from the story post as themselves, as they are right now according to the scene notes and the latest story. Someone busy, asleep, or in the middle of the scene with ${u} stays quiet or posts later.\n` +
    `- The feed is ${u}'s own. Who appears in it follows from who ${u} is: the people they know, the places they go, their work and interests, as [${u}] and the story describe them. People address ${u} the way they would address that particular person.\n` +
    `- Friends, strangers, local accounts and outlets of this world fill the feed with their own lives and with public events. Not everything is about ${u}.\n` +
    `- This phone shows only what ${u} can see: public posts, and messages sent to ${u}. Private messages between other people never appear.\n` +
    `- Never write anything as ${u}: no posts, replies, comments or messages from them.`,
  writing: (u, lim) =>
    "What to write:\n" +
    `- Only what would really have appeared in this stretch of the story; a quiet stretch can be almost empty. At most ${lim.murmur} Murmur posts, ${lim.glimpse} Glimpse photos, ${lim.comments} comments and ${lim.messages} messages. Fewer is fine.\n` +
    `- Answer ${u}'s new posts, comments and messages first, where someone would.\n` +
    "- People reply to each other and continue threads, using replyTo with an id from [Already on the phone].\n" +
    `- A message comes only from someone with a reason to text ${u} now, and reads like texting: short, in that person's habits.\n` +
    "- A Glimpse photo is described, not shown: what the picture shows, framing and mood, in one or two sentences, plus the caption its poster would write.\n" +
    "- Use the story's language, names, places and era. Hashtags and emoji only where that person would use them. Never use em-dashes.",
  format: () =>
    "Reply with ONE JSON object and nothing else, no code fence:\n" +
    '{"people":[{"handle":"","name":"","bio":"one line"}],\n' +
    ' "murmur":[{"by":"handle","text":"","replyTo":"optional id"}],\n' +
    ' "glimpse":[{"by":"handle","photo":"what the picture shows","caption":""}],\n' +
    ' "comments":[{"on":"id of a Glimpse post","by":"handle","text":""}],\n' +
    ' "messages":[{"from":"handle","text":""}]}\n' +
    '"people" lists only new accounts not in [Accounts]. Use [] for a list with nothing in it. Handles: 2-20 of a-z 0-9 _ . with no @.',
};

const speakerOf = (m, { userName, charLabel }) =>
  m.role === "user" ? userName : m.role === "system" ? "Narrator" : m.speaker || charLabel;

/* The newest messages as "Speaker: text", newest kept, `max` characters. */
function latestLines(messages, names, { count = 8, max = 2500 } = {}) {
  const out = [];
  let used = 0;
  for (const m of (messages || []).filter((x) => x && String(x.content || "").trim()).slice(-count).reverse()) {
    const room = max - used;
    if (room < 80) break;
    let line = `${speakerOf(m, names)}: ${String(m.content).replace(/\s+/g, " ").trim()}`;
    if (line.length > room) line = `…${line.slice(line.length - room + 1)}`;
    out.unshift(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/* Lines up to `max` characters in all, whole lines only. */
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

/* @deprecated: one 3.2.0 tick request: { system, user, maxTokens }. */
export function phoneRequest({ chat, character, ensemble = [], universe, persona, userName, messages, memory, worldLog = [] }) {
  const u = userName || persona?.name || "You";
  const h = handsetOf(chat);
  const lim = limitsOf(h.level);
  const msgs = Array.isArray(messages) ? messages : chat?.messages || [];
  const accounts = phoneAccounts({ chat, character, ensemble, universe, userName: u, handset: h });
  const at = (key) => `@${accounts.handleOf(key)}`;
  const vis = visiblePhone(h, msgs);
  const sections = [];

  if (universe) {
    const story = cut(universe.story || universe.description || "", 600);
    sections.push(`[Story]\nThe world of "${universe.name}".${story ? ` ${story}` : ""}`);
  } else if (character) {
    const lines = [`${character.name}: ${cut(character.description || character.tagline || "", 400)}`];
    for (const c of ensemble || []) if (c?.name) lines.push(`${c.name}: ${cut(c.tagline || c.description || "", 140)}`);
    sections.push(`[Story]\n${lines.join("\n")}`);
  }

  sections.push(`[${u}]\n${cut(persona?.description || "", 300) || `${u}, the person this phone belongs to.`}`);

  const accountLines = [`@${YOU} = ${u} (never write as them)`];
  for (const p of accounts.list.slice(0, 24)) accountLines.push(cut(`@${p.handle} ${p.name}${p.role ? `: ${p.role}` : ""}`, 110));
  sections.push(`[Accounts]\n${accountLines.join("\n")}`);

  const sceneLive = chat?.scene?.text?.trim() && (!chat.scene.lastId || msgs.some((m) => m.id === chat.scene.lastId));
  const stands = sceneLive ? chat.scene.text.trim() : str(memory?.summary).trim();
  if (stands) sections.push(`[Where the story stands]\n${stands.length > 800 ? `${stands.slice(0, 799)}…` : stands}`);

  if (universe && worldLog?.length) {
    sections.push(`[Happening in the world]\n${worldLog.slice(-3).map((e) => `- ${cut(e.text || e, 200)}`).join("\n")}`);
  }

  const charLabel = universe?.name || character?.name || "Narrator";
  const latest = latestLines(msgs, { userName: u, charLabel });
  if (latest) sections.push(`[Latest in the story]\n${latest}`);

  const postLine = (p) => {
    const where = p.kind === "reply" ? `reply to #${p.ref}` : p.kind === "quote" ? `quote of #${p.ref}` : p.kind === "repost" ? `repost of #${p.ref}` : p.photo ? "photo" : "post";
    const body = p.photo ? `[${cut(p.photo, 60)}] ${p.text}` : p.text;
    return `#${p.id} ${at(p.by)} (${where}): ${cut(body, 80)}`;
  };
  const already = vis.posts.slice(0, 10).reverse().map(postLine);
  sections.push(`[Already on the phone]\n${already.length ? already.join("\n") : "Nothing yet. This is the first time the phone is checked."}`);

  const mine = [];
  for (const p of [...vis.posts].reverse()) {
    if (p.by !== YOU || p.tick <= h.tick.n) continue;
    if (p.kind === "reply") mine.push(`- replied to #${p.ref} (#${p.id}): ${cut(p.text, 160)}`);
    else if (p.kind === "quote") mine.push(`- quoted #${p.ref} (#${p.id}): ${cut(p.text, 160)}`);
    else if (p.photo) mine.push(`- posted a photo (#${p.id}) [${cut(p.photo, 100)}]: ${cut(p.text, 120)}`);
    else mine.push(`- posted (#${p.id}): ${cut(p.text, 160)}`);
  }
  for (const [key, list] of Object.entries(vis.threads)) {
    for (const m of list) if (m.from === YOU && m.tick > h.tick.n) mine.push(`- messaged ${at(key)}: ${cut(m.text, 160)}`);
  }
  if (mine.length) sections.push(`[${u}'s new activity]\n${capLines(mine, 700)}`);

  const open = [];
  for (const [key, list] of Object.entries(vis.threads)) {
    if (!list.some((m) => m.tick > h.tick.n - 3)) continue;
    open.push(`With ${at(key)}:\n${list.slice(-4).map((m) => `  ${m.from === YOU ? `@${YOU}` : at(m.from)}: ${cut(m.text, 110)}`).join("\n")}`);
  }
  if (open.length) sections.push(`[Open conversations]\n${capLines(open, 900)}`);

  sections.push(`Write what appeared on ${u}'s phone since then.`);

  const system = [phoneSystem.intro(u), phoneSystem.knowledge(u), phoneSystem.writing(u, lim), phoneSystem.format()].join("\n\n");
  return { system, user: sections.join("\n\n"), maxTokens: PHONE_MAX_TOKENS };
}

/* ---------- reading the old answer (deprecated: phoneBatch.js) ---------- */

const listOf = (v) => (Array.isArray(v) ? v.filter(isRecord) : []);

/* @deprecated. The model's answer, or null when there is no JSON object in
   it at all. Never throws: a list of the wrong shape is empty, a wrong item dropped. */
export function parsePhone(text) {
  let value;
  try { value = parseModelJson(text).value; } catch { return null; }
  if (!isRecord(value)) return null;
  return {
    people: listOf(value.people),
    murmur: listOf(value.murmur ?? value.posts),
    glimpse: listOf(value.glimpse ?? value.photos),
    comments: listOf(value.comments),
    messages: listOf(value.messages ?? value.dms),
  };
}

/* A new feed item with counts at zero. */
function feedItem({ id, by, text, kind = "post", ref, photo, tick, anchor, pot, birth = false, at }) {
  const stats = birth && pot ? birthStats(cleanStats(pot)) : { ...ZERO_STATS };
  const out = { id, by, text, kind };
  if (kind !== "post" && ref) out.ref = ref;
  if (photo) out.photo = photo;
  out.stats = stats;
  out.pot = cleanPot(pot, stats);
  out.ago = 0;
  out.tick = tick;
  out.anchor = anchor;
  if (Number.isFinite(at)) out.at = at;
  return out;
}

/* `field` of post `id` up or down by `d`, floor and ceiling together, so the
   shown number moves by exactly `d` at once and never goes below zero. */
function bump(posts, id, field, d) {
  return posts.map((p) => {
    if (p.id !== id) return p;
    const s = Math.max(0, (p.stats?.[field] || 0) + d);
    return { ...p, stats: { ...p.stats, [field]: s }, pot: { ...p.pot, [field]: Math.max(s, (p.pot?.[field] || 0) + d) } };
  });
}

/* What a reply or quote aims at: an existing post; a reply to a reply or a
   repost aims at its root, so replies stay flat. */
function rootOf(posts, id) {
  const x = str(id).trim().replace(/^#/, "");
  let p = x && posts.find((q) => q.id === x);
  for (let i = 0; p && (p.kind === "reply" || p.kind === "repost") && i < 4; i++) p = posts.find((q) => q.id === p.ref);
  return p && p.kind !== "reply" && p.kind !== "repost" ? p : null;
}

/* @deprecated (phoneBatch.js mergeBatch replaces it). A 3.2.0 tick's answer
   folded into the v2 handset: checked, mapped to keys, capped. `anchor` is
   the message the tick ran after; `keyOf(handle)` maps a handle to a key (YOU
   for the persona, null for someone new, who becomes an npc); `nameOf(key)`
   names a story character; `messages`, when given, prunes what hangs on a
   message that no longer exists. Anything by the persona is dropped.
   `answered`, when given, lists the ids of the persona's items the request
   was built with: anything the persona did while it ran stays new (moved to
   the next tick, with `pending` kept) so the next tick answers it. */
export function mergeTick(handset, parsed, { anchor, keyOf = () => null, nameOf, messages, answered } = {}) {
  const h = asHandset(handset);
  const lim = limitsOf(h.level);
  const n = h.tick.n + 1;
  const at = cleanAnchor(anchor);
  /* only what hangs on a message that is gone is dropped; what hangs on
     another swipe of an existing message comes back when swiped to */
  const live = (x) => !messages || isRootAnchor(x.anchor) || (x.anchor?.id && messages.some((m) => m?.id === x.anchor.id));
  let posts = h.posts.filter(live);
  const threads = {};
  for (const [key, list] of Object.entries(h.threads)) {
    const lines = list.filter(live);
    if (lines.length) threads[key] = lines;
  }
  const people = { ...h.people };
  const p = parsed && typeof parsed === "object" ? parsed : {};

  for (const x of listOf(p.people)) {
    const handle = cleanHandle(x.handle);
    if (!handle) continue;
    const known = keyOf(handle);
    if (known) continue;
    const key = `npc:${handle}`;
    if (people[key]) continue;
    const person = { key, handle, name: clean(x.name, 60) || handle };
    const bio = clean(x.bio, 160);
    if (bio) person.bio = bio;
    const fame = fameOf(x.fame);
    if (fame !== null) person.fame = fame;
    people[key] = person;
  }
  /* who wrote it, as a key; null drops the item */
  const resolve = (raw) => {
    const handle = cleanHandle(raw);
    if (!handle) return null;
    const key = keyOf(handle);
    if (key === YOU) return null;
    if (key) {
      if (!people[key]) people[key] = { key, handle, name: clean(nameOf?.(key), 60) || handle };
      return key;
    }
    const npc = `npc:${handle}`;
    if (!people[npc]) people[npc] = { key: npc, handle, name: handle };
    return npc;
  };
  const repeat = (by, text) => posts.some((q) => q.by === by && q.text === text);
  if (!at) return { ...h, people: h.people, posts, threads, tick: { ...h.tick } };

  const fresh = [];
  let i = 0;
  const id = (c) => `${c}${n}${(i++).toString(36)}`;
  const reply = (target, item) => {
    posts = bump(posts, target.id, "replies", 1);
    fresh.push({ ...item, kind: "reply", ref: target.id });
  };
  let count = 0;
  for (const x of listOf(p.murmur)) {
    if (count >= lim.murmur) break;
    const text = clean(x.text, TEXT_LIMITS.post);
    const by = text && resolve(x.by);
    if (!by || repeat(by, text)) continue;
    const target = x.replyTo ? rootOf(posts, x.replyTo) : null;
    const item = feedItem({ id: id("m"), by, text, tick: n, anchor: at });
    if (target) reply(target, item);
    else fresh.push(item);
    count++;
  }
  count = 0;
  for (const x of listOf(p.glimpse)) {
    if (count >= lim.glimpse) break;
    const photo = clean(x.photo, TEXT_LIMITS.photo);
    const text = clean(x.caption ?? x.text, TEXT_LIMITS.post);
    const by = photo && resolve(x.by);
    if (!by) continue;
    fresh.push(feedItem({ id: id("g"), by, text, photo, tick: n, anchor: at }));
    count++;
  }
  count = 0;
  for (const x of listOf(p.comments)) {
    if (count >= lim.comments) break;
    const target = rootOf(posts, x.on ?? x.replyTo);
    const text = target && clean(x.text, TEXT_LIMITS.post);
    const by = text && resolve(x.by);
    if (!by) continue;
    reply(target, feedItem({ id: id("c"), by, text, tick: n, anchor: at }));
    count++;
  }
  count = 0;
  for (const x of listOf(p.messages)) {
    if (count >= lim.messages) break;
    const text = clean(x.text, TEXT_LIMITS.dm);
    const from = text && resolve(x.from ?? x.by);
    if (!from) continue;
    threads[from] = [...(threads[from] || []), { id: id("d"), from, text, tick: n, anchor: at }].slice(-THREAD_LINES);
    count++;
  }
  /* newest first: the model writes in order, so its last item is newest */
  posts = [...fresh.reverse(), ...posts].slice(0, POST_CAP);
  let pending = false;
  if (answered) {
    const done = new Set(answered);
    const later = (x) => (x.tick >= n && !done.has(x.id) ? ((pending = true), { ...x, tick: n + 1 }) : x);
    posts = posts.map((q) => (q.by === YOU ? later(q) : q));
    for (const [key, list] of Object.entries(threads)) threads[key] = list.map((m) => (m.from === YOU ? later(m) : m));
  }
  return { ...h, people: cleanPeople(people), posts, threads, tick: { ...h.tick, n, lastMsgId: at.id, pending, seeded: true } };
}

/* ---------- the persona's own actions (local, never a model call) ---------- */

const ownId = () => `y${uid().slice(0, 7)}`;

/* One persona action on the phone, as it takes in-world time:
     phoneAct(handset, messages, kind, (h, { at, anchor }) => newHandset)
   `kind` is a PHONE_COST key (dm, post, reply, quote, comment, story,
   transfer). `fn` gets the handset and { at: now + PHONE_COST[kind] (left
   out before setup), anchor: a loose anchor on the chat's last message
   (ROOT_ANCHOR in an empty chat) }. When the action took (a new posts[0],
   stories[0], bank.tx[0] or last line of a thread), the result comes back
   with the clock moved on by the cost (spendClock); otherwise the handset as
   given, so an empty text spends nothing. */
export function phoneAct(handset, messages, kind, fn) {
  const h = asHandset(handset);
  const cost = PHONE_COST[kind] || 0;
  const now = phoneNow(h, messages);
  const msgs = Array.isArray(messages) ? messages : [];
  const opts = { anchor: looseAnchorOf(msgs.at(-1)), ...(now !== null ? { at: now + cost } : {}) };
  const next = typeof fn === "function" ? fn(h, opts) : h;
  if (!isRecord(next) || actSignature(next) === actSignature(h)) return handset;
  return spendClock(asHandset(next), cost, msgs);
}
const actSignature = (h) => {
  const parts = [h.posts?.[0]?.id, h.stories?.[0]?.id, h.bank?.tx?.[0]?.id];
  for (const [k, list] of Object.entries(isRecord(h.threads) ? h.threads : {})) parts.push(`${k}=${Array.isArray(list) ? list.at(-1)?.id : ""}`);
  return parts.join("|");
};

/* The chat with what hung loose on message `messageId` moved to the message
   before it (ROOT_ANCHOR when it was the first), so deleting one message
   keeps what the persona and the phone did after it: posts, stories, DM
   lines, bank lines, the clock's anchors and the world log's loose entries.
   Strict anchors stay (they go with the message). Call it with the chat as
   it is before the message is removed; it does not remove it. Pure. */
export function keepPhoneOnDelete(chat, messageId) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const i = messages.findIndex((m) => m?.id === messageId);
  if (!chat || i < 0) return chat;
  const to = i > 0 ? looseAnchorOf(messages[i - 1]) : ROOT_ANCHOR;
  const loose = (a) => isRecord(a) && a.any === true && a.id === messageId;
  const move = (x) => (isRecord(x) && loose(x.anchor) ? { ...x, anchor: to } : x);
  const out = { ...chat };
  const raw = chat.handset;
  if (isRecord(raw)) {
    const h = normalizeHandset(raw);
    if (h) {
      const threads = Object.fromEntries(Object.entries(h.threads).map(([k, list]) => [k, list.map(move)]));
      const clock = { ...h.clock, ...(h.clock.at.id === messageId ? { at: to } : {}), ...(h.clock.sync.id === messageId ? { sync: to } : {}) };
      out.handset = { ...h, posts: h.posts.map(move), stories: h.stories.map(move), threads, bank: { ...h.bank, tx: h.bank.tx.map(move) }, clock };
    }
  }
  if (Array.isArray(chat.world?.log)) out.world = { ...chat.world, log: chat.world.log.map(move) };
  return out;
}

/* A post by the persona; the new item is posts[0].
     { text, photo }            a post (text, a photo description, or both)
     { kind: "reply", ref }     a reply (text needed); a reply to a reply goes
                                to its root; `ref` may be a story id (a comment)
     { kind: "quote", ref }     a quote (text needed)
   The new item starts at zero: its numbers come with the next refresh
   (mergeBatch), which gives it a pot from the persona's fame; `pot` is
   ignored (kept in the signature for old callers). A reply or quote adds one
   to its target's count at once. Legacy { app, replyTo } still works.
   `at`: the in-world minute it goes up (phoneClock.js phoneNow), if known. */
export function addPost(handset, { kind, text = "", photo = "", ref, replyTo, pot: _pot, at } = {}, anchor) {
  const pot = undefined;
  const h = asHandset(handset);
  const a = cleanAnchor(anchor);
  const body = String(text || "").trim().slice(0, TEXT_LIMITS.post);
  const pic = String(photo || "").trim().slice(0, TEXT_LIMITS.photo);
  const to = ref ?? replyTo;
  const k = kind || (to ? "reply" : "post");
  if (!a || !["post", "reply", "quote"].includes(k)) return h;
  const tick = h.tick.n + 1;
  let posts = h.posts;
  let item;
  if (k === "post") {
    if (!body && !pic) return h;
    item = feedItem({ id: ownId(), by: YOU, text: body, photo: pic, tick, anchor: a, pot, birth: true, at });
  } else {
    const story = k === "reply" && !rootOf(posts, to) ? h.stories.find((x) => x.id === to) : null;
    if (story) {
      if (!body) return h;
      item = feedItem({ id: ownId(), by: YOU, text: body, kind: "reply", ref: story.id, tick, anchor: a, at });
      return { ...h, posts: [item, ...posts].slice(0, POST_CAP), stories: recountStories(h.stories, [item, ...posts]), tick: { ...h.tick, pending: true } };
    }
    const target = k === "reply" ? rootOf(posts, to) : posts.find((p) => p.id === to && p.kind !== "repost");
    if (!target || !body) return h;
    item = feedItem({ id: ownId(), by: YOU, text: body, kind: k, ref: target.id, photo: k === "quote" ? pic : "", tick, anchor: a, pot, birth: true, at });
    posts = bump(posts, target.id, k === "reply" ? "replies" : "quotes", 1);
  }
  return { ...h, posts: recount([item, ...posts].slice(0, POST_CAP)), tick: { ...h.tick, pending: true } };
}

/* A story by the persona (text, a photo description, or both); `at` as in addPost. */
export function addStory(handset, { text = "", photo = "", at } = {}, anchor) {
  const h = asHandset(handset);
  const a = cleanAnchor(anchor);
  const body = String(text || "").trim().slice(0, TEXT_LIMITS.post);
  const pic = String(photo || "").trim().slice(0, TEXT_LIMITS.photo);
  if (!a || (!body && !pic)) return h;
  /* no reactions yet: they come with the next refresh */
  const story = { id: ownId(), by: YOU, text: body, ...(pic ? { photo: pic } : {}), stats: { likes: 0, replies: 0 }, tick: h.tick.n + 1, anchor: a, ...(Number.isFinite(at) ? { at } : {}) };
  return { ...h, stories: [story, ...h.stories].slice(0, STORY_CAP), tick: { ...h.tick, pending: true } };
}

/* The persona's like on a story, on or off. */
export function toggleStoryLike(handset, storyId) {
  const h = asHandset(handset);
  const s0 = h.stories.find((x) => x.id === storyId);
  if (!s0 || s0.by === YOU) return h;
  const on = !s0.liked;
  const stories = h.stories.map((x) => {
    if (x.id !== storyId) return x;
    const stats = { ...x.stats, likes: Math.max(0, x.stats.likes + (on ? 1 : -1)) };
    if (on) return { ...x, stats, liked: true };
    const { liked: _l, ...rest } = x;
    return { ...rest, stats };
  });
  return { ...h, stories };
}

/* A story's reactions for the UI: { likes, replies (as repliesTo), likedBy,
   liked, seen }. `seen` (seen.stories) is the ring's source: unseen shows. */
export function storyReactions(handset, storyId) {
  const h = asHandset(handset);
  const s0 = h.stories.find((x) => x.id === storyId);
  if (!s0) return null;
  return {
    likes: s0.stats.likes,
    ...(s0.pot ? { pot: s0.pot.likes } : {}),
    replies: repliesTo(h, storyId),
    likedBy: s0.likedBy || [],
    liked: !!s0.liked,
    seen: s0.by === YOU || h.seen.stories.includes(storyId),
  };
}

/* A message from the persona to `personKey`. `at`: the in-world minute it
   is sent (phoneClock.js phoneNow; default the clock's last check). The
   first line of an unanswered streak decides, in code, whether and when
   they read and answer it (handset.dmWait, planDm); a follow-up keeps that,
   except one sent a day or more after a "no answer", which rolls once more. */
export function addMessage(handset, personKey, text, anchor, { at } = {}) {
  const h = asHandset(handset);
  const a = cleanAnchor(anchor);
  const body = String(text || "").trim().slice(0, TEXT_LIMITS.dm);
  if (!a || !body || typeof personKey !== "string" || !personKey || personKey === YOU) return h;
  const sent = Number.isFinite(at) ? at : cleanClock(h.clock).last;
  const line = { id: ownId(), from: YOU, text: body, tick: h.tick.n + 1, anchor: a, at: sent };
  const before = h.threads[personKey] || [];
  const lines = [...before, line].slice(-THREAD_LINES);
  const prev = h.dmWait[personKey];
  let wait = prev;
  if (!(before.at(-1)?.from === YOU && prev)) wait = planDm(h, personKey, line, lines);
  else if (prev.due === null && !prev.re && sent - prev.sent >= 1440) wait = { ...planDm(h, personKey, line, lines, { retry: true }), re: 1 };
  return { ...h, threads: { ...h.threads, [personKey]: lines }, dmWait: { ...h.dmWait, [personKey]: wait }, tick: { ...h.tick, pending: true } };
}

/* The persona's like, on or off; the post's likes move by one at once. */
export function toggleLike(handset, postId) {
  const h = asHandset(handset);
  const post = h.posts.find((p) => p.id === postId);
  if (!post) return h;
  const on = !post.liked;
  const posts = bump(h.posts, postId, "likes", on ? 1 : -1).map((p) => (p.id !== postId ? p : on ? { ...p, liked: true } : (({ liked, ...rest }) => rest)(p)));
  return { ...h, posts };
}

/* The persona's repost, on or off; the post's reposts move by one at once.
   (Lifting `pot` for a famous persona is phoneStats.js's.) */
export function toggleRepost(handset, postId) {
  const h = asHandset(handset);
  const post = h.posts.find((p) => p.id === postId && p.kind !== "repost");
  if (!post) return h;
  const on = !post.reposted;
  const posts = bump(h.posts, postId, "reposts", on ? 1 : -1).map((p) => (p.id !== postId ? p : on ? { ...p, reposted: true } : (({ reposted, ...rest }) => rest)(p)));
  return { ...h, posts };
}

/* A picture on a post or story: a developed photo or one the persona
   attached (the UI's, never the model's). Nothing changes when it is gone.
   Past IMAGE_CAP pictured posts, the oldest go back to their description. */
export function setPostImage(handset, postId, image) {
  const h = asHandset(handset);
  if (typeof image !== "string" || !image) return h;
  if (h.posts.some((p) => p.id === postId)) {
    let left = IMAGE_CAP - 1;
    const posts = h.posts.map((p) => {
      if (p.id === postId) return { ...p, image };
      if (!p.image) return p;
      if (left-- > 0) return p;
      const { image: _drop, ...rest } = p;
      return rest;
    });
    return { ...h, posts };
  }
  if (h.stories.some((s) => s.id === postId)) return { ...h, stories: h.stories.map((s) => (s.id === postId ? { ...s, image } : s)) };
  return h;
}

/* Seen up to now: "feed" (also the old "murmur" | "glimpse"), "bank",
   "mentions", { mentions: tick } (seen up to that tick), { story: id } or
   { thread: key }. */
export function markSeen(handset, what) {
  const h = asHandset(handset);
  if (what === "feed" || PHONE_APPS.includes(what)) return { ...h, seen: { ...h.seen, feed: h.tick.n } };
  if (what === "mentions") return { ...h, seen: { ...h.seen, mentions: Math.max(h.seen.mentions, h.tick.n) } };
  if (isRecord(what) && isInt(what.mentions)) return what.mentions > h.seen.mentions ? { ...h, seen: { ...h.seen, mentions: what.mentions } } : h;
  /* money in: seen up to the newest transaction's tick */
  if (what === "bank") return { ...h, seen: { ...h.seen, bank: Math.max(h.tick.n, ...h.bank.tx.map((x) => x.tick)) } };
  if (isRecord(what) && nonEmpty(what.story)) {
    if (h.seen.stories.includes(what.story)) return h;
    return { ...h, seen: { ...h.seen, stories: [...h.seen.stories, what.story].slice(-SEEN_STORIES_CAP) } };
  }
  if (isRecord(what) && nonEmpty(what.thread)) {
    return { ...h, seen: { ...h.seen, messages: { ...h.seen.messages, [what.thread]: h.tick.n } } };
  }
  return h;
}

/* Turning the phone off keeps what is on it (posts, stories, threads, bank, clock). */
export function setLevel(handset, level) {
  if (!LEVELS.includes(level)) return asHandset(handset);
  return { ...asHandset(handset), level };
}

/* How far Refresh moves the phone's clock: a REFRESH_STEPS id (phoneClock.js);
   anything else leaves the handset as it is. */
export function setRefreshStep(handset, id) {
  const h = asHandset(handset);
  if (stepOf(id).id !== id || h.clock.step === id) return h;
  return { ...h, clock: { ...h.clock, step: id } };
}

/* The persona's standing and profile (the home screen's override, the
   seed's or the profile call's). `traits` merge into the current ones (a
   field set to "" is removed); `fame` sets traits.fame; `from` marks the
   source of every field given ("manual" by default). */
export function setMe(handset, { fame, followers, bio, traits, from = "manual" } = {}) {
  const h = asHandset(handset);
  const src = TRAIT_SOURCES.includes(from) ? from : "manual";
  const next = { ...h.me.traits, ...(isRecord(traits) ? traits : {}), ...(fame !== undefined ? { fame } : {}) };
  const touched = [...Object.keys(isRecord(traits) ? traits : {}), ...(fame !== undefined ? ["fame"] : [])];
  const traitsFrom = { ...(h.me.traitsFrom || {}) };
  for (const k of touched) traitsFrom[k] = src;
  const me = cleanMe({
    ...h.me, fame: undefined, traits: next, traitsFrom,
    ...(followers !== undefined ? { followers } : {}), ...(bio !== undefined ? { bio } : {}),
  });
  /* a bank never used follows a new wealth tier */
  const bank = h.bank.fresh && me.traits.wealth !== traitsOf(h.me).wealth ? newBank(me) : h.bank;
  return { ...h, me, bank };
}

/* ---------- money (local, never a model call) ---------- */

export const bankOf = (handset) => asHandset(handset).bank;
const txId = () => `t${uid().slice(0, 7)}`;
const wholeAmount = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const partyName = (key, name) => clean(name, 60) || String(key || "").replace(/^\w+:/, "");

const txExtra = (world, category, anchor) => {
  const a = anchor ? cleanAnchor(anchor) : null;
  return { ...(world ? { world: true } : {}), ...(TX_CATEGORIES.includes(category) ? { category } : world ? { category: "other" } : {}), ...(a ? { anchor: a } : {}) };
};

/* The persona pays `to` (an account key; a free name with `world`); `at`:
   the in-world minute (phoneAct gives it).
   Returns the handset unchanged when the amount is not a positive number,
   is more than the balance, or `to` is empty. A transfer the persona makes
   sets tick.pending so the respond batch lets the payee react; `world: true`
   marks a payment the batch recorded (a bill, rent), which sets nothing. */
export function transfer(handset, { to, toName, amount, note = "", t, world = false, category, anchor, at } = {}) {
  const h = asHandset(handset);
  const amt = wholeAmount(amount);
  const dest = typeof to === "string" ? to.trim() : "";
  if (!amt || amt > h.bank.balance || (!dest && !(world && clean(toName, 60))) || dest === YOU) return handset;
  const tx = { id: txId(), kind: "sent", amount: amt, note: clean(note, 140), t: Number.isFinite(t) ? t : Date.now(), tick: h.tick.n + 1, source: YOU, to: dest, toName: partyName(dest, toName) || dest, ...txExtra(world, category, anchor), ...(Number.isFinite(at) ? { at } : {}) };
  return { ...h, bank: { balance: h.bank.balance - amt, tx: [tx, ...h.bank.tx].slice(0, BANK_TX_CAP) }, tick: world ? h.tick : { ...h.tick, pending: true } };
}

/* Money in: from an account key, or a payer by name only (`from` ""). */
export function receive(handset, { from = "", fromName, amount, note = "", t, world = false, category, anchor, at } = {}) {
  const h = asHandset(handset);
  const amt = wholeAmount(amount);
  const src = typeof from === "string" ? from.trim() : "";
  if (!amt || src === YOU || (!src && !clean(fromName, 60))) return handset;
  const tx = { id: txId(), kind: "received", amount: amt, note: clean(note, 140), t: Number.isFinite(t) ? t : Date.now(), tick: h.tick.n + 1, source: SOURCE.test(src) ? src : "", from: src, fromName: partyName(src, fromName), ...txExtra(world, category, anchor), ...(Number.isFinite(at) ? { at } : {}) };
  return { ...h, bank: { balance: h.bank.balance + amt, tx: [tx, ...h.bank.tx].slice(0, BANK_TX_CAP) } };
}

/* The bank lines involving one story character (sent to or received
   from them), newest first. */
export function paymentsOf(handset, { character } = {}) {
  if (!character) return [];
  return asHandset(handset).bank.tx.filter((x) => (x.kind === "sent" ? x.to : x.from) === character);
}

/* The persona's newest transfer to `key` that no batch has run after yet
   (the payee is still to react), or null. */
export function reactingTo(handset, key) {
  const h = asHandset(handset);
  return h.bank.tx.find((x) => x.kind === "sent" && !x.world && x.to === key && x.tick > h.tick.n) || null;
}

/* ---------- reading it ---------- */

/* The stored replies to a post, newest first (feed order). */
export function repliesTo(handset, postId) {
  return asHandset(handset).posts.filter((p) => p.kind === "reply" && p.ref === postId);
}

/* A thread's etiquette state: `mine` is the persona's lines since the
   other side last wrote (unanswered by them), `theirs` their lines since the
   persona last wrote (unanswered by the persona), `lastMine` / `lastTheirs`
   the ticks of the newest line of each side (null when none), `sinceMine`
   batches since the persona's newest line, `read` whether the persona has
   opened the thread since their newest line. */
export function threadStreak(handset, key) {
  const h = asHandset(handset);
  const list = h.threads[key] || [];
  let mine = 0;
  let theirs = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.from === YOU) { if (theirs) break; mine++; } else { if (mine) break; theirs++; }
  }
  const lastOf = (f) => { for (let i = list.length - 1; i >= 0; i--) if (f(list[i])) return list[i].tick; return null; };
  const lastMine = lastOf((m) => m.from === YOU);
  const lastTheirs = lastOf((m) => m.from !== YOU);
  return {
    mine, theirs, lastMine, lastTheirs,
    sinceMine: lastMine === null ? null : Math.max(0, h.tick.n - lastMine),
    read: lastTheirs !== null && (h.seen.messages[key] || 0) >= lastTheirs,
  };
}

/* ---------- how DMs go (closeness, closers, waits) ---------- */

/* Who someone is to the persona, read from role, the relationship trait and
   bio: CLOSEST (partner, best friend, family), FRIEND (friends, exes,
   cousins, flatmates, colleagues), FAR (fans, brands, outlets, strangers). */
export const CLOSEST = /\b(partner|girlfriend|boyfriend|wife|husband|spouse|lover|best|mother|father|mum|mom|dad|sister|brother|family)\b/i;
export const FRIEND = /\b(friend|ex|cousin|roommate|flatmate|colleague|coworker|classmate|neighbou?r)\b/i;
export const FAR = /\b(fan|brand|stranger|outlet|media|news|press|shop|store|company|bot|spam|follower)\b/i;

/* 0 cold, 1 known, 2 friend or story character, 3 close. `lines`: the
   thread (default the stored one). */
export function closenessOf(handset, key, lines) {
  const p = handset?.people?.[key] || null;
  const list = Array.isArray(lines) ? lines : handset?.threads?.[key] || [];
  const about = [str(p?.role), str(traitsOf(p || {}).relationship), str(p?.bio)].join(" ");
  if (CLOSEST.test(about)) return 3;
  const story = typeof key === "string" && /^(char|cast|uni):/.test(key);
  if (story || FRIEND.test(about)) return 2;
  const far = FAR.test(str(p?.role)) || officialTier(p || {}) > 0;
  if (far) return list[0] && list[0].from !== YOU ? 1 : 0;
  return list.some((m) => m.from !== YOU) ? 1 : 0;
}

/* A line that ends a conversation: a short sign-off, thanks, an ok, a
   laugh or only emoji (four words at most), or a goodnight or "see you
   tomorrow" anywhere in a line that asks nothing. */
const CLOSER = /^(ok(ay)?|k+|cool|sure|thanks?|thank you|thx|ty|night|good ?night|gn|bye|see (you|ya)|later|ttyl|talk (soon|later)|sleep well|sweet dreams|love you|xo+|haha|lol|[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}\s]+)[\s.!]*$/iu;
const SIGN_OFF = /good ?night|see you (tomorrow|later|soon)|talk (to you )?(tomorrow|later|soon)|sleep well/i;
export function isCloser(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.split(/\s+/).length <= 4 && CLOSER.test(t)) return true;
  return !t.includes("?") && SIGN_OFF.test(t);
}

/* The wait for one line of the persona's (`line`: { id, at, text }) in a
   thread (`lines`, that line included): { line, sent, due, seen }, minutes
   on the phone's clock; due / seen null when no answer comes / never read.
   Seeded by the line id (a retry by `<id>:dm2`). */
export function planDm(handset, key, line, lines = [], { retry = false } = {}) {
  const p = handset?.people?.[key] || null;
  const sent = Number.isFinite(line?.at) ? line.at : 0;
  const theirs = lines.filter((m) => m.from !== YOU && m.id !== line?.id);
  const lastTheirs = theirs.at(-1);
  const active = !!lastTheirs && Number.isFinite(lastTheirs.at) && sent - lastTheirs.at <= 30 && !lastTheirs.end;
  const r = dmReply({
    gap: traitsOf(p || {}).fame - traitsOf(handset?.me || {}).fame,
    closeness: closenessOf(handset, key, lines),
    active,
    closer: isCloser(line?.text),
    retry,
    official: officialTier(p || {}),
    theyOpened: !!lines[0] && lines[0].from !== YOU,
    seed: `${line?.id}:${retry ? "dm2" : "dm"}`,
  });
  return { line: line?.id, sent, due: r.answer ? sent + r.delay : null, seen: r.seen === null ? null : sent + r.seen };
}

/* The answers due by `now`: [{ key, line, sent, due, seen }] whose line still
   shows (`messages`, when given) and that nobody has answered yet. */
export function dueDms(handset, now, messages) {
  const h = asHandset(handset);
  const threads = messages ? visiblePhone(h, messages).threads : h.threads;
  const out = [];
  for (const [key, w] of Object.entries(h.dmWait)) {
    if (w.due === null || !(w.due <= now)) continue;
    const list = threads[key] || [];
    const k = list.findIndex((m) => m.id === w.line);
    if (k < 0 || list.slice(k + 1).some((m) => m.from !== YOU)) continue;
    out.push({ key, ...w });
  }
  return out;
}

/* A thread's state at `now`: { last, turn ("them": the persona wrote last;
   "you": they did), closed, since (minutes since the last line), wait }, or
   null for no thread. Closed: the last line ended it (end, or a closer), or
   theirs has stood 12 hours, or the persona's closer gets no answer.
   Reads the handset as given (a visiblePhone() one works). */
export function threadState(handset, key, now) {
  const list = handset?.threads?.[key] || [];
  const last = list.at(-1);
  if (!last) return null;
  const wait = handset?.dmWait?.[key] || null;
  const since = Number.isFinite(last.at) && Number.isFinite(now) ? Math.max(0, now - last.at) : null;
  const mine = last.from === YOU;
  const closed = !!last.end || isCloser(last.text) || (!mine && since !== null && since >= 720) || (mine && wait?.due === null && isCloser(last.text));
  return { last, turn: mine ? "them" : "you", closed, since, wait };
}

/* What the persona's last line shows at `now`: { seen } (the minute they read
   it, or null: delivered, not read), or null when the last line is theirs. */
export function dmStatus(handset, key, now) {
  const last = handset?.threads?.[key]?.at(-1);
  if (!last || last.from !== YOU) return null;
  const w = handset?.dmWait?.[key];
  return { seen: w && w.seen !== null && Number.isFinite(now) && now >= w.seen ? w.seen : null };
}

/* What waits on the persona's side for the next refresh: posts, replies,
   quotes, stories, DM lines and transfers made since the last batch. */
export function waitingActions(handset) {
  const h = asHandset(handset);
  const n = h.tick.n;
  let count = h.posts.filter((p) => p.by === YOU && p.tick > n).length + h.stories.filter((x) => x.by === YOU && x.tick > n).length;
  for (const list of Object.values(h.threads)) count += list.filter((m) => m.from === YOU && m.tick > n).length;
  count += h.bank.tx.filter((x) => x.kind === "sent" && !x.world && x.tick > n).length;
  return count;
}

/* What the persona is named in, newest first: [{ id, kind, by, post?,
   story?, tick, unread }] (unread: tick past seen.mentions). Kinds, one item
   per post, the first that fits:
     "comment"  a reply by someone else to the persona's post or story
     "quote"    a quote of the persona's post
     "mention"  a post, reply or quote whose text has @you or the persona's
                handle (@slug(userName)), or someone's story with it in the
                text or the photo (that one carries `story`, no `post`)
   A plain name is not a mention; a reply under someone else's post that the
   persona replied to is not either. `messages` (optional) limits to what shows. */
export function mentionsOf(handset, { messages, userName } = {}) {
  const h0 = asHandset(handset);
  const h = messages ? visiblePhone(h0, messages) : h0;
  const byId = new Map(h.posts.map((p) => [p.id, p]));
  const ownStories = new Set(h.stories.filter((x) => x.by === YOU).map((x) => x.id));
  const seen = h.seen.mentions || 0;
  const out = [];
  for (const p of h.posts) {
    if (p.by === YOU || p.kind === "repost") continue;
    const target = p.ref ? byId.get(p.ref) : null;
    const item = { id: `n:${p.id}`, by: p.by, post: p.id, tick: p.tick, unread: p.tick > seen };
    if (p.kind === "reply" && (target?.by === YOU || ownStories.has(p.ref))) out.push({ ...item, kind: "comment", ...(ownStories.has(p.ref) ? { story: p.ref } : {}) });
    else if (p.kind === "quote" && target?.by === YOU) out.push({ ...item, kind: "quote" });
    else if (tagsYou(p.text, userName)) out.push({ ...item, kind: "mention" });
  }
  for (const x of h.stories) {
    if (x.by === YOU || !(tagsYou(x.text, userName) || tagsYou(x.photo, userName))) continue;
    out.push({ id: `n:story:${x.id}`, kind: "mention", by: x.by, story: x.id, tick: x.tick, unread: x.tick > seen });
  }
  return newestFirst(out);
}
const newestFirst = (list) => list.map((x, i) => [x, i]).sort((a, b) => b[0].tick - a[0].tick || a[1] - b[1]).map(([x]) => x);
/* @you or @<the persona's handle>, not followed by more handle characters */
function tagsYou(text, userName) {
  const t = String(text || "").toLowerCase();
  if (!t.includes("@")) return false;
  const handles = [YOU];
  const u = String(userName || "").trim();
  if (u) handles.push(slug(u));
  return handles.some((x) => new RegExp(`@${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`).test(t));
}

/* The phone's notifications, newest first: only what is for the persona.
     { id, kind, by?, post?, story?, thread?, tx?, count?, tick, unread }
   kinds: "comment" | "quote" | "mention" (mentionsOf), "dm" | "request"
   (a thread with someone else's lines; count = unread lines), "transfer"
   (money in; count = the amount). Likes, reposts and new posts never
   notify. `messages` (optional) limits to what shows. */
export function notificationsOf(handset, { messages, userName } = {}) {
  const h0 = asHandset(handset);
  const h = messages ? visiblePhone(h0, messages) : h0;
  const out = mentionsOf(h, { userName });
  for (const [key, list] of Object.entries(h.threads)) {
    const seen = h.seen.messages[key] || 0;
    const last = [...list].reverse().find((m) => m.from !== YOU);
    if (!last) continue;
    out.push({ id: `n:dm:${key}`, kind: isRequest(key, list) ? "request" : "dm", by: key, thread: key, count: list.filter((m) => m.from !== YOU && m.tick > seen).length, tick: last.tick, unread: last.tick > seen });
  }
  for (const x of h.bank.tx) {
    if (x.kind === "received") out.push({ id: `n:tx:${x.id}`, kind: "transfer", ...(x.from ? { by: x.from } : {}), tx: x.id, count: x.amount, tick: x.tick, unread: x.tick > (h.seen.bank || 0) });
  }
  return newestFirst(out);
}

/* Everything an account wrote (posts, replies, quotes, reposts), newest
   first; a reply carries its parent post id as `parent`. */
export function activityOf(handset, accountKey) {
  return asHandset(handset).posts.filter((p) => p.by === accountKey).map((p) => (p.kind === "reply" ? { ...p, parent: p.ref } : p));
}

/* A message request: an npc thread the persona never wrote in. */
export const isRequest = (key, lines) => typeof key === "string" && key.startsWith("npc:") && !(lines || []).some((m) => m.from === YOU);

const h0bank = (handset) => asHandset(handset).bank.tx;

/* New items the persona has not seen and did not write: { feed, stories,
   messages, bank, mentions, total }. `total` (the phone's badge) is messages
   + money in + mentions; new feed posts and stories show on their own
   (the Murmur tab, the story rings), never in it. */
export function unread(handset, messages, { userName } = {}) {
  const v = visiblePhone(handset, messages);
  const feed = v.posts.filter((p) => p.by !== YOU && p.tick > v.seen.feed).length;
  const seenStories = new Set(v.seen.stories);
  const stories = v.stories.filter((s) => s.by !== YOU && !seenStories.has(s.id)).length;
  let dms = 0;
  for (const [key, list] of Object.entries(v.threads)) {
    const seen = v.seen.messages[key] || 0;
    dms += list.filter((m) => m.from !== YOU && m.tick > seen).length;
  }
  const bank = h0bank(handset).filter((x) => x.kind === "received" && x.tick > v.seen.bank).length;
  const mentions = mentionsOf(v, { userName }).filter((x) => x.unread).length;
  return { feed, stories, messages: dms, bank, mentions, total: dms + bank + mentions };
}

/* @deprecated (phoneStats.js statsOf replaces it; removed with Murmur.jsx and
   Glimpse.jsx). A v2 post's stored likes; the 3.2.0 formula for anything else. */
export function likeCount(post, fame = 1) {
  if (!post?.id) return 0;
  if (isRecord(post.stats) && Number.isFinite(post.stats.likes)) return post.stats.likes;
  return v1Likes(post, fame);
}

/* ---------- the story's side ---------- */

export const PHONE_NOTE_MAX = 500;
export const PHONE_NOTE_MAX_LIVELY = 900;
/* the "since the last story message" block's own budget, on top */
export const PHONE_NOTE_SINCE_MAX = 1600;
const SINCE_THREAD_LINES = 12;
const PHONE_NOTE_HEAD = "[On the phones lately (public posts are common knowledge; a message is known only to the two people in it; people may act on what they sent or saw; a reply exists only if listed):";

const plural = (w) => (/s$/i.test(w) ? w : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

/* Recent phone activity, for the chat prompt, so the story knows what was
   posted and texted. First, when time passed on the phone since the last
   story message (10 minutes or more) or the persona did something there
   since, a "since the last story message" block (sinceBlock, its own
   PHONE_NOTE_SINCE_MAX): how long, the DMs with story characters since then
   with each thread's state, and the persona's posts, stories and transfers.
   Then, in order: DMs between the persona and story characters
   (last 4 lines a thread, "(unread)" until opened), the persona's posts with
   notable counts, story characters' posts and replies, one line of requests
   and the top topic. On Off only the first two. At most PHONE_NOTE_MAX
   characters (PHONE_NOTE_MAX_LIVELY on Lively). `statsOf(post)`, when given,
   is the shown count; else the count at the post's age on the phone's clock
   (phoneStats.js statsOf over phoneClock.js ageUnits). */
export function phoneNote(chat, { userName = "You", nameOf, statsOf } = {}) {
  const h = handsetOf(chat);
  const off = h.level === "off";
  const max = h.level === "lively" ? PHONE_NOTE_MAX_LIVELY : PHONE_NOTE_MAX;
  const v = visiblePhone(h, chat?.messages || []);
  const u = userName;
  const story = (key) => typeof key === "string" && key !== YOU && !key.startsWith("npc:");
  const name = (key) => (key === YOU ? u : nameOf?.(key) || h.people[key]?.name || String(key).replace(/^\w+:/, ""));
  const q = (t) => `"${cut(t, 90)}"`;
  const byId = new Map(v.posts.map((p) => [p.id, p]));
  const lines = [];

  /* 1. DMs with story characters, the most recent thread first */
  const lastTick = (list) => list[list.length - 1]?.tick || 0;
  const now = clockNowOf(h, chat?.messages || []);
  const since = sinceBlock(h, v, chat?.messages || [], { u, name, story, now });
  const charThreads = Object.entries(v.threads).filter(([k]) => story(k)).sort((a, b) => lastTick(b[1]) - lastTick(a[1]))
    .map(([k, list]) => [k, list.filter((m) => !since.shown.has(m.id))]).filter(([, list]) => list.length);
  /* the persona's last line says whether it was read and answered */
  const waitTag = (key) => {
    const w = h.dmWait[key];
    if (!w) return " (no answer)";
    if (w.seen === null || now < w.seen) return ` (${name(key)} has not read it yet)`;
    return w.due !== null ? " (read, no answer yet)" : " (read, no answer)";
  };
  for (const [key, list] of charThreads) {
    const seen = v.seen.messages[key] || 0;
    const shown = list.slice(-4);
    shown.forEach((m, k) => {
      if (m.from === YOU) lines.push(`${u} texted ${name(key)}: ${q(m.text)}${k === shown.length - 1 ? waitTag(key) : ""}`);
      else lines.push(`${name(key)} texted ${u}: ${q(m.text)}${m.tick > seen ? " (unread)" : ""}`);
    });
  }

  /* 2. the persona's own posts, newest first */
  const countNote = (p) => {
    const s = (statsOf ? statsOf(p) : shownOf(p, ageUnits(p, h, chat?.messages || []))) || ZERO_STATS;
    const likes = Math.round(s.likes || 0);
    if (likes >= 10000) return ` (went viral, ${compactCount(likes)} likes)`;
    if (likes >= 100) return ` (${compactCount(likes)} likes)`;
    return "";
  };
  for (const p of v.posts.filter((x) => x.by === YOU && x.kind !== "repost" && !since.shown.has(x.id)).slice(0, 4)) {
    const parent = p.ref ? byId.get(p.ref) : null;
    const whose = parent ? (parent.by === YOU ? "their own post" : `${name(parent.by)}'s post`) : "a post";
    const what = p.kind === "reply" ? `${u} replied to ${whose}` : p.kind === "quote" ? `${u} quoted ${whose}` : p.photo ? `${u} posted a photo (${cut(p.photo, 60)})` : `${u} posted`;
    lines.push(`${what}${p.text ? `: ${q(p.text)}` : ""}${countNote(p)}`);
  }

  /* 2b. money: up to 3 recent lines */
  const amt = (n) => Math.round(n).toLocaleString("en-US");
  const money = h.bank.tx.filter((x) => !x.anchor || anchorVisible(x.anchor, chat?.messages || [])).slice(0, 3).map((x) => {
    const tag = x.category && x.category !== "other" ? x.category : x.note ? cut(x.note, 40) : "";
    return x.kind === "sent"
      ? `${u} sent ${amt(x.amount)} to ${x.to ? name(x.to) : x.toName}${tag ? ` (${tag})` : ""}`
      : `${u} received ${amt(x.amount)} from ${x.from ? name(x.from) : x.fromName}${tag ? ` (${tag})` : ""}`;
  });
  if (money.length) lines.push(`Money: ${money.join("; ")}.`);

  if (!off) {
    /* 3. story characters' posts and replies */
    for (const p of v.posts.filter((x) => story(x.by) && x.kind !== "repost").slice(0, 4)) {
      const parent = p.ref ? byId.get(p.ref) : null;
      const whose = parent ? `${name(parent.by)}'s post` : "a post";
      const what = p.kind === "reply" ? `${name(p.by)} replied to ${whose}` : p.kind === "quote" ? `${name(p.by)} quoted ${whose}`
        : p.photo ? `${name(p.by)} posted a photo (${cut(p.photo, 60)})` : `${name(p.by)} posted`;
      lines.push(`${what}${p.text ? `: ${q(p.text)}` : ""}`);
    }
    /* 4. requests and the top topic */
    const requests = Object.entries(v.threads).filter(([k, l]) => isRequest(k, l));
    const parts = [];
    if (requests.length) {
      const roles = new Map();
      for (const [k] of requests) { const r = h.people[k]?.role; if (r) roles.set(r, (roles.get(r) || 0) + 1); }
      const [top, n] = [...roles.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      parts.push(`${requests.length} message request${requests.length > 1 ? "s" : ""}${top && n * 2 >= requests.length ? `, mostly ${requests.length > 1 ? plural(top) : top}` : ""}`);
    }
    if (h.world.topics[0]) parts.push(`top topic: ${cut(h.world.topics[0], 120)}`);
    if (parts.length) lines.push(`On ${u}'s phone: ${parts.join("; ")}`);
  }

  const out = [];
  let used = PHONE_NOTE_HEAD.length + 2;
  for (const line of lines) {
    const l = `- ${line}`;
    if (used + l.length + 1 > max) continue;
    out.push(l);
    used += l.length + 1;
  }
  const note = out.length ? `${PHONE_NOTE_HEAD}\n${out.join("\n")}]` : "";
  const events = storyEvents(chat);
  return [events, since.text, note].filter(Boolean).join("\n");
}

/* The "since the last story message" block of phoneNote: { text, shown }
   (shown: the ids of DM lines and posts it carries, left out of the rest). */
function sinceBlock(h, v, messages, { u, name, story, now }) {
  const none = { text: "", shown: new Set() };
  const lastWt = lastWtOf(messages);
  if (!h.tick.seeded || lastWt === null) return none;
  const after = (x) => Number.isFinite(x?.at) && x.at > lastWt;
  const threads = Object.entries(v.threads).filter(([k, list]) => story(k) && list.some(after))
    .sort((a, b) => Math.max(...b[1].filter(after).map((m) => m.at)) - Math.max(...a[1].filter(after).map((m) => m.at)));
  const mine = [
    ...v.posts.filter((p) => p.by === YOU && p.kind !== "repost" && after(p)).map((p) => ({ at: p.at, id: p.id, line: `${u} ${p.kind === "reply" ? "replied" : p.kind === "quote" ? "quoted a post" : p.photo ? `posted a photo (${cut(p.photo, 60)})` : "posted"}${p.text ? `: "${cut(p.text, 120)}"` : ""}` })),
    ...v.stories.filter((x) => x.by === YOU && after(x)).map((x) => ({ at: x.at, id: x.id, line: `${u} posted a story${x.photo ? ` (${cut(x.photo, 60)})` : ""}${x.text ? `: "${cut(x.text, 120)}"` : ""}` })),
    ...h.bank.tx.filter((x) => x.kind === "sent" && !x.world && after(x) && (!x.anchor || anchorVisible(x.anchor, messages))).map((x) => ({ at: x.at, id: x.id, line: `${u} sent ${Math.round(x.amount).toLocaleString("en-US")} to ${x.to ? name(x.to) : x.toName}${x.note ? ` (${cut(x.note, 40)})` : ""}` })),
  ].sort((a, b) => b.at - a.at).slice(0, 3);
  const gap = Math.max(0, now - lastWt);
  if (gap < 10 && !threads.length && !mine.length) return none;
  const head = `[Since the last story message, on ${u}'s phone (about ${spanLabel(gap)} passed in the story):`;
  const tail = "Continue the story from here, after this time.]";
  const shown = new Set();
  const out = [head];
  let used = head.length + tail.length + 2;
  const add = (l) => { if (used + l.length + 1 > PHONE_NOTE_SINCE_MAX) return false; out.push(l); used += l.length + 1; return true; };
  for (const [key, list] of threads) {
    const all = list.filter(after);
    let lines = all.slice(-SINCE_THREAD_LINES);
    const block = () => [`Texts with ${name(key)}:`, ...(lines.length < all.length ? ["…"] : []), ...lines.map((m) => `${m.from === YOU ? u : name(key)}: "${cut(m.text, 160)}"`), dmStateLine(v, key, now, { u, them: name(key) })].filter(Boolean).join("\n");
    /* the oldest lines go first until the thread fits */
    while (lines.length > 1 && used + block().length + 1 > PHONE_NOTE_SINCE_MAX) lines = lines.slice(1);
    if (!add(block())) continue;
    for (const m of lines) shown.add(m.id);
  }
  for (const x of mine) if (add(x.line)) shown.add(x.id);
  out.push(tail);
  return { text: out.join("\n"), shown };
}

/* A thread's state for the story, from threadState and dmWait. */
function dmStateLine(v, key, now, { u, them }) {
  const st = threadState(v, key, now);
  if (!st) return "";
  if (st.closed) return "(conversation ended)";
  if (st.turn === "you") return `(${u} has not answered)`;
  const w = v.dmWait?.[key];
  if (!w || w.seen === null || now < w.seen) return `(${them} has not read it yet)`;
  return w.due !== null ? `(${them} read it, no answer yet)` : `(${them} read it, no answer)`;
}

/* The user's story events and time skips (chat.world.log entries with
   source "you": phoneJob.js worldEvent / skipTime), the last three still
   part of the story, as a block every chat's prompt carries through
   phoneNote; on any level, phone on or off. */
export const STORY_EVENTS_MAX = 600;
const STORY_EVENTS_HEAD = "[Story events (these happened in the story; characters know what they would plausibly know):";
export function storyEvents(chat) {
  const log = Array.isArray(chat?.world?.log) ? chat.world.log : [];
  const shown = log.filter((e) => e && e.source === YOU && typeof e.text === "string" && e.text.trim() && anchorVisible(e.anchor, chat?.messages || [])).slice(-3);
  if (!shown.length) return "";
  const lines = [];
  let used = STORY_EVENTS_HEAD.length + 2;
  for (const e of shown.reverse()) {
    const l = `- ${cut(e.text, 240)}`;
    if (used + l.length + 1 > STORY_EVENTS_MAX) break;
    lines.unshift(l);
    used += l.length + 1;
  }
  return `${STORY_EVENTS_HEAD}\n${lines.join("\n")}]`;
}

export { ROOT_ANCHOR, replyPot };
