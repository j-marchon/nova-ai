// Pure count model for the phone feed. No React, storage, network or Math.random.
// Randomness comes only from rng(seed), seeded by post id and tick.

const KEYS = ["likes", "reposts", "replies", "quotes"];
const BANDS = [[0, 15], [5, 150], [100, 8000], [2000, 400000]];
// Ratios to likes (min, max): reposts 0.15-0.3, replies 0.05-0.12, quotes 0.02-0.05.
const RATIOS = { reposts: [0.15, 0.3], replies: [0.05, 0.12], quotes: [0.02, 0.05] };
// Own-post reply expectation by persona tier (min, max).
const OWN_REPLIES = [[0, 1], [1, 3], [3, 6], [5, 8]];
const OWN_LIKE_RATE = [0.3, 0.08, 0.04, 0.03]; // likes per follower, by tier

const tierOf = (x) => {
  const f = Number(x && typeof x === "object" ? x.fame : x);
  return Number.isFinite(f) ? Math.max(0, Math.min(3, Math.round(f))) : 0;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const AGE_CAP = 1e9;
const POT_MAX = 1e15;
const FOLLOWER_MAX = 1e12;
// Finite non-negative number; +Infinity becomes the cap, NaN becomes 0.
const capped = (v, max) => {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
};
// One seed helper: string as-is, {id, tick} combined, nothing -> "own".
const seedOf = (x) => {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && (x.id != null || x.tick != null)) return `${x.id ?? ""}:${x.tick ?? 0}`;
  return "own";
};

// Deterministic float source in [0,1): xmur3 string hash into mulberry32.
export function rng(seedString) {
  const s = String(seedString ?? "");
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^ (h >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function potBand(fameTier) {
  return { likes: BANDS[tierOf(fameTier)].slice() };
}

const cap = (tier) => BANDS[tier][1] * 2;

function derive(likes, r, floor = {}) {
  const out = { likes: Math.round(likes) };
  for (const k of Object.keys(RATIOS)) {
    const [lo, hi] = RATIOS[k];
    out[k] = Math.max(num(floor[k]), Math.round(likes * (lo + (hi - lo) * r())));
  }
  return out;
}

export function newPot(post, author, { heat } = {}) {
  const tier = tierOf(author);
  const r = rng(seedOf(post));
  const [lo, hi] = BANDS[tier];
  // log-uniform over [lo, hi]; tier 0 (lo 0) uses 1 as the log lower bound
  const lb = Math.log(Math.max(lo, 1));
  const base = Math.round(Math.exp(lb + (Math.log(hi) - lb) * r()));
  const h = heat == null || !Number.isFinite(Number(heat)) ? 1 : clamp(Number(heat), 0.5, 3);
  const likes = clamp(base * h, 0, cap(tier));
  return derive(likes, r);
}

// A new post's first numbers: a visible share of its pot, so the first look
// already shows a believable count (never zero for a pot above 3). The caller
// sets t0 to the post's current age, so growth starts from here.
export const BIRTH_SHARE = 0.35;
export function birthStats(pot) {
  const out = {};
  for (const k of KEYS) {
    const p = Math.max(0, Math.round(num(pot?.[k])));
    out[k] = Math.min(p, p > 3 ? Math.max(1, Math.round(p * BIRTH_SHARE)) : Math.round(p * BIRTH_SHARE));
  }
  return out;
}

export function statsOf(post, age) {
  const stats = post?.stats || {};
  const pot = post?.pot || {};
  const t0 = capped(post?.t0, AGE_CAP);
  const a = Math.max(t0, capped(age, AGE_CAP));
  const f = 1 - Math.exp(-(a - t0) / 3);
  const out = {};
  for (const k of KEYS) {
    const s = Math.max(0, num(stats[k]));
    const p = Math.max(s, Math.min(POT_MAX, num(pot[k] ?? s)));
    out[k] = clamp(Math.round(s + (p - s) * f), s, p);
  }
  return out;
}

// Story replies since the post's anchor (counted by the caller), less the ones
// that had already happened when it was written (`born`, for posts hung on
// ROOT_ANCHOR after the chat began), plus minutes-old / 30.
export function ageOf(post, storyReplies) {
  const replies = Math.max(0, capped(storyReplies, AGE_CAP) - capped(post?.born, AGE_CAP));
  return Math.min(AGE_CAP, replies + capped(post?.ago, AGE_CAP) / 30);
}

// Freeze the shown numbers as the new floor so a pot change never lowers them.
export function rebase(post, age) {
  const stats = statsOf(post, age);
  const t0 = Math.max(capped(post?.t0, AGE_CAP), capped(age, AGE_CAP));
  const pot = { ...stats };
  for (const k of KEYS) pot[k] = Math.max(stats[k], Math.min(POT_MAX, num(post?.pot?.[k])));
  return { ...post, stats, pot, t0 };
}

export function applyEvent(post, event, { author, age } = {}) {
  const base = rebase(post, age);
  const tier = tierOf(author);
  const c = cap(tier);
  const r = rng(`${seedOf(post)}:${event}`);
  const stats = base.stats;
  let pot = { ...base.pot };
  if (event === "viral") {
    const factor = 5 + 15 * r();
    const likes = clamp(Math.max(pot.likes, stats.likes, 1) * factor, stats.likes, c);
    pot = derive(likes, r, pot);
  } else if (event === "ratio") {
    const target = Math.ceil(0.9 * pot.likes);
    pot.replies = Math.max(pot.replies, target);
    pot.quotes = Math.max(pot.quotes, target);
  } else if (event === "fades") {
    pot = { ...stats };
  } else {
    return base;
  }
  for (const k of KEYS) pot[k] = Math.max(stats[k], Math.min(pot[k], k === "likes" ? c : Math.max(c, stats[k])));
  return { ...base, pot };
}

const KIND_KEY = { like: "likes", repost: "reposts", quote: "quotes", reply: "replies" };

export function personaAction(post, kind, { persona, author, age } = {}) {
  const key = KIND_KEY[kind];
  const base = rebase(post, age);
  if (!key) return base;
  const stats = { ...base.stats, [key]: Math.min(POT_MAX, base.stats[key] + 1) };
  const pot = { ...base.pot };
  if (kind === "repost" && tierOf(persona) >= 2 && tierOf(author) <= 1) {
    const m = 2 + 4 * rng(`${seedOf(post)}:repost`)();
    for (const k of KEYS) pot[k] = Math.min(POT_MAX, Math.round(pot[k] * m));
  }
  for (const k of KEYS) pot[k] = Math.max(Math.min(POT_MAX, pot[k]), stats[k]);
  return { ...base, stats, pot };
}

export function responseChance(persona, author, kind, { storyCharacter } = {}) {
  const P = tierOf(persona);
  const A = tierOf(author);
  const reply = () => {
    if (storyCharacter) return 0.9;
    return Math.min(0.95, [0.7, 0.45, 0.15, 0.04][A] + 0.2 * Math.max(0, P - A));
  };
  const noticed = P >= 2 && A <= 1;
  switch (kind) {
    case "like": return noticed ? 0.25 : 0;
    case "repost": return noticed ? 0.5 : 0;
    case "quote": return 0.6 * reply();
    case "reply": return reply();
    case "dm": return storyCharacter ? 1 : reply();
    default: return 0;
  }
}

/* ---------- DM replies ----------

   Whether and when someone answers the persona's DM, decided in code when it
   is sent (phone.js planDm). Rows: their fame minus the persona's, -3 to +3
   (row = gap + 3; gaps beyond are clamped); columns: closeness (0 cold, 1
   known, 2 friend or story, 3 close). Each cell is [chance, profile]; the
   profile picks the delay bucket. Someone below the persona answers more
   and faster the bigger the gap; above, less and slower. Friends, story
   characters (2) and close people (3) answer the same whatever the fame. */
export const DM_ORDER = Object.freeze(["distant", "slow", "casual", "prompt", "eager"]);
export const DM_GAP_MIN = -3;
export const DM_GAP_MAX = 3;
export const DM_TABLE = Object.freeze([
  [[0.93, "eager"], [0.95, "eager"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.88, "eager"], [0.93, "eager"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.75, "prompt"], [0.88, "prompt"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.55, "casual"], [0.8, "casual"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.25, "slow"], [0.6, "casual"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.06, "distant"], [0.4, "slow"], [0.95, "prompt"], [0.98, "eager"]],
  [[0.02, "distant"], [0.25, "distant"], [0.95, "prompt"], [0.98, "eager"]],
]);
/* delay buckets in minutes after the DM was sent: instant, minutes,
   hour-ish, hours, next day, days */
export const DM_BUCKETS = Object.freeze([[0, 0], [2, 30], [30, 180], [180, 720], [720, 2160], [2160, 7200]]);
export const DM_PROFILES = Object.freeze({
  eager: [0.45, 0.35, 0.12, 0.06, 0.02, 0],
  prompt: [0.25, 0.35, 0.22, 0.12, 0.05, 0.01],
  casual: [0.08, 0.22, 0.3, 0.25, 0.12, 0.03],
  slow: [0.02, 0.08, 0.15, 0.3, 0.3, 0.15],
  distant: [0, 0.02, 0.05, 0.18, 0.35, 0.4],
});

const dmDelay = (profile, rb, rd) => {
  const p = DM_PROFILES[profile];
  let acc = 0;
  let k = p.length - 1;
  for (let i = 0; i < p.length; i++) { acc += p[i]; if (rb < acc) { k = i; break; } }
  /* a bucket with no weight is never picked, even at the rounding edge */
  while (k > 0 && !p[k]) k--;
  const [lo, hi] = DM_BUCKETS[k];
  if (!hi) return 0;
  return Math.round(Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * rd));
};

/* { answer, delay, seen }: whether they answer, the minutes after the DM was
   sent that the answer comes (null when none), and the minutes after it that
   they read it (null when never). Seeded: the same input gives the same
   answer. `gap`: their fame minus the persona's; `closeness` 0..3; `active`:
   they wrote in the last half hour; `closer`: the persona's line ended the
   conversation; `retry`: a follow-up a day after no answer; `official`: their
   official tier; `theyOpened`: they started the thread. */
export function dmReply({ gap = 0, closeness = 0, active = false, closer = false, retry = false, official = 0, theyOpened = false, seed } = {}) {
  const g = Math.round(clamp(num(gap), DM_GAP_MIN, DM_GAP_MAX));
  const c = Math.round(clamp(num(closeness), 0, 3));
  let [chance, profile] = DM_TABLE[g - DM_GAP_MIN][c];
  if (active) {
    profile = DM_ORDER[Math.min(DM_ORDER.length - 1, DM_ORDER.indexOf(profile) + 1)];
    chance = Math.max(chance, 0.9);
  }
  if (num(official) >= 2 && c <= 1 && !theyOpened) chance *= 0.6;
  if (closer) chance *= 0.5;
  if (retry) chance *= 0.5;
  const r = rng(seedOf(seed));
  const answer = r() < chance;
  const rb = r();
  const rd = r();
  const rs = r();
  const delay = dmDelay(profile, rb, rd);
  if (answer) return { answer, delay, seen: delay === 0 ? 0 : Math.round(delay * (0.15 + 0.85 * rs)) };
  /* a cold request to someone above them is never even opened */
  if (c === 0 && g >= 1) return { answer, delay: null, seen: null };
  return { answer, delay: null, seen: rs < 0.75 ? delay : null };
}

// Pot for the persona's own post. Likes = followers * rate by tier (0.30, 0.08, 0.04, 0.03),
// clamped to the tier band (a floor of 1 keeps a zero-follower account alive at tier 0).
// Reposts and quotes are jittered ratios of likes; replies the larger of that ratio and
// the reply slots by tier (ownReplySlots, the same draw).
export function ownPostPot(persona, followers, seed) {
  const t = tierOf(persona);
  const r = rng(seedOf(seed));
  const [lo, hi] = BANDS[t];
  const likes = Math.max(1, Math.round(clamp(capped(followers, FOLLOWER_MAX) * OWN_LIKE_RATE[t] * (0.7 + 0.6 * r()), lo, hi)));
  const [rl, rh] = OWN_REPLIES[t];
  const slots = Math.round(rl + (rh - rl) * r());
  const out = derive(likes, r);
  out.replies = Math.max(out.replies, slots);
  return out;
}

// How many replies the persona's own post is owed in writing (the reply slots a batch
// fills), by tier: the second draw of ownPostPot's seed.
export function ownReplySlots(persona, seed) {
  const r = rng(seedOf(seed));
  r();
  const [rl, rh] = OWN_REPLIES[tierOf(persona)];
  return Math.round(rl + (rh - rl) * r());
}

// The replies a post is heading for: 5-12% of its likes ceiling, seeded by its id.
export function replyPot(post) {
  const likes = Math.max(0, Math.min(POT_MAX, num(post?.pot?.likes)));
  return Math.round(likes * (0.05 + 0.07 * rng(`${post?.id ?? ""}:replies`)()));
}

// Roughly 2% of engagement (likes + reposts + quotes + replies) converts to followers.
export function followersAfter(followers, engagement) {
  const f = Math.floor(capped(followers, FOLLOWER_MAX));
  return Math.min(FOLLOWER_MAX, f + Math.round(capped(engagement, FOLLOWER_MAX * 50) * 0.02));
}

function parseNumber(v) {
  if (typeof v === "number") return v;
  const m = String(v ?? "").trim().toLowerCase().replace(/,/g, "").match(/^(-?\d*\.?\d+)\s*([kmb])?$/);
  if (!m) return NaN;
  return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
}

// band: [lo, hi] or { likes: [lo, hi] }. Returns an integer inside the band, or null if unparsable.
export function clampModelNumber(value, band) {
  const b = Array.isArray(band) ? band : band?.likes;
  const n = parseNumber(value);
  if (!Number.isFinite(n) || !Array.isArray(b)) return null;
  const lo = Math.ceil(b[0]);
  const hi = Math.floor(b[1]);
  if (lo <= hi) return Math.round(clamp(n, lo, hi));
  // no integer inside the band: nearest edge, rounded toward the band
  return n <= (b[0] + b[1]) / 2 ? lo : hi;
}
