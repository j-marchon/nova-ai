import { describe, expect, it } from "vitest";
import {
  DEFAULT_STEP, PHONE_COST, REFRESH_STEPS, REPLY_MINUTES, SKIP_MINUTES, STORY_MINUTES, advanceClock, ageUnits, clockNowOf, clockOf, itemMinutes, lastWtOf, messageStamp, phoneGapOf, phoneNow,
  shiftTimeline, spanLabel, spendClock, stepOf, syncChat, syncPendingOf, timeLabel,
} from "../src/lib/phoneClock.js";
import { ROOT_ANCHOR, anchorOf, looseAnchorOf } from "../src/lib/anchor.js";
import { addMessage, emptyHandset, normalizeHandset, phoneAct, setRefreshStep } from "../src/lib/phone.js";
import { addSwipe } from "../src/lib/swipes.js";

const msg = (id, role = "assistant") => ({ id, role, content: `${role} ${id}` });
const story = (n) => {
  const out = [msg("g")];
  for (let i = 1; i <= n; i++) out.push(msg(`u${i}`, "user"), msg(`r${i}`));
  return out;
};
const seeded = (level = "light") => ({ ...emptyHandset(level), tick: { ...emptyHandset(level).tick, seeded: true } });

describe("the contract", () => {
  it("exports the constants", () => {
    expect(REPLY_MINUTES).toBe(5);
    expect(REFRESH_STEPS.map((s) => [s.id, s.min, s.label])).toEqual([["sync", 0, "Sync to chat"], ["15m", 15, "15 min"], ["1h", 60, "1 hour"], ["3h", 180, "3 hours"], ["day", 1440, "1 day"]]);
    expect(DEFAULT_STEP).toBe("sync");
    expect(stepOf("sync")).toMatchObject({ id: "sync", min: 0 });
    expect(stepOf("nope").id).toBe("sync");
    expect(PHONE_COST).toEqual({ dm: 1, post: 3, reply: 2, quote: 2, comment: 2, story: 2, transfer: 1 });
    expect(STORY_MINUTES).toBe(1440);
    expect(SKIP_MINUTES).toEqual({ day: 1440, week: 10080, month: 43200 });
  });
  it("clockOf is always whole; a stored clock survives normalizeHandset", () => {
    expect(clockOf(undefined)).toEqual({ min: 0, at: ROOT_ANCHOR, sync: ROOT_ANCHOR, step: "sync", last: 0 });
    expect(clockOf({ clock: { min: "x", at: 3, step: "2h", last: Infinity } })).toEqual({ min: 0, at: ROOT_ANCHOR, sync: ROOT_ANCHOR, step: "sync", last: 0 });
    /* a clock stored before Sync to chat: sync defaults to at */
    const h = normalizeHandset({ ...seeded(), clock: { min: 900, at: { id: "r2", swipe: 1 }, step: "3h", last: 900 } });
    expect(h.clock).toEqual({ min: 900, at: { id: "r2", swipe: 1 }, sync: { id: "r2", swipe: 1 }, step: "3h", last: 900 });
    expect(normalizeHandset(h)).toEqual(h);
  });
});

describe("phoneNow", () => {
  it("is null before setup, then skips plus 5 minutes per story reply", () => {
    const m = story(3);
    expect(phoneNow(emptyHandset("light"), m)).toBeNull();
    expect(phoneNow(undefined, m)).toBeNull();
    expect(phoneNow(seeded(), m)).toBe(3 * REPLY_MINUTES + 5); /* the greeting is a reply too */
    /* 60 minutes skipped after r2 (now 20): then only r3 counts on top */
    const h = advanceClock(seeded(), 60, anchorOf(m[4]), m);
    expect(h.clock).toMatchObject({ min: 80, at: { id: "r2", swipe: 0 }, last: 80 });
    expect(phoneNow(h, m)).toBe(85);
  });
  it("a swipe or a delete moves now with the story, never the stored skips", () => {
    const m = story(2);
    const h = advanceClock(seeded(), 1440, anchorOf(m.at(-1)), m);
    expect(phoneNow(h, m)).toBe(15 + 1440);
    const more = [...m, msg("u3", "user"), msg("r3")];
    expect(phoneNow(h, more)).toBe(15 + 1440 + 5);
    /* deleting the new reply: back */
    expect(phoneNow(h, m)).toBe(15 + 1440);
    /* the swiped message itself still counts by id */
    const swiped = more.map((x) => (x.id === "r3" ? addSwipe(x, "Other.") : x));
    expect(phoneNow(h, swiped)).toBe(15 + 1440 + 5);
    /* the anchor's message gone: only the stored minutes */
    expect(phoneNow(h, story(0))).toBe(15 + 1440);
    expect(h.clock.min).toBe(1455);
  });
  it("advanceClock never goes back", () => {
    const m = story(1);
    expect(advanceClock(seeded(), -50, ROOT_ANCHOR, m).clock.min).toBe(10);
    expect(advanceClock(seeded(), 0, null, m).clock).toMatchObject({ min: 10, at: ROOT_ANCHOR, last: 10 });
  });
});

describe("labels and ages", () => {
  it("timeLabel from minutes to months", () => {
    expect([0, 0.5, -3, 1, 5, 59, 60, 179, 1439, 1440, 2 * 1440, 6 * 1440, 7 * 1440, 3 * 10080, 29 * 1440, 30 * 1440, 4 * 43200].map(timeLabel))
      .toEqual(["now", "now", "now", "1m", "5m", "59m", "1h", "2h", "23h", "1d", "2d", "6d", "1w", "3w", "4w", "1mo", "4mo"]);
  });
  it("spanLabel names a span", () => {
    expect([15, 60, 180, 1440, 2880, 10080, 43200].map(spanLabel)).toEqual(["15 minutes", "1 hour", "3 hours", "1 day", "2 days", "1 week", "1 month"]);
  });
  it("itemMinutes is now - at; items without at use the old reply clock x 30", () => {
    const m = story(2);
    const h = seeded();
    expect(itemMinutes({ at: 5, anchor: ROOT_ANCHOR }, h, m)).toBe(10);
    expect(ageUnits({ at: -45, anchor: ROOT_ANCHOR }, h, m)).toBe(2);
    expect(itemMinutes({ at: 99, anchor: ROOT_ANCHOR }, h, m)).toBe(0);
    /* legacy, the old clock: (replies since the anchor + ago/30) x 30 */
    expect(itemMinutes({ anchor: { id: "r1", swipe: 0 }, ago: 15 }, h, m)).toBe(30 + 15);
    expect(ageUnits({ anchor: ROOT_ANCHOR }, h, m)).toBe(3);
    /* before setup, `at` is not read */
    expect(itemMinutes({ at: 0, anchor: { id: "r1", swipe: 0 } }, emptyHandset("light"), m)).toBe(30);
  });
});

describe("messageStamp", () => {
  it("is null before setup; the user's at now, the reply's 5 minutes later", () => {
    const m = story(2);
    expect(messageStamp({ messages: m }, "user")).toBeNull();
    expect(messageStamp({ messages: m, handset: emptyHandset("lively") }, "assistant")).toBeNull();
    const off = { ...seeded("off") };
    expect(messageStamp({ messages: m, handset: off }, "user")).toBe(15);
    expect(messageStamp({ messages: m, handset: off }, "assistant")).toBe(20);
  });
});

describe("setRefreshStep", () => {
  it("sets a known step and ignores anything else", () => {
    const h = setRefreshStep(seeded(), "3h");
    expect(h.clock.step).toBe("3h");
    expect(setRefreshStep(h, "2h").clock.step).toBe("3h");
    expect(normalizeHandset(h).clock.step).toBe("3h");
  });
});

describe("the W floor and spendClock", () => {
  it("spendClock moves min and at, keeps last and sync; nothing before setup", () => {
    const m = story(2);
    const h = spendClock(seeded(), 3, m);
    expect(h.clock).toMatchObject({ min: 18, at: looseAnchorOf(m.at(-1)), sync: ROOT_ANCHOR, last: 0 });
    expect(phoneNow(h, m)).toBe(18);
    expect(spendClock(emptyHandset("light"), 3, m)).toEqual(emptyHandset("light"));
    /* an empty chat: hung on the start */
    expect(spendClock(seeded(), 1, []).clock.at).toEqual(ROOT_ANCHOR);
  });
  it("now never falls below the newest stamp, even when the clock's message is deleted", () => {
    const m = story(2).map((x, i) => ({ ...x, wt: [5, 5, 10, 10, 15][i] }));
    expect(lastWtOf(m)).toBe(15);
    expect(lastWtOf(story(1))).toBeNull();
    const h = spendClock(seeded(), 1, m);
    expect(phoneNow(h, m)).toBe(16);
    /* a reply stamped later than the drift (e.g. after a sync) lifts now */
    const later = [...m, { ...msg("u3", "user"), wt: 100 }];
    expect(clockNowOf(h, later)).toBe(100);
    /* clock.at's message deleted: R is 0, W keeps now */
    expect(phoneNow(h, later.filter((x) => x.id !== "r2"))).toBe(100);
    expect(phoneGapOf(h, m)).toBe(1);
    expect(phoneGapOf(emptyHandset("light"), m)).toBeNull();
  });
  it("one shared timeline: user message, DM, refresh, next message, reply", () => {
    const m = [{ ...msg("u1", "user"), wt: 0 }];
    let h = seeded();
    const t = phoneNow(h, m);
    expect(t).toBe(0);
    h = phoneAct(h, m, "dm", (x, o) => addMessage(x, "char:a", "hi", o.anchor, { at: o.at }));
    expect(h.threads["char:a"][0].at).toBe(t + 1);
    expect(phoneNow(h, m)).toBe(t + 1);
    h = advanceClock(h, 60, looseAnchorOf(m.at(-1)), m);
    expect(phoneNow(h, m)).toBe(t + 61);
    expect(messageStamp({ handset: h, messages: m }, "user")).toBe(t + 61);
    const m2 = [...m, { ...msg("u2", "user"), wt: t + 61 }];
    expect(messageStamp({ handset: h, messages: m2 }, "assistant")).toBe(t + 66);
  });
});

describe("Sync to chat", () => {
  /* the phone set up after g; then 4 user + reply pairs, stamped */
  const chatWith = (handset, n = 4) => {
    const messages = [{ ...msg("g"), wt: 0 }];
    let now = 0;
    for (let i = 1; i <= n; i++) { messages.push({ ...msg(`u${i}`, "user"), wt: now }); now += 5; messages.push({ ...msg(`r${i}`), wt: now }); }
    return { id: "c", messages, handset };
  };
  const synced = () => ({ ...seeded(), clock: { ...seeded().clock, at: looseAnchorOf(msg("g")), sync: looseAnchorOf(msg("g")) } });

  it("syncPendingOf counts story replies after the last sync; 0 when off or not set up", () => {
    expect(syncPendingOf(chatWith(synced()))).toBe(4);
    expect(syncPendingOf(chatWith({ ...synced(), level: "off" }))).toBe(0);
    expect(syncPendingOf(chatWith(emptyHandset("light")))).toBe(0);
    expect(syncPendingOf(undefined)).toBe(0);
  });
  it("E below D gives X 0; a missing elapsed gives 0; the cap is a week", () => {
    expect(syncChat(chatWith(synced()), 5).extra).toBe(0);
    expect(syncChat(chatWith(synced()), null).extra).toBe(0);
    expect(syncChat(chatWith(synced()), 180).extra).toBe(160);
    expect(syncChat(chatWith(synced()), 1e9).extra).toBe(10080 - 20);
  });
  it("after a sync now is nowBefore + X, the stamps moved, the next message stamped at now", () => {
    const c = chatWith(synced());
    const r = syncChat(c, 180);
    expect(r.nowBefore).toBe(20);
    expect(r.now).toBe(180);
    expect(phoneNow(r.chat.handset, r.chat.messages)).toBe(180);
    expect(r.chat.handset.clock).toMatchObject({ min: 180, last: 180, at: looseAnchorOf(c.messages.at(-1)), sync: looseAnchorOf(c.messages.at(-1)) });
    expect(r.chat.messages.at(-1).wt).toBeLessThanOrEqual(180);
    expect(messageStamp(r.chat, "user")).toBe(180);
    expect(syncPendingOf(r.chat)).toBe(0);
    expect(r.window).toBe(180);
  });
  it("shiftTimeline keeps the order; a DM after reply 2 of 4 moves by X/2; ROOT items stay", () => {
    let h = synced();
    const c0 = chatWith(h);
    h = { ...h, threads: {
      "char:a": [{ id: "l1", from: "you", text: "hi", tick: 1, anchor: looseAnchorOf(c0.messages[4]), at: 11 }],
    }, dmWait: { "char:a": { line: "l1", sent: 11, due: 40, seen: 20 } },
    posts: [{ id: "p0", by: "npc:x", text: "seed", kind: "post", stats: {}, tick: 0, anchor: ROOT_ANCHOR, at: -30 }] };
    const c = { ...c0, handset: h };
    const out = shiftTimeline(c, looseAnchorOf(c.messages[0]), 160);
    expect(out.handset.threads["char:a"][0].at).toBe(11 + 80);
    expect(out.handset.dmWait["char:a"]).toEqual({ line: "l1", sent: 91, due: 120, seen: 100 });
    expect(out.handset.posts[0].at).toBe(-30);
    const wts = out.messages.map((x) => x.wt);
    for (let i = 1; i < wts.length; i++) expect(wts[i]).toBeGreaterThanOrEqual(wts[i - 1]);
    expect(out.messages.at(-1).wt).toBe(20 + 160);
    /* nothing to move */
    expect(shiftTimeline(c, ROOT_ANCHOR, 0)).toBe(c);
  });
  it("a phone action that folded the drift into min: D is still 5 x the replies since the sync", () => {
    let c = chatWith(synced());
    c = { ...c, handset: phoneAct(c.handset, c.messages, "dm", (x, o) => addMessage(x, "char:a", "hi", o.anchor, { at: o.at })) };
    expect(c.handset.clock.min).toBe(21);
    const r = syncChat(c, 120);
    expect(r.nowBefore).toBe(21);
    expect(r.extra).toBe(100);
    expect(r.now).toBe(121);
  });
});
