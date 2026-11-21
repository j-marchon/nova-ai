// @vitest-environment jsdom
/* The phone's flow through the chat (round 4): the setup is by hand (a
   card on the phone, nothing on mount or open), a phone that is off is
   turned on from the chat's phone button, every chat message shows its
   in-world age by the name while the phone is on, and phone time past the
   last message shows as "<span> later" under the transcript. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearActivity } from "../src/lib/activity.js";
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


/* any model request (a phone batch would make one) */
const requests = () => fetch.mock.calls.length;
const notSetUp = (d = seed()) => { d.chats[0].handset.tick = { ...d.chats[0].handset.tick, seeded: false }; return d; };
/* a set-up phone whose clock stands at 120 in-world minutes after m2 */
const clocked = (d = seed()) => {
  d.chats[0].handset.clock = { min: 120, at: at("m2"), step: "1h", last: 120 };
  d.chats[0].messages[1].wt = 110;
  d.chats[0].messages[2].wt = 115;
  return d;
};

describe("setup by hand", () => {
  it("nothing runs on mount or on opening a phone that is on but not set up; the setup card waits", async () => {
    await mount(notSetUp());
    expect(phoneCalls()).toHaveLength(0);
    await openPhone();
    expect(q('[data-testid="phone-setup"]')).toBeTruthy();
    await openApp("Murmur");
    expect(q('[data-testid="phone-setup"]')).toBeTruthy();
    expect(byLabel("Refresh")).toBeNull();
    expect(phoneCalls()).toHaveLength(0);
    expect(requests()).toBe(0);
  });

  it("turning the phone on from Off shows the card and starts nothing", async () => {
    const d = notSetUp(); d.chats[0].handset.level = "off";
    await mount(d);
    await click(byLabel("Phone off. Turn on"));
    expect(q('[data-testid="phone"]')).toBeNull();
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Turn phone on")));
    expect(chat().handset.level).toBe("light");
    expect(q('[data-testid="phone-setup"]')).toBeTruthy();
    expect(requests()).toBe(0);
  });

  it("Set up phone starts the setup (a model request) only on the tap", async () => {
    await mount(notSetUp());
    await openPhone();
    expect(requests()).toBe(0);
    await click(q('[data-testid="phone-setup-start"]'));
    expect(requests()).toBeGreaterThan(0);
  });
});

describe("no updates card", () => {
  it("the chat shows no \"Phone: N updates\" card, on or off", async () => {
    await mount(clocked());
    expect(q('[data-testid="phone-updates"]')).toBeNull();
  });
});

describe("in-world time on chat messages", () => {
  const stamp = (id) => q(`#msg-${id} [data-wt]`);

  it("shows how long ago each stamped message was, by the name", async () => {
    await mount(clocked());
    expect(stamp("m1").textContent).toBe("10m ago");
    expect(stamp("m2").textContent).toBe("5m ago");
    /* no stamp, nothing */
    expect(stamp("m0")).toBeNull();
  });

  it("shows nothing while the phone is off", async () => {
    const d = clocked(); d.chats[0].handset.level = "off";
    await mount(d);
    expect(q("[data-wt]")).toBeNull();
  });

  it("a message sent with the phone set up is stamped with the phone's now", async () => {
    await mount(clocked());
    const box = document.querySelector("textarea");
    await type(box, "On my way");
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await flush();
    const sent = chat().messages.find((m) => m.content === "On my way");
    expect(sent, "sent message").toBeTruthy();
    expect(sent.wt).toBe(120);
  });

  it("phone time past the last message shows as a caption under the transcript, from 15 minutes on", async () => {
    const d = clocked();
    d.chats[0].handset.clock = { ...d.chats[0].handset.clock, min: 175 };
    await mount(d);
    expect(q('[data-testid="phone-time-gap"]').textContent).toBe("1 hour later");
  });

  it("no caption while the phone's now is close to the last message", async () => {
    await mount(clocked());
    expect(q('[data-testid="phone-time-gap"]')).toBeNull();
  });

  it("before the phone is set up, nothing is stamped or shown", async () => {
    const d = notSetUp(clocked());
    await mount(d);
    expect(q("[data-wt]")).toBeNull();
  });
});
