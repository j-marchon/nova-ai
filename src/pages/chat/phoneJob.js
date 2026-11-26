import { activeModel, hasKey, sourceOf } from "../../lib/api.js";
import { ROOT_ANCHOR, anchorVisible, isRootAnchor, looseAnchorOf } from "../../lib/anchor.js";
import { activity, activityModelLabel, cancelActivity, runActivity } from "../../lib/activity.js";
import { WORLD_LOG_CAP, visibleLog } from "../../lib/memory.js";
import { uid } from "../../lib/util.js";
import { userNameOf } from "../../lib/data.js";
import { POST_CAP, REPLIES_PER_POST, YOU, addUsage, cleanHandle, handsetOf, phoneAccounts, repliesTo, slug, usageOf } from "../../lib/phone.js";
import {
  PROFILE_MAX_TOKENS, SKIP_SPANS, activityRequester, budgetOf, mergeBatch, mergeProfile, owedPlan, phoneBatch, profileKeys, profileRequest, runPhoneBatch, runProfile, storyPeople,
} from "../../lib/phoneBatch.js";
import { SKIP_MINUTES, advanceClock, clockNowOf, clockOf, spanLabel, stepOf, syncChat } from "../../lib/phoneClock.js";
import { estimateTokens } from "../../lib/tokens.js";
import { showToast } from "../../lib/toast.js";
import { ensembleOf } from "../../lib/scope.js";
import { createStreamStore } from "./streamStore.js";

/* ---------- the phone's queue ----------

   One quiet job per chat (kind "phone", label "Phone", dedupeKey
   phone:<chatId>) through the activity store. Per chat, in memory:

     running   the batch in flight (one at most)
     seed      a waiting seed; it runs before anything else, and whatever
               else was asked for runs after it
     waiting   one other request; a new one merges into it (slots unioned,
               ids unique per request; mode respond > more, and refresh +
               respond run as one refresh that fills the owed slots; a
               Sync to chat in either makes the merge one; the longest
               refresh step wins)
     timer     the respond delay after a persona action (4 s; 2.5 s for a DM
               or a transfer to a story character). Whether anything is owed
               is decided when it runs, on the chat as it is then: nothing
               owed (a DM whose answer is not due yet) sends no request
     actions   the persona's likes and reposts since the last batch (they
               leave no item), passed to the next batch and cleared
     setup     a waiting setup (the user tapped "Set up phone"): profiles,
               then a seed from the chat as it stands; runs first, replaces
               a waiting seed. The only job that is not quiet, and the only
               one that runs on a phone not set up yet (nothing seeds by
               itself any more; startPhoneSeed is kept for tests).
     replies   "more replies" requests, one per post ({ post, promise }),
               run one at a time after a waiting seed and before `waiting`

   Nothing runs by itself after a story reply: the phone moves on when the
   user syncs it to the chat (Sync to chat, the default Refresh step),
   refreshes, skips time, or acts on it. DM answers that came due while the
   user was chatting are fetched when the phone opens (requestRespond with
   { dm: true }).

   A batch never starts during that chat's reply; a reply never waits for a
   batch. On a local endpoint a starting reply cancels the running batch,
   which is re-queued (replyJob.js calls phoneReplyStarting).

   Every exported function takes the chat id and, the first time for a chat,
   `{ getData, update }` (remembered per chat; replyJob.js and ChatPage pass
   them). Results are written only through update() with functional updaters. */

export const RESPOND_DELAY = 4000;
/* the delay for a DM whose answer is due at once (handset.dmWait), anyone's */
export const RESPOND_DM_DELAY = 2500;
const PRIORITY = { more: 1, refresh: 2, respond: 3, seed: 4, replies: 0, setup: 5, world: 0 };
const MODES = Object.keys(PRIORITY);

const chats = new Map();
const subs = new Set();
const emit = () => { for (const fn of subs) fn(); };

function stateOf(chatId) {
  let st = chats.get(chatId);
  if (!st) {
    st = { deps: null, running: null, waiting: null, seed: null, setup: null, world: null, lastSpan: "day", lastMinutes: null, replies: [], seedFailed: false, timer: null, actions: [], slotSeq: 0, preview: null, expect: null, error: null, pumping: false, snap: null };
    chats.set(chatId, st);
  }
  return st;
}
const remember = (chatId, deps) => {
  const st = stateOf(chatId);
  if (deps?.getData && deps?.update) st.deps = { getData: deps.getData, update: deps.update, requester: deps.requester || st.deps?.requester };
  return st;
};
const changed = (st) => { st.snap = null; emit(); };

const replyRunning = (chatId) => activity.get().some((j) => j.status === "running" && j.dedupeKey === `reply:${chatId}`);
const storyReply = (m) => m?.role === "assistant" && !!String(m.content || "").trim();
const isStoryKey = (k) => typeof k === "string" && /^(char|cast|uni):/.test(k);

/* ---------- reading the queue (usePhoneTick) ---------- */

/* { pending, running, mode, preview, error, replies, expect, setup } for a
   chat; stable between changes. `replies`: post ids whose "more replies"
   runs or waits. `expect`: what the running batch should bring, for the
   UI's placeholders ({ mode, posts, place: "top" | "bottom", post? }, null
   for respond or when nothing runs). `setup`: a setup runs or waits. */
export function phoneQueueOf(chatId) {
  const st = chats.get(chatId);
  if (!st) return IDLE;
  if (!st.snap) {
    const replies = [...(st.running?.mode === "replies" ? [st.running.req.post] : []), ...st.replies.map((r) => r.post)];
    st.snap = {
      pending: !!(st.timer || st.waiting || st.seed || st.setup || st.world || st.replies.length), running: !!st.running, mode: st.running?.mode || null,
      preview: st.preview, error: st.error, replies, expect: st.running ? st.expect : null, setup: !!st.setup || st.running?.mode === "setup",
    };
  }
  return st.snap;
}
const IDLE = Object.freeze({ pending: false, running: false, mode: null, preview: null, error: null, replies: Object.freeze([]), expect: null, setup: false });

/* what a batch should bring, for the UI (phoneQueueOf `expect`) */
function expectOf(level, mode, post) {
  if (mode === "respond") return null;
  const b = budgetOf(level, mode);
  if (mode === "replies") return b.replies ? { mode, posts: b.replies, place: "bottom", post } : null;
  const posts = Math.min(b.posts || 0, 4);
  return posts ? { mode, posts, place: mode === "more" ? "bottom" : "top" } : null;
}
export const subscribePhoneQueue = (fn) => { subs.add(fn); return () => subs.delete(fn); };

/* ---------- requests ---------- */

/* Two waiting requests (never a seed: that waits on its own, st.seed, and
   runs first). Slot ids are unique per request (requestPhone), so a union
   keeps every obligation. */
function mergeRequest(a, b) {
  if (!a) return { ...b, modes: b.modes || [b.mode] };
  const modes = [...new Set([...(a.modes || [a.mode]), ...(b.modes || [b.mode])])];
  /* a refresh and a respond make one refresh that also fills the owed slots
     (phoneBatch owes slots in refresh mode too), so the refresh's posts stay */
  const mode = modes.includes("refresh") ? "refresh" : modes.includes("respond") ? "respond" : "more";
  let slots;
  if (a.slots || b.slots) {
    const seen = new Map();
    for (const s of [...(a.slots || []), ...(b.slots || [])]) if (!seen.has(s.id)) seen.set(s.id, s);
    slots = [...seen.values()];
  }
  /* minutes: the longest refresh step asked for (the clock moves once);
     sync: any Sync to chat in it makes the refresh one */
  const minutes = Math.max(a.minutes || 0, b.minutes || 0);
  const sync = !!a.sync || !!b.sync;
  return { mode, modes, ...(slots ? { slots } : {}), ...(minutes ? { minutes } : {}), ...(sync ? { sync } : {}) };
}
const queueSeed = (st) => { st.seed = { mode: "seed" }; st.seedFailed = false; };
/* puts a request back: a seed on its own, anything else merged */
const enqueue = (st, req) => {
  if (req.mode === "seed") queueSeed(st);
  else if (req.mode === "setup") st.setup = st.setup || req;
  else if (req.mode === "world") st.world = st.world || req;
  else if (req.mode === "replies") { if (!st.replies.some((r) => r.post === req.post)) st.replies.unshift(req); }
  else st.waiting = mergeRequest(st.waiting, req);
};

/* Queues a batch: { mode, slots?, minutes?, sync? }. Runs at once when
   nothing is in flight and the chat's reply is not being written. */
export function requestPhone(chatId, req = {}, deps) {
  const st = remember(chatId, deps);
  if (!st.deps) return;
  const mode = MODES.includes(req.mode) && !["replies", "setup", "world"].includes(req.mode) ? req.mode : "refresh";
  if (mode === "seed") queueSeed(st);
  else {
    /* each request's slots get their own prefix: two r1s stay two */
    const tag = `q${++st.slotSeq}`;
    const slots = Array.isArray(req.slots) ? req.slots.map((s, k) => ({ ...s, id: `${tag}${s?.id || `r${k + 1}`}` })) : null;
    const minutes = mode === "refresh" && Number.isFinite(req.minutes) && req.minutes > 0 ? req.minutes : 0;
    const sync = mode === "refresh" && req.sync === true;
    st.waiting = mergeRequest(st.waiting, { mode, ...(slots ? { slots } : {}), ...(minutes ? { minutes } : {}), ...(sync ? { sync } : {}) });
  }
  changed(st);
  void pump(chatId);
}

const whenNoReply = (chatId) => new Promise((resolve) => {
  if (!replyRunning(chatId)) { resolve(); return; }
  const off = activity.subscribe(() => { if (!replyRunning(chatId)) { off(); resolve(); } });
});

async function pump(chatId) {
  const st = stateOf(chatId);
  const any = () => !!(st.waiting || st.seed || st.setup || st.world || st.replies.length);
  if (st.pumping || st.running || !any()) return;
  st.pumping = true;
  try {
    await whenNoReply(chatId);
  } finally {
    st.pumping = false;
  }
  if (st.running || !any()) return;
  let req;
  if (st.setup) { req = st.setup; st.setup = null; st.seed = null; }
  else if (st.seed) { req = st.seed; st.seed = null; }
  else if (st.world) { req = st.world; st.world = null; }
  else if (st.replies.length) req = st.replies.shift();
  else { req = st.waiting; st.waiting = null; }
  await runBatch(chatId, req);
}

/* ---------- the chat as the phone sees it ---------- */

function contextOf(data, chat) {
  const isUni = chat.kind === "universe";
  const universe = isUni ? (data.universes || []).find((u) => u.id === chat.universeId) || null : null;
  const character = !isUni ? (data.characters || []).find((c) => c.id === chat.characterId) || null : null;
  const ensemble = character ? ensembleOf(chat, data.characters || []) : [];
  const persona = (data.personas || []).find((p) => p.id === chat.personaId) || null;
  const userName = userNameOf(data, chat, persona);
  const handset = handsetOf(chat);
  const accounts = phoneAccounts({ chat, character, ensemble, universe, userName, handset });
  const characters = storyPeople({ chat, character, ensemble, universe, handset, userName, messages: chat.messages });
  const story = universe ? universe.description || "" : character?.scenario || "";
  const log = isUni ? visibleLog(chat) : [];
  return { universe, character, ensemble, persona, userName, accounts, characters, world: { story, log } };
}

/* One request's spend: the app's ledger line (as replyJob.js records its
   side calls; only when the provider reported cost or tokens) and the chat's
   phone usage (handset.usage, by mode). When the provider reported no
   tokens, the chat's usage gets estimates (estimateTokens of the request
   and of the answer) and counts one more estimated call; a cost is added
   only when reported. `request`: { system, user } as sent. */
const usageMode = (mode, sync) => (sync ? "sync" : mode === "seed" ? "setup" : mode);
function recordSpend(update, res, { chatId, mode, request } = {}) {
  const r = typeof res === "string" ? { text: res } : res;
  if (!r || typeof r !== "object") return;
  const reported = r.tokensIn != null || r.tokensOut != null;
  update((d) => {
    let next = d;
    if (r.cost != null || r.tokensIn != null) {
      const led = { spent: 0, replies: 0, tokensIn: 0, tokensOut: 0, lastTtft: null, lastTtfb: null, ttfbAvg: null, byModel: {}, ...(d.ledger || {}) };
      const model = r.servedBy || activeModel(d.settings);
      const cost = r.cost || 0;
      next = { ...d, ledger: { ...led, spent: led.spent + cost, tokensIn: led.tokensIn + (r.tokensIn || 0), tokensOut: led.tokensOut + (r.tokensOut || 0), lastModel: model, byModel: { ...led.byModel, [model]: (led.byModel[model] || 0) + cost } } };
    }
    if (!chatId || !mode) return next;
    const tokensIn = reported ? r.tokensIn || 0 : estimateTokens(`${request?.system || ""}\n${request?.user || ""}`);
    const tokensOut = reported ? r.tokensOut || 0 : estimateTokens(typeof r.text === "string" ? r.text : "");
    return {
      ...next,
      chats: next.chats.map((c) => (c.id !== chatId || !c.handset ? c : { ...c, handset: addUsage(c.handset, { mode, tokensIn, tokensOut, cost: r.cost ?? 0, est: !reported }) })),
    };
  });
}

const patchHandset = (update, chatId, fn) => update((d) => ({
  ...d,
  chats: d.chats.map((c) => {
    if (c.id !== chatId) return c;
    const next = fn(handsetOf(c), c);
    return next && next !== c.handset ? { ...c, handset: next } : c;
  }),
}));

/* Only the answers to owed slots of a parsed batch (the anchor went away). */
function answersOnly(parsed, owed, accounts) {
  const ids = new Set((owed || []).map((s) => s.id));
  const keep = (p) => (p.slot && ids.has(p.slot) ? { ...p, replies: (p.replies || []).filter(keep) } : null);
  const posts = (parsed.posts || []).map(keep).filter(Boolean);
  const dmHandles = new Set((owed || []).filter((s) => (s.kind === "dm" || s.kind === "transfer") && s.by).map((s) => accounts.handleOf(s.by)));
  const dms = (parsed.dms || []).filter((d) => (d.slot && ids.has(d.slot)) || (!d.slot && dmHandles.has(cleanHandle(d.from) || slug(d.from))));
  return { me: null, accounts: parsed.accounts || [], posts, stories: [], dms, events: [], topics: [] };
}

/* ---------- one batch ---------- */

async function runBatch(chatId, request) {
  const req = request;
  const st = stateOf(chatId);
  const { getData, update, requester: makeRequester } = st.deps;
  const data = getData();
  const chat = data.chats.find((c) => c.id === chatId);
  if (!chat || !hasKey(data.settings) || !activeModel(data.settings)) { req.resolve?.("dropped"); changed(st); void pump(chatId); return; }
  const h = handsetOf(chat);
  let mode = req.mode;
  /* more replies: only to a post that is there and not full */
  if (mode === "replies") {
    const target = h.tick.seeded && h.posts.find((p) => p.id === req.post && p.kind !== "reply" && p.kind !== "repost");
    const full = target && repliesTo(h, target.id).length >= REPLIES_PER_POST;
    if (!target || full) { req.resolve?.(full ? "full" : "dropped"); changed(st); void pump(chatId); return; }
  }
  /* a phone not set up yet runs nothing but its setup (asked for by hand;
     a seed only when asked for directly): anything else is dropped */
  if (!h.tick.seeded && mode !== "seed" && mode !== "setup") { req.resolve?.("dropped"); changed(st); void pump(chatId); return; }
  /* a second seed never duplicates the starting feed: on a seeded phone it
     is a refresh */
  if (mode === "seed" && h.tick.seeded) mode = "refresh";
  /* Load more with a full feed: nothing to ask for, and no error */
  if (mode === "more" && h.posts.length >= POST_CAP) { changed(st); void pump(chatId); return; }

  const ctx = contextOf(data, chat);
  /* a respond batch runs only when something is owed now, on the chat as
     it is now (a DM whose answer is not due yet owes nothing): otherwise it
     ends quietly with no request, tick.pending kept for later */
  if (mode === "respond" && !req.slots) {
    const plan = owedPlan({ handset: h, messages: chat.messages, characters: ctx.characters, actions: st.actions, clockNow: clockNowOf(h, chat.messages) });
    if (!plan.slots.length) { changed(st); void pump(chatId); return; }
  }
  /* seed and setup hang at the chat's start; everything else loosely on the
     chat's last message (a swipe of it keeps the result) */
  const anchor = mode === "seed" || mode === "setup" ? ROOT_ANCHOR : looseAnchorOf(chat.messages.at(-1));
  const sync = mode === "refresh" && !!req.sync;
  /* likes and reposts go only to a batch that owes answers (refresh,
     respond); seed and more leave them queued */
  const owes = mode === "refresh" || mode === "respond";
  const actions = owes ? st.actions : [];
  if (owes) st.actions = [];
  /* the persona's items this batch answers. Seed and more owe nothing, so
     they answer none: tick.pending passes through for the respond batch */
  const mine = owes ? [...h.posts.filter((p) => p.by === YOU).map((p) => p.id), ...h.stories.filter((x) => x.by === YOU).map((x) => x.id), ...Object.values(h.threads).flat().filter((m) => m.from === YOU).map((m) => m.id)] : [];
  const run = { mode, req: { ...req, mode }, handle: null, requeue: false };
  st.running = run;
  st.preview = null;
  st.expect = expectOf(h.level, mode, req.post);
  changed(st);
  /* the minutes the batch covers, for the prompt: the step (refresh) or
     the skip (world), or the time since the phone was last checked */
  const step = mode === "world" ? req.minutes || SKIP_MINUTES[req.span] || SKIP_MINUTES.day : mode === "refresh" ? req.minutes || 0 : 0;
  const coverMin = mode === "world" ? step : Math.max(step, clockNowOf(h, chat.messages) + step - clockOf(h).last);

  const sideStream = createStreamStore();
  let outcome = "dropped";
  try {
    /* setup is shown in the island like a reply; everything else is quiet.
       A time skip is its own kind, "world" (label "World"), quiet too */
    const setup = mode === "setup";
    const world = mode === "world";
    await runActivity({ kind: world ? "world" : "phone", stream: sideStream, label: setup ? "Phone setup" : world ? "World" : "Phone", owner: { chatId }, dedupeKey: `phone:${chatId}`, model: activityModelLabel(data.settings), quiet: !setup }, async (handle) => {
      run.handle = handle;
      const requester = makeRequester ? makeRequester({ settings: data.settings, activity: handle, signal: handle.signal }) : activityRequester({ settings: data.settings, activity: handle, signal: handle.signal });
      const spend = (list, m, request) => { for (const r of list || []) if (r && (typeof r === "object" || typeof r === "string")) recordSpend(update, r, { chatId, mode: m, request }); };

      /* the seed starts with the profiles it still needs */
      if (mode === "seed" || mode === "setup") {
        const keys = profileKeys(h, ctx.characters);
        if (keys.length) {
          const prof = await runProfile({ requester, persona: ctx.persona, userName: ctx.userName, characters: ctx.characters, story: ctx.world.story, keys });
          spend(prof.responses, "profile", prof.request);
          if (prof.parsed) patchHandset(update, chatId, (cur) => mergeProfile(cur, prof.parsed, { characters: ctx.characters }));
        }
      }
      const fresh = getData().chats.find((c) => c.id === chatId) || chat;
      /* the phone's minute the batch is written at: after the step for a
         refresh or a skip (applyResult moves the clock the same way), so DM
         answers due inside it are owed and dated at their minute */
      const clockNow = clockNowOf(handsetOf(fresh), fresh.messages) + (mode === "refresh" || mode === "world" ? step : 0);
      const res = await runPhoneBatch({
        requester,
        onPreview: (parsed) => { if (st.running === run) { st.preview = parsed; sideStream.set({ preview: parsed }); changed(st); } },
        mode, handset: handsetOf(fresh), chat: fresh, persona: ctx.persona, userName: ctx.userName,
        characters: ctx.characters, world: ctx.world, actions, messages: fresh.messages, clockNow,
        ...(req.slots ? { slots: req.slots } : {}),
        ...(mode === "replies" ? { post: req.post } : {}),
        ...(mode === "world" ? { minutes: step, ...(req.span ? { span: req.span } : {}) } : mode === "refresh" ? { minutes: coverMin } : {}),
        ...(sync ? { sync: true } : {}),
        mergeOpts: { anchor, accounts: ctx.accounts, characters: ctx.characters, userName: ctx.userName, ...(mode === "replies" ? { post: req.post } : {}) },
      });
      spend(res.responses, usageMode(mode, sync), res.request);
      if (handle.signal.aborted) return;
      if (res.error) {
        outcome = "error";
        st.error = res.error;
        if (mode === "seed" || mode === "setup") st.seedFailed = true;
        patchHandset(update, chatId, (cur) => ({ ...cur, tick: { ...cur.tick, error: res.error } }));
        handle.fail(new Error(res.error.message));
        return;
      }
      /* what the slot cap left out stays pending, its actions queued */
      const over = res.overflow || [];
      const later = new Set(over.map((o) => o.src).filter(Boolean));
      const answered = mine.filter((id) => !later.has(id));
      outcome = applyResult(chatId, { res, mode, req: run.req, anchor, answered, ctx, update });
      if (outcome === "merged") {
        const back = over.map((o) => o.action).filter(Boolean);
        if (back.length) st.actions = [...back, ...st.actions];
      }
      if (mode === "seed" || mode === "setup") st.seedFailed = false;
      st.error = null;
    });
  } catch {
    /* an abort (Cancel, or a reply on a local endpoint) or an unexpected throw */
    outcome = run.requeue ? "requeue" : "aborted";
  } finally {
    if (run.requeue) outcome = "requeue";
    if (st.running === run) { st.running = null; st.expect = null; }
    st.preview = null;
    /* a batch that merged nothing answered nothing: its actions go back */
    if (outcome !== "merged") st.actions = [...actions, ...st.actions];
    if (outcome === "requeue") enqueue(st, run.req);
    else if (mode === "replies" || mode === "setup" || mode === "world") run.req.resolve?.(outcome);
    if (mode === "setup" && outcome === "merged") showToast("Your phone is set up");
    else if (mode === "setup" && outcome === "error") showToast("Phone setup failed. Open the phone to retry.", { tone: "warn" });
    changed(st);
  }
  void pump(chatId);
}

/* Folds a batch into the chat as it is now (§3 "If the chat moves"). Returns
   "merged", "answers" (only the owed answers kept; actions go back) or
   "dropped"; queues the follow-ups.

   Refresh = skip: a refresh of S minutes (the step) and a time skip move the
   phone's clock the same way, in this updater and only when the batch
   merges: advanceClock (now + S, hung loosely on the chat's last message),
   then mergeBatch at the new now over the time since the phone was last
   checked. S of an hour or more also leaves a world log line and a "Time:"
   line in the scene notes. A Sync to chat re-times the story since the last
   sync by the answer's "elapsed" (phoneClock.js syncChat: the stamps move,
   the clock lands on nowBefore + X, sync and at on the last message), then
   merges at that now; no world log line. Setup sets clock.sync to the last
   message. Respond, more and replies never move the clock. A batch that
   fails or is dropped changes nothing. */
function applyResult(chatId, { res, mode, req, anchor, answered, ctx, update }) {
  let outcome = "dropped";
  let follow = null;
  update((d) => ({
    ...d,
    chats: d.chats.map((c) => {
      if (c.id !== chatId) return c;
      const cur = handsetOf(c);
      const opts = { mode, accounts: ctx.accounts, characters: ctx.characters, userName: ctx.userName, messages: c.messages, owed: res.owed, answered };
      const last = looseAnchorOf(c.messages.at(-1));
      /* the clock as it stands, and moved on by S for a refresh or a skip */
      const here = { clockNow: clockNowOf(cur, c.messages) };
      const advanced = (from, minutes, prevLast = clockOf(cur).last) => {
        const next = advanceClock(from, minutes, last, c.messages);
        const clockNow = clockOf(next).last;
        return { next, clock: { clockNow, window: Math.max(minutes, clockNow - prevLast) } };
      };
      const gone = !isRootAnchor(anchor) && !anchorVisible(anchor, c.messages);
      /* a time skip: merged like a refresh (the seeded flag left as it was),
         plus a world log line and the scene's time moved on; dropped when
         the message it ran after went away */
      if (mode === "world") {
        if (gone) return c;
        outcome = "merged";
        const minutes = req.minutes || SKIP_MINUTES[req.span] || SKIP_MINUTES.day;
        const { next, clock } = advanced(cur, minutes);
        const merged = mergeBatch(next, res.parsed, { ...opts, anchor, ...clock });
        const span = req.span;
        const line = `${span ? `A ${span}` : `About ${spanLabel(minutes)}`} passed.${res.parsed.summary ? ` ${res.parsed.summary}` : ""}`;
        const time = res.parsed.time || (span ? `a ${span} later` : `${spanLabel(minutes)} later`);
        return withEvent({ ...c, handset: { ...merged, tick: { ...merged.tick, seeded: cur.tick.seeded } } }, { kind: "skip", text: line, ...(span ? { span } : {}), anchor }, { time });
      }
      /* setup: hangs at the chat's start like the seed, never stale, and adds
         to whatever is on the phone already; the phone counts as synced up
         to the chat's last message */
      if (mode === "setup") {
        outcome = "merged";
        const merged = mergeBatch(cur, res.parsed, { ...opts, ...here });
        return { ...c, handset: { ...merged, clock: { ...merged.clock, sync: last } } };
      }
      /* more replies: merged unless the message it ran after went away */
      if (mode === "replies") {
        if (gone) return c;
        outcome = "merged";
        return { ...c, handset: mergeBatch(cur, res.parsed, { ...opts, anchor, post: req.post, ...here }) };
      }
      /* the seed hangs at the chat's start: never stale; a second one is dropped */
      if (mode === "seed") {
        if (cur.tick.seeded) return c;
        outcome = "merged";
        const merged = mergeBatch(cur, res.parsed, { ...opts, ...here });
        return { ...c, handset: { ...merged, clock: { ...merged.clock, sync: last } } };
      }
      const responds = mode === "respond" || (req?.modes || []).includes("respond");
      if (gone && !responds) {
        /* the message it ran after was deleted: the ambient items go, and
           the refresh runs again on the chat as it is */
        follow = req;
        return c;
      }
      if (gone) {
        /* only the answers to owed slots stay, re-anchored; a refresh part
           runs again, and the actions go back to the queue */
        outcome = "answers";
        if (mode === "refresh" && cur.level !== "off") follow = { mode: "refresh", ...(req?.minutes ? { minutes: req.minutes } : {}), ...(req?.sync ? { sync: true } : {}) };
        return { ...c, handset: mergeBatch(cur, answersOnly(res.parsed, res.owed, ctx.accounts), { ...opts, anchor: last, ...here }) };
      }
      outcome = "merged";
      if (mode !== "refresh") return { ...c, handset: mergeBatch(cur, res.parsed, { ...opts, anchor, ...here }) };
      const minutes = req?.minutes || 0;
      if (req?.sync) {
        /* Sync to chat: re-time the story since the last sync, then merge at
           the new now over the time since the phone was last checked */
        const synced = syncChat({ ...c, handset: cur }, res.parsed.elapsed ?? null);
        const base = synced.chat;
        const { next, clock } = minutes > 0
          ? advanced(base.handset, minutes, clockOf(cur).last)
          : { next: base.handset, clock: { clockNow: synced.now, window: synced.window } };
        return { ...base, handset: mergeBatch(next, res.parsed, { ...opts, messages: base.messages, anchor, ...clock }) };
      }
      const { next, clock } = advanced(cur, minutes);
      const done = { ...c, handset: mergeBatch(next, res.parsed, { ...opts, anchor, ...clock }) };
      return minutes >= 60 ? withEvent(done, { kind: "skip", text: `About ${spanLabel(minutes)} passed.`, anchor }, { time: `${spanLabel(minutes)} later` }) : done;
    }),
  }));
  if (follow) enqueue(stateOf(chatId), follow);
  return outcome;
}

/* ---------- triggers ---------- */

/* Story replies since the last refresh: after tick.lastMsgId (saved with the
   handset, moved only by a refresh, so it holds across reloads); before any,
   after the first user message (the greeting is not a reply). */
export function repliesSince(chat) {
  const msgs = chat?.messages || [];
  const last = handsetOf(chat).tick.lastMsgId;
  let at = last ? msgs.findIndex((m) => m.id === last) : -1;
  if (at < 0) at = msgs.findIndex((m) => m.role === "user");
  if (at < 0) return 0;
  return msgs.slice(at + 1).filter(storyReply).length;
}

/* A seed, when the chat has none yet and a key and model exist. Nothing in
   the UI calls it any more (the phone is set up by hand: setupPhone); kept
   for tests and old callers. */
export function startPhoneSeed(chatId, deps) {
  const st = remember(chatId, deps);
  if (!st.deps) return false;
  const data = st.deps.getData();
  const chat = data.chats.find((c) => c.id === chatId);
  if (!chat || handsetOf(chat).tick.seeded || !hasKey(data.settings) || !activeModel(data.settings)) return false;
  /* one seed at a time: already running or waiting */
  if (st.seed || st.running?.mode === "seed") return false;
  requestPhone(chatId, { mode: "seed" });
  return true;
}

/* On mount: only remembers the chat's deps. Nothing seeds by itself any
   more (the user sets the phone up by hand); always false. */
export function phoneOnMount(chatId, deps) {
  remember(chatId, deps);
  return false;
}

/* The Refresh button: by `step` (a REFRESH_STEPS id; the handset's chosen
   step when left out). "sync" is a Sync to chat: the story since the phone
   was last synced, re-timed by how long the model says it took, and what
   appeared on the phone in that time. 15m to 3h moves the clock by that
   much and brings what appeared; a day or more is a time skip of that
   length (skipTime's path; returns its promise). */
export function refreshPhone(chatId, deps, { step } = {}) {
  const st = remember(chatId, deps);
  if (!st.deps) return undefined;
  const chat = st.deps.getData().chats.find((c) => c.id === chatId);
  const s = stepOf(typeof step === "string" ? step : clockOf(handsetOf(chat)).step);
  if (s.id === "sync") { requestPhone(chatId, { mode: "refresh", sync: true }); return undefined; }
  if (s.min >= SKIP_MINUTES.day) return skipMinutes(chatId, s.min);
  requestPhone(chatId, { mode: "refresh", minutes: s.min });
  return undefined;
}
/* Manual Load more at the bottom (level budgets). */
export const loadMorePhone = (chatId, deps) => requestPhone(chatId, { mode: "more" }, deps);
/* "Set up phone", by hand (any level, posts or not): the profiles it still
   lacks, then a seed built from the chat as it stands and its memory
   (summary, scene notes, latest messages, topics, people). Not quiet: the
   island shows "Phone setup", and a toast says when it is done ("Your phone
   is set up") or failed. New posts are added, old ones kept. Returns a
   promise of "merged" | "dropped" | "error" | "aborted"; asking again while
   one waits or runs returns the same promise. */
export function setupPhone(chatId, deps) {
  const st = remember(chatId, deps);
  if (!st.deps) return Promise.resolve("dropped");
  if (st.running?.mode === "setup") return st.running.req.promise;
  if (st.setup) return st.setup.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  st.setup = { mode: "setup", promise, resolve };
  st.seed = null;
  st.seedFailed = false;
  changed(st);
  void pump(chatId);
  return promise;
}

/* ---------- the story's own events (the user's) ----------

   worldEvent writes the user's line into chat.world.log as a story event
   (kind "event", source "you", anchored to the last message so it follows
   swipes); skipTime runs a "world" batch for a day, a week or a month. Both
   reach every later reply through phoneNote (phone.js storyEvents), on any
   level; neither writes a character reply. */
const TIME_WORDS = /\b(morning|noon|midday|afternoon|evening|night|tonight|midnight|dawn|dusk|sunrise|sunset|tomorrow|yesterday|o'?clock|\d{1,2}(:\d{2})?\s?(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|(hours?|days?|weeks?|months?|years?)\s+later|later that)\b/i;
const PLACE_WORDS = /\b(arriv(e|es|ed|ing)|reach(es|ed)?|enter(s|ed)?|(go|goes|went|move[sd]?|head(s|ed)?|return(s|ed)?)\s+(to|into|back)|at the|in the|inside the|outside the)\b/i;
const sceneLines = (text) => String(text || "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
/* the scene note with a "Now:" line (the newest event naming a time or a
   place) and, for a skip, a "Time:" line; other lines kept */
function sceneWith(scene, { now, time }) {
  let lines = sceneLines(scene?.text);
  if (time) lines = [`Time: ${time}`, ...lines.filter((l) => !/^Time:/i.test(l))];
  if (now) lines = [...lines.filter((l) => !/^Now:/i.test(l)), `Now: ${now}`];
  let text = lines.join("\n");
  if (text.length > 1200) text = text.slice(text.length - 1200);
  return { ...(scene || {}), text, at: Date.now() };
}
/* a chat with one more user event in its world log (and scene note) */
function withEvent(c, { kind, text, span, anchor }, { time } = {}) {
  const log = Array.isArray(c.world?.log) ? c.world.log : [];
  const entry = { id: `w${uid().slice(0, 7)}`, kind, source: YOU, text, ...(span ? { span } : {}), anchor };
  const names = kind === "event" && (TIME_WORDS.test(text) || PLACE_WORDS.test(text));
  const next = { ...c, world: { ...(c.world || {}), log: [...log, entry].slice(-WORLD_LOG_CAP) } };
  if (names || time) next.scene = sceneWith(c.scene, { ...(names ? { now: text } : {}), ...(time ? { time } : {}) });
  return next;
}

/* The user's story event: written at once (no model call, no reply).
   Returns the entry, or null for an empty line or an unknown chat. */
export function worldEvent(chatId, text, deps) {
  const st = remember(chatId, deps);
  const line = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!st.deps || !line) return null;
  let entry = null;
  st.deps.update((d) => ({
    ...d,
    chats: d.chats.map((c) => {
      if (c.id !== chatId) return c;
      const next = withEvent(c, { kind: "event", text: line, anchor: looseAnchorOf(c.messages?.at(-1)) });
      entry = next.world.log.at(-1);
      return next;
    }),
  }));
  return entry;
}

/* A time skip: one "world" batch through the phone queue (it waits for a
   reply being written; a reply never waits for it), on any level. Returns a
   promise of "merged" | "dropped" | "error" | "aborted"; a second skip while
   one waits or runs returns the same promise. */
export function skipTime(chatId, span, deps) {
  const st = remember(chatId, deps);
  if (!st.deps || !SKIP_SPANS.includes(span)) return Promise.resolve("dropped");
  return skipMinutes(chatId, SKIP_MINUTES[span]);
}
/* a "world" batch of `minutes` (span named when it is exactly one) */
function skipMinutes(chatId, minutes) {
  const st = stateOf(chatId);
  if (st.running?.mode === "world") return st.running.req.promise;
  if (st.world) return st.world.promise;
  const span = SKIP_SPANS.find((k) => SKIP_MINUTES[k] === minutes);
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  st.world = { mode: "world", minutes, ...(span ? { span } : {}), promise, resolve };
  st.lastMinutes = minutes;
  if (span) st.lastSpan = span;
  changed(st);
  void pump(chatId);
  return promise;
}

/* More replies under one post (3 on Light, 5 on Lively, never past
   REPLIES_PER_POST), through the same queue: one batch in flight per chat.
   Returns a promise of "merged" | "dropped" | "full" | "error" | "aborted";
   asking again for a post already queued returns the same promise. */
export function loadMoreReplies(chatId, postId, deps) {
  const st = remember(chatId, deps);
  if (!st.deps || typeof postId !== "string" || !postId) return Promise.resolve("dropped");
  if (st.running?.mode === "replies" && st.running.req.post === postId) return st.running.req.promise;
  const queued = st.replies.find((r) => r.post === postId);
  if (queued) return queued.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  st.replies.push({ mode: "replies", post: postId, promise, resolve });
  changed(st);
  void pump(chatId);
  return promise;
}

/* Retry after a failure: the failed mode again, by hand. */
export function retryPhone(chatId, deps) {
  const st = remember(chatId, deps);
  const chat = st.deps?.getData().chats.find((c) => c.id === chatId);
  const failed = (st.error || handsetOf(chat).tick.error)?.mode;
  if (failed === "setup") { void setupPhone(chatId); return; }
  if (failed === "world") { void skipMinutes(chatId, st.lastMinutes || SKIP_MINUTES[st.lastSpan] || SKIP_MINUTES.day); return; }
  if (failed === "profile") { void setupPhone(chatId); return; }
  const mode = MODES.includes(failed) && failed !== "replies" ? failed : "refresh";
  if (mode === "refresh") refreshPhone(chatId);
  else requestPhone(chatId, { mode });
}

/* The persona's like or repost (they leave no item): kept for the next batch. */
export function notePhoneAction(chatId, action) {
  const st = stateOf(chatId);
  if (!action || !["like", "repost"].includes(action.kind) || !action.post) return;
  st.actions = [...st.actions.filter((a) => !(a.kind === action.kind && a.post === action.post)), { kind: action.kind, post: action.post }].slice(-20);
}
export const pendingPhoneActions = (chatId) => chats.get(chatId)?.actions || [];

/* A persona action (or the phone opening, { dm: true }): a respond batch
   after RESPOND_DM_DELAY for a DM or a transfer to a story character, else
   RESPOND_DELAY; a burst makes one request. Whether anything is owed (a DM
   whose answer is due on the phone's clock, replies to a post, a payee's
   reaction) is decided when the batch would run, on the chat as it is then
   (runBatch), so calling this before the action's update lands is fine; a
   batch with nothing owed sends nothing. Nothing on a phone that is off or
   not set up. `action` ({ kind: "like"|"repost", post }) is kept for that batch. */
export function requestRespond(chatId, { dm = false, action, ...deps } = {}) {
  const st = remember(chatId, deps);
  if (action) notePhoneAction(chatId, action);
  if (!st.deps) return;
  const chat = st.deps.getData().chats.find((c) => c.id === chatId);
  const h = handsetOf(chat);
  if (!h.tick.seeded || h.level === "off") { changed(st); return; }
  const delay = dm || (action?.kind === "transfer" && isStoryKey(action.to)) ? RESPOND_DM_DELAY : RESPOND_DELAY;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    st.timer = null;
    requestPhone(chatId, { mode: "respond" });
  }, delay);
  changed(st);
}

/* ---------- estimated use (Phone Settings) ---------- */

/* What each kind of phone request would send and get back, estimated from
   the real prompts on the chat as it is now: { setup, sync, refresh, more,
   respond, replies }, each { in, out, cost? } in tokens (cost in the
   ledger's currency). `in`: estimateTokens of that mode's prompt (setup adds
   the profile prompt when profiles are missing; respond with one owed DM;
   sync with the story since the last sync). `out`: the average answer of
   that mode in this chat once it has run twice, else its budget. `cost`:
   tokens x the price per token this chat has paid (handset.usage), else the
   app's (ledger), else left out. Pure and synchronous: no request. Null for
   an unknown chat. */
export function phoneEstimates(chatId, deps) {
  const st = remember(chatId, deps);
  const data = st.deps?.getData();
  const chat = data?.chats?.find((c) => c.id === chatId);
  if (!chat) return null;
  const ctx = contextOf(data, chat);
  const h = handsetOf(chat);
  const usage = usageOf(h);
  const led = data.ledger || {};
  const perToken = usage.cost > 0 && usage.tokensIn + usage.tokensOut > 0 ? usage.cost / (usage.tokensIn + usage.tokensOut)
    : led.spent > 0 && (led.tokensIn || 0) + (led.tokensOut || 0) > 0 ? led.spent / ((led.tokensIn || 0) + (led.tokensOut || 0)) : null;
  const base = { handset: h, chat, persona: ctx.persona, userName: ctx.userName, characters: ctx.characters, world: ctx.world, messages: chat.messages, clockNow: clockNowOf(h, chat.messages) };
  const tokensOf = (req) => estimateTokens(`${req.system}\n${req.user}`);
  const dmTo = ctx.characters[0]?.key || "npc:someone";
  const post = h.posts.find((q) => q.kind === "post");
  const reqs = {
    setup: phoneBatch({ ...base, mode: "setup" }),
    sync: phoneBatch({ ...base, mode: "refresh", sync: true, minutes: 0 }),
    refresh: phoneBatch({ ...base, mode: "refresh", minutes: stepOf("1h").min }),
    more: phoneBatch({ ...base, mode: "more" }),
    respond: phoneBatch({ ...base, mode: "respond", slots: [{ id: "r1", kind: "dm", by: dmTo, thread: dmTo, story: dmTo.startsWith("npc:") ? false : true, what: "answer", lines: ["…"], dueAt: base.clockNow, sentAt: base.clockNow }] }),
    replies: phoneBatch({ ...base, mode: "replies", ...(post ? { post: post.id } : {}) }),
  };
  const keys = profileKeys(h, ctx.characters);
  const out = {};
  for (const [mode, req] of Object.entries(reqs)) {
    let tin = tokensOf(req);
    let budget = req.maxTokens;
    if (mode === "setup" && keys.length) {
      tin += tokensOf(profileRequest({ persona: ctx.persona, userName: ctx.userName, characters: ctx.characters, story: ctx.world.story, keys }));
      budget += PROFILE_MAX_TOKENS;
    }
    const m = usage.byMode[mode];
    const tout = m && m.calls >= 2 ? Math.round(m.tokensOut / m.calls) : budget;
    out[mode] = { in: tin, out: tout, ...(perToken !== null ? { cost: (tin + tout) * perToken } : {}) };
  }
  return out;
}

/* replyJob.js, as a reply starts: on a local endpoint the running batch is
   cancelled and re-queued (it runs again after the reply). */
export function phoneReplyStarting(chatId, settings) {
  const st = chats.get(chatId);
  if (!st?.running?.handle || sourceOf(settings) !== "local") return false;
  st.running.requeue = true;
  cancelActivity(st.running.handle.id);
  return true;
}

/* for tests */
export function resetPhoneJobs() {
  for (const st of chats.values()) { clearTimeout(st.timer); for (const r of st.replies) r.resolve?.("dropped"); st.setup?.resolve?.("dropped"); st.world?.resolve?.("dropped"); }
  chats.clear();
  emit();
}
