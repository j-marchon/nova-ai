// @vitest-environment jsdom
/* The persona's phone in the chat (components/phone): the composer button,
   the home screen's level and default, Murmur through the chat (local
   writes, never a request), and back/Escape through the phone's stack. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearActivity } from "../src/lib/activity.js";
import { settleMotion } from "../src/components/motion/runtime.js";
import { startChatSide } from "../src/pages/chat/replyJob.js";

vi.mock("../src/pages/chat/replyJob.js", async (original) => ({ ...await original(), startChatSide: vi.fn(() => Promise.resolve()) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const q = (sel) => document.querySelector(sel);
const byLabel = (label) => q(`[aria-label="${label}"]`);
const buttons = () => [...document.querySelectorAll("button")];
const button = (text) => buttons().find((b) => b.textContent.trim() === text || b.textContent.trim().startsWith(text) || b.getAttribute("aria-label") === text);
const click = async (el) => { expect(el, "element to click").toBeTruthy(); await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const escape = async () => { await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); await flush(); };
const phoneCalls = () => startChatSide.mock.calls.filter(([a]) => a.kind === "phone");

const at = (id) => ({ id, swipe: 0 });
const post = (id, by, text, tick, anchor, extra = {}) => ({
  id, by, text, kind: "post", stats: { likes: 3, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 3, reposts: 0, replies: 0, quotes: 0 },
  ago: 0, tick, anchor: at(anchor), ...extra,
});
function seed() {
  const d = structuredClone(emptyData);
  d.username = "Ana";
  d.settings.providers[0].key = "sk-test";
  d.settings.providers[0].model = "test-model";
  d.characters = [{ id: "c1", name: "Mira", description: "A thief.", greetings: [], avatar: "" }];
  d.chats = [{
    id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1,
    messages: [
      { id: "m0", role: "assistant", content: "Hello, Ana." },
      { id: "m1", role: "user", content: "Look at this." },
      { id: "m2", role: "assistant", content: "Nice." },
    ],
    handset: {
      v: 2,
      level: "light",
      tick: { n: 2, lastMsgId: "m2", pending: false, seeded: true },
      me: { fame: 0, followers: 0 },
      people: { "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea" } },
      posts: [
        post("p2", "npc:bea", "Newest post", 2, "m2"),
        post("g1", "npc:bea", "morning", 2, "m2", { photo: "A harbour at dawn" }),
        post("p3", "npc:bea", "Ghost post", 1, "gone"),
        post("p1", "char:c1", "Older post", 1, "m0"),
      ],
      stories: [],
      threads: { "char:c1": [{ id: "d1", from: "char:c1", text: "Where are you?", tick: 2, anchor: at("m2") }] },
      seen: { feed: 0, stories: [], messages: {} },
    },
  }];
  return d;
}

function Harness({ initial }) {
  const [data, setData] = useState(initial);
  Harness.data = data;
  Harness.setData = setData;
  const update = (p) => setData((prev) => (typeof p === "function" ? p(prev) : { ...prev, ...p }));
  return <ChatPage data={data} chatId="k1" update={update} goBack={() => {}} goSettings={() => {}} />;
}
const chat = () => Harness.data.chats[0];
const mount = async (data = seed()) => { await act(async () => root.render(<Harness initial={data} />)); await flush(); };
const openPhone = async () => { await click(byLabel("Open phone")); expect(q('[data-testid="phone"]')).toBeTruthy(); };
const openApp = async (name) => { await click(buttons().find((b) => (b.getAttribute("aria-label") || "").startsWith(name) && b.closest('[aria-label="Apps"]'))); };

beforeEach(() => {
  clearActivity();
  startChatSide.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => { root.unmount(); clearActivity(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("phone button", () => {
  it("sits in the composer toolbar with the author's note and model buttons, with a count of what is new", async () => {
    await mount();
    const row = q(".nv-composer-actions");
    expect(row.querySelector('[aria-label="Open phone"]')).toBeTruthy();
    expect(row.querySelector('[aria-label^="Author\'s note"]')).toBeTruthy();
    expect(row.querySelector('[aria-label="Model"]')).toBeTruthy();
    /* new feed posts light nothing: the one unread DM */
    expect(row.querySelector('[data-testid="phone-badge"]').textContent).toBe("1");
    expect(q('[data-testid="phone-off-mark"]')).toBeNull();
  });
  it("is marked off while the phone is off, and a tap offers to turn it on instead of opening it", async () => {
    const d = seed(); d.chats[0].handset.level = "off";
    await mount(d);
    expect(byLabel("Open phone")).toBeNull();
    expect(q('[data-testid="phone-off-mark"]')).toBeTruthy();
    expect(q('[data-testid="phone-badge"]')).toBeNull();
    await click(byLabel("Phone off. Turn on"));
    expect(q('[data-testid="phone"]')).toBeNull();
    expect(document.body.textContent).toContain("The phone is off for this chat. Everything on it is kept.");
    await click(button("Turn phone on"));
    expect(chat().handset.level).toBe("light");
    expect(q('[data-testid="phone"]')).toBeTruthy();
    expect(q('[data-testid="phone-off-mark"]')).toBeNull();
  });
  it("turns on at the new-chat default when that is a level", async () => {
    const d = seed(); d.chats[0].handset.level = "off"; d.settings.phoneDefault = "lively";
    await mount(d);
    await click(byLabel("Phone off. Turn on"));
    await click(button("Turn phone on"));
    expect(chat().handset.level).toBe("lively");
    expect(q('[data-testid="phone"]')).toBeTruthy();
  });
});

describe("the phone", () => {
  it("shows Murmur, Messages, Gallery and Bank (no Glimpse); the level control and the new-chat default write through the chat and settings", async () => {
    await mount();
    await openPhone();
    for (const name of ["Murmur", "Messages", "Gallery", "Bank"]) expect(buttons().some((b) => (b.getAttribute("aria-label") || "").startsWith(name))).toBe(true);
    expect(buttons().some((b) => (b.getAttribute("aria-label") || "").startsWith("Glimpse"))).toBe(false);
    /* Murmur's badge counts what is aimed at the persona, not new posts */
    expect(byLabel("Murmur")).toBeTruthy();
    /* no app bar on home: no back, no title, a close X */
    expect(byLabel("Back")).toBeNull();
    expect(byLabel("Close phone")).toBeTruthy();
    expect(buttons().some((b) => b.getAttribute("role") === "radio")).toBe(false);
    await click(q('[data-testid="phone-settings"]'));
    expect(byLabel("Back")).toBeTruthy();
    await click(buttons().find((b) => b.getAttribute("role") === "radio" && b.textContent === "Lively"));
    expect(chat().handset.level).toBe("lively");
    await click(button("Default for new chats"));
    expect(Harness.data.settings.phoneDefault).toBe("lively");
    await click(button("Default for new chats"));
    expect(Harness.data.settings.phoneDefault).toBe("off");
    expect(document.body.textContent).not.toContain("Refresh automatically");
    await click(buttons().find((b) => b.getAttribute("role") === "radio" && b.textContent === "Off"));
    act(() => settleMotion());
    await flush();
    expect(q('[data-testid="phone"]')).toBeNull();
    expect(chat().handset.level).toBe("off");
    expect(q('[data-testid="phone-off-mark"]')).toBeTruthy();
  });

  it("Refresh and its step sit on the home screen's top row, not in Murmur", async () => {
    await mount();
    await openPhone();
    expect(q('[data-testid="phone-refresh"]')).toBeTruthy();
    expect(q("[data-step-menu]")).toBeTruthy();
    await openApp("Murmur");
    expect(q('[data-testid="phone-refresh"]')).toBeNull();
    expect(q("[data-step-menu]")).toBeNull();
  });

  it("the name in the top row opens the persona's profile; home has no You row", async () => {
    await mount();
    await openPhone();
    const you = q('[data-testid="phone-you"]');
    expect(you.getAttribute("aria-label")).toBe("Your profile");
    expect(byLabel("Apps").parentElement.textContent).not.toContain("followers");
    await click(you);
    expect(q('[data-route="profile"]')).toBeTruthy();
    expect(byLabel("Back")).toBeTruthy();
  });

  it("with the Sync step, Refresh shows how many story replies wait; another step shows none", async () => {
    const d = seed();
    d.chats[0].handset.clock = { min: 0, at: { id: "m0", swipe: 0 }, sync: { id: "m0", swipe: 0 }, step: "sync", last: 0 };
    await mount(d);
    await openPhone();
    const badge = q('[data-testid="phone-sync-count"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("1");
    expect(q('[data-testid="phone-refresh"]').getAttribute("aria-label")).toBe("Sync to chat, 1 new in the chat");
    await act(async () => Harness.setData((x) => ({ ...x, chats: [{ ...x.chats[0], handset: { ...x.chats[0].handset, clock: { ...x.chats[0].handset.clock, step: "1h" } } }] })));
    await flush();
    expect(q('[data-testid="phone-sync-count"]')).toBeNull();
    expect(q('[data-testid="phone-refresh"]').getAttribute("aria-label")).toBe("Refresh, 1 hour later");
  });

  it("Settings shows the phone's usage, without a cost while nothing is priced", async () => {
    const d = seed();
    d.chats[0].handset.usage = { calls: 3, tokensIn: 48200, tokensOut: 9100, cost: 0, est: 1, byMode: {} };
    await mount(d);
    await openPhone();
    await click(q('[data-testid="phone-settings"]'));
    const box = q('[data-testid="phone-usage"]');
    expect(box.textContent).toContain("Usage (estimated)");
    const total = q('[data-testid="phone-usage-total"]').textContent;
    expect(total).toContain("3 requests · 48.2k in · 9.1k out");
    expect(total).toContain("(some estimated)");
    expect(total).not.toContain("$");
    /* one row per kind of request, from the real prompts; no price known, no cost */
    const rows = [...document.querySelectorAll("[data-estimate]")];
    expect(rows.map((r) => r.dataset.estimate)).toEqual(["setup", "sync", "refresh", "more", "respond", "replies"]);
    expect(rows[0].textContent).toMatch(/^Set up~[\d.]+k? in · ≤[\d.]+k? out$/);
    expect(box.textContent).not.toContain("$");
    expect(box.textContent).toContain("Estimates. Actual use depends on the model.");
  });

  it("Settings shows the cost once the provider reported one", async () => {
    const d = seed();
    d.chats[0].handset.usage = { calls: 2, tokensIn: 2000, tokensOut: 500, cost: 0.03, est: 0, byMode: {} };
    await mount(d);
    await openPhone();
    await click(q('[data-testid="phone-settings"]'));
    const total = q('[data-testid="phone-usage-total"]').textContent;
    expect(total).toContain("$0.03");
    expect(total).not.toContain("estimated)");
  });

  it("Murmur: visible posts in feed order, a deleted anchor hides one, posting and liking are local", async () => {
    await mount();
    await openPhone();
    await openApp("Murmur");
    const feed = byLabel("Murmur feed").textContent;
    expect(feed.indexOf("Newest post")).toBeLessThan(feed.indexOf("Older post"));
    expect(feed).not.toContain("Ghost post");
    /* opening it marks it seen */
    expect(chat().handset.seen.feed).toBe(2);

    await type(byLabel("What's happening?"), "Out by the docks.");
    await click(button("Post"));
    const mine = chat().handset.posts.find((p) => p.by === "you");
    expect(mine).toMatchObject({ kind: "post", text: "Out by the docks.", anchor: { id: "m2" } });
    expect(chat().handset.tick.pending).toBe(true);

    await click(q('[data-post="p2"] [data-action="like"]'));
    expect(chat().handset.posts.find((p) => p.id === "p2").liked).toBe(true);
    await click(q('[data-post="p2"] [data-action="like"]'));
    expect(chat().handset.posts.find((p) => p.id === "p2").liked).toBeUndefined();
    /* nothing asked a model */
    expect(phoneCalls()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Escape goes from a post to the feed, to home, then closes", async () => {
    await mount();
    await openPhone();
    await openApp("Murmur");
    await click(q('[data-post="p1"] [data-action="reply"]'));
    expect(byLabel("Replies")).toBeTruthy();
    await escape();
    expect(byLabel("Replies")).toBeNull();
    expect(byLabel("Murmur feed")).toBeTruthy();
    await escape();
    expect(byLabel("Apps")).toBeTruthy();
    await escape();
    expect(q('[data-testid="phone"]')).toBeNull();
  });

  it("does not seed from the phone: opening an empty phone asks nothing", async () => {
    const d = seed();
    d.chats[0].handset = { v: 2, level: "light", tick: { n: 0, lastMsgId: null, pending: false, seeded: false }, people: {}, posts: [], stories: [], threads: {}, seen: { feed: 0, stories: [], messages: {} } };
    await mount(d);
    await openPhone();
    await openApp("Murmur");
    expect(phoneCalls()).toHaveLength(0);
    /* on but not set up: the app is the setup card, which waits for a tap */
    expect(document.querySelector('[data-testid="phone-setup"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="phone-setup-start"]')).toBeTruthy();
    expect(phoneCalls()).toHaveLength(0);
  });
});
