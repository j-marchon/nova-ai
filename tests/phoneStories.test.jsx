// @vitest-environment jsdom
/* The stories row and viewer (components/phone/apps/Stories.jsx): the row
   keeps its order however much is seen (only the rings change), and the
   viewer walks across profiles in that order, Instagram's way. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { Phone } from "../src/components/phone/Phone.jsx";
import { storyGroups } from "../src/components/phone/apps/Stories.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearActivity } from "../src/lib/activity.js";
import { handsetOf, markSeen, normalizeHandset, visiblePhone } from "../src/lib/phone.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, tick;

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const byLabel = (label) => q(`[aria-label="${label}"]`);
const buttons = () => [...document.querySelectorAll("button")];
const click = async (el) => { expect(el, "element to click").toBeTruthy(); await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); };

const at = (id) => ({ id, swipe: 0 });
const MESSAGES = [
  { id: "m0", role: "assistant", content: "Hello, Ana." },
  { id: "m1", role: "user", content: "Hi." },
  { id: "m2", role: "assistant", content: "Nice." },
];
const story = (id, by, text, tick) => ({ id, by, text, tick, anchor: at("m0") });
/* newest first: Bea's newest story is the newest of all, so Bea comes first */
function handset({ mine = true } = {}) {
  return {
    v: 2,
    level: "light",
    tick: { n: 5, lastMsgId: "m2", pending: false, seeded: true },
    me: { fame: 0, followers: 10 },
    people: {
      "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea" },
      "npc:zed": { key: "npc:zed", handle: "zed", name: "Zed" },
    },
    posts: [],
    stories: [
      story("a2", "npc:bea", "Bea two", 4),
      story("b1", "npc:zed", "Zed one", 3),
      story("a1", "npc:bea", "Bea one", 2),
      ...(mine ? [story("y1", "you", "Mine", 1)] : []),
    ],
    threads: {},
    seen: { feed: 0, stories: [], messages: {} },
  };
}
function data() {
  const d = structuredClone(emptyData);
  d.username = "Ana";
  d.characters = [{ id: "c1", name: "Mira", description: "A thief.", greetings: [], avatar: "" }];
  return d;
}
function Harness({ initial, d }) {
  const [chat, setChat] = useState(initial);
  Harness.chat = chat;
  return (
    <Phone
      chat={chat} data={d} persona={null} userName="Ana" character={d.characters[0]} ensemble={[]} universe={null}
      onHandset={(fn) => setChat((c) => ({ ...c, handset: fn(handsetOf(c), c) }))}
      onSettings={() => {}} tick={tick} onPreview={() => {}} onClose={() => {}}
    />
  );
}
const h = () => Harness.chat.handset;
const mount = async (hs = handset()) => {
  await act(async () => root.render(<Harness initial={{ id: "k1", kind: "character", characterId: "c1", messages: MESSAGES, handset: hs }} d={data()} />));
  await flush();
};
const openMurmur = async () => { await click(buttons().find((b) => (b.getAttribute("aria-label") || "").startsWith("Murmur") && b.closest('[aria-label="Apps"]'))); };
const row = () => qa('[aria-label="Stories"] [data-story]').map((e) => e.dataset.story);
const ring = (key) => q(`[aria-label="Stories"] [data-story="${key}"]`).dataset.ring;
const shown = () => q("[data-story-id]")?.dataset.storyId || null;

beforeEach(() => {
  clearActivity();
  tick = { now: vi.fn(), later: vi.fn(), more: vi.fn(() => Promise.resolve()), refresh: vi.fn() };
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => { root.unmount(); clearActivity(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("storyGroups", () => {
  it("orders owners by their newest story, the same before and after seeing them", () => {
    const hs = normalizeHandset(handset());
    const before = storyGroups(visiblePhone(hs, MESSAGES));
    expect(before.mine.by).toBe("you");
    expect(before.others.map((g) => g.by)).toEqual(["npc:bea", "npc:zed"]);
    expect(before.others[0].list.map((s) => s.id)).toEqual(["a1", "a2"]);
    const seen = markSeen(markSeen(hs, { story: "a1" }), { story: "a2" });
    const after = storyGroups(visiblePhone(seen, MESSAGES));
    expect(after.others.map((g) => g.by)).toEqual(["npc:bea", "npc:zed"]);
    expect(after.others.map((g) => g.unseen)).toEqual([false, true]);
  });
});

describe("the row", () => {
  it("keeps its order after viewing; only the ring turns grey", async () => {
    await mount();
    await openMurmur();
    expect(row()).toEqual(["you", "npc:bea", "npc:zed"]);
    expect(ring("npc:bea")).toBe("new");
    await click(q('[data-story="npc:bea"] button'));
    await click(byLabel("Next story"));
    await click(byLabel("Close story"));
    expect(h().seen.stories).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(row()).toEqual(["you", "npc:bea", "npc:zed"]);
    expect(ring("npc:bea")).toBe("seen");
    expect(ring("npc:zed")).toBe("new");
  });
});

describe("the viewer", () => {
  it("goes A1, A2, then B1, and closes after the last owner's last story", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-story="npc:bea"] button'));
    expect(shown()).toBe("a1");
    await click(byLabel("Next story"));
    expect(shown()).toBe("a2");
    await click(byLabel("Next story"));
    expect(shown()).toBe("b1");
    expect(byLabel("Zed's story")).toBeTruthy();
    await click(byLabel("Next story"));
    expect(q('[data-testid="story-viewer"]')).toBeNull();
    expect(q('[data-route="murmur"]')).toBeTruthy();
  });

  it("goes back from B1 to A's last story, and stops at the very first", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-story="npc:zed"] button'));
    expect(shown()).toBe("b1");
    await click(byLabel("Previous story"));
    expect(shown()).toBe("a2");
    await click(byLabel("Previous story"));
    expect(shown()).toBe("a1");
    /* opened on someone else: never into "Your story" */
    await click(byLabel("Previous story"));
    expect(shown()).toBe("a1");
    expect(byLabel("Bea's story")).toBeTruthy();
  });

  it("opened on the persona's own story, walks on into the others", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-story="you"] button'));
    expect(shown()).toBe("y1");
    await click(byLabel("Next story"));
    expect(shown()).toBe("a1");
  });

  it("starts the next owner at their first unseen story", async () => {
    const hs = handset();
    hs.stories = [story("b2", "npc:zed", "Zed two", 5), ...hs.stories];
    hs.seen.stories = ["b1"];
    await mount(hs);
    await openMurmur();
    expect(row()).toEqual(["you", "npc:zed", "npc:bea"]);
    await click(q('[data-story="npc:zed"] button'));
    expect(shown()).toBe("b2");
    await click(byLabel("Next story"));
    expect(shown()).toBe("a1");
  });
});
