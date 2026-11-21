// @vitest-environment jsdom
/* The phone's screens on their own (C2): home, Messages, Gallery, Bank, the
   profile page and the avatars, each rendered with a ctx shaped like
   Phone.jsx's. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { anchorOf, ROOT_ANCHOR } from "../src/lib/anchor.js";
import { YOU, normalizeHandset, phoneAccounts, unread, visiblePhone } from "../src/lib/phone.js";
import { PhoneHome } from "../src/components/phone/PhoneHome.jsx";
import { PhoneSettings } from "../src/components/phone/PhoneSettings.jsx";
import { NotificationsPage } from "../src/components/phone/Notifications.jsx";
import { Messages } from "../src/components/phone/apps/Messages.jsx";
import { Gallery, galleryOf } from "../src/components/phone/apps/Gallery.jsx";
import { ProfilePage } from "../src/components/phone/AccountSheet.jsx";
import { Bank, money } from "../src/components/phone/apps/Bank.jsx";
import { PHONE_STEPS } from "../src/components/phone/Phone.jsx";
import { PhoneAvatar, StepMenu, avatarHue } from "../src/components/phone/parts.jsx";
import { PostCard } from "../src/components/phone/PostCard.jsx";
import { ageLabel, isVerified, phoneWrites, shownStats } from "../src/components/phone/social.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;

const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const byLabel = (label) => q(`[aria-label="${label}"]`);
const button = (text) => qa("button").find((b) => b.textContent.trim() === text || b.textContent.trim().startsWith(text) || b.getAttribute("aria-label") === text);
const click = async (el) => { expect(el, "element to click").toBeTruthy(); await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};

const at = (id) => ({ id, swipe: 0 });
const IMG = "data:image/png;base64,AAAA";
const POSTIMG = "data:image/png;base64,PPPP";
const OLDIMG = "data:image/png;base64,OOOO";
const STORYIMG = "data:image/png;base64,SSSS";
const messages = [
  { id: "m0", role: "assistant", content: "Hello." },
  { id: "m1", role: "user", content: "Look.", images: [{ id: "i1", url: IMG }] },
  { id: "m2", role: "assistant", content: "Nice." },
];
const character = { id: "c1", name: "Mira", description: "A thief." };

function baseHandset() {
  return {
    v: 2, level: "light",
    tick: { n: 5, lastMsgId: "m2", pending: false, seeded: true },
    me: { fame: 2, followers: 1200, traits: { fame: 2, job: "singer" }, traitsFrom: { fame: "inferred", job: "stated" } },
    people: {
      "char:c1": { key: "char:c1", handle: "mira", name: "Mira", traits: { fame: 1, looks: "tall, scarred", hobby: "locks" }, traitsFrom: { fame: "inferred", looks: "stated", hobby: "manual" } },
      "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea", verified: true, role: "outlet", bio: "News first.", followers: 48200 },
      "npc:fan": { key: "npc:fan", handle: "fan1", name: "A fan" },
      "npc:zed": { key: "npc:zed", handle: "zed", name: "Zed" },
    },
    posts: [
      { id: "p3", by: "npc:bea", text: "new", image: POSTIMG, tick: 4, anchor: at("m2") },
      { id: "p2", by: "npc:bea", text: "described only", photo: "A harbour", tick: 4, anchor: at("m2") },
      { id: "p1", by: "char:c1", text: "seed", image: OLDIMG, tick: 1, anchor: ROOT_ANCHOR },
    ],
    stories: [{ id: "s1", by: "npc:bea", text: "", photo: "x", image: STORYIMG, tick: 3, anchor: at("m0") }],
    threads: {
      "char:c1": [{ id: "d1", from: "char:c1", text: "Where are you?", tick: 2, anchor: at("m2") }],
      "npc:bea": [
        { id: "d2", from: "npc:bea", text: "Comment?", tick: 1, anchor: at("m0") },
        { id: "d3", from: YOU, text: "No.", tick: 4, anchor: at("m2") },
      ],
      "npc:fan": [{ id: "d4", from: "npc:fan", text: "I love you!", tick: 5, anchor: at("m2") }],
    },
    seen: { feed: 3, stories: [], messages: { "npc:bea": 4 } },
  };
}

/* A small Phone: the same ctx fields Phone.jsx builds, over local state. */
function Harness({ initial, render, spies }) {
  const [handset, setHandset] = useState(() => normalizeHandset(initial));
  Harness.set = setHandset;
  const chat = { id: "k1", messages, handset };
  Harness.h = handset;
  const h = handset;
  const v = visiblePhone(h, messages);
  const ctx = {
    h, v,
    accounts: phoneAccounts({ chat, character, userName: "Ana" }),
    avatarOf: () => null,
    busy: !!spies.busy,
    tick: { now: spies.now, later: spies.later },
    onPreview: spies.preview,
    onSettings: spies.settings,
    unread: unread(h, messages),
    settings: spies.appSettings || {},
    chatId: "k1",
    messages,
    act: (fn) => { spies.act(fn); setHandset((x) => fn(x, { ...chat, handset: x })); },
    anchorIn: (c) => anchorOf(c?.messages?.at(-1)),
    open: spies.open, replace: spies.replace, back: spies.back,
    postById: (id) => v.posts.find((p) => p.id === id) || null,
    statsOf: (post) => shownStats(post, messages, v.posts),
    ageLabel: (item) => ageLabel(item, messages),
    write: { like: vi.fn(), repost: vi.fn(), reply: vi.fn(), dm: phoneWrites({ act: (fn) => { spies.act(fn); setHandset((x) => fn(x, { ...chat, handset: x })); }, tick: { later: spies.later } }).dm },
    waiting: false,
    emptyText: "Nothing new yet.",
  };
  return render(ctx);
}
let spies;
const mount = async (render, initial = baseHandset()) => {
  await act(async () => root.render(<Harness initial={initial} render={render} spies={spies} />));
  await flush();
};

beforeEach(() => {
  spies = { act: vi.fn(), now: vi.fn(), later: vi.fn(), preview: vi.fn(), settings: vi.fn(), open: vi.fn(), replace: vi.fn(), back: vi.fn() };
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("home", () => {
  it("shows four apps (Bank added) on coloured tiles, with unread counts on Murmur and Messages", async () => {
    await mount((ctx) => <PhoneHome ctx={ctx} />);
    const tiles = qa('[aria-label="Apps"] button');
    expect(tiles.map((b) => b.textContent.replace(/\d+\+?/g, "").trim())).toEqual(["Murmur", "Messages", "Gallery", "Bank"]);
    expect(tiles[3].getAttribute("aria-label")).toBe("Bank");
    /* a different colour pair per app, white glyph */
    const looks = qa("[data-tile]").map((t) => t.style.backgroundImage);
    expect(new Set(looks).size).toBe(4);
    expect(looks.every((g) => g.startsWith("linear-gradient"))).toBe(true);
    /* Murmur counts only mentions (none here), not new posts; messages: Mira's line and the fan's */
    expect(tiles[0].getAttribute("aria-label")).toBe("Murmur");
    expect(tiles[1].getAttribute("aria-label")).toBe("Messages, 2 new");
    expect(tiles[2].getAttribute("aria-label")).toBe("Gallery");
    expect(tiles[0].querySelector("[data-unread-dot]")).toBeNull();
    expect(tiles[1].querySelector("[data-unread-dot]")).toBeTruthy();
    expect(tiles[2].querySelector("[data-unread-dot]")).toBeNull();
    await click(tiles[1]);
    expect(spies.open).toHaveBeenCalledWith({ app: "messages" });
    await click(tiles[3]);
    expect(spies.open).toHaveBeenCalledWith({ app: "bank" });
  });

  it("Settings at the bottom opens the settings page; the home screen has no level control", async () => {
    await mount((ctx) => <PhoneHome ctx={ctx} />);
    expect(qa('[role="radio"]')).toHaveLength(0);
    expect(button("Default for new chats")).toBeUndefined();
    await click(q('[data-testid="phone-settings"]'));
    expect(spies.open).toHaveBeenCalledWith({ app: "settings" });
  });

  it("settings page: level and default for new chats write through ctx; fame override writes me", async () => {
    await mount((ctx) => <PhoneSettings ctx={ctx} />);
    await click(button("Default for new chats"));
    expect(spies.settings).toHaveBeenCalledWith({ phoneDefault: "light" });
    await click(qa('[role="radio"]').find((b) => b.textContent === "Lively"));
    expect(Harness.h.level).toBe("lively");
    await click(byLabel("Star"));
    expect(Harness.h.me.fame).toBe(3);
    expect(Harness.h.me.traitsFrom.fame).toBe("manual");
    await click(qa('[role="radio"]').find((b) => b.textContent === "Off"));
    expect(Harness.h.level).toBe("off");
    expect(button("Default for new chats")).toBeUndefined();
  });

  it("settings page: Off turns the phone off through ctx.turnOff (it closes first); no automatic refresh", async () => {
    const turnOff = vi.fn();
    await mount((ctx) => <PhoneSettings ctx={{ ...ctx, turnOff }} />);
    expect(button("Refresh automatically")).toBeUndefined();
    await click(qa('[role="radio"]').find((b) => b.textContent === "Off"));
    expect(turnOff).toHaveBeenCalledTimes(1);
    expect(Harness.h.level).toBe("light");
  });

  it("the Refresh step menu lists Sync to chat first", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<StepMenu steps={PHONE_STEPS} value="sync" onChange={onChange} />));
    expect(q("[data-step]").textContent).toContain("Sync");
    await click(q("[data-step]"));
    const options = qa("[data-step-option]");
    expect(options.map((b) => b.dataset.stepOption)).toEqual(["sync", "15m", "1h", "3h", "day"]);
    expect(options[0].textContent).toContain("Sync to chat");
  });

  it("How much money you have writes traits.wealth as manual, and leaves the balance", async () => {
    const hs = baseHandset();
    hs.bank = { balance: 700, tx: [{ id: "t1", kind: "sent", amount: 1, note: "", t: 1, tick: 1, to: "char:c1", toName: "Mira" }] };
    await mount((ctx) => <PhoneSettings ctx={ctx} />, hs);
    const group = q('[data-testid="phone-wealth"]');
    expect([...group.querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual(["Modest", "Comfortable", "Wealthy", "Very rich"]);
    await click([...group.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Wealthy"));
    expect(Harness.h.me.traits.wealth).toBe(2);
    expect(Harness.h.me.traitsFrom.wealth).toBe("manual");
    expect(Harness.h.bank.balance).toBe(700);
  });

  it("turning the phone on from Off starts nothing by itself", async () => {
    spies.setup = vi.fn();
    await mount((ctx) => <PhoneSettings ctx={{ ...ctx, messages, tick: { ...ctx.tick, setup: spies.setup } }} />, { ...baseHandset(), level: "off" });
    await click(qa('[role="radio"]').find((b) => b.textContent === "Light"));
    expect(Harness.h.level).toBe("light");
    expect(spies.setup).not.toHaveBeenCalled();
    expect(spies.now).not.toHaveBeenCalled();
  });

  it("on but not set up: the home screen offers Set up phone, which runs the setup once", async () => {
    let done;
    spies.setup = vi.fn(() => new Promise((r) => { done = r; }));
    spies.appSettings = { providers: [{ id: "loc", preset: "custom", base: "http://localhost:5001/v1", local: true, model: "m" }], activeProvider: "loc" };
    const notSet = { ...baseHandset(), tick: { ...baseHandset().tick, seeded: false } };
    await mount((ctx) => <PhoneHome ctx={{ ...ctx, needsSetup: true, settings: { ...ctx.settings }, tick: { ...ctx.tick, setup: spies.setup } }} />, notSet);
    const start = q('[data-testid="phone-setup-start"]');
    expect(start).toBeTruthy();
    expect(start.disabled).toBe(false);
    await click(start);
    expect(spies.setup).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="phone-setup"]').textContent).toContain("Setting up");
    await click(q('[data-testid="phone-setup-start"]'));
    expect(spies.setup).toHaveBeenCalledTimes(1);
    await act(async () => done("merged"));
  });

  it("without a model the setup card says to choose one first", async () => {
    const notSet = { ...baseHandset(), tick: { ...baseHandset().tick, seeded: false } };
    await mount((ctx) => <PhoneHome ctx={{ ...ctx, needsSetup: true, tick: { ...ctx.tick, setup: vi.fn() } }} />, notSet);
    expect(q('[data-testid="phone-setup-start"]').disabled).toBe(true);
    expect(q('[data-testid="phone-setup-start"]').textContent).toBe("Choose a model first");
  });

  it("has no You row (the name in the phone's top row opens the profile) and no off banner", async () => {
    await mount((ctx) => <PhoneHome ctx={ctx} />);
    expect(q('[data-testid="phone-you"]')).toBeNull();
    expect(q('[data-testid="phone-off"]')).toBeNull();
    expect(byLabel("Apps").style.opacity).toBe("");
    await click(byLabel("Apps").querySelector("button"));
    expect(spies.open).toHaveBeenCalledWith({ app: "murmur" });
  });
});

describe("Messages", () => {
  it("inbox: most recent first, unread dots, requests collapsed", async () => {
    await mount((ctx) => <Messages ctx={ctx} />);
    const rows = qa('[aria-label="Conversations"] [data-thread]').map((b) => b.dataset.thread);
    /* bea's last line (tick 4) is newer than Mira's (tick 2); the fan never got a reply: a request */
    expect(rows).toEqual(["npc:bea", "char:c1"]);
    expect(q('[data-thread="char:c1"] [data-unread-dot]')).toBeTruthy();
    expect(q('[data-thread="npc:bea"] [data-unread-dot]')).toBeNull();
    const toggle = button("Requests (1)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-thread="npc:fan"]')).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(q('[aria-label="Message requests"] [data-thread="npc:fan"]')).toBeTruthy();
  });

  it("the picker lists story characters first", async () => {
    await mount((ctx) => <Messages ctx={ctx} pick />);
    const keys = qa("[data-person]").map((b) => b.dataset.person);
    expect(keys[0]).toBe("char:c1");
    expect(keys.slice(1).sort()).toEqual(["npc:bea", "npc:fan", "npc:zed"]);
    expect(q('[aria-label="People in the story"] [data-person="char:c1"]')).toBeTruthy();
    await click(q('[data-person="npc:zed"]'));
    expect(spies.replace).toHaveBeenCalledWith({ app: "messages", thread: "npc:zed", focus: true });
  });

  /* the persona's line to `key` answered at once (handset.dmWait) */
  const answerNow = async (key) => act(async () => Harness.set((x) => ({ ...x, dmWait: { ...x.dmWait, [key]: { ...x.dmWait[key], due: x.dmWait[key].sent, seen: x.dmWait[key].sent } } })));

  it("a thread marks seen; sending adds a line at the phone's now, sets pending and asks for a DM tick", async () => {
    await mount((ctx) => <Messages ctx={ctx} thread="char:c1" />);
    expect(Harness.h.seen.messages["char:c1"]).toBe(5);
    const input = byLabel("Message");
    await type(input, "On my way");
    await click(byLabel("Send"));
    const lines = Harness.h.threads["char:c1"];
    /* two story replies on the clock: 10 minutes in, and a DM takes a minute */
    expect(lines.at(-1)).toMatchObject({ from: YOU, text: "On my way", anchor: { id: "m2", any: true }, at: 11 });
    expect(Harness.h.dmWait["char:c1"]).toMatchObject({ line: lines.at(-1).id, sent: 11 });
    expect(Harness.h.tick.pending).toBe(true);
    expect(spies.later).toHaveBeenCalledTimes(1);
    expect(spies.later).toHaveBeenCalledWith({ dm: true });
    /* nothing runs: no typing, only the status */
    expect(q('[data-testid="phone-typing"]')).toBeNull();
    expect(q('[data-testid="phone-unanswered"]').textContent).toMatch(/^(Delivered|Seen)$/);
  });

  it("a reply added to the handset while the thread is open shows at once, without remounting, and scrolls the page to it", async () => {
    await mount((ctx) => <div data-route="messages" data-testid="page"><Messages ctx={ctx} thread="char:c1" /></div>);
    const page = q('[data-testid="page"]');
    Object.defineProperty(page, "scrollHeight", { configurable: true, value: 900 });
    const old = q('[data-line="d1"]');
    page.scrollTop = 0;
    await act(async () => Harness.set((x) => ({
      ...x,
      tick: { ...x.tick, n: 6 },
      threads: { ...x.threads, "char:c1": [...x.threads["char:c1"], { id: "d9", from: "char:c1", text: "On my way.", tick: 6, anchor: at("m2") }] },
    })));
    await flush();
    expect(q('[data-line="d9"]').textContent).toBe("On my way.");
    expect(q('[data-line="d1"]')).toBe(old);
    expect(qa("[data-line]").map((e) => e.dataset.line)).toEqual(["d1", "d9"]);
    expect(page.scrollTop).toBe(900);
  });

  it("the log stands at the bottom by the input, with typing and the status as its last rows", async () => {
    spies.busy = true;
    await mount((ctx) => <Messages ctx={ctx} thread="char:c1" />);
    const log = q('[data-testid="phone-thread-log"]');
    expect(log.className).toContain("justify-end");
    await type(byLabel("Message"), "On my way");
    await click(byLabel("Send"));
    await answerNow("char:c1");
    const input = byLabel("Message");
    const typing = q('[data-testid="phone-typing"]');
    expect(log.contains(typing)).toBe(true);
    expect([...log.children].at(-1).contains(typing)).toBe(true);
    expect(typing.querySelector(".nv-wait")).toBeTruthy();
    /* the input is the same element, after the log */
    expect(log.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a thread opened to write focuses its input as it mounts", async () => {
    await mount((ctx) => <Messages ctx={ctx} thread="char:c1" focus />);
    expect(document.activeElement).toBe(byLabel("Message"));
  });

  it("Send goes through the persona's DM write: the line is stamped and the phone's clock moves on", async () => {
    await mount((ctx) => <Messages ctx={ctx} thread="char:c1" />);
    await type(byLabel("Message"), "Hi");
    expect(byLabel("Send").disabled).toBe(false);
    expect(q('[data-testid="send-hint"]')).toBeNull();
    await click(byLabel("Send"));
    const line = Harness.h.threads["char:c1"].at(-1);
    expect(line).toMatchObject({ from: YOU, text: "Hi" });
    expect(Number.isFinite(line.at)).toBe(true);
    expect(Harness.h.clock.min).toBe(line.at);
    expect(spies.later).toHaveBeenCalledWith({ dm: true });
  });

  it("the send box shows n/500 past 80% and turns Send off when over", async () => {
    await mount((ctx) => <Messages ctx={ctx} thread="char:c1" />);
    const input = byLabel("Message");
    await type(input, "a".repeat(400));
    expect(q('[data-testid="char-count"]')).toBeNull();
    await type(input, "a".repeat(401));
    expect(q('[data-testid="char-count"]').textContent).toBe("401/500");
    expect(byLabel("Send").disabled).toBe(false);
    await type(input, "a".repeat(501));
    expect(q('[data-testid="char-count"]').textContent).toBe("501/500");
    expect(byLabel("Send").disabled).toBe(true);
    await click(byLabel("Send"));
    expect(spies.later).not.toHaveBeenCalled();
  });

  it("an old line they left unanswered shows Delivered, with no typing, even while the job runs", async () => {
    spies.busy = true;
    await mount((ctx) => <Messages ctx={ctx} thread="npc:bea" />);
    expect(q('[data-testid="phone-typing"]')).toBeNull();
    expect(q('[data-testid="phone-unanswered"]').textContent).toBe("Delivered");
    expect(q('[data-line="d3"]').textContent).toContain("No.");
    expect(document.body.textContent).not.toContain("Not answered yet");
  });

  it("a line they read shows when: Seen, Seen 2h ago", async () => {
    const h = baseHandset();
    /* the phone's now is 10 (two story replies) */
    await mount((ctx) => <Messages ctx={ctx} thread="npc:bea" />, { ...h, dmWait: { "npc:bea": { line: "d3", sent: -200, due: null, seen: -110 } } });
    expect(q('[data-testid="phone-unanswered"]').textContent).toBe("Seen 2h ago");
    await act(async () => Harness.set((x) => ({ ...x, dmWait: { "npc:bea": { ...x.dmWait["npc:bea"], seen: 10 } } })));
    expect(q('[data-testid="phone-unanswered"]').textContent).toBe("Seen");
    await act(async () => Harness.set((x) => ({ ...x, dmWait: { "npc:bea": { ...x.dmWait["npc:bea"], seen: 11 } } })));
    expect(q('[data-testid="phone-unanswered"]').textContent).toBe("Delivered");
  });

  it("a fresh line types only while the job runs and their answer is due", async () => {
    spies.busy = true;
    await mount((ctx) => <Messages ctx={ctx} thread="npc:bea" />);
    await type(byLabel("Message"), "Still there?");
    await click(byLabel("Send"));
    await act(async () => Harness.set((x) => ({ ...x, dmWait: { ...x.dmWait, "npc:bea": { ...x.dmWait["npc:bea"], due: 500, seen: null } } })));
    expect(q('[data-testid="phone-typing"]')).toBeNull();
    expect(q('[data-testid="phone-unanswered"]').textContent).toBe("Delivered");
    await answerNow("npc:bea");
    expect(q('[data-testid="phone-typing"]')).toBeTruthy();
    expect(q('[data-testid="phone-unanswered"]')).toBeNull();
  });
});

describe("persona verified", () => {
  const mine = { id: "mine", by: YOU, kind: "post", text: "Hello from me", stats: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, ago: 0, tick: 2, anchor: at("m2") };
  const card = (verified) => (ctx) => {
    const h = verified === undefined ? ctx.h : { ...ctx.h, me: { ...ctx.h.me, verified } };
    return <PostCard ctx={{ ...ctx, h, ageLabel: () => "now", postById: () => null, statsOf: () => mine.stats, write: {} }} post={mine} />;
  };

  it("isVerified reads h.me.verified for the persona, false by default", () => {
    expect(isVerified({ me: {} , people: {} }, YOU)).toBe(false);
    expect(isVerified({ me: { verified: true }, people: {} }, YOU)).toBe(true);
    expect(isVerified({ me: { verified: "yes" }, people: {} }, YOU)).toBe(false);
    expect(isVerified({ me: {}, people: { "npc:x": { verified: true } } }, "npc:x")).toBe(true);
  });

  it("the persona's post shows the check only when h.me.verified is true", async () => {
    await mount(card(undefined));
    expect(q("[data-verified]")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    await mount(card(true));
    expect(q("[data-verified]")).toBeTruthy();
  });
});

describe("Gallery", () => {
  it("lists chat, post and story pictures newest first, skips described photos", async () => {
    await mount((ctx) => <Gallery ctx={ctx} messages={messages} />);
    const srcs = qa('[aria-label="Pictures"] img').map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([POSTIMG, IMG, STORYIMG, OLDIMG]);
    await click(qa('[aria-label="View picture"]')[1]);
    expect(spies.preview).toHaveBeenCalledWith(IMG);
  });
  it("hides pictures whose message is gone", () => {
    const out = galleryOf(messages, [{ id: "x", image: POSTIMG, tick: 1, anchor: at("gone") }], []);
    expect(out).toEqual([expect.objectContaining({ url: IMG })]);
  });
});

describe("profile page", () => {
  const page = (key) => (ctx) => <ProfilePage ctx={ctx} accountKey={key} />;
  const openStats = async () => {
    const t = button("Profile stats (debug)");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-testid="account-traits"]')).toBeNull();
    await click(t);
  };
  const withReplies = () => {
    const hs = baseHandset();
    hs.posts = [
      { id: "r1", by: "npc:bea", kind: "reply", ref: "p1", text: "Nice one", tick: 5, anchor: at("m2") },
      { id: "rp", by: "npc:bea", kind: "repost", ref: "p1", text: "", tick: 5, anchor: at("m2") },
      ...hs.posts,
    ];
    return hs;
  };

  it("another account: header fields and Message on the stack", async () => {
    await mount(page("npc:bea"));
    const s = q('[data-testid="profile-page"]');
    expect(s.dataset.account).toBe("npc:bea");
    expect(s.textContent).toContain("Bea");
    expect(s.textContent).toContain("@bea");
    expect(s.textContent).toContain("outlet");
    expect(s.textContent).toContain("News first.");
    expect(s.textContent).toContain("48K followers");
    expect(byLabel("Verified")).toBeTruthy();
    await click(byLabel("Message Bea"));
    expect(spies.open).toHaveBeenCalledWith({ app: "messages", thread: "npc:bea", focus: true });
  });

  it("has Posts, Replies and Activity tabs; Replies lists the account's replies with what they answer", async () => {
    await mount(page("npc:bea"), withReplies());
    expect(qa('[role="tab"]').map((t) => t.textContent)).toEqual(["Posts", "Replies", "Activity"]);
    expect(qa('[data-testid="profile-posts"] [data-post]').map((e) => e.dataset.post)).toEqual(["p3", "p2"]);
    await click(q('[data-tab="replies"]'));
    expect(q('[data-tab="replies"]').getAttribute("aria-selected")).toBe("true");
    const rows = qa('[data-testid="profile-replies"] [role="listitem"][data-post]');
    expect(rows.map((e) => e.dataset.post)).toEqual(["r1"]);
    expect(rows[0].querySelector('[data-replied-to="p1"]').textContent).toContain("seed");
    await click(q('[data-tab="activity"]'));
    expect(qa('[data-testid="profile-activity"] [role="listitem"][data-post]').map((e) => e.dataset.post)).toEqual(["r1", "rp", "p3", "p2"]);
  });

  it("a story character: its traits and sources in the collapsed debug panel, wealth included", async () => {
    await mount(page("char:c1"));
    await openStats();
    const rows = qa("[data-trait]").map((r) => [r.dataset.trait, r.querySelector("[data-source]").dataset.source]);
    expect(rows).toEqual([["fame", "inferred"], ["wealth", "unknown"], ["looks", "stated"], ["hobby", "manual"]]);
    expect(q('[data-testid="account-traits"]').textContent).toContain("tall, scarred");
  });

  it("the persona: no Message, the persona's traits", async () => {
    await mount(page(YOU));
    expect(button("Message")).toBeUndefined();
    expect(q('[data-testid="profile-page"]').textContent).toContain("@ana");
    await openStats();
    expect(qa("[data-trait]").map((r) => r.dataset.trait)).toEqual(["fame", "wealth", "job"]);
    expect(q('[data-trait="job"]').textContent).toContain("singer");
    expect(q('[data-trait="job"] [data-source]').textContent).toBe("stated");
  });

  it("shows no traits yet when none were made", async () => {
    await mount(page("npc:zed"));
    await openStats();
    expect(q('[data-testid="account-traits"]').textContent.toLowerCase()).toContain("no traits yet");
    expect(qa("[data-trait]")).toHaveLength(0);
  });
});

describe("PhoneAvatar", () => {
  it("gives a colour from the name, the same for the same name, the initial in white", async () => {
    await mount(() => (
      <div>
        <span data-a="1"><PhoneAvatar name="Bea" /></span>
        <span data-a="2"><PhoneAvatar name="Bea" /></span>
        <span data-a="3"><PhoneAvatar name="Mira" /></span>
      </div>
    ));
    const [a, b, c] = ["1", "2", "3"].map((n) => q(`[data-a="${n}"] [data-avatar-hue]`));
    expect(a.dataset.avatarHue).toBe(String(avatarHue("Bea")));
    expect(a.dataset.avatarHue).toBe(b.dataset.avatarHue);
    expect(a.style.backgroundColor).toBe(b.style.backgroundColor);
    expect(a.style.backgroundColor).toBeTruthy();
    expect(c.dataset.avatarHue).not.toBe(a.dataset.avatarHue);
    expect(a.textContent).toBe("B");
    expect(a.style.color).toMatch(/^(#fff|rgb\(255, 255, 255\))$/);
  });
});

describe("Bank", () => {
  const withBank = (balance = 12500) => {
    const hs = baseHandset();
    hs.bank = {
      balance,
      tx: [
        { id: "t2", kind: "received", amount: 1200, note: "wage", t: Date.now() - 3 * 3600e3, tick: 4, from: "npc:bea", fromName: "Bea" },
        { id: "t1", kind: "sent", amount: 300, note: "for the cab", t: Date.now() - 60e3, tick: 3, to: "char:c1", toName: "Mira" },
      ],
    };
    return hs;
  };

  it("shows the balance with separators and the transactions, sent and received apart", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{}} />, withBank());
    expect(q('[data-testid="bank-balance"]').textContent).toBe("$12,500");
    const rows = qa("[data-tx]");
    expect(rows.map((r) => [r.dataset.tx, r.dataset.kind])).toEqual([["t2", "received"], ["t1", "sent"]]);
    expect(rows[0].textContent).toContain("Bea");
    expect(rows[0].textContent).toContain("+$1,200");
    expect(rows[0].textContent).toContain("3h");
    expect(rows[1].textContent).toContain("Mira");
    expect(rows[1].textContent).toContain("for the cab");
    expect(rows[1].querySelector("[data-amount]").style.color).not.toBe(rows[0].querySelector("[data-amount]").style.color);
    expect(document.body.textContent).not.toMatch(/wealth/i);
    await click(button("Send money"));
    expect(spies.open).toHaveBeenCalledWith({ app: "bank", pick: true });
  });

  it("the contact picker searches the persona's accounts, the most recent contact first", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{ pick: true }} />, withBank());
    /* the fan wrote last (tick 5), then Bea and Mira (tick 4) */
    expect(qa("[data-contact]").map((b) => b.dataset.contact).slice(0, 3)).toEqual(["npc:fan", "npc:bea", "char:c1"]);
    await type(byLabel("Search contacts"), "mir");
    expect(qa("[data-contact]").map((b) => b.dataset.contact)).toEqual(["char:c1"]);
    await click(q('[data-contact="char:c1"]'));
    expect(spies.replace).toHaveBeenCalledWith({ app: "bank", to: "char:c1" });
  });

  it("Send is off and an error row shows when the amount is over the balance", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{ to: "char:c1" }} />, withBank(500));
    await type(byLabel("Amount"), "800");
    expect(button("Send").disabled).toBe(true);
    expect(q('[data-testid="bank-error"]').textContent).toContain("more than your balance");
    await type(byLabel("Amount"), "200");
    expect(button("Send").disabled).toBe(false);
    expect(q('[data-testid="bank-error"]')).toBeNull();
    expect(q('[data-testid="bank-remaining"]').textContent).toContain("$300");
    expect(byLabel("Amount").value).toBe("$200");
  });

  it("a valid transfer goes through act with transfer, asks for a respond, and confirms", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{ to: "char:c1" }} />, withBank(12500));
    await type(byLabel("Amount"), "2000");
    await type(byLabel("Note"), "x".repeat(100));
    expect(byLabel("Note").value).toHaveLength(80);
    await type(byLabel("Note"), "rent");
    expect(q('[data-testid="bank-remaining"]').textContent).toContain("$10,500");
    await click(button("Send"));
    expect(spies.act).toHaveBeenCalledTimes(1);
    expect(Harness.h.bank.balance).toBe(10500);
    expect(Harness.h.bank.tx[0]).toMatchObject({ kind: "sent", to: "char:c1", toName: "Mira", amount: 2000, note: "rent" });
    expect(spies.later).toHaveBeenCalledWith({ action: { kind: "transfer", to: "char:c1", amount: 2000, note: "rent" } });
    expect(q('[data-testid="bank-sent"]').textContent).toContain("Sent $2,000");
    await click(button("Done"));
    expect(spies.back).toHaveBeenCalled();
  });
});

describe("notification centre", () => {
  const busy = (fame = 0) => {
    const hs = baseHandset();
    hs.me = { ...hs.me, fame, traits: { ...hs.me.traits, fame } };
    const z = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
    hs.posts = [
      { id: "rq", by: "npc:bea", kind: "quote", ref: "mine", text: "lol", tick: 5, anchor: at("m2") },
      { id: "rr", by: "char:c1", kind: "reply", ref: "mine", text: "Me too", tick: 5, anchor: at("m2") },
      { id: "mine", by: YOU, text: "Out tonight", tick: 4, anchor: at("m2"), stats: { ...z, likes: 7, reposts: 2 }, pot: { ...z, likes: 7, reposts: 2 } },
      ...hs.posts,
    ];
    hs.bank = { balance: 100, tx: [{ id: "t9", kind: "received", amount: 1500, note: "", t: Date.now(), tick: 6, from: "", fromName: "The studio" }] };
    return hs;
  };
  const kinds = (sel = "[data-notification]") => qa(sel).map((r) => r.dataset.notification);

  it("shows the engine's five newest on home, each opening its place; See all lists every one", async () => {
    await mount((ctx) => <PhoneHome ctx={ctx} />, busy());
    const rows = qa('[aria-label="Recent notifications"] [data-notification]');
    expect(rows).toHaveLength(5);
    expect(rows[0].dataset.notification).toBe("money");
    expect(rows[0].textContent).toContain("The studio sent you $1,500");
    expect(kinds('[aria-label="Recent notifications"] [data-notification]')).toEqual(expect.arrayContaining(["quote", "comment", "request"]));
    expect(kinds()).not.toContain("posts");
    await click(rows.find((r) => r.dataset.notification === "comment"));
    expect(spies.open).toHaveBeenCalledWith({ app: "murmur", post: "mine", focus: true });
    /* reading a mention marks it seen */
    expect(Harness.h.seen.mentions).toBeGreaterThanOrEqual(5);
    await click(rows.find((r) => r.dataset.notification === "request"));
    expect(spies.open).toHaveBeenCalledWith({ app: "messages", thread: "npc:fan", focus: true });
    await click(button("See all"));
    expect(spies.open).toHaveBeenCalledWith({ app: "notifications" });
  });

  it("the full page lists messages, money and mentions, never likes or reposts; Mark all read marks every kind seen", async () => {
    await mount((ctx) => <NotificationsPage ctx={ctx} />, busy());
    expect(kinds()).toEqual(expect.arrayContaining(["dm", "money", "comment", "quote"]));
    expect(kinds().some((k) => ["like", "repost", "likes", "reposts", "posts", "story-like", "reply"].includes(k))).toBe(false);
    expect(document.body.textContent).not.toContain("likes on your post");
    expect(q('[data-unread="1"]')).toBeTruthy();
    await click(button("Mark all read"));
    expect(Harness.h.seen.bank).toBeGreaterThanOrEqual(6);
    expect(Harness.h.seen.mentions).toBe(Harness.h.tick.n);
    expect(Harness.h.seen.messages["npc:fan"]).toBe(Harness.h.tick.n);
    expect(qa('[data-unread="1"]')).toHaveLength(0);
    expect(button("Mark all read")).toBeUndefined();
  });

  it("a famous persona still gets messages, money and mentions", async () => {
    await mount((ctx) => <NotificationsPage ctx={ctx} />, busy(2));
    expect(kinds()).toEqual(expect.arrayContaining(["dm", "request", "money", "comment", "quote"]));
  });
});

describe("Bank statement", () => {
  const statement = () => {
    const hs = baseHandset();
    hs.bank = {
      balance: 900,
      tx: [
        { id: "w1", kind: "received", amount: 2400, note: "", t: Date.now(), tick: 5, from: "", fromName: "Harbour Studio", world: true, category: "wage" },
        { id: "s1", kind: "sent", amount: 50, note: "cab", t: Date.now(), tick: 6, to: "char:c1", toName: "Mira" },
        { id: "b1", kind: "sent", amount: 120, note: "", t: Date.now(), tick: 3, to: "", toName: "Power company", world: true, category: "bill" },
      ],
    };
    return hs;
  };

  it("filters All, Money in, Money out; shows category and the world payer's name", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{}} />, statement());
    expect(qa("[data-tx]").map((r) => r.dataset.tx)).toEqual(["w1", "s1", "b1"]);
    expect(q('[data-tx="w1"]').textContent).toContain("Harbour Studio");
    expect(q('[data-tx="w1"] [data-category="wage"]')).toBeTruthy();
    expect(q('[data-tx="b1"] [data-category="bill"]')).toBeTruthy();
    await click(q('[data-filter="in"]'));
    expect(qa("[data-tx]").map((r) => r.dataset.tx)).toEqual(["w1"]);
    await click(q('[data-filter="out"]'));
    expect(qa("[data-tx]").map((r) => r.dataset.tx)).toEqual(["s1", "b1"]);
  });

  it("a story character's row opens their profile and says they are reacting to a fresh transfer", async () => {
    await mount((ctx) => <Bank ctx={ctx} route={{}} />, statement());
    /* tick.n is 5: the transfer at tick 6 is still to be answered */
    expect(q('[data-tx="s1"] [data-testid="tx-reacting"]').textContent).toContain("Mira is reacting");
    expect(q('[data-tx="b1"] button')).toBeNull();
    await click(q('[data-tx="s1"] button'));
    expect(spies.open).toHaveBeenCalledWith({ app: "profile", account: "char:c1" });
  });
});

describe("currency", () => {
  it("one formatter: USD by default, EUR when the settings say so; the switch writes settings.bankCurrency", async () => {
    expect(money(1200)).toBe("$1,200");
    expect(money(1200, "EUR").replace(/\s/g, " ")).toBe("1.200 €");
    const hs = baseHandset();
    hs.bank = { balance: 12500, tx: [{ id: "t1", kind: "received", amount: 300, note: "", t: Date.now(), tick: 4, from: "npc:bea", fromName: "Bea" }] };
    spies.appSettings = { bankCurrency: "EUR" };
    await mount((ctx) => <Bank ctx={ctx} route={{}} />, hs);
    expect(q('[data-testid="bank-balance"]').textContent.replace(/\s/g, " ")).toBe("12.500 €");
    expect(q('[data-tx="t1"]').textContent.replace(/\s/g, " ")).toContain("+300 €");
    expect(q('[data-currency="EUR"]').getAttribute("aria-checked")).toBe("true");
    await click(q('[data-currency="USD"]'));
    expect(spies.settings).toHaveBeenCalledWith({ bankCurrency: "USD" });
  });
});
