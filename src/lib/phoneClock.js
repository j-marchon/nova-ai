import { ROOT_ANCHOR, cleanAnchor, isRootAnchor, looseAnchorOf } from "./anchor.js";
import { ageOf } from "./phoneStats.js";

/* ---------- the phone's clock (in-world minutes) ----------

   One clock per handset, `handset.clock = { min, at, sync, step, last }`:

     min    in-world minutes stored at the last write (refresh, skip, sync,
            or a persona action on the phone)
     at     the (loose) anchor of the message that write ran after
     sync   the anchor of the last message a setup or a Sync to chat covered
     step   the Refresh step id (REFRESH_STEPS), "sync" by default
     last   the in-world minute of the last refresh, skip or sync

   The rule (null before the phone is set up):

     now = max( min + REPLY_MINUTES x R, W )

   R: story replies (non-empty assistant messages) after `at`'s message (all
   for ROOT_ANCHOR; 0 when that message is gone). W: the stamp (m.wt) of the
   newest message that has one (ignored when none), so deleting replies
   never takes the clock back past what the chat already showed.

   Writers, each stamping at now or later:
   1. a chat message: the user's wt = now, the reply's now + REPLY_MINUTES
      (messageStamp); between syncs the story drifts 5 minutes a reply;
   2. a persona action of kind k (phone.js phoneAct): the item's at = now +
      PHONE_COST[k], then min = that, at = the last message (spendClock);
      last and sync stay;
   3. Refresh by a step S or a time skip (advanceClock): min = now + S, at =
      the last message, last = min; new items dated in (previous last, now];
   4. DM answers and batch items are dated at or before now; they never move it;
   5. setup also sets sync = the last message;
   6. Sync to chat (syncChat): the story since `sync` is re-timed by what the
      model says it took (shiftTimeline), then min = last = now + X, at =
      sync = the last message.
   Likes, reposts, reading and opening cost nothing.

   Items carry `at` (the in-world minute they went up); their age is now - at.
   Items stored before the clock (no `at`) fall back to the old reply clock:
   replies since their anchor x 30 minutes, plus their `ago`.

   Pure: no React, storage or requests. Only anchor.js and phoneStats.js. */

export const REPLY_MINUTES = 5;
export const REFRESH_STEPS = Object.freeze([
  Object.freeze({ id: "sync", min: 0, label: "Sync to chat" }),
  Object.freeze({ id: "15m", min: 15, label: "15 min" }),
  Object.freeze({ id: "1h", min: 60, label: "1 hour" }),
  Object.freeze({ id: "3h", min: 180, label: "3 hours" }),
  Object.freeze({ id: "day", min: 1440, label: "1 day" }),
]);
export const DEFAULT_STEP = "sync";
export const SKIP_MINUTES = Object.freeze({ day: 1440, week: 10080, month: 43200 });
/* minutes one story reply stood for on the old clock (and one statsOf unit) */
export const LEGACY_REPLY_MINUTES = 30;
/* in-world minutes a persona action on the phone takes (phone.js phoneAct) */
export const PHONE_COST = Object.freeze({ dm: 1, post: 3, reply: 2, quote: 2, comment: 2, story: 2, transfer: 1 });
/* a story is gone a day after it went up (or after STORY_LIFE replies) */
export const STORY_MINUTES = 1440;
/* the longest a Sync to chat may say the story took (a week) */
export const SYNC_MAX_MINUTES = 10080;
/* how far back a Sync looks when the message it last covered is gone */
export const SYNC_FALLBACK_MESSAGES = 12;

const isRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x) => (Number.isFinite(x) ? x : null);
const lastOf = (messages) => (Array.isArray(messages) ? messages.at(-1) : undefined);

/* the step for an id (the default, Sync to chat, for anything unknown) */
export const stepOf = (id) => REFRESH_STEPS.find((s) => s.id === id) || REFRESH_STEPS.find((s) => s.id === DEFAULT_STEP);

export const emptyClock = () => ({ min: 0, at: ROOT_ANCHOR, sync: ROOT_ANCHOR, step: DEFAULT_STEP, last: 0 });

const anchorOr = (a, fallback) => { const x = cleanAnchor(a); return x ? (isRootAnchor(x) ? ROOT_ANCHOR : x) : fallback; };

/* A stored clock made valid; the default for anything that is not one.
   `sync` defaults to `at` (a clock stored before Sync to chat). */
export function cleanClock(c) {
  if (!isRecord(c)) return emptyClock();
  const at = anchorOr(c.at, ROOT_ANCHOR);
  return {
    min: finite(c.min) ?? 0,
    at,
    sync: anchorOr(c.sync, at),
    step: REFRESH_STEPS.some((s) => s.id === c.step) ? c.step : DEFAULT_STEP,
    last: finite(c.last) ?? 0,
  };
}

/* the handset's clock, always whole */
export const clockOf = (h) => cleanClock(h?.clock);

const storyReply = (m) => m?.role === "assistant" && !!String(m.content || "").trim();

/* Story replies after the anchor's message (all of them for ROOT_ANCHOR), or
   null when that message is gone. (phone.js re-exports it.) */
export function repliesAfter(anchor, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const at = isRootAnchor(anchor) ? -1 : list.findIndex((m) => m?.id === anchor?.id);
  if (at < 0 && !isRootAnchor(anchor)) return null;
  let n = 0;
  for (let i = at + 1; i < list.length; i++) if (storyReply(list[i])) n++;
  return n;
}

/* W: the in-world stamp (m.wt) of the newest message that has one, or null. */
export function lastWtOf(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) if (Number.isFinite(list[i]?.wt)) return list[i].wt;
  return null;
}

/* now on the clock, set up or not (mergeBatch stamps a seed with it) */
export function clockNowOf(h, messages) {
  const c = clockOf(h);
  const drift = c.min + REPLY_MINUTES * (repliesAfter(c.at, messages) ?? 0);
  const w = lastWtOf(messages);
  return w === null ? drift : Math.max(drift, w);
}
const rawNow = clockNowOf;

/* The phone's in-world now (minutes), or null before the phone is set up. */
export function phoneNow(handset, messages) {
  if (!handset?.tick?.seeded) return null;
  return rawNow(handset, messages);
}

/* In-world minutes since the newest stamped chat message (now - W), or null
   before setup or when no message has a stamp. The chat shows "<span>
   later" under the transcript from 15 on; phoneNote tells the story. */
export function phoneGapOf(handset, messages) {
  const now = phoneNow(handset, messages);
  const w = lastWtOf(messages);
  return now === null || w === null ? null : Math.max(0, now - w);
}

/* The handset after a persona action that took `minutes` (PHONE_COST):
   min = now + minutes, at = the chat's last message (loose; ROOT in an empty
   chat); last and sync stay. Unchanged before setup. */
export function spendClock(handset, minutes, messages) {
  if (!isRecord(handset) || !handset?.tick?.seeded) return handset;
  const c = clockOf(handset);
  const add = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  return { ...handset, clock: { ...c, min: rawNow(handset, messages) + add, at: looseAnchorOf(lastOf(messages)) } };
}

/* ---------- Sync to chat ---------- */

/* The index of the message a sync starts after (-1: the chat's start):
   clock.sync's message, else clock.at's, else SYNC_FALLBACK_MESSAGES back. */
function syncIndex(clock, messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const a of [clock.sync, clock.at]) {
    if (isRootAnchor(a)) return -1;
    const i = list.findIndex((m) => m?.id === a?.id);
    if (i >= 0) return i;
  }
  return Math.max(-1, list.length - 1 - SYNC_FALLBACK_MESSAGES);
}

/* The anchor a sync starts after (ROOT_ANCHOR for the chat's start). */
export function syncAnchorOf(handset, messages) {
  const i = syncIndex(clockOf(handset), messages);
  return i < 0 ? ROOT_ANCHOR : looseAnchorOf(messages[i]);
}

/* The chat's messages a Sync to chat covers (after syncAnchorOf). */
export function syncMessagesOf(handset, messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(syncIndex(clockOf(handset), list) + 1);
}

/* Story replies since the phone was last synced: the count on the home
   Refresh button. 0 when the phone is off or not set up. */
export function syncPendingOf(chat) {
  const h = chat?.handset;
  if (!h?.tick?.seeded || h.level === "off") return 0;
  return syncMessagesOf(h, chat?.messages).filter(storyReply).length;
}

/* The chat with the story after `syncAnchor` stretched by `extra` minutes,
   spread over its story replies: a message k replies in (k of R) moves by
   round(extra * k / R). Moves the stamps (m.wt) of those messages, and the
   `at` of phone posts, stories, DM lines and bank lines hung on them (with
   their DM waits); anything on the chat's start or before `syncAnchor`
   stays. Monotone: the order of things never changes. Pure. */
export function shiftTimeline(chat, syncAnchor, extra) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const X = Number.isFinite(extra) ? Math.round(extra) : 0;
  if (!X || !chat) return chat;
  const from = isRootAnchor(syncAnchor) ? -1 : messages.findIndex((m) => m?.id === syncAnchor?.id);
  if (from < 0 && !isRootAnchor(syncAnchor)) return chat;
  const R = messages.slice(from + 1).filter(storyReply).length;
  if (!R) return chat;
  const shift = new Map();
  let k = 0;
  for (let i = from + 1; i < messages.length; i++) {
    if (storyReply(messages[i])) k++;
    shift.set(messages[i].id, Math.round((X * k) / R));
  }
  const by = (a) => (a && !isRootAnchor(a) ? shift.get(a.id) || 0 : 0);
  const move = (x) => { const d = by(x?.anchor); return d && Number.isFinite(x.at) ? { ...x, at: x.at + d } : x; };
  const next = { ...chat, messages: messages.map((m) => { const d = shift.get(m.id) || 0; return d && Number.isFinite(m.wt) ? { ...m, wt: m.wt + d } : m; }) };
  const h = chat.handset;
  if (isRecord(h)) {
    const threads = {};
    const lineShift = new Map();
    for (const [key, list] of Object.entries(isRecord(h.threads) ? h.threads : {})) {
      threads[key] = Array.isArray(list) ? list.map((l) => { lineShift.set(l?.id, by(l?.anchor)); return move(l); }) : list;
    }
    const dmWait = {};
    for (const [key, w] of Object.entries(isRecord(h.dmWait) ? h.dmWait : {})) {
      const d = isRecord(w) ? lineShift.get(w.line) || 0 : 0;
      const add = (x) => (Number.isFinite(x) ? x + d : x);
      dmWait[key] = d ? { ...w, sent: add(w.sent), due: add(w.due), seen: add(w.seen) } : w;
    }
    const bank = isRecord(h.bank) && Array.isArray(h.bank.tx) ? { ...h.bank, tx: h.bank.tx.map(move) } : h.bank;
    next.handset = {
      ...h,
      posts: Array.isArray(h.posts) ? h.posts.map(move) : h.posts,
      stories: Array.isArray(h.stories) ? h.stories.map(move) : h.stories,
      threads, dmWait, bank,
    };
  }
  return next;
}

/* A Sync to chat folded into the chat: the model said the story since the
   last sync took `elapsed` minutes (null: it did not say). D = REPLY_MINUTES
   x the story replies in it (what the clock already counted); E =
   clamp(round(elapsed), D, SYNC_MAX_MINUTES), E = D when missing; X = E - D.
   Returns { chat, extra: X, nowBefore, now, window }: the chat re-timed
   (shiftTimeline) with clock = { min: nowBefore + X, at = sync = the last
   message, last: the new now }, and the window the batch covers (new now -
   the previous last). Pure. */
export function syncChat(chat, elapsed) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const h = chat?.handset;
  const c = clockOf(h);
  const nowBefore = rawNow(h, messages);
  const s = syncAnchorOf(h, messages);
  const R = syncMessagesOf(h, messages).filter(storyReply).length;
  const D = REPLY_MINUTES * R;
  const e = Number.isFinite(elapsed) ? Math.round(elapsed) : null;
  const E = e === null ? D : Math.min(SYNC_MAX_MINUTES, Math.max(D, e));
  const X = Math.max(0, E - D);
  const shifted = shiftTimeline(chat, s, X) || chat;
  const now = nowBefore + X;
  const at = looseAnchorOf(lastOf(messages));
  const handset = isRecord(shifted?.handset) ? { ...shifted.handset, clock: { ...c, min: now, at, sync: at, last: now } } : shifted?.handset;
  return { chat: { ...shifted, handset }, extra: X, nowBefore, now, window: Math.max(0, now - c.last) };
}

/* "now", "5m", "3h", "2d", "3w", "4mo" for an age in minutes */
export function timeLabel(minutes) {
  const m = Math.floor(Number(minutes));
  if (!Number.isFinite(m) || m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / 1440);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

/* "15 minutes", "1 hour", "3 hours", "1 day", "2 weeks", "1 month": a span
   of in-world time for prompts and the world log */
export function spanLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const unit = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m < 60) return unit(m, "minute");
  if (m < 1440) return unit(Math.round(m / 60), "hour");
  if (m < 10080) return unit(Math.round(m / 1440), "day");
  if (m < 43200) return unit(Math.round(m / 10080), "week");
  return unit(Math.round(m / 43200), "month");
}

/* An item's age on the old reply clock, in minutes (items without `at`). */
export const legacyMinutes = (item, messages) => ageOf(item, repliesAfter(item?.anchor, messages) ?? 0) * LEGACY_REPLY_MINUTES;

/* An item's age in in-world minutes (never below 0): now - item.at; items
   without `at` (or a phone not set up) use the old reply clock x 30. */
export function itemMinutes(item, handset, messages) {
  const now = phoneNow(handset, messages);
  if (now !== null && Number.isFinite(item?.at)) return Math.max(0, now - item.at);
  return Math.max(0, legacyMinutes(item, messages));
}

/* The same age in statsOf's unit (30 minutes). */
export const ageUnits = (item, handset, messages) => itemMinutes(item, handset, messages) / LEGACY_REPLY_MINUTES;

/* The handset with its clock moved on by `minutes` (0 or more) from now,
   hung on `anchor` (the message the advance ran after): min = now + minutes,
   at = anchor, last = the new now. */
export function advanceClock(handset, minutes, anchor, messages) {
  if (!isRecord(handset)) return handset;
  const c = clockOf(handset);
  const add = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  const next = rawNow(handset, messages) + add;
  const a = cleanAnchor(anchor);
  return { ...handset, clock: { ...c, min: next, at: a && !isRootAnchor(a) ? a : ROOT_ANCHOR, last: next } };
}

/* The in-world minute for a new chat message (m.wt): the user's at now, the
   assistant's REPLY_MINUTES later. Null before the chat's phone is set up
   (any level counts once it is). Pass the chat as it is before the message
   is added. */
export function messageStamp(chat, role) {
  const now = phoneNow(chat?.handset, chat?.messages);
  if (now === null) return null;
  return role === "assistant" ? now + REPLY_MINUTES : now;
}
