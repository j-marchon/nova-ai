// @vitest-environment jsdom
/* Murmur, the phone's one social app (components/phone): the feed with
   counts from phoneStats, every persona action as a local write, quotes,
   replies, the composer and its photos (Develop the only generator), Load
   more and Retry through the tick, stories, and the Activity tab. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { Phone } from "../src/components/phone/Phone.jsx";
import { emptyData } from "../src/lib/data.js";
import { activity, clearActivity } from "../src/lib/activity.js";
import { compactCount, handsetOf } from "../src/lib/phone.js";
import { ageOf, statsOf } from "../src/lib/phoneStats.js";
import { gsap, motionMode, setMotionPreference, settleMotion } from "../src/components/motion/runtime.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, tick;

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const byLabel = (label) => q(`[aria-label="${label}"]`);
const buttons = () => [...document.querySelectorAll("button")];
const button = (text) => buttons().find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
const click = async (el) => { expect(el, "element to click").toBeTruthy(); await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const escape = async () => { await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); await flush(); };
const count = (postId, action) => q(`[data-post="${postId}"] [data-action="${action}"] [data-count]`).textContent;

const at = (id) => ({ id, swipe: 0 });
const z = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
const item = (id, by, text, extra = {}) => ({ id, by, text, kind: "post", stats: { ...z }, pot: { ...z }, ago: 0, tick: 2, anchor: at("m2"), ...extra });
const MESSAGES = [
  { id: "m0", role: "assistant", content: "Hello, Ana." },
  { id: "m1", role: "user", content: "Look at this." },
  { id: "m2", role: "assistant", content: "Nice." },
];
/* p1 rises toward its ceiling: anchored at m0, one story reply after it */
const P1 = item("p1", "char:c1", "Big news", { stats: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 1000, reposts: 200, replies: 60, quotes: 20 }, anchor: at("m0"), tick: 1 });
function handset() {
  return {
    v: 2,
    level: "light",
    tick: { n: 2, lastMsgId: "m2", pending: false, seeded: true },
    me: { fame: 0, followers: 10 },
    people: {
      "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea" },
      "npc:news": { key: "npc:news", handle: "dailynews", name: "Daily News With A Very Long Name Indeed", verified: true, fame: 3 },
    },
    posts: [
      item("r2", "npc:bea", "Second reply", { kind: "reply", ref: "p1" }),
      item("q1", "npc:bea", "Look at this", { kind: "quote", ref: "p1" }),
      item("big", "npc:news", "Breaking", { stats: { likes: 12345, reposts: 23456, replies: 34567, quotes: 1 }, pot: { likes: 12345, reposts: 23456, replies: 34567, quotes: 1 } }),
      item("p2", "npc:bea", "Ten likes", { stats: { likes: 10, reposts: 2, replies: 0, quotes: 0 }, pot: { likes: 10, reposts: 2, replies: 0, quotes: 0 } }),
      item("ph", "npc:bea", "Morning", { photo: "A harbour at dawn" }),
      item("r1", "char:c1", "First reply", { kind: "reply", ref: "p1", tick: 1 }),
      P1,
    ],
    stories: [],
    threads: {},
    seen: { feed: 0, stories: [], messages: {} },
  };
}
function data({ imageGen = { provider: "ai_horde" } } = {}) {
  const d = structuredClone(emptyData);
  d.username = "Ana";
  d.characters = [{ id: "c1", name: "Mira", description: "A thief.", greetings: [], avatar: "" }];
  if (imageGen) d.settings.imageGen = { ...d.settings.imageGen, ...imageGen };
  else delete d.settings.imageGen;
  return d;
}

function Harness({ initial, d }) {
  const [chat, setChat] = useState(initial);
  Harness.chat = chat;
  Harness.setChat = setChat;
  return (
    <Phone
      chat={chat} data={d} persona={null} userName="Ana" character={d.characters[0]} ensemble={[]} universe={null}
      onHandset={(fn) => setChat((c) => ({ ...c, handset: fn(handsetOf(c), c) }))}
      onSettings={() => {}} tick={tick} onPreview={() => {}} onClose={() => { Harness.closed = true; }}
    />
  );
}
const h = () => Harness.chat.handset;
const mount = async ({ hs = handset(), messages = MESSAGES, d = data(), chat = {} } = {}) => {
  Harness.closed = false;
  await act(async () => root.render(<Harness initial={{ id: "k1", kind: "character", characterId: "c1", messages, handset: hs, ...chat }} d={d} />));
  await flush();
};
const refreshBtn = () => q('[data-testid="phone-refresh"]');
/* Refresh is on the home screen: back to home, tap it, and open Murmur again */
const refreshFromHome = async () => {
  while (byLabel("Back")) await click(byLabel("Back"));
  await click(refreshBtn());
  await openMurmur();
};
const openMurmur = async () => { await click(buttons().find((b) => (b.getAttribute("aria-label") || "").startsWith("Murmur") && b.closest('[aria-label="Apps"]'))); };

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

describe("feed", () => {
  it("renders the posts in feed order (no replies) with counts from statsOf, five-digit counts compact", async () => {
    await mount();
    await openMurmur();
    const ids = qa('[aria-label="Murmur feed"] [data-post]').map((e) => e.dataset.post);
    expect(ids).toEqual(["q1", "big", "p2", "ph", "p1"]);
    const shown = statsOf(P1, ageOf(P1, 1));
    expect(shown.likes).toBeGreaterThan(0);
    expect(shown.likes).toBeLessThan(1000);
    expect(count("p1", "like")).toBe(compactCount(shown.likes));
    expect(count("p1", "repost")).toBe(compactCount(shown.reposts));
    expect(count("big", "like")).toBe(compactCount(12345));
    /* the reply count follows the post's stats, not only the stored replies */
    expect(count("big", "reply")).toBe(compactCount(34567));
    expect(count("big", "repost")).toBe(compactCount(23456));
    /* verified check, age, and the feed marked seen */
    expect(q('[data-post="big"] [data-verified]')).toBeTruthy();
    expect(q('[data-post="p1"] [data-age]').textContent).toBe("30m");
    expect(h().seen.feed).toBe(2);
  });

  it("a like toggles and changes the shown count at once, as a local write", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p2"] [data-action="like"]'));
    expect(count("p2", "like")).toBe("11");
    expect(q('[data-post="p2"] [data-action="like"]').getAttribute("aria-pressed")).toBe("true");
    expect(h().posts.find((p) => p.id === "p2").liked).toBe(true);
    expect(h().tick.pending).toBe(true);
    expect(tick.later).toHaveBeenCalled();
    await click(q('[data-post="p2"] [data-action="like"]'));
    expect(count("p2", "like")).toBe("10");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Repost opens a menu (Repost or Quote); a second tap undoes the repost", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p2"] [data-action="repost"]'));
    expect(button("Quote")).toBeTruthy();
    await click(button("Repost"));
    expect(h().posts.find((p) => p.id === "p2").reposted).toBe(true);
    expect(count("p2", "repost")).toBe("3");
    await click(q('[data-post="p2"] [data-action="repost"]'));
    expect(button("Quote")).toBeFalsy();
    expect(h().posts.find((p) => p.id === "p2").reposted).toBeUndefined();
    expect(count("p2", "repost")).toBe("2");
  });

  it("shows a quote's embed, and Quote writes a quote post over the quoted one", async () => {
    await mount();
    await openMurmur();
    const embed = q('[data-post="q1"] [data-embed="p1"]');
    expect(embed.textContent).toContain("Big news");
    await click(q('[data-post="p2"] [data-action="repost"]'));
    await click(button("Quote"));
    expect(q('[data-embed="p2"]')).toBeTruthy();
    await type(byLabel("Add a comment"), "So true");
    await click(button("Post"));
    expect(h().posts[0]).toMatchObject({ by: "you", kind: "quote", ref: "p2", text: "So true" });
    expect(h().posts.find((p) => p.id === "p2").stats.quotes).toBe(1);
    expect(byLabel("Murmur feed")).toBeTruthy();
  });

  it("Reply opens the detail: replies flat, newest first, a sticky reply input; back returns to the feed", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    expect(qa('[aria-label="Replies"] [data-post]').map((e) => e.dataset.post)).toEqual(["r2", "r1"]);
    await type(byLabel("Reply"), "Congrats!");
    await click(byLabel("Send reply"));
    expect(h().posts[0]).toMatchObject({ by: "you", kind: "reply", ref: "p1", text: "Congrats!" });
    expect(qa('[aria-label="Replies"] [data-post]').map((e) => e.dataset.post)).toEqual([h().posts[0].id, "r2", "r1"]);
    await click(byLabel("Back"));
    expect(byLabel("Murmur feed")).toBeTruthy();
  });

  it("a name opens the account's profile as a page on the stack; back returns to the feed", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p2"] [data-profile="npc:bea"]'));
    expect(q('[data-testid="profile-page"]').dataset.account).toBe("npc:bea");
    expect(byLabel("Murmur feed")).toBeNull();
    /* an iOS nav bar: the page's name centred over it, one back arrow */
    expect(q("h2").className).toContain("nv-ios-title");
    expect(qa('[aria-label="Back"]')).toHaveLength(1);
    /* her own name on her page does not stack the page again */
    await click(q('[data-testid="profile-page"] [data-profile="npc:bea"]'));
    await click(byLabel("Back"));
    expect(byLabel("Murmur feed")).toBeTruthy();
  });

  it("an avatar on a reply opens that account's profile with the Replies tab", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    await click(q('[data-post="r2"] [aria-label="Bea\'s profile"]'));
    await click(q('[data-tab="replies"]'));
    expect(qa('[data-testid="profile-replies"] [role="listitem"][data-post]').map((e) => e.dataset.post)).toEqual(["r2"]);
    /* one level deep: the profile took the post's place, so back is the feed */
    await click(byLabel("Back"));
    expect(byLabel("Murmur feed")).toBeTruthy();
    await click(byLabel("Back"));
    expect(byLabel("Apps")).toBeTruthy();
    expect(byLabel("Back")).toBeNull();
  });
});

describe("keyboard, skeletons and setup", () => {
  it("a tap on a text field focuses it (the Android keyboard needs focus from the tap)", async () => {
    await mount();
    await openMurmur();
    const box = byLabel("What's happening?");
    expect(document.activeElement).not.toBe(box);
    await click(box);
    expect(document.activeElement).toBe(box);
    await click(q('[data-post="p1"] [data-action="reply"]'));
    /* Reply opens the detail with its box already focused, inside the tap */
    expect(document.activeElement).toBe(byLabel("Reply"));
    await click(byLabel("Reply"));
    expect(document.activeElement).toBe(byLabel("Reply"));
  });

  it("opening a post by its text does not focus the reply box", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p2"] article button.block'));
    expect(byLabel("Reply")).toBeTruthy();
    expect(document.activeElement).not.toBe(byLabel("Reply"));
  });

  it("posts in a chat that has not begun: the post hangs on the chat's start", async () => {
    await mount({ messages: [] });
    await openMurmur();
    const box = byLabel("What's happening?");
    expect(box.disabled).toBe(false);
    await type(box, "Hello");
    expect(button("Post").disabled).toBe(false);
    expect(q('[data-testid="send-hint"]')).toBeNull();
    await click(button("Post"));
    expect(h().posts[0]).toMatchObject({ by: "you", text: "Hello" });
    expect(qa('[aria-label="Murmur feed"] [data-post]').map((e) => e.dataset.post)).toContain(h().posts[0].id);
  });

  it("Refresh disables at once and shows its slots at the top of the feed until the job answers", async () => {
    let done;
    tick.refresh = vi.fn(() => new Promise((r) => { done = r; }));
    await mount();
    await openMurmur();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    await refreshFromHome();
    expect(qa('[data-testid="phone-incoming"] [data-slot="skeleton"]').length).toBe(2);
    await act(async () => done());
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
  });

  it("Refresh disables at once on the home screen", async () => {
    tick.refresh = vi.fn(() => new Promise(() => {}));
    await mount();
    await click(refreshBtn());
    expect(refreshBtn().disabled).toBe(true);
  });

  it("Refresh moves the clock by the chosen step: pick 3h, Refresh asks refresh(\"3h\")", async () => {
    await mount();
    expect(q("[data-step]").dataset.step).toBe("sync");
    expect(q("[data-step]").textContent).toContain("Sync");
    await click(q("[data-step]"));
    expect(qa("[data-step-option]").map((b) => b.dataset.stepOption)).toEqual(["sync", "15m", "1h", "3h", "day"]);
    await click(q('[data-step-option="3h"]'));
    expect(h().clock.step).toBe("3h");
    expect(q("[data-step]").textContent).toContain("3h");
    await click(refreshBtn());
    expect(tick.refresh).toHaveBeenCalledWith("3h");
  });

  it("Load more shows its slots at once, above the button", async () => {
    let done;
    tick.more = vi.fn(() => new Promise((r) => { done = r; }));
    await mount();
    await openMurmur();
    await click(button("Load more"));
    const inc = q('[data-testid="phone-incoming"]');
    expect(inc).toBeTruthy();
    expect(byLabel("Murmur feed").contains(inc)).toBe(true);
    expect(qa('[aria-label="Murmur feed"] [data-motion-key]').at(-1).contains(inc)).toBe(true);
    await act(async () => done());
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
  });

  it("the reply list shows slots while this post's replies load, and streams preview replies into them", async () => {
    tick.loadingReplies = ["p1"];
    tick.preview = { posts: [{ by: "bea", text: "Streaming reply", replyTo: "p1" }] };
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    const inc = q('[data-testid="phone-incoming"]');
    expect(byLabel("Replies").contains(inc)).toBe(true);
    expect(inc.querySelector('[data-slot="card"]').textContent).toContain("Streaming reply");
    expect(inc.querySelector('[data-slot="card"]').textContent).toContain("Replying to");
    expect(inc.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});

describe("reply pager and sorting", () => {
  /* p1 with 8 stored replies, n7 newest; n2 has the most likes, n5 none */
  const many = (level) => {
    const hs = handset();
    hs.level = level;
    const likes = { n2: 50, n6: 20, n5: 0 };
    const replies = Array.from({ length: 8 }, (_, i) => {
      const id = `n${7 - i}`;
      const l = likes[id] ?? 5;
      return item(id, "npc:bea", `Reply ${7 - i}`, { kind: "reply", ref: "p1", tick: 2, stats: { ...z, likes: l }, pot: { ...z, likes: l } });
    });
    hs.posts = [...replies, P1];
    return hs;
  };
  const shown = () => qa('[aria-label="Replies"] [data-post]').map((e) => e.dataset.post);
  const openP1 = async () => { await openMurmur(); await click(q('[data-post="p1"] [data-action="reply"]')); };
  const sort = async (label, value) => {
    await click(qa("[data-filter]").find((b) => b.getAttribute("aria-label").startsWith(label)));
    await click(q(`[data-sort-option="${value}"]`));
  };

  it("shows 5 on Lively, 3 on Light, newest first", async () => {
    await mount({ hs: many("lively") });
    await openP1();
    expect(shown()).toEqual(["n7", "n6", "n5", "n4", "n3"]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ hs: many("light") });
    await openP1();
    expect(shown()).toEqual(["n7", "n6", "n5"]);
  });

  it("Load more replies appends below with no gap: the rows shown keep their place, the skeleton goes under them", async () => {
    let done;
    tick.moreReplies = vi.fn(() => new Promise((r) => { done = r; }));
    await mount({ hs: many("light") });
    await openP1();
    const first = qa('[aria-label="Replies"] [data-post]');
    await click(button("Load more replies"));
    expect(shown()).toEqual(["n7", "n6", "n5", "n4", "n3", "n2"]);
    const after = qa('[aria-label="Replies"] [data-post]');
    first.forEach((el, i) => { expect(after[i]).toBe(el); expect(el.isConnected).toBe(true); });
    await click(button("Load more replies"));
    expect(shown()).toHaveLength(8);
    expect(tick.moreReplies).not.toHaveBeenCalled();
    /* every stored one is shown: ask the job, busy, the skeleton below the rows */
    await click(button("Load more replies"));
    expect(tick.moreReplies).toHaveBeenCalledWith("p1");
    const more = q('[data-testid="more-replies"]');
    expect(more.disabled).toBe(true);
    expect(more.textContent).toBe("Load more replies");
    expect(more.getAttribute("aria-busy")).toBe("true");
    const list = byLabel("Replies");
    const skel = q('[data-testid="phone-incoming"]');
    /* the slots stand after the rows shown, inside the list */
    expect(list.contains(skel)).toBe(true);
    expect(list.lastElementChild).toBe(skel);
    expect(qa('[aria-label="Replies"] [data-post]')[0]).toBe(first[0]);
    /* nothing new came: the button goes */
    await act(async () => done());
    await flush();
    expect(q('[data-testid="more-replies"]')).toBeNull();
    /* the feed's own Load more is unchanged */
    await click(byLabel("Back"));
    expect(button("Load more")).toBeTruthy();
  });

  it("no button without tick.moreReplies once every stored reply shows", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    expect(shown()).toEqual(["r2", "r1"]);
    expect(q('[data-testid="more-replies"]')).toBeNull();
  });

  it("sorts replies Most recent, Most liked, Oldest, Least liked, and keeps the choice for the open phone", async () => {
    await mount({ hs: many("lively") });
    await openP1();
    await sort("Sort replies", "liked");
    expect(shown()).toEqual(["n2", "n6", "n7", "n4", "n3"]);
    await sort("Sort replies", "oldest");
    expect(shown()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    await sort("Sort replies", "least");
    expect(shown()).toEqual(["n5", "n7", "n4", "n3", "n1"]);
    await sort("Sort replies", "recent");
    expect(shown()).toEqual(["n7", "n6", "n5", "n4", "n3"]);
    await sort("Sort replies", "oldest");
    await click(byLabel("Back"));
    await click(q('[data-post="p1"] [data-action="reply"]'));
    expect(qa("[data-filter]").find((b) => b.getAttribute("aria-label").startsWith("Sort replies")).getAttribute("aria-label")).toBe("Sort replies: Oldest");
    expect(shown()[0]).toBe("n0");
  });

  it("sorts the feed the same four ways", async () => {
    await mount();
    await openMurmur();
    const feed = () => qa('[aria-label="Murmur feed"] [data-post]').map((e) => e.dataset.post);
    expect(feed()).toEqual(["q1", "big", "p2", "ph", "p1"]);
    await sort("Sort feed", "oldest");
    expect(feed()).toEqual(["p1", "ph", "p2", "big", "q1"]);
    await sort("Sort feed", "liked");
    expect(feed()[0]).toBe("big");
    await sort("Sort feed", "least");
    expect(feed().slice(0, 2)).toEqual(["q1", "ph"]);
    await sort("Sort feed", "recent");
    expect(feed()).toEqual(["q1", "big", "p2", "ph", "p1"]);
  });
});

describe("incoming posts fill fixed slots", () => {
  const feedIds = () => qa('[aria-label="Murmur feed"] [data-post]').map((e) => e.dataset.post);
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const slots = () => qa('[data-testid="phone-incoming"] [data-slot]');

  it("Refresh's slots stand at the top and leave the loaded rows, their order and nodes alone", async () => {
    await mount();
    await openMurmur();
    const before = feedIds();
    let done;
    tick.refresh = vi.fn(() => new Promise((r) => { done = r; }));
    await refreshFromHome();
    const nodes = qa('[aria-label="Murmur feed"] [data-post]');
    const inc = q('[data-testid="phone-incoming"]');
    expect(after(inc, nodes[0])).toBe(true);
    expect(feedIds()).toEqual(before);
    await act(async () => done());
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    expect(feedIds()).toEqual(before);
    qa('[aria-label="Murmur feed"] [data-post]').forEach((el, i) => expect(el).toBe(nodes[i]));
  });

  it("streamed posts fill the job's slots in order, one whole post each, at full strength; the slot count holds", async () => {
    tick.expect = { mode: "refresh", posts: 3, place: "top" };
    tick.preview = { posts: [] };
    await mount();
    await openMurmur();
    const first = feedIds();
    expect(slots().map((e) => e.dataset.slot)).toEqual(["skeleton", "skeleton", "skeleton"]);
    const texts = ["One", "Two", "Three"];
    for (let n = 1; n <= 3; n++) {
      tick = { ...tick, preview: { posts: texts.slice(0, n).map((text) => ({ by: "bea", text })) } };
      await act(async () => root.render(<Harness initial={Harness.chat} d={data()} />));
      await flush();
      expect(slots()).toHaveLength(n < 3 ? 3 : 4);
      expect(slots().map((e) => e.dataset.slot).slice(0, 3)).toEqual(["card", "card", "card"].map((c, i) => (i < n ? c : "skeleton")));
      expect(slots()[n - 1].textContent).toContain(texts[n - 1]);
      expect(feedIds()).toEqual(first);
    }
    const cards = qa('[data-testid="phone-incoming"] [data-preview]');
    cards.forEach((c) => { expect(c.className).not.toContain("opacity"); expect(c.getAttribute("aria-busy")).toBeNull(); });
    expect(q('[data-testid="preview-writing"]')).toBeNull();
    /* each card keeps a post's action row (inert), so the saved post takes its height */
    expect(cards[0].querySelector("[data-preview-actions]")).toBeTruthy();
    expect(cards[0].querySelector("button")).toBeNull();
  });

  it("when the batch lands the saved posts take the cards' places, marked arrived (no second entrance)", async () => {
    tick.expect = { mode: "refresh", posts: 2, place: "top" };
    tick.preview = { posts: [{ by: "bea", text: "Fresh one" }] };
    await mount();
    await openMurmur();
    tick = { ...tick, expect: null, preview: null };
    await act(async () => {
      Harness.setChat((c) => ({ ...c, handset: { ...c.handset, posts: [item("new1", "npc:bea", "Fresh one", { tick: 3 }), ...c.handset.posts] } }));
      root.render(<Harness initial={Harness.chat} d={data()} />);
    });
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    expect(feedIds()[0]).toBe("new1");
    expect(q('[data-post="new1"]').hasAttribute("data-arrived")).toBe(true);
    expect(q('[data-post="q1"]').hasAttribute("data-arrived")).toBe(false);
  });

  it("the reply list's slots stand above its rows in Most recent", async () => {
    tick.loadingReplies = ["p1"];
    tick.preview = { posts: [{ by: "bea", text: "Streaming reply", replyTo: "p1" }] };
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    const list = byLabel("Replies");
    expect(qa('[aria-label="Replies"] [data-post]').map((e) => e.dataset.post)).toEqual(["r2", "r1"]);
    expect(list.firstElementChild).toBe(q('[data-testid="phone-incoming"]'));
  });
});

describe("loading keeps what is loaded, and moves", () => {
  const feedRows = () => qa('[aria-label="Murmur feed"] [data-post]');
  const dimmed = (el) => { for (let x = el; x && x !== document.body; x = x.parentElement) { const o = x.style?.opacity; if (o !== "" && o !== undefined && Number(o) < 1) return true; if (x.inert || x.style?.pointerEvents === "none") return true; } return false; };

  it("the filter is an icon in the feed's header row that drops down the four orders", async () => {
    await mount();
    await openMurmur();
    const head = q('[data-testid="murmur-header"]');
    const btn = head.querySelector("[data-filter]");
    expect(btn).toBeTruthy();
    expect(head.querySelector('[role="tablist"]')).toBeTruthy();
    expect(btn.className).toContain("w-10 h-10");
    expect(q('[role="menu"]')).toBeNull();
    await click(btn);
    expect(qa('[role="menu"] [role="menuitemradio"]').map((b) => b.textContent)).toEqual(["Most recent", "Most liked", "Oldest", "Least liked"]);
    await click(q('[data-sort-option="liked"]'));
    expect(q('[role="menu"]')).toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Sort feed: Most liked");
    /* only on the feed tab */
    await click(buttons().find((b) => b.getAttribute("role") === "tab" && b.textContent === "Activity"));
    expect(q('[data-testid="murmur-header"] [data-filter]')).toBeNull();
  });

  it("while Refresh and Load more run, the loaded rows keep full opacity and stay usable", async () => {
    let done;
    tick.refresh = vi.fn(() => new Promise((r) => { done = r; }));
    tick.more = vi.fn(() => new Promise(() => {}));
    await mount();
    await openMurmur();
    await refreshFromHome();
    await click(button("Load more"));
    expect(q('[data-testid="phone-incoming"]')).toBeTruthy();
    expect(feedRows().length).toBeGreaterThan(0);
    feedRows().forEach((r) => expect(dimmed(r)).toBe(false));
    await act(async () => done());
  });

  describe("in Full motion", () => {
    let rect;
    beforeEach(() => {
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
      setMotionPreference("full");
      rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 60, top: 0, bottom: 60, left: 0, right: 300 });
    });
    afterEach(() => { Element.prototype.getBoundingClientRect = rect; settleMotion(); gsap.globalTimeline.clear(); });

    it("Load more's slots fade in (no rise) and shimmer (GSAP); the post that lands in them shows at once", async () => {
      expect(motionMode()).toBe("full");
      let done;
      tick.more = vi.fn(() => new Promise((r) => { done = r; }));
      await mount();
      await openMurmur();
      /* hold GSAP's clock so a slow, loaded run cannot finish the fade before it is looked at */
      gsap.globalTimeline.pause();
      let inc;
      try {
        await click(button("Load more"));
        inc = q('[data-testid="phone-incoming"]');
        const shimmer = gsap.globalTimeline.getChildren(false, true, false).filter((t) => t.data === "phone-shimmer");
        expect(shimmer.length).toBe(1);
        const fade = gsap.getTweensOf(inc);
        expect(fade.length).toBeGreaterThan(0);
        expect(gsap.getProperty(inc, "y")).toBe(0);
      } finally { gsap.globalTimeline.resume(); }
      /* the batch lands: one more post at the bottom, where the slots were */
      await act(async () => {
        Harness.setChat((c) => ({ ...c, handset: { ...c.handset, posts: [...c.handset.posts, item("old1", "npc:bea", "From before", { tick: 1, anchor: at("m0") })] } }));
        done();
      });
      await flush();
      await act(async () => settleMotion());
      await flush();
      const wrap = q('[data-post="old1"]').closest("[data-motion-key]");
      expect(q('[data-post="old1"]').hasAttribute("data-arrived")).toBe(true);
      expect(wrap.style.opacity).toBe("");
      expect(q('[data-testid="phone-incoming"]')).toBeNull();
    });

    it("a post that comes with no slots up (the persona's own) enters with a fade and rise", async () => {
      await mount();
      await openMurmur();
      await act(async () => {
        Harness.setChat((c) => ({ ...c, handset: { ...c.handset, posts: [item("mine1", "you", "Mine", { tick: 3 }), ...c.handset.posts] } }));
      });
      await flush();
      const wrap = q('[data-post="mine1"]').closest("[data-motion-key]");
      expect(gsap.getTweensOf(wrap).length).toBeGreaterThan(0);
    });

    it("a re-render while a row fades in never leaves it half-faded", async () => {
      await mount();
      await openMurmur();
      await act(async () => {
        Harness.setChat((c) => ({ ...c, handset: { ...c.handset, posts: [item("mine1", "you", "Mine", { tick: 3 }), ...c.handset.posts] } }));
      });
      const wrap = q('[data-post="mine1"]').closest("[data-motion-key]");
      gsap.getTweensOf(wrap).forEach((t) => t.progress(0.2));
      /* the like re-renders the feed (same rows) mid-entry */
      await click(q('[data-post="p2"] [data-action="like"]'));
      gsap.getTweensOf(wrap).forEach((t) => t.progress(1));
      expect(wrap.style.opacity).toBe("");
    });
  });
});

describe("World", () => {
  const openWorld = async () => { await click(q('[data-testid="phone-world"]')); expect(q('[data-testid="world-page"]')).toBeTruthy(); };

  it("Write an event calls tick.world, shows it at once, and asks for no reply or DM", async () => {
    tick.world = vi.fn(() => Promise.resolve());
    await mount();
    await openWorld();
    expect(button("Post").disabled).toBe(true);
    await type(byLabel("Event"), "A storm hits the harbour.");
    await click(button("Post"));
    expect(tick.world).toHaveBeenCalledWith("A storm hits the harbour.");
    expect(byLabel("Events you wrote").textContent).toContain("A storm hits the harbour.");
    expect(byLabel("Event").value).toBe("");
    expect(tick.later).not.toHaveBeenCalled();
    expect(tick.now).not.toHaveBeenCalled();
    expect(h().threads).toEqual({});
    /* up to 500 */
    await type(byLabel("Event"), "x".repeat(501));
    expect(q('[data-testid="char-count"]').textContent).toBe("501/500");
    expect(button("Post").disabled).toBe(true);
  });

  it("lists the persona's events from the world log", async () => {
    tick.world = vi.fn();
    await mount({ chat: { world: { log: [{ id: "w1", text: "The mayor resigned.", by: "you", anchor: at("m2") }, { id: "w2", text: "Not mine.", anchor: at("m2") }] } } });
    await openWorld();
    const list = byLabel("Events you wrote").textContent;
    expect(list).toContain("The mayor resigned.");
    expect(list).not.toContain("Not mine.");
  });

  it("Skip a week: busy and skeletons at once, streams the preview, then says where time moved", async () => {
    let done;
    tick.skip = vi.fn(() => new Promise((r) => { done = r; }));
    tick.preview = { posts: [{ by: "bea", text: "A week later, still raining" }] };
    await mount({ chat: { scene: { text: "[Day 9 | Evening | Harbour]" } } });
    await openWorld();
    expect(qa("[data-skip]").map((b) => b.textContent)).toEqual(["Skip a day", "Skip a week", "Skip a month"]);
    await click(q('[data-skip="week"]'));
    expect(tick.skip).toHaveBeenCalledWith("week");
    expect(q('[data-skip="week"]').textContent).toBe("Skipping…");
    expect(qa("[data-skip]").every((b) => b.disabled)).toBe(true);
    expect(q('[data-testid="phone-incoming"]')).toBeTruthy();
    expect(byLabel("What happened meanwhile").textContent).toContain("A week later, still raining");
    await act(async () => done());
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    expect(q('[data-testid="world-moved"]').textContent).toBe("Time moved to Day 9, Evening.");
    expect(tick.later).not.toHaveBeenCalled();
    expect(h().threads).toEqual({});
  });
});

describe("composer", () => {
  it("posts text, with a counter, and asks the job for later", async () => {
    await mount();
    await openMurmur();
    await type(byLabel("What's happening?"), "Out by the docks.");
    expect(q('[data-testid="char-count"]')).toBeNull();
    await click(button("Post"));
    expect(h().posts[0]).toMatchObject({ by: "you", kind: "post", text: "Out by the docks.", anchor: { id: "m2" } });
    expect(h().posts[0].photo).toBeUndefined();
    expect(h().tick.pending).toBe(true);
    expect(tick.later).toHaveBeenCalled();
  });

  it("a device picture is read and posted; over 10 MB is refused", async () => {
    await mount();
    await openMurmur();
    const input = q('[data-testid="phone-photo-input"]');
    const pick = async (file) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      await flush();
    };
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await pick(big);
    expect(q('[data-testid="phone-composer"] [role="alert"]').textContent).toContain("10 MB");
    await pick(new File(["abc"], "pic.png", { type: "image/png" }));
    expect(byLabel("Remove photo")).toBeTruthy();
    await click(button("Post"));
    expect(h().posts[0].image).toMatch(/^data:image\/png;base64,/);
  });

  it("three boxes: the picture (image), its description (photo) and the text; the picture shows on the post and in Gallery", async () => {
    await mount();
    await openMurmur();
    await click(byLabel("Attach photo"));
    expect(q('[data-testid="composer-picture-box"]')).toBeTruthy();
    expect(byLabel("What the photo shows")).toBeTruthy();
    const input = q('[data-testid="phone-photo-input"]');
    Object.defineProperty(input, "files", { value: [new File(["abc"], "pier.png", { type: "image/png" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(q('[data-testid="composer-picture"] img')).toBeTruthy();
    await type(byLabel("What the photo shows"), "The pier at dusk");
    await type(byLabel("What's happening?"), "Made it");
    await click(button("Post"));
    const saved = h().posts[0];
    expect(saved).toMatchObject({ by: "you", text: "Made it", photo: "The pier at dusk" });
    expect(saved.image).toMatch(/^data:image\/png;base64,/);
    expect(q(`[data-post="${saved.id}"] img`).getAttribute("src")).toBe(saved.image);
    await click(byLabel("Back"));
    await click(buttons().find((b) => (b.getAttribute("aria-label") || "").startsWith("Gallery") && b.closest('[aria-label="Apps"]')));
    expect(qa("img").some((i) => i.getAttribute("src") === saved.image)).toBe(true);
  });

  it("a described photo shows as a described card; Develop is the only generator", async () => {
    await mount();
    await openMurmur();
    await click(byLabel("Attach photo"));
    await type(byLabel("What the photo shows"), "Rain on the pier");
    await click(button("Post"));
    const mine = h().posts[0];
    expect(mine).toMatchObject({ by: "you", photo: "Rain on the pier" });
    expect(mine.image).toBeUndefined();
    const card = q(`[data-post="${mine.id}"] [data-described-photo]`);
    expect(card.textContent).toContain("Rain on the pier");
    /* nothing generated by posting */
    expect(activity.get().some((j) => j.kind === "image")).toBe(false);
    await click(q(`[data-post="${mine.id}"] [data-develop]`));
    expect(activity.get().some((j) => j.kind === "image" && j.dedupeKey === `develop:${mine.id}`)).toBe(true);
  });

  it("no Develop without an image provider", async () => {
    await mount({ d: data({ imageGen: null }) });
    await openMurmur();
    expect(q('[data-post="ph"] [data-described-photo]').textContent).toContain("A harbour at dawn");
    expect(q("[data-develop]")).toBeNull();
  });
});

describe("character counters", () => {
  it("the composer shows n/280 past 80% and turns Post off when over", async () => {
    await mount();
    await openMurmur();
    const box = byLabel("What's happening?");
    await type(box, "x".repeat(224));
    expect(q('[data-testid="phone-composer"] [data-testid="char-count"]')).toBeNull();
    await type(box, "x".repeat(225));
    expect(q('[data-testid="phone-composer"] [data-testid="char-count"]').textContent).toBe("225/280");
    expect(button("Post").disabled).toBe(false);
    await type(box, "x".repeat(281));
    expect(q('[data-testid="phone-composer"] [data-testid="char-count"]').textContent).toBe("281/280");
    expect(button("Post").disabled).toBe(true);
    /* the counter sits in the composer's one row */
    expect(q('[data-testid="char-count"]').parentElement).toBe(box.parentElement);
  });

  it("the reply box in a post's detail counts to 280 and refuses over", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p1"] [data-action="reply"]'));
    const box = byLabel("Reply");
    await type(box, "y".repeat(250));
    expect(q('[data-testid="char-count"]').textContent).toBe("250/280");
    expect(byLabel("Send reply").disabled).toBe(false);
    await type(box, "y".repeat(300));
    expect(byLabel("Send reply").disabled).toBe(true);
    const before = h().posts.length;
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(h().posts.length).toBe(before);
  });
});

describe("streamed seed preview", () => {
  const PREVIEW = {
    me: null, accounts: [], dms: [], events: [], topics: [],
    posts: [
      { id: "a", by: "@bea", text: "Fresh off the press", photo: "", replyTo: "", quote: "", repost: "", slot: "", replies: [] },
      { id: "b", by: "Someone New", text: "", photo: "A cat on a wall", replyTo: "", quote: "", repost: "", slot: "", replies: [] },
    ],
    stories: [{ by: "dailynews", text: "Live now", photo: "" }],
  };

  it("shows the streamed posts as full-strength cards in the feed's slots (stories stay in their row), then the saved feed", async () => {
    tick.preview = PREVIEW;
    await mount();
    await openMurmur();
    const cards = qa('[data-testid="phone-incoming"] [data-preview]');
    expect(cards.map((c) => c.dataset.preview)).toEqual(["post", "post"]);
    expect(cards[0].textContent).toContain("Bea");
    expect(cards[0].textContent).toContain("Fresh off the press");
    expect(cards[0].className).not.toContain("opacity-50");
    expect(cards[1].textContent).toContain("A cat on a wall");
    expect(q('[data-testid="preview-writing"]')).toBeNull();
    /* no buttons on a card being written */
    expect(cards[0].querySelector("button")).toBeNull();

    /* the seed is saved: the preview is cleared, the saved posts stay */
    tick = { ...tick, preview: null };
    await act(async () => root.render(<Harness initial={Harness.chat} d={data()} />));
    await flush();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    expect(byLabel("Murmur feed")).toBeTruthy();
  });

  it("no preview shows nothing; an empty preview shows nothing", async () => {
    tick.preview = { me: null, accounts: [], posts: [], stories: [], dms: [], events: [], topics: [] };
    await mount();
    await openMurmur();
    expect(q('[data-testid="phone-incoming"]')).toBeNull();
    expect(q("[data-preview]")).toBeNull();
  });
});

describe("Load more, Refresh and Retry", () => {
  it("Load more calls tick.more with a busy state; Refresh calls tick.refresh", async () => {
    let done;
    tick.more = vi.fn(() => new Promise((r) => { done = r; }));
    await mount();
    await openMurmur();
    await click(button("Load more"));
    expect(tick.more).toHaveBeenCalledTimes(1);
    expect(button("Load more").disabled).toBe(true);
    expect(button("Load more").getAttribute("aria-busy")).toBe("true");
    await act(async () => done());
    await flush();
    expect(button("Load more")).toBeTruthy();
    await refreshFromHome();
    expect(tick.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows Couldn't update with Retry when the last batch failed", async () => {
    const hs = handset();
    hs.tick.error = { message: "Couldn't update", mode: "more" };
    await mount({ hs });
    await openMurmur();
    expect(q('[data-testid="phone-error"]').textContent).toContain("Couldn't update");
    await click(button("Retry"));
    expect(tick.more).toHaveBeenCalledTimes(1);
  });

  it("no error row without an error", async () => {
    await mount();
    await openMurmur();
    expect(q('[data-testid="phone-error"]')).toBeNull();
  });
});

describe("stories", () => {
  const withStories = () => {
    const hs = handset();
    hs.stories = [
      { id: "s3", by: "you", text: "My day", tick: 2, anchor: at("m2") },
      { id: "s2", by: "char:c1", text: "On the roof", tick: 2, anchor: at("m2") },
      { id: "s1", by: "npc:bea", text: "Coffee", tick: 1, anchor: at("m0") },
    ];
    hs.seen.stories = ["s1"];
    return hs;
  };

  it("the row: Your story first, then by newest story; unseen ringed", async () => {
    await mount({ hs: withStories() });
    await openMurmur();
    const row = qa('[aria-label="Stories"] [data-story]');
    expect(row.map((e) => e.dataset.story)).toEqual(["you", "char:c1", "npc:bea"]);
    expect(row.map((e) => e.hasAttribute("data-unseen"))).toEqual([false, true, false]);
  });

  it("rings like Instagram: gradient while unviewed, grey once viewed; your own shows its viewers", async () => {
    const hs = withStories();
    await mount({ hs });
    await openMurmur();
    const ring = (k) => q(`[data-story="${k}"]`).dataset.ring;
    expect(ring("char:c1")).toBe("new");
    expect(q('[data-story="char:c1"] [data-ring-el]').style.backgroundImage).toContain("linear-gradient");
    expect(ring("npc:bea")).toBe("seen");
    /* nobody has viewed yours: grey, 0 */
    expect(ring("you")).toBe("seen");
    expect(q('[data-story="you"] [data-views]').dataset.views).toBe("0");
    await act(async () => root.unmount());
    root = createRoot(host);
    const viewed = withStories();
    viewed.stories[0] = { ...viewed.stories[0], stats: { likes: 4, replies: 0 } };
    await mount({ hs: viewed });
    await openMurmur();
    expect(ring("you")).toBe("new");
    expect(q('[data-story="you"] [data-views]').textContent).toBe("4");
  });

  it("the viewer: Like counts, a comment is a reply under the story, Post about it opens a quote of the story", async () => {
    await mount({ hs: withStories() });
    await openMurmur();
    await click(q('[data-story="char:c1"] button'));
    const like = q('[data-action="story-like"]');
    /* a story's first likes come from the engine (its author's fame) */
    const start = h().stories.find((x) => x.id === "s2").stats.likes;
    expect(like.querySelector("[data-count]").textContent).toBe(String(start));
    await click(like);
    expect(h().stories.find((x) => x.id === "s2")).toMatchObject({ liked: true, stats: { likes: start + 1 } });
    expect(q('[data-action="story-like"] [data-count]').textContent).toBe(String(start + 1));
    await type(byLabel("Comment"), "Great view");
    await click(byLabel("Send comment"));
    const c = h().posts.find((p) => p.kind === "reply" && p.ref === "s2");
    expect(c).toMatchObject({ by: "you", text: "Great view" });
    /* starts at zero: no likes or replies yet */
    expect(c.stats).toMatchObject({ likes: 0, replies: 0 });
    expect(tick.later).toHaveBeenCalled();
    /* the count; the comments open in their panel */
    expect(q('[data-action="story-comments"] [data-count]').textContent).toBe("1");
    await click(q('[data-action="story-comments"]'));
    expect(q('[data-testid="story-comments"] [aria-label="Comments"]').textContent).toContain("Great view");
    expect(document.activeElement).toBe(byLabel("Comment on story"));
    expect(q('[data-testid="story-comment-sent"]')).toBeTruthy();
    await type(byLabel("Comment on story"), "And again");
    await click(q('[data-testid="story-comments"] [aria-label="Send comment"]'));
    expect(h().posts.filter((p) => p.kind === "reply" && p.ref === "s2").map((p) => p.text)).toEqual(expect.arrayContaining(["Great view", "And again"]));
    const rows = qa('[data-testid="story-comments"] [data-post]').map((e) => e.textContent);
    expect(rows.at(-1)).toContain("And again");
    /* Escape closes the panel, not the story */
    await escape();
    expect(q('[data-testid="story-comments"]')).toBeNull();
    expect(q('[data-testid="story-viewer"]')).toBeTruthy();
    await click(button("Post about it"));
    expect(q('[data-testid="story-viewer"]')).toBeNull();
    expect(q('[data-embed-story="s2"]').textContent).toContain("On the roof");
  });

  it("the viewer marks seen, Message sends a DM, Escape closes it", async () => {
    await mount({ hs: withStories() });
    await openMurmur();
    await click(q('[data-story="char:c1"] button'));
    expect(q('[data-testid="story-viewer"]').textContent).toContain("On the roof");
    expect(h().seen.stories).toContain("s2");
    /* the box comments by default; Message makes the same box a DM and focuses it */
    const box = byLabel("Comment");
    expect(box).toBeTruthy();
    await click(button("Message"));
    expect(byLabel("Reply to story")).toBe(box);
    expect(document.activeElement).toBe(box);
    await type(byLabel("Reply to story"), "Careful up there");
    await click(byLabel("Send reply"));
    const line = h().threads["char:c1"].at(-1);
    expect(line.from).toBe("you");
    expect(line.text).toContain("Careful up there");
    expect(h().tick.pending).toBe(true);
    await escape();
    expect(q('[data-testid="story-viewer"]')).toBeNull();
    expect(byLabel("Murmur feed")).toBeTruthy();
  });

  it("a comment on the persona's story opens, from its notification, the story with its comments panel", async () => {
    const hs = withStories();
    hs.posts = [item("sc1", "npc:bea", "Love this", { kind: "reply", ref: "s3", tick: 3 }), ...hs.posts];
    hs.tick.n = 3;
    await mount({ hs });
    const row = q('[data-notification="comment"]');
    expect(row).toBeTruthy();
    await click(row);
    expect(q('[data-testid="story-viewer"]')).toBeTruthy();
    expect(q('[data-story-id]').dataset.storyId).toBe("s3");
    expect(q('[data-testid="story-comments"]').textContent).toContain("Love this");
    expect(q('[data-action="story-comments"] [data-count]').textContent).toBe("1");
  });

  it("a story past its life is not shown; Your story with none opens the story composer", async () => {
    const hs = handset();
    hs.stories = [{ id: "old", by: "npc:bea", text: "Old news", tick: 1, anchor: at("m0") }];
    const messages = [{ id: "m0", role: "assistant", content: "a" }];
    for (let i = 1; i <= 13; i++) messages.push({ id: `m${i}`, role: "assistant", content: `r${i}` });
    await mount({ hs, messages });
    await openMurmur();
    expect(q('[data-story="npc:bea"]')).toBeNull();
    await click(q('[data-story="you"] button'));
    await type(byLabel("Story text"), "Hello world");
    await click(button("Share to story"));
    expect(h().stories[0]).toMatchObject({ by: "you", text: "Hello world" });
    expect(qa('[aria-label="Stories"] [data-story]').map((e) => e.dataset.story)).toEqual(["you"]);
  });
});

describe("writes move the phone's clock", () => {
  it("a story comment goes through phoneAct: dated at now + its cost, the clock moves on, the anchor is loose", async () => {
    const hs = handset();
    hs.stories = [{ id: "s2", by: "char:c1", text: "On the roof", tick: 2, anchor: at("m2") }];
    await mount({ hs });
    await openMurmur();
    /* two story replies after the start: 10 minutes in */
    await click(q('[data-story="char:c1"] button'));
    await type(byLabel("Comment"), "Nice");
    await click(byLabel("Send comment"));
    const c = h().posts.find((p) => p.kind === "reply" && p.ref === "s2");
    expect(c).toMatchObject({ at: 12, anchor: { id: "m2", any: true } });
    expect(h().clock.min).toBe(12);
  });

  it("a post goes through phoneAct as well, and a like costs nothing", async () => {
    await mount();
    await openMurmur();
    await click(q('[data-post="p2"] [data-action="like"]'));
    expect(h().clock?.min ?? 0).toBe(0);
    await type(byLabel("What's happening?"), "Out");
    await click(button("Post"));
    expect(h().posts[0]).toMatchObject({ by: "you", at: 13 });
    expect(h().clock.min).toBe(13);
  });
});

describe("reply counts", () => {
  it("the detail's head shows the big count while the list shows the stored replies and Load more", async () => {
    tick.moreReplies = vi.fn(() => Promise.resolve());
    await mount();
    await openMurmur();
    await click(q('[data-post="big"] [data-action="reply"]'));
    expect(q('[data-route="murmur"] [data-action="reply"] [data-count]').textContent).toBe(compactCount(34567));
    expect(qa('[aria-label="Replies"] [data-post]')).toHaveLength(0);
    expect(q('[data-testid="more-replies"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain("No replies yet.");
  });
});

describe("activity", () => {
  it("lists replies and quotes aimed at the persona and sums the likes on their posts", async () => {
    const hs = handset();
    hs.posts = [
      item("ar", "npc:bea", "Nice one", { kind: "reply", ref: "mine" }),
      item("aq", "npc:bea", "Ha, look", { kind: "quote", ref: "mine" }),
      item("other", "npc:bea", "Not about you", { kind: "reply", ref: "p2" }),
      item("p2", "npc:bea", "Ten likes"),
      item("mine", "you", "My post", { stats: { likes: 7, reposts: 1, replies: 0, quotes: 0 }, pot: { likes: 7, reposts: 1, replies: 0, quotes: 0 } }),
    ];
    await mount({ hs });
    await openMurmur();
    await click(buttons().find((b) => b.getAttribute("role") === "tab" && b.textContent === "Activity"));
    expect(qa('[aria-label="Replies and quotes"] [data-post]').map((e) => e.dataset.post)).toEqual(["ar", "aq"]);
    expect(q('[data-post="ar"] [data-reply-to]').textContent).toContain("@you");
    expect(q('[data-testid="activity-summary"]').textContent).toContain("7 likes");
    expect(q('[data-testid="activity-summary"]').textContent).toContain("1 reposts");
  });
});
