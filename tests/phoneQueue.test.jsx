// @vitest-environment jsdom
/* The phone's queue (src/pages/chat/phoneJob.js, PHONE_SOCIAL.md §3): setup,
   manual refresh and Sync to chat, respond after a delay (only when
   something is owed), one batch in flight per chat, coalescing, the chat
   moving under a batch, failures, usage. A fake requester
   stands in for the model; nothing touches the network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData } from "../src/lib/data.js";
import { activity, cancelWhere, clearActivity, startActivity } from "../src/lib/activity.js";
import { ROOT_ANCHOR, anchorOf, looseAnchorOf } from "../src/lib/anchor.js";
import { POST_CAP, addMessage as sendDm, addPost, emptyHandset, setMe } from "../src/lib/phone.js";
import { syncPendingOf } from "../src/lib/phoneClock.js";
import { BUDGETS, mergeBatch, owedSlots } from "../src/lib/phoneBatch.js";
import { addSwipe } from "../src/lib/swipes.js";
import {
  RESPOND_DELAY, RESPOND_DM_DELAY, loadMorePhone, notePhoneAction, pendingPhoneActions, phoneEstimates, phoneOnMount, phoneQueueOf, phoneReplyStarting,
  refreshPhone as refreshRaw, requestPhone, requestRespond, resetPhoneJobs, startPhoneSeed, loadMoreReplies, setupPhone,
} from "../src/pages/chat/phoneJob.js";
import { REPLIES_PER_POST, repliesTo, transfer } from "../src/lib/phone.js";

/* the persona's DM read and answered at once (handset.dmWait): most suites
   here test the queue, not the timing ("DM timing" below does) */
const instant = (x, key) => (x.dmWait?.[key] ? { ...x, dmWait: { ...x.dmWait, [key]: { ...x.dmWait[key], due: x.dmWait[key].sent, seen: x.dmWait[key].sent } } } : x);
const addMessage = (x, key, ...rest) => instant(sendDm(x, key, ...rest), key);

let data;
let calls;
const getData = () => data;
const update = (patch) => { data = typeof patch === "function" ? patch(data) : { ...data, ...patch }; };
const requester = ({ signal }) => (req) => new Promise((resolve, reject) => {
  calls.push({ ...req, signal, finish: (text) => resolve({ text }), fail: (m) => reject(new Error(m)) });
  signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
});
const deps = () => ({ getData, update, requester });
const chat = () => data.chats.find((c) => c.id === "a");
const h = () => chat().handset;
const patchChat = (fn) => { data = { ...data, chats: data.chats.map((c) => (c.id === "a" ? fn(c) : c)) }; };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const flushFake = async () => { for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0); };
const isProfile = (c) => /read character descriptions/.test(c.system);
const batches = () => calls.filter((c) => !isProfile(c));
const phoneRunning = () => activity.get().filter((j) => j.kind === "phone" && j.status === "running");
const texts = () => h().posts.map((p) => p.text);
let n = 0;
/* Refresh by an hour unless a step is given or chosen (the default step is
   Sync to chat, tested on its own below) */
const refreshNow = (id, d, opts = {}) => refreshRaw(id, d, opts.step || data.chats.find((c) => c.id === id)?.handset?.clock?.step !== "sync" ? opts : { ...opts, step: "1h" });
/* these tests refresh after the story moved on by one reply */
let moves = 0;
const refreshPhone = (...args) => {
  patchChat((c) => ({ ...c, messages: [...c.messages, { id: `m${++moves}`, role: "assistant", content: `Moved ${moves}.` }] }));
  return refreshNow(...args);
};
const reply = () => {
  const id = `r${++n}`;
  patchChat((c) => ({ ...c, messages: [...c.messages, { id, role: "assistant", content: `Reply ${n}.` }] }));
  return id;
};
const SEED = JSON.stringify({ me: { fame: 1 }, posts: [{ by: "bea", text: "Morning, harbour." }, { by: "tom", text: "Ferry late again." }], dms: [{ from: "mira", text: "You up?" }] });
const FEED = (text = "Fog rolls in.") => JSON.stringify({ posts: [{ by: "bea", text }] });
const PROFILE = JSON.stringify({ accounts: [{ key: "you", fame: 1, job: "baker", from: { fame: "stated", job: "stated" } }] });
/* a seeded handset with one post */
const base = (level) => mergeBatch(emptyHandset(level), { posts: [{ by: "lena", text: "Seed post." }] }, { mode: "seed" });
const setHandset = (x) => patchChat((c) => ({ ...c, handset: x }));

beforeEach(() => {
  resetPhoneJobs(); clearActivity(); calls = []; n = 0; moves = 0;
  data = structuredClone(emptyData);
  data.username = "Ana";
  data.settings.providers[0].key = "test";
  data.settings.providers[0].model = "test-model";
  data.characters = [{ id: "c", name: "Mira", description: "A locksmith.", greetings: [] }];
  data.chats = [{ id: "a", kind: "character", characterId: "c", messages: [{ id: "g", role: "assistant", content: "Hello." }, { id: "u1", role: "user", content: "Hi Mira." }] }];
});
afterEach(async () => {
  cancelWhere(() => true);
  vi.useRealTimers();
  await flush();
  resetPhoneJobs(); clearActivity();
});

describe("seed", () => {
  it.each(["off", "light", "lively"])("never seeds by itself on %s: mount, reply and refresh run nothing until setup", async (level) => {
    patchChat((c) => ({ ...c, messages: [c.messages[0]], handset: emptyHandset(level) }));
    expect(phoneOnMount("a", deps())).toBe(false);
    reply();
    refreshNow("a");
    requestPhone("a", { mode: "respond" });
    loadMorePhone("a");
    await flush();
    expect(calls).toHaveLength(0);
    expect(h().tick.seeded).toBe(false);
    expect(phoneQueueOf("a")).toMatchObject({ running: false, pending: false });
  });

  it.each(["off", "light", "lively"])("setup by hand on %s: profile first, then the feed, streamed, then a toast", async (level) => {
    const { toasts } = await import("../src/lib/toast.js");
    const before = toasts.get().length;
    patchChat((c) => ({ ...c, messages: [c.messages[0]], handset: emptyHandset(level) }));
    const done = setupPhone("a", deps());
    expect(phoneQueueOf("a").setup).toBe(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(isProfile(calls[0])).toBe(true);
    calls[0].finish(PROFILE); await flush();
    expect(h().me.traits.job).toBe("baker");
    expect(batches()).toHaveLength(1);
    expect(batches()[0].maxTokens).toBe(BUDGETS[level].seed.maxTokens);
    expect(phoneRunning()[0]).toMatchObject({ label: "Phone setup", quiet: false, dedupeKey: "phone:a", owner: { chatId: "a" } });
    /* what it should bring, for the placeholders, while it runs */
    expect(phoneQueueOf("a").expect).toEqual({ mode: "setup", posts: Math.min(BUDGETS[level].seed.posts, 4), place: "top" });
    /* streamed: the finished items show as previews */
    batches()[0].onText('{"posts":[{"by":"bea","text":"Morning, harbour."},{"by":"tom","te');
    expect(phoneQueueOf("a").preview.posts.map((p) => p.text)).toEqual(["Morning, harbour."]);
    batches()[0].finish(SEED);
    expect(await done).toBe("merged");
    await flush();
    expect(h().tick.seeded).toBe(true);
    expect(texts()).toEqual(["Morning, harbour.", "Ferry late again."]);
    expect(h().posts.every((p) => p.anchor.id === ROOT_ANCHOR.id)).toBe(true);
    expect(h().threads["char:c"].map((m) => m.text)).toEqual(["You up?"]);
    expect(phoneQueueOf("a")).toMatchObject({ preview: null, expect: null, setup: false });
    expect(phoneRunning()).toHaveLength(0);
    expect(toasts.get().slice(before).at(-1)).toMatchObject({ text: "Your phone is set up" });
  });

  it("a failed setup says so in a warning toast", async () => {
    const { toasts } = await import("../src/lib/toast.js");
    patchChat((c) => ({ ...c, handset: emptyHandset("light") }));
    const done = setupPhone("a", deps()); await flush();
    calls[0].finish(PROFILE); await flush();
    batches()[0].fail("500 server error"); await flush();
    expect(await done).toBe("error");
    expect(toasts.get().at(-1)).toMatchObject({ text: "Phone setup failed. Open the phone to retry.", tone: "warn" });
    expect(h().tick.seeded).toBe(false);
  });

  it("startPhoneSeed (kept for tests) still seeds when asked for directly", async () => {
    expect(phoneOnMount("a", deps())).toBe(false);
    await flush();
    expect(calls).toHaveLength(0);
    expect(startPhoneSeed("a", deps())).toBe(true);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("skips the profile call when every profile exists, and needs a key", async () => {
    data.settings.providers[0].key = "";
    patchChat((c) => ({ ...c, handset: emptyHandset("light") }));
    expect(startPhoneSeed("a", deps())).toBe(false);
  });

  it("an empty seed retries once (phoneBatch's nudge), then sets tick.error", async () => {
    patchChat((c) => ({ ...c, handset: emptyHandset("light") }));
    startPhoneSeed("a", deps()); await flush();
    calls[0].finish(PROFILE); await flush();
    batches()[0].finish("Sorry, no."); await flush();
    expect(batches()).toHaveLength(2);
    batches()[1].finish("{}"); await flush();
    expect(batches()).toHaveLength(2);
    expect(h().tick.error).toMatchObject({ mode: "seed" });
    expect(h().tick.seeded).toBe(false);
  });
});

describe("refresh by level", () => {
  it.each(["off", "light", "lively"])("a saved reply never queues a phone request on %s", async (level) => {
    vi.useFakeTimers();
    setHandset(addMessage(base(level), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    phoneOnMount("a", deps());
    for (let i = 0; i < 6; i++) reply();
    await vi.advanceTimersByTimeAsync(RESPOND_DELAY * 3); await flushFake();
    expect(calls).toHaveLength(0);
    expect(phoneQueueOf("a")).toMatchObject({ pending: false, running: false });
  });

  it("manual refresh and Load more work on Off with their budgets", async () => {
    setHandset(base("off"));
    refreshPhone("a", deps()); await flush();
    expect(batches()[0].maxTokens).toBe(BUDGETS.light.refresh.maxTokens);
    batches()[0].finish(FEED("fresh")); await flush();
    loadMorePhone("a", deps()); await flush();
    expect(batches()[1].maxTokens).toBe(BUDGETS.off.more.maxTokens);
    batches()[1].finish(FEED("older")); await flush();
    expect(texts()).toEqual(["fresh", "Seed post.", "older"]);
  });
});

describe("the queue", () => {
  it("keeps one in flight and coalesces waiting requests by priority", async () => {
    setHandset(addMessage(base("lively"), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    loadMorePhone("a", deps()); await flush();
    refreshPhone("a"); requestPhone("a", { mode: "respond" }); refreshNow("a"); loadMorePhone("a");
    await flush();
    expect(batches()).toHaveLength(1);
    expect(phoneRunning()).toHaveLength(1);
    expect(phoneQueueOf("a")).toMatchObject({ pending: true, running: true, mode: "more" });
    batches()[0].finish(FEED("older")); await flush();
    expect(batches()).toHaveLength(2);
    /* refresh + respond: one refresh that also fills the owed slots */
    expect(batches()[1].user).toContain("Write what appeared since");
    expect(batches()[1].user).toContain("[Owed]");
    batches()[1].finish(JSON.stringify({ dms: [{ from: "mira", text: "Home.", slot: "r1" }] })); await flush();
    expect(batches()).toHaveLength(2);
    expect(phoneQueueOf("a").pending).toBe(false);
  });

  it.each(["light", "off"])("on %s a waiting refresh merged with a respond runs as a refresh and keeps its posts", async (level) => {
    setHandset(addMessage(base(level), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    loadMorePhone("a", deps()); await flush();
    requestPhone("a", { mode: "respond" }); refreshNow("a");
    batches()[0].finish(FEED("older")); await flush();
    expect(batches()).toHaveLength(2);
    expect(batches()[1].user).toContain("Write what appeared since");
    expect(batches()[1].user).toContain("r1: @mira answers");
    batches()[1].finish(JSON.stringify({ posts: [{ by: "bea", text: "Ambient news." }], dms: [{ from: "mira", text: "Home.", slot: "r1" }] })); await flush();
    expect(texts()).toContain("Ambient news.");
    expect(h().threads["char:c"].at(-1).text).toBe("Home.");
    expect(h().tick.pending).toBe(false);
  });

  it("Load more and the seed leave the persona's pending actions for the respond batch", async () => {
    setHandset(addMessage(base("light"), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    loadMorePhone("a", deps()); await flush();
    batches()[0].finish(FEED("older")); await flush();
    expect(h().tick.pending).toBe(true);
    requestPhone("a", { mode: "respond" }); await flush();
    expect(batches()[1].user).toContain("r1: @mira answers");

    /* the seed too */
    resetPhoneJobs(); calls = [];
    setHandset(addMessage(emptyHandset("light"), "char:c", "You up?", anchorOf(chat().messages.at(-1))));
    startPhoneSeed("a", deps()); await flush();
    calls[0].finish(PROFILE); await flush();
    batches()[0].finish(SEED); await flush();
    expect(h().tick.seeded).toBe(true);
    expect(h().tick.pending).toBe(true);
  });

  it("never starts a batch during the chat's reply, and starts it after", async () => {
    setHandset(base("lively"));
    const r = startActivity({ kind: "reply", dedupeKey: "reply:a", owner: { chatId: "a" } });
    refreshPhone("a", deps()); await flush();
    expect(calls).toHaveLength(0);
    r.done(); await flush();
    expect(batches()).toHaveLength(1);
  });

  it("a reply on a local endpoint cancels the running batch, which runs again after it", async () => {
    data.settings.providers = [{ id: "loc", preset: "custom", base: "http://localhost:5001/v1", local: true, model: "m" }];
    data.settings.activeProvider = "loc";
    setHandset(base("lively"));
    refreshPhone("a", deps()); await flush();
    expect(batches()).toHaveLength(1);
    const r = startActivity({ kind: "reply", dedupeKey: "reply:a", owner: { chatId: "a" } });
    expect(phoneReplyStarting("a", data.settings)).toBe(true);
    await flush();
    expect(phoneRunning()).toHaveLength(0);
    expect(batches()[0].signal.aborted).toBe(true);
    expect(phoneQueueOf("a").pending).toBe(true);
    r.done(); await flush();
    expect(batches()).toHaveLength(2);
    batches()[1].finish(FEED("after the reply")); await flush();
    expect(texts()[0]).toBe("after the reply");
  });

  it("a reply on a remote endpoint leaves the batch running", async () => {
    setHandset(base("lively"));
    refreshPhone("a", deps()); await flush();
    expect(phoneReplyStarting("a", data.settings)).toBe(false);
    expect(phoneRunning()).toHaveLength(1);
  });
});

describe("the chat moving under a batch", () => {
  it("a deleted message drops ambient items and re-queues one refresh; a swipe keeps them", async () => {
    setHandset(base("lively"));
    const id = reply();
    refreshPhone("a", deps()); await flush();
    patchChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === `m${moves}` ? addSwipe(m, "Another version.") : m)) }));
    batches()[0].finish(FEED("kept")); await flush();
    expect(texts()[0]).toBe("kept");
    expect(batches()).toHaveLength(1);
    refreshPhone("a"); await flush();
    patchChat((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== `m${moves}`) }));
    batches()[1].finish(FEED("stale")); await flush();
    expect(texts()).not.toContain("stale");
    expect(batches()).toHaveLength(3);
    expect(id).toBe("r1");
  });

  it("a respond result survives a swipe of its message", async () => {
    const id = "r0";
    patchChat((c) => ({ ...c, messages: [...c.messages, { id, role: "assistant", content: "Reply." }] }));
    setHandset(addMessage(base("lively"), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    requestPhone("a", { mode: "respond" }, deps()); await flush();
    expect(batches()[0].user).toContain("[Owed]");
    patchChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? addSwipe(m, "Another version.") : m)) }));
    batches()[0].finish(JSON.stringify({ dms: [{ from: "mira", text: "On my way.", slot: "r1" }] })); await flush();
    const answer = h().threads["char:c"].at(-1);
    expect(answer.text).toBe("On my way.");
    expect(answer.anchor).toEqual({ id, swipe: 0, any: true });
    expect(batches()).toHaveLength(1);
  });

  it("new messages after the anchor are merged, with no follow-up", async () => {
    setHandset(base("lively"));
    refreshPhone("a", deps()); await flush();
    patchChat((c) => ({ ...c, messages: [...c.messages, { id: "late", role: "assistant", content: "Later reply." }] }));
    batches()[0].finish(FEED("kept")); await flush();
    expect(texts()[0]).toBe("kept");
    expect(batches()).toHaveLength(1);
  });
});

describe("failures", () => {
  it("a failure sets tick.error and the next success clears it", async () => {
    setHandset(base("light"));
    refreshPhone("a", deps()); await flush();
    batches()[0].fail("429 rate limited"); await flush();
    expect(h().tick.error).toMatchObject({ message: "429 rate limited", mode: "refresh" });
    expect(phoneQueueOf("a").error).toMatchObject({ mode: "refresh" });
    expect(chat().lastError).toBeFalsy();
    refreshPhone("a"); await flush();
    batches()[1].finish(FEED()); await flush();
    expect(h().tick.error).toBeUndefined();
    expect(phoneQueueOf("a").error).toBeNull();
  });
});

describe("persona actions", () => {
  it("passes likes and reposts to the next batch, then clears them", async () => {
    setHandset(base("lively"));
    const post = h().posts[0].id;
    requestRespond("a", { action: { kind: "like", post }, ...deps() });
    requestRespond("a", { action: { kind: "repost", post } });
    expect(pendingPhoneActions("a")).toHaveLength(2);
    refreshNow("a"); await flush();
    expect(batches()[0].user).toContain(`- liked #${post}`);
    expect(batches()[0].user).toContain(`- reposted #${post}`);
    expect(pendingPhoneActions("a")).toHaveLength(0);
    batches()[0].finish("{}"); await flush();
    refreshPhone("a"); await flush();
    expect(batches()[1].user).not.toContain("liked #");
  });

  it("keeps the actions for a retry when the batch fails", async () => {
    setHandset(base("lively"));
    const post = h().posts[0].id;
    requestRespond("a", { action: { kind: "like", post }, ...deps() });
    refreshNow("a"); await flush();
    batches()[0].fail("boom"); await flush();
    expect(pendingPhoneActions("a")).toEqual([{ kind: "like", post }]);
  });

  it("a DM to a story character answers after 2.5 s; other actions after 4 s", async () => {
    vi.useFakeTimers();
    setHandset(addMessage(base("light"), "char:c", "Where are you?", anchorOf(chat().messages.at(-1))));
    requestRespond("a", { dm: true, ...deps() });
    expect(phoneQueueOf("a").pending).toBe(true);
    await vi.advanceTimersByTimeAsync(RESPOND_DM_DELAY - 100); await flushFake();
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100); await flushFake();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("[Texting Mira");
    batches()[0].finish(JSON.stringify({ dms: [{ from: "mira", text: "Home.", slot: "r1" }] })); await flushFake();
    expect(h().threads["char:c"].at(-1).text).toBe("Home.");

    /* a public figure's post is owed replies */
    setHandset(addPost(setMe(h(), { fame: 2 }), { text: "Hello world." }, anchorOf(chat().messages.at(-1))));
    requestRespond("a", {});
    await vi.advanceTimersByTimeAsync(RESPOND_DM_DELAY + 100); await flushFake();
    expect(batches()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RESPOND_DELAY - RESPOND_DM_DELAY); await flushFake();
    expect(batches()).toHaveLength(2);
    expect(batches()[1].user).toContain("replies to #");
  });

  it("an instant DM gets its batch at the DM delay even when asked for before the handset update lands", async () => {
    vi.useFakeTimers();
    setHandset(base("light"));
    requestRespond("a", { dm: true, ...deps() });
    setHandset(addMessage(h(), "char:c", "You there?", looseAnchorOf(chat().messages.at(-1))));
    await vi.advanceTimersByTimeAsync(RESPOND_DM_DELAY); await flushFake();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("@mira answers");
  });
});

describe("DM timing (handset.dmWait)", () => {
  const at = () => anchorOf(chat().messages.at(-1));
  const timed = (x, key, w) => ({ ...x, dmWait: { ...x.dmWait, [key]: { ...x.dmWait[key], ...w } } });

  it("a DM whose answer is not due yet runs no batch", async () => {
    vi.useFakeTimers();
    setHandset(timed(sendDm(base("light"), "char:c", "Where are you?", at(), { at: 5 }), "char:c", { due: 100, seen: 50 }));
    requestRespond("a", { dm: true, ...deps() });
    await vi.advanceTimersByTimeAsync(RESPOND_DELAY + 100); await flushFake();
    expect(calls).toHaveLength(0);
    expect(phoneQueueOf("a")).toMatchObject({ pending: false, running: false });
    expect(h().tick.pending).toBe(true);
  });

  it("the story moving the clock past the answer's minute: opening the phone brings it, dated then", async () => {
    vi.useFakeTimers();
    setHandset(timed(sendDm(base("light"), "char:c", "Where are you?", at(), { at: 5 }), "char:c", { due: 15, seen: 12 }));
    reply(); reply(); await flushFake();
    expect(calls).toHaveLength(0);
    /* the phone opens: tick.checkDue */
    requestRespond("a", { dm: true, ...deps() });
    await vi.advanceTimersByTimeAsync(RESPOND_DM_DELAY); await flushFake();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain(`r1: @mira answers Ana's message: "Where are you?" (dm)`);
    expect(batches()[0].user).toContain("Write the owed items");
    batches()[0].finish(JSON.stringify({ dms: [{ slot: "r1", text: "Home." }] })); await flushFake();
    expect(h().threads["char:c"].at(-1)).toMatchObject({ text: "Home.", at: 15 });
    expect(h().dmWait["char:c"]).toBeUndefined();
    requestRespond("a", { dm: true });
    await vi.advanceTimersByTimeAsync(RESPOND_DELAY); await flushFake();
    expect(batches()).toHaveLength(1);
  });

  it("a manual refresh of an hour brings the answers due inside it, dated at their minute; a later one keeps waiting", async () => {
    let x = timed(sendDm(base("light"), "char:c", "Where are you?", at(), { at: 5 }), "char:c", { due: 40, seen: 30 });
    x = timed(sendDm(x, "npc:zed", "Hi Zed", at(), { at: 5 }), "npc:zed", { due: 200, seen: 100 });
    setHandset(x);
    refreshPhone("a", deps()); await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("@mira answers");
    expect(batches()[0].user).not.toMatch(/@zed\w* answers/);
    batches()[0].finish(JSON.stringify({ dms: [{ slot: "r1", text: "Home." }] })); await flush();
    expect(h().threads["char:c"].at(-1)).toMatchObject({ text: "Home.", at: 40 });
    expect(h().dmWait["npc:zed"]).toMatchObject({ due: 200 });
    resetPhoneJobs();
    const { normalizeHandset } = await import("../src/lib/phone.js");
    expect(normalizeHandset(h()).dmWait["npc:zed"]).toMatchObject({ due: 200, seen: 100 });
  });
});

describe("review fixes", () => {
  const dmTo = (x, key, text) => addMessage(x, key, text, anchorOf(chat().messages.at(-1)));

  it.each([["seed first", ["seed", "respond"]], ["respond first", ["respond", "seed"]]])("a seed queued with a respond runs the seed, then the respond (%s)", async (_, order) => {
    setHandset(dmTo(emptyHandset("light"), "char:c", "Where are you?"));
    for (const m of order) requestPhone("a", { mode: m }, deps());
    await flush();
    expect(isProfile(calls[0])).toBe(true);
    calls[0].finish(PROFILE); await flush();
    expect(batches()[0].maxTokens).toBe(BUDGETS.light.seed.maxTokens);
    batches()[0].finish(SEED); await flush();
    expect(batches()).toHaveLength(2);
    expect(batches()[1].user).toContain("Write the owed items");
    expect(batches()[1].user).toContain("@mira answers");
  });

  it("two requests' slots with the same id both stay owed", async () => {
    setHandset(base("lively"));
    const post = h().posts[0].id;
    refreshPhone("a", deps()); await flush();
    requestPhone("a", { mode: "respond", slots: [{ id: "r1", kind: "dm", by: "char:c", story: true }] });
    requestPhone("a", { mode: "respond", slots: [{ id: "r1", kind: "reply", by: null, to: post }] });
    batches()[0].finish(FEED()); await flush();
    const tags = [...batches()[1].user.matchAll(/^(q\d+)r1: /gm)].map((m) => m[1]);
    expect(new Set(tags).size).toBe(2);
    expect(batches()[1].user).toMatch(/q\d+r1: @mira answers/);
    expect(batches()[1].user).toContain(`r1: someone who follows Ana replies to #${post}`);
  });

  it("Load more leaves likes and reposts queued for the respond batch", async () => {
    setHandset(base("lively"));
    const post = h().posts[0].id;
    notePhoneAction("a", { kind: "like", post });
    loadMorePhone("a", deps()); await flush();
    expect(batches()[0].user).not.toContain("liked #");
    batches()[0].finish(FEED("older")); await flush();
    expect(pendingPhoneActions("a")).toEqual([{ kind: "like", post }]);
    refreshNow("a"); await flush();
    expect(batches()[1].user).toContain(`- liked #${post}`);
  });

  it("a DM sent while an answer is being written stays owed", async () => {
    setHandset(dmTo(base("light"), "char:c", "Where are you?"));
    requestPhone("a", { mode: "respond" }, deps()); await flush();
    setHandset(dmTo(h(), "char:c", "Also, bring the key."));
    batches()[0].finish(JSON.stringify({ dms: [{ from: "mira", text: "At the shop.", slot: "r1" }] })); await flush();
    /* the answer goes before the line it did not see; that line waits on its own */
    const lines = h().threads["char:c"];
    expect(lines.map((m) => m.text)).toEqual(["Where are you?", "At the shop.", "Also, bring the key."]);
    expect(h().tick.pending).toBe(true);
    expect(h().dmWait["char:c"]).toMatchObject({ line: lines[2].id });
    setHandset(instant(h(), "char:c"));
    expect(owedSlots({ handset: h(), messages: chat().messages })[0]).toMatchObject({ kind: "dm", by: "char:c", lines: ["Also, bring the key."] });
  });

  it("a combined refresh and respond whose message is deleted puts its actions back for the retry", async () => {
    patchChat((c) => ({ ...c, messages: [...c.messages, { id: "r0", role: "assistant", content: "Reply." }] }));
    setHandset(base("lively"));
    const post = h().posts[0].id;
    notePhoneAction("a", { kind: "like", post });
    loadMorePhone("a", deps()); await flush();
    requestPhone("a", { mode: "respond" }); refreshNow("a");
    batches()[0].finish(FEED("older")); await flush();
    expect(batches()[1].user).toContain(`- liked #${post}`);
    patchChat((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== "r0") }));
    batches()[1].finish(FEED("stale")); await flush();
    expect(texts()).not.toContain("stale");
    expect(batches()).toHaveLength(3);
    expect(batches()[2].user).toContain(`- liked #${post}`);
  });

  it("on Light, story DMs past the slot cap stay pending for the next batch", async () => {
    let x = base("light");
    for (const k of ["a", "b", "c", "d", "e"]) x = dmTo(x, `cast:${k}`, `Hi ${k}`);
    setHandset(x);
    requestPhone("a", { mode: "respond" }, deps()); await flush();
    expect(batches()[0].user).toContain("r4:");
    expect(batches()[0].user).not.toContain("r5:");
    batches()[0].finish(JSON.stringify({ dms: ["a", "b", "c", "d"].map((k, i) => ({ from: k, text: `yo ${k}`, slot: `r${i + 1}` })) })); await flush();
    expect(h().tick.pending).toBe(true);
    expect(owedSlots({ handset: h(), messages: chat().messages }).map((o) => o.by)).toContain("cast:e");
  });
});

describe("review fixes, round 2", () => {
  const dmTo = (x, key, text) => addMessage(x, key, text, anchorOf(chat().messages.at(-1)));

  it("a second seed never duplicates the starting feed", async () => {
    setHandset(emptyHandset("lively"));
    expect(startPhoneSeed("a", deps())).toBe(true);
    await flush();
    /* reopened or remounted while the first runs */
    expect(startPhoneSeed("a", deps())).toBe(false);
    expect(phoneOnMount("a", deps())).toBe(false);
    /* a seed forced through the queue meanwhile, after the story moved */
    patchChat((c) => ({ ...c, messages: [...c.messages, { id: "r9", role: "assistant", content: "Later." }] }));
    requestPhone("a", { mode: "seed" });
    calls[0].finish(PROFILE); await flush();
    batches()[0].finish(SEED); await flush();
    expect(texts()).toEqual(["Morning, harbour.", "Ferry late again."]);
    /* the queued one runs as a refresh, not a second seed */
    expect(batches()).toHaveLength(2);
    expect(batches()[1].user).toContain("Write what appeared since");
    batches()[1].finish(SEED); await flush();
    expect(texts().filter((t) => t === "Morning, harbour.")).toHaveLength(1);
  });

  it("a seed result landing on an already seeded phone is dropped", async () => {
    setHandset(emptyHandset("lively"));
    startPhoneSeed("a", deps()); await flush();
    calls[0].finish(PROFILE); await flush();
    setHandset(base("lively")); /* seeded elsewhere meanwhile */
    batches()[0].finish(SEED); await flush();
    expect(texts()).toEqual(["Seed post."]);
  });

  it("a stale refresh+respond keeps the answers re-anchored and puts its actions back", async () => {
    patchChat((c) => ({ ...c, messages: [...c.messages, { id: "r0", role: "assistant", content: "Reply." }] }));
    setHandset(dmTo(base("lively"), "char:c", "Where are you?"));
    const post = h().posts[0].id;
    notePhoneAction("a", { kind: "like", post });
    loadMorePhone("a", deps()); await flush();
    requestPhone("a", { mode: "respond" }); refreshNow("a");
    batches()[0].finish(FEED("older")); await flush();
    patchChat((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== "r0") }));
    batches()[1].finish(JSON.stringify({ posts: [{ by: "bea", text: "ambient" }], dms: [{ from: "mira", text: "Home.", slot: "r1" }] })); await flush();
    expect(texts()).not.toContain("ambient");
    const answer = h().threads["char:c"].at(-1);
    expect(answer.text).toBe("Home.");
    expect(answer.anchor).toEqual(looseAnchorOf(chat().messages.at(-1)));
    expect(batches()).toHaveLength(3);
    expect(batches()[2].user).toContain(`- liked #${post}`);
  });

  it("Load more with a full feed asks nothing and shows no error", async () => {
    let x = base("lively");
    x = { ...x, posts: Array.from({ length: POST_CAP }, (_, i) => ({ ...x.posts[0], id: `p${i}`, text: `post ${i}` })) };
    setHandset(x);
    loadMorePhone("a", deps()); await flush();
    expect(calls).toHaveLength(0);
    expect(h().tick.error).toBeUndefined();
    expect(phoneQueueOf("a")).toMatchObject({ pending: false, error: null });
  });
});

describe("more replies", () => {
  const REPLIES = (tag, k = 5) => JSON.stringify({ posts: Array.from({ length: k }, (_, i) => ({ by: `fan${tag}${i}`, text: `reply ${tag}${i}`, replyTo: "anything" })), dms: [{ from: "x", text: "no" }] });
  it("queues one replies batch per post, merges with the post ref and stops at the cap", async () => {
    setHandset(base("lively"));
    const id = h().posts[0].id;
    const p = loadMoreReplies("a", id, deps());
    expect(loadMoreReplies("a", id)).toBe(p);
    await flush();
    expect(phoneQueueOf("a")).toMatchObject({ running: true, mode: "replies", replies: [id] });
    /* one in flight: a refresh waits behind it */
    refreshPhone("a"); await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].maxTokens).toBe(600);
    expect(batches()[0].user).toContain(`#${id}`);
    batches()[0].finish(REPLIES("a"));
    expect(await p).toBe("merged");
    expect(repliesTo(h(), id).map((x) => x.text)).toHaveLength(5);
    expect(repliesTo(h(), id).every((x) => x.ref === id)).toBe(true);
    expect(h().threads).toEqual({});
    expect(h().posts.find((x) => x.id === id).stats.replies).toBeGreaterThanOrEqual(5);
    await flush();
    expect(batches()).toHaveLength(2); /* the refresh ran after */
    batches()[1].finish(FEED("after")); await flush();
    const p2 = loadMoreReplies("a", id); await flush();
    batches()[2].finish(REPLIES("b", 10));
    expect(await p2).toBe("merged");
    expect(repliesTo(h(), id)).toHaveLength(REPLIES_PER_POST);
    expect(await loadMoreReplies("a", id)).toBe("full");
    expect(batches()).toHaveLength(3);
    expect(await loadMoreReplies("a", "missing")).toBe("dropped");
  });
});

describe("transfers", () => {
  it("a transfer to a story character queues a respond after 2.5 s with [Money]", async () => {
    vi.useFakeTimers();
    setHandset(transfer(base("light"), { to: "char:c", toName: "Mira", amount: 40, note: "the key" }));
    requestRespond("a", { action: { kind: "transfer", to: "char:c", amount: 40, note: "the key" }, ...deps() });
    await vi.advanceTimersByTimeAsync(RESPOND_DM_DELAY - 100); await flushFake();
    expect(batches()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100); await flushFake();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("[Money]\nAna sent 40 (the key) to Mira.");
    batches()[0].finish(JSON.stringify({ dms: [{ from: "mira", text: "Forty? What is this for?" }] })); await flushFake();
    expect(h().threads["char:c"].at(-1).text).toBe("Forty? What is this for?");
    expect(h().tick.pending).toBe(false);
  });
});

describe("setup on toggle", () => {
  it.each(["off", "lively"])("runs profiles then a not-quiet seed from the chat as it stands on %s, keeping old posts", async (level) => {
    setHandset({ ...base(level), level });
    patchChat((c) => ({ ...c, memory: { summary: "Mira lost the key." }, messages: [...c.messages, { id: "r1", role: "assistant", content: "Mira sighs." }] }));
    const done = setupPhone("a", deps());
    expect(setupPhone("a")).toBe(done);
    await flush();
    const job = activity.get().find((j) => j.kind === "phone" && j.status === "running");
    expect(job).toMatchObject({ label: "Phone setup", dedupeKey: "phone:a" });
    expect(job.quiet).toBeFalsy();
    expect(isProfile(calls[0])).toBe(true);
    calls[0].finish(PROFILE); await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("Mira lost the key.");
    expect(batches()[0].user).toMatch(/just switched on in a story already under way/);
    expect(batches()[0].maxTokens).toBe(BUDGETS[level].seed.maxTokens);
    batches()[0].finish(FEED("Heard about the key?"));
    expect(await done).toBe("merged");
    expect(texts()).toEqual(["Heard about the key?", "Seed post."]);
    expect(h().posts[0].anchor).toEqual(ROOT_ANCHOR);
    expect(h().me.traits.job).toBe("baker");
    /* other generations stay quiet */
    refreshPhone("a"); await flush();
    expect(activity.get().find((j) => j.kind === "phone" && j.status === "running")).toMatchObject({ label: "Phone", quiet: true });
  });
});

describe("no automatic refresh", () => {
  it("replies queue nothing; the persona's post waits for its replies; Refresh brings the reactions", async () => {
    vi.useFakeTimers();
    setHandset(base("lively"));
    reply(); reply(); await flushFake();
    expect(batches()).toHaveLength(0);
    setHandset(addPost(setMe(h(), { fame: 1 }), { text: "My news" }, anchorOf(chat().messages.at(-1))));
    refreshNow("a", deps()); await flushFake();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("- posted (#");
    batches()[0].finish(FEED("World news.")); await flushFake();
    expect(h().posts.find((p) => p.text === "My news").pot.likes).toBeGreaterThan(0);
  });
});

describe("world events and time skips", () => {
  it("worldEvent writes an anchored story event, moves the scene note, and makes no request", async () => {
    const { worldEvent } = await import("../src/pages/chat/phoneJob.js");
    const { phoneNote } = await import("../src/lib/phone.js");
    patchChat((c) => ({ ...c, messages: [...c.messages, { id: "r1", role: "assistant", content: "Mira nods." }], scene: { text: "Mira's shop, noon." } }));
    const e = worldEvent("a", "That evening they arrive at the lighthouse.", deps());
    expect(e).toMatchObject({ kind: "event", source: "you", text: "That evening they arrive at the lighthouse.", anchor: { id: "r1", swipe: 0, any: true } });
    expect(chat().world.log.at(-1)).toEqual(e);
    expect(chat().scene.text).toBe("Mira's shop, noon.\nNow: That evening they arrive at the lighthouse.");
    worldEvent("a", "Mira sneezes.");
    expect(chat().scene.text).toBe("Mira's shop, noon.\nNow: That evening they arrive at the lighthouse.");
    expect(worldEvent("a", "   ")).toBeNull();
    await flush();
    expect(calls).toHaveLength(0);
    expect(activity.get()).toHaveLength(0);
    /* every chat's next reply hears it; a swipe of its message keeps it, a
       cut takes it out */
    expect(phoneNote(chat())).toContain("[Story events");
    expect(phoneNote(chat())).toContain("- Mira sneezes.");
    patchChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === "r1" ? addSwipe(m, "Other.") : m)) }));
    expect(phoneNote(chat())).toContain("Mira sneezes");
    patchChat((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== "r1") }));
    expect(phoneNote(chat())).not.toContain("Mira sneezes");
  });

  it.each([["off", BUDGETS.light.refresh.maxTokens], ["lively", BUDGETS.lively.seed.maxTokens]])("skipTime runs one quiet World batch on %s, merges it and moves the time", async (level, tokens) => {
    const { skipTime } = await import("../src/pages/chat/phoneJob.js");
    setHandset({ ...base(level), level });
    patchChat((c) => ({ ...c, scene: { text: "Harbour, night." } }));
    const p = skipTime("a", "week", deps());
    expect(skipTime("a", "week")).toBe(p);
    await flush();
    const job = activity.get().find((j) => j.status === "running");
    expect(job).toMatchObject({ kind: "world", label: "World", quiet: true, dedupeKey: "phone:a" });
    expect(batches()).toHaveLength(1);
    expect(batches()[0].maxTokens).toBe(tokens);
    expect(batches()[0].user).toMatch(/A week passes in the story/);
    batches()[0].finish(JSON.stringify({ time: "Monday, a week later", summary: "The ferry strike ended.", posts: [{ by: "bea", text: "Ferries are back!", ago: "2d" }], payments: [{ from: "Harbour Co.", to: "you", amount: 200, note: "wages", category: "wage" }] }));
    expect(await p).toBe("merged");
    expect(texts()).toContain("Ferries are back!");
    expect(h().bank.tx[0]).toMatchObject({ category: "wage", amount: 200 });
    expect(chat().world.log.at(-1)).toMatchObject({ kind: "skip", source: "you", span: "week", text: "A week passed. The ferry strike ended." });
    expect(chat().scene.text).toBe("Time: Monday, a week later\nHarbour, night.");
    expect(chat().messages).toHaveLength(2); /* no character reply */
    expect(await skipTime("a", "year")).toBe("dropped");
  });

  it("a DM thread gets one answer per persona line, refresh after refresh", async () => {
    setHandset(base("light"));
    const say = (t) => setHandset(addMessage(h(), "char:c", t, anchorOf(chat().messages.at(-1))));
    const lines = () => h().threads["char:c"].map((m) => `${m.from}: ${m.text}`);
    say("Where are you?");
    refreshPhone("a", deps()); await flush();
    batches()[0].finish(JSON.stringify({ dms: [{ from: "mira", text: "Shop." }, { from: "mira", text: "Also, hi." }] })); await flush();
    expect(lines()).toEqual(["you: Where are you?", "char:c: Shop."]);
    say("Coming over.");
    refreshPhone("a"); await flush();
    batches()[1].finish(JSON.stringify({ dms: [{ from: "mira", text: "Ok!" }, { from: "mira", text: "Bring coffee." }] })); await flush();
    expect(lines()).toEqual(["you: Where are you?", "char:c: Shop.", "you: Coming over.", "char:c: Ok!"]);
    /* nothing new from the persona: nothing in the thread */
    refreshPhone("a"); await flush();
    batches()[2].finish(JSON.stringify({ dms: [{ from: "mira", text: "Hello?" }] })); await flush();
    expect(lines()).toHaveLength(4);
  });
});

describe("the phone's clock: refresh = skip", () => {
  it("Refresh moves the clock by the chosen step, dates what it brings inside it and logs an hour or more", async () => {
    const { setRefreshStep } = await import("../src/lib/phone.js");
    setHandset(base("light"));
    /* now: 5 minutes for the greeting */
    refreshNow("a", deps()); await flush();
    expect(phoneQueueOf("a").expect).toEqual({ mode: "refresh", posts: Math.min(BUDGETS.light.refresh.posts, 4), place: "top" });
    expect(batches()[0].user).toMatch(/About 1 hour passed since the phone was last checked/);
    batches()[0].finish(JSON.stringify({ posts: [{ by: "bea", text: "Fog.", ago: "20m" }, { by: "tom", text: "Old?", ago: "5h" }] })); await flush();
    expect(h().clock).toEqual({ min: 65, at: { id: "u1", swipe: 0, any: true }, sync: ROOT_ANCHOR, step: "sync", last: 65 });
    expect(h().posts.slice(0, 2).map((p) => p.at)).toEqual([45, 0]);
    expect(chat().world.log.at(-1)).toMatchObject({ kind: "skip", source: "you", text: "About 1 hour passed." });
    expect(chat().scene.text).toMatch(/^Time: 1 hour later/);
    expect(phoneQueueOf("a").expect).toBeNull();

    /* a chosen step; under an hour no log line */
    setHandset(setRefreshStep(h(), "15m"));
    const logged = chat().world.log.length;
    refreshNow("a"); await flush();
    batches()[1].finish(FEED()); await flush();
    expect(h().clock).toMatchObject({ min: 80, last: 80, step: "15m" });
    expect(chat().world.log).toHaveLength(logged);
    /* an explicit step wins */
    refreshNow("a", undefined, { step: "3h" }); await flush();
    batches()[2].finish(FEED("Later.")); await flush();
    expect(h().clock.min).toBe(260);
    expect(chat().world.log.at(-1).text).toBe("About 3 hours passed.");
  });

  it("a failed or dropped refresh moves nothing; respond and more never move it", async () => {
    setHandset(base("lively"));
    refreshNow("a", deps()); await flush();
    batches()[0].fail("500"); await flush();
    expect(h().clock.min).toBe(0);
    loadMorePhone("a"); await flush();
    expect(phoneQueueOf("a").expect).toMatchObject({ mode: "more", place: "bottom" });
    batches()[1].finish(FEED("older")); await flush();
    expect(h().clock.min).toBe(0);
  });

  it("a day step and skipTime('day') take the same path", async () => {
    const { skipTime } = await import("../src/pages/chat/phoneJob.js");
    setHandset(base("light"));
    const p = refreshNow("a", deps(), { step: "day" });
    expect(skipTime("a", "day")).toBe(p);
    await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toMatch(/A day passes in the story/);
    batches()[0].finish(JSON.stringify({ summary: "Rain all day.", posts: [{ by: "bea", text: "Wet.", ago: "3h" }] }));
    expect(await p).toBe("merged");
    expect(h().clock).toMatchObject({ min: 1445, last: 1445 });
    expect(h().posts[0].at).toBe(1445 - 180);
    expect(chat().world.log.at(-1)).toMatchObject({ kind: "skip", span: "day", text: "A day passed. Rain all day." });
    /* a week after that */
    const w = skipTime("a", "week"); await flush();
    batches()[1].finish(FEED("A week on.")); expect(await w).toBe("merged");
    expect(h().clock.min).toBe(1445 + 10080);
  });

  it("a time skip on a phone not set up is dropped", async () => {
    const { skipTime } = await import("../src/pages/chat/phoneJob.js");
    setHandset(emptyHandset("light"));
    expect(await skipTime("a", "day", deps())).toBe("dropped");
    expect(calls).toHaveLength(0);
  });
});

describe("Sync to chat", () => {
  it("re-times the story since the last sync by the answer's elapsed, then merges what appeared", async () => {
    /* set up after the greeting; then 4 user + reply pairs, stamped */
    let x = base("light");
    x = { ...x, clock: { ...x.clock, min: 5, at: looseAnchorOf(chat().messages[0]), sync: looseAnchorOf(chat().messages[0]) } };
    patchChat((c) => ({ ...c, messages: [{ ...c.messages[0], wt: 5 }], handset: x }));
    let now = 5;
    for (let i = 1; i <= 4; i++) patchChat((c) => ({ ...c, messages: [...c.messages, { id: `su${i}`, role: "user", content: `Ana ${i}`, wt: now }, { id: `sr${i}`, role: "assistant", content: `Mira ${i}`, wt: (now += 5) }] }));
    expect(syncPendingOf(chat())).toBe(4);
    refreshRaw("a", deps(), { step: "sync" }); await flush();
    expect(batches()).toHaveLength(1);
    expect(batches()[0].user).toContain("[The story since Ana's phone was last checked]");
    expect(batches()[0].user).toMatch(/Return "elapsed"/);
    batches()[0].finish(JSON.stringify({ elapsed: 180, posts: [{ by: "bea", text: "Long night.", ago: "1h" }] })); await flush();
    const last = chat().messages.at(-1);
    /* D = 20 already counted; X = 160 spread over the 4 replies */
    expect(last.wt).toBe(25 + 160);
    expect(chat().messages.find((m) => m.id === "sr2").wt).toBe(15 + 80);
    expect(h().clock).toMatchObject({ min: 185, last: 185, at: looseAnchorOf(last), sync: looseAnchorOf(last) });
    const post = h().posts.find((p) => p.text === "Long night.");
    expect(post.at).toBe(125);
    expect(post.at).toBeGreaterThan(5);
    expect(chat().world?.log || []).toHaveLength(0);
    expect(syncPendingOf(chat())).toBe(0);
  });
  it("a failed sync changes nothing", async () => {
    setHandset(base("light"));
    const before = chat();
    refreshRaw("a", deps(), { step: "sync" }); await flush();
    batches()[0].fail("500"); await flush();
    expect(chat().messages).toEqual(before.messages);
    expect(h().clock).toEqual(before.handset.clock);
  });
});

describe("usage", () => {
  it("records each request on the chat's phone, estimated when the provider reports nothing", async () => {
    setHandset(base("light"));
    refreshNow("a", deps()); await flush();
    batches()[0].finish(FEED()); await flush();
    expect(h().usage).toMatchObject({ calls: 1, est: 1, cost: 0, byMode: { refresh: { calls: 1 } } });
    expect(h().usage.tokensIn).toBeGreaterThan(100);
    expect(h().usage.tokensOut).toBeGreaterThan(0);
  });
  it("uses the reported tokens and cost exactly", async () => {
    setHandset(base("light"));
    const reported = ({ signal }) => (req) => new Promise((resolve) => {
      calls.push({ ...req, signal, finish: (text) => resolve({ text, tokensIn: 1200, tokensOut: 300, cost: 0.004 }) });
    });
    refreshRaw("a", { getData, update, requester: reported }, { step: "1h" }); await flush();
    batches()[0].finish(FEED()); await flush();
    expect(h().usage).toEqual({ calls: 1, tokensIn: 1200, tokensOut: 300, cost: 0.004, est: 0, byMode: { refresh: { calls: 1, tokensIn: 1200, tokensOut: 300 } } });
    expect(data.ledger).toMatchObject({ tokensIn: 1200, tokensOut: 300 });
  });
  it("phoneEstimates builds the real prompts; with no history the answer is the budget; cost only when priced", () => {
    setHandset(base("light"));
    const e = phoneEstimates("a", deps());
    expect(Object.keys(e).sort()).toEqual(["more", "refresh", "replies", "respond", "setup", "sync"]);
    for (const k of ["refresh", "more", "respond", "replies"]) expect(e[k].out).toBe(BUDGETS.light[k].maxTokens);
    expect(e.refresh.in).toBeGreaterThan(100);
    expect(e.refresh.cost).toBeUndefined();
    data.ledger = { spent: 1, tokensIn: 500000, tokensOut: 500000 };
    expect(phoneEstimates("a").refresh.cost).toBeCloseTo((e.refresh.in + e.refresh.out) / 1e6, 9);
    expect(phoneEstimates("nope")).toBeNull();
  });
});
