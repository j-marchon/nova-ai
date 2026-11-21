import { describe, expect, it } from "vitest";
import {
  IMAGE_CAP, NPC_CAP, POST_CAP, STORY_CAP, STORY_LIFE, THREAD_CAP, THREAD_LINES, YOU,
  TRAIT_EXTRA_CAP, TRAIT_MAX, addPost, addStory, setMe, traitsOf, emptyHandset, markSeen, mergeTick, normalizeHandset, repliesAfter, setPostImage, toggleLike, toggleRepost, unread, visiblePhone,
} from "../src/lib/phone.js";
import { ROOT_ANCHOR, anchorVisible } from "../src/lib/anchor.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { BACKUP_APP, readBackup } from "../src/lib/backup.js";

/* The 3.2.0 handset (no `v`) becomes version 2 in normalizeHandset, the path
   every chat and backup takes. Nothing the persona saw may change: every
   post, thread, like and seen marker is kept, with the like counts it showed. */

const A = (id, swipe = 0) => ({ id, swipe });
const msg = (id, role = "assistant") => ({ id, role, content: `${role} ${id}` });

/* the 3.2.0 display formula, copied so this test does not depend on phone.js keeping it */
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const oldLikes = (post, fame = 1) => {
  const f = Math.max(0, Math.min(3, Number.isFinite(fame) ? Math.round(fame) : 1));
  const [lo, hi] = [[0, 12], [3, 60], [40, 900], [800, 20000]][f];
  return lo + (hash(post.id) % (hi - lo + 1)) + (post.liked ? 1 : 0);
};

const v1 = () => ({
  level: "light",
  tick: { n: 3, lastMsgId: "r2", pending: true },
  people: {
    "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea", fame: 2 },
    "char:mira": { key: "char:mira", handle: "mira", name: "Mira" },
  },
  posts: [
    { id: "c3a", app: "glimpse", by: "char:mira", text: "cute", replyTo: "g2a", tick: 3, anchor: A("r2") },
    { id: "y1", app: "murmur", by: YOU, text: "mine", replyTo: "m1a", liked: true, tick: 3, anchor: A("r2") },
    { id: "g2a", app: "glimpse", by: "npc:bea", text: "harbour", photo: "A harbour at dawn", image: "data:image/png;base64,AAA", liked: true, tick: 2, anchor: A("r1", 1) },
    { id: "c2b", app: "glimpse", by: "npc:bea", text: "me again", replyTo: "g2a", tick: 2, anchor: A("r1", 1) },
    { id: "m1a", app: "murmur", by: "npc:bea", text: "Rain again.", tick: 1, anchor: A("r1") },
    { id: "m1b", app: "murmur", by: "char:mira", text: "Rooftops.", tick: 1, anchor: A("r1") },
  ],
  threads: {
    "char:mira": [
      { id: "d1", from: "char:mira", text: "Bring the map", tick: 1, anchor: A("r1") },
      { id: "y2", from: YOU, text: "On my way", tick: 2, anchor: A("r1") },
    ],
    "npc:bea": [{ id: "d2", from: "npc:bea", text: "you up?", tick: 3, anchor: A("r2") }],
  },
  seen: { murmur: 2, glimpse: 3, messages: { "char:mira": 2, "npc:bea": 1 } },
});

describe("migration from 3.2.0", () => {
  it("keeps every post with its likes, kind and target", () => {
    const old = v1();
    const h = normalizeHandset(old);
    expect(h.v).toBe(2);
    expect(h.level).toBe("light");
    expect(h.posts.map((p) => p.id)).toEqual(old.posts.map((p) => p.id));
    const by = Object.fromEntries(h.posts.map((p) => [p.id, p]));
    for (const p of old.posts) {
      const fame = old.people[p.by]?.fame;
      expect(by[p.id].stats.likes).toBe(oldLikes(p, fame));
      expect(by[p.id].pot).toEqual(by[p.id].stats);
      expect(by[p.id].text).toBe(p.text);
      expect(by[p.id].anchor).toEqual(p.anchor);
      expect(by[p.id].tick).toBe(p.tick);
      expect(by[p.id].liked).toBe(p.liked);
      expect("app" in by[p.id]).toBe(false);
      expect("replyTo" in by[p.id]).toBe(false);
    }
    expect(by.m1a).toMatchObject({ kind: "post", stats: { replies: 1, reposts: 0, quotes: 0 } });
    expect(by.m1b).toMatchObject({ kind: "post", stats: { replies: 0 } });
    expect(by.y1).toMatchObject({ kind: "reply", ref: "m1a", by: YOU });
    expect(by.g2a).toMatchObject({ kind: "post", photo: "A harbour at dawn", image: "data:image/png;base64,AAA", stats: { replies: 2 } });
    expect(by.c3a).toMatchObject({ kind: "reply", ref: "g2a" });
    expect(by.c2b).toMatchObject({ kind: "reply", ref: "g2a" });
    expect(by.m1a.ref).toBeUndefined();
  });

  it("keeps threads, people and seen markers; fills the new parts", () => {
    const old = v1();
    const h = normalizeHandset(old);
    expect(h.threads).toEqual(old.threads);
    /* fame becomes traits.fame (the model's guess: inferred); no fame is 0 */
    expect(h.people["npc:bea"]).toEqual({ ...old.people["npc:bea"], traits: { fame: 2, wealth: 0 }, traitsFrom: { fame: "inferred" } });
    expect(h.people["char:mira"]).toEqual({ ...old.people["char:mira"], fame: 0, traits: { fame: 0, wealth: 0 } });
    expect(h.seen).toEqual({ feed: 3, stories: [], messages: old.seen.messages, bank: 0, mentions: 3 });
    expect(h.tick).toEqual({ n: 3, lastMsgId: "r2", pending: true, seeded: true });
    expect(h.me).toEqual({ fame: 0, followers: 0, traits: { fame: 0, wealth: 0 } });
    expect(h.bank).toMatchObject({ tx: [], fresh: true });
    expect(h.world).toEqual({ topics: [] });
    expect(h.stories).toEqual([]);
  });

  it("is not seeded when nothing ever happened", () => {
    const h = normalizeHandset({ level: "off", tick: { n: 0, lastMsgId: null, pending: false }, people: {}, posts: [], threads: {}, seen: { murmur: 0, glimpse: 0, messages: {} } });
    expect(h).toEqual(emptyHandset("off"));
    expect(normalizeHandset({ level: "lively", tick: { n: 2 } }).tick.seeded).toBe(true);
  });

  it("drops broken items one at a time", () => {
    const old = v1();
    old.posts.push(
      { id: "bad1", app: "tiktok", by: "npc:bea", text: "x", tick: 1, anchor: A("r1") },
      { id: "bad2", app: "murmur", by: "npc:bea", text: 5, tick: 1, anchor: A("r1") },
      { id: "bad3", app: "murmur", by: "npc:bea", text: "no anchor", tick: 1 },
      null, "junk",
    );
    old.threads["char:mira"].push({ text: "broken" }, null);
    old.threads.broken = "nope";
    old.people["npc:bad"] = { handle: "no spaces" };
    old.seen.messages.bad = -1;
    const h = normalizeHandset(old);
    expect(h.posts.map((p) => p.id)).toEqual(v1().posts.map((p) => p.id));
    expect(h.threads).toEqual(v1().threads);
    expect(Object.keys(h.people).sort()).toEqual(["char:mira", "npc:bea"]);
    expect(h.seen.messages).toEqual(v1().seen.messages);
    expect(normalizeHandset({ posts: [] })).toBeUndefined();
  });

  it("is idempotent, and v2 data survives normalising unchanged", () => {
    const once = normalizeHandset(v1());
    expect(normalizeHandset(once)).toEqual(once);
    expect(normalizeHandset(normalizeHandset(once))).toEqual(once);
    let h = addPost(once, { kind: "quote", ref: "m1a", text: "this" }, A("r2"));
    h = addStory(h, { photo: "the docks at night" }, A("r2"));
    h = markSeen(h, { story: h.stories[0].id });
    h = { ...h, me: { fame: 2, followers: 1200, bio: "Courier", traits: { fame: 2, wealth: 0, job: "courier", scar: "left cheek" }, traitsFrom: { fame: "manual", job: "stated" } }, world: { topics: ["the storm"] }, tick: { ...h.tick, error: { message: "Couldn't update", mode: "seed" } } };
    h.posts = [{ ...h.posts[0], ago: 30, t0: 1.5, reposted: true, pot: { likes: 90, reposts: 4, replies: 20, quotes: 1 } }, ...h.posts.slice(1)];
    const n = normalizeHandset(h);
    expect(n).toEqual(h);
    expect(normalizeHandset(n)).toEqual(n);
  });

  it("a chat and a 3.2.0 backup import through normalizeData", () => {
    const messages = [msg("g"), msg("u1", "user"), msg("r1"), msg("u2", "user"), msg("r2")];
    const d = structuredClone(emptyData);
    d.chats = [{ id: "a", kind: "character", characterId: "c", messages, handset: v1() }];
    const out = normalizeData(d);
    expect(out.chats[0].handset).toEqual(normalizeHandset(v1()));
    /* loading again changes nothing */
    expect(normalizeData(out).chats[0].handset).toEqual(out.chats[0].handset);

    const { chats, ...core } = structuredClone(emptyData);
    const file = JSON.stringify({
      app: BACKUP_APP, backup: 1, version: "3.2.0", createdAt: 7,
      core: { ...core, format: 2, chatOrder: ["a"] },
      chats: [{ id: "a", kind: "character", characterId: "c", messages, handset: v1() }],
      images: {},
    });
    const { state } = readBackup(file);
    const h = state.chats[0].handset;
    expect(h.v).toBe(2);
    expect(h.posts.map((p) => p.id)).toEqual(v1().posts.map((p) => p.id));
    expect(h.posts.find((p) => p.id === "g2a").stats.likes).toBe(oldLikes(v1().posts[2], 2));
    expect(h.threads).toEqual(v1().threads);
    expect(h.seen.feed).toBe(3);
  });
});

describe("version 2 shape", () => {
  it("emptyHandset", () => {
    expect(emptyHandset("lively")).toEqual({
      v: 2, level: "lively",
      tick: { n: 0, lastMsgId: null, pending: false, seeded: false },
      clock: { min: 0, at: { id: "@start", swipe: 0 }, sync: { id: "@start", swipe: 0 }, step: "sync", last: 0 },
      me: { fame: 0, followers: 0, traits: { fame: 0, wealth: 0 } }, world: { topics: [] },
      people: {}, posts: [], stories: [], threads: {},
      seen: { feed: 0, stories: [], messages: {}, bank: 0, mentions: 0 },
      bank: { balance: emptyHandset("lively").bank.balance, tx: [], fresh: true },
      dmWait: {},
    });
    expect(emptyHandset("lively").bank.balance).toBeGreaterThanOrEqual(80);
    expect(emptyHandset("lively").bank.balance).toBeLessThanOrEqual(600);
    expect(emptyHandset("loud").level).toBe("off");
  });

  it("cleans v2 fields and enforces caps", () => {
    const post = (i, extra = {}) => ({ id: `p${i}`, by: "npc:x", text: `t${i}`, kind: "post", stats: { likes: 5 }, tick: 1, anchor: A("r1"), ...extra });
    const people = { "npc:x": { handle: "x_x", name: "X", fame: 9, verified: true, role: "outlet", followers: "1.2M" } };
    for (let i = 0; i < NPC_CAP + 5; i++) people[`npc:n${i}`] = { handle: `n${i}x`, name: `N${i}` };
    const threads = {};
    for (let i = 0; i < THREAD_CAP + 3; i++) threads[`npc:n${i}`] = Array.from({ length: i === 0 ? THREAD_LINES + 5 : 1 }, (_, j) => ({ id: `d${i}_${j}`, from: `npc:n${i}`, text: "hi", tick: i + 1, anchor: A("r1") }));
    const h = normalizeHandset({
      v: 2, level: "lively",
      tick: { n: 2, lastMsgId: "r1", pending: false, seeded: true, error: "boom" },
      me: { fame: 7, followers: "12k" },
      world: { topics: ["a", "", 3, "b", "c", "d", "e", "f", "g"] },
      people,
      posts: [
        ...Array.from({ length: POST_CAP + 10 }, (_, i) => post(i)),
      ].map((p, i) => (i === 0 ? { ...p, pot: { likes: 2 } } : i === 1 ? { ...p, kind: "reply" } : i === 2 ? { ...p, kind: "repost" } : i === 3 ? { ...p, kind: "weird" } : p)),
      stories: Array.from({ length: STORY_CAP + 4 }, (_, i) => ({ id: `s${i}`, by: "npc:x", text: "story", tick: 1, anchor: A("r1") })),
      threads,
      seen: { feed: 1, stories: ["s1", "s1", 4], messages: {} },
    });
    expect(h.tick.error).toEqual({ message: "boom" });
    expect(h.me).toEqual({ fame: 3, followers: 12000, traits: { fame: 3, wealth: 0 } });
    expect(h.world.topics).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(h.people["npc:x"]).toMatchObject({ fame: 3, verified: true, role: "outlet", followers: 1200000 });
    expect(Object.keys(h.people).filter((k) => k.startsWith("npc:"))).toHaveLength(NPC_CAP);
    expect(h.posts).toHaveLength(POST_CAP);
    expect(h.posts[0].pot.likes).toBe(5); // never below the floor
    expect(h.posts[1].kind).toBe("post"); // a reply with no target
    expect(h.posts.map((p) => p.id)).not.toContain("p2"); // a repost of nothing
    expect(h.posts.map((p) => p.id)).not.toContain("p3");
    expect(h.stories).toHaveLength(STORY_CAP);
    expect(Object.keys(h.threads)).toHaveLength(THREAD_CAP);
    expect(h.threads["npc:n0"]).toBeUndefined(); // the quietest thread went
    expect(h.threads[`npc:n${THREAD_CAP + 2}`]).toHaveLength(1);
    expect(h.seen.stories).toEqual(["s1"]);
  });
});

describe("the chat's start", () => {
  it("ROOT_ANCHOR is always visible and counts every reply", () => {
    expect(anchorVisible(ROOT_ANCHOR, [])).toBe(true);
    expect(anchorVisible(ROOT_ANCHOR, undefined)).toBe(true);
    expect(anchorVisible(A("r1"), [msg("g")])).toBe(false);
    const messages = [msg("g"), msg("u1", "user"), msg("r1")];
    expect(repliesAfter(ROOT_ANCHOR, messages)).toBe(2);
    expect(repliesAfter(A("g"), messages)).toBe(1);
    expect(repliesAfter(A("gone"), messages)).toBeNull();
  });

  it("seeded items survive swipes and the old merge; stories go after STORY_LIFE replies", () => {
    const seed = { ...emptyHandset("light"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true },
      posts: [{ id: "s1", by: "npc:x", text: "seed", kind: "post", tick: 1, anchor: ROOT_ANCHOR }],
      stories: [{ id: "st", by: "npc:x", text: "story", tick: 1, anchor: ROOT_ANCHOR }] };
    const h = normalizeHandset(seed);
    expect(h.posts[0].anchor).toEqual(ROOT_ANCHOR);
    expect(visiblePhone(h, [msg("g")]).posts).toHaveLength(1);
    expect(mergeTick(h, {}, { anchor: A("g"), messages: [msg("g")] }).posts.map((p) => p.id)).toEqual(["s1"]);
    const long = [msg("g")]; // the greeting is a story reply too
    for (let i = 1; i < STORY_LIFE - 1; i++) long.push(msg(`u${i}`, "user"), msg(`r${i}`));
    expect(visiblePhone(h, long).stories).toHaveLength(1);
    expect(unread(h, long).stories).toBe(1);
    long.push(msg("u99", "user"), msg("r99"));
    expect(visiblePhone(h, long).stories).toHaveLength(0);
  });
});

describe("persona actions on v2 counts", () => {
  const base = normalizeHandset({ ...emptyHandset("light"), posts: [{ id: "p", by: "npc:x", text: "hi", kind: "post", stats: { likes: 10, reposts: 1 }, pot: { likes: 40, reposts: 3 }, tick: 1, anchor: A("r1") }] });

  it("like and repost move counts by one at once, and back", () => {
    const liked = toggleLike(base, "p");
    expect(liked.posts[0]).toMatchObject({ liked: true, stats: { likes: 11 }, pot: { likes: 41 } });
    expect(toggleLike(liked, "p").posts[0]).toEqual(base.posts[0]);
    const rp = toggleRepost(base, "p");
    expect(rp.posts[0]).toMatchObject({ reposted: true, stats: { reposts: 2 }, pot: { reposts: 4 } });
    expect(toggleRepost(rp, "p").posts[0]).toEqual(base.posts[0]);
  });

  it("reply and quote count on their target and stay flat", () => {
    let h = addPost(base, { kind: "reply", ref: "p", text: "a reply" }, A("r1"));
    const replyId = h.posts[0].id;
    h = addPost(h, { kind: "reply", ref: replyId, text: "reply to a reply" }, A("r1"));
    expect(h.posts[0]).toMatchObject({ kind: "reply", ref: "p" });
    h = addPost(h, { kind: "quote", ref: "p", text: "quoting" }, A("r1"));
    expect(h.posts[0]).toMatchObject({ kind: "quote", ref: "p" });
    const p = h.posts.find((x) => x.id === "p");
    expect(p.stats).toMatchObject({ replies: 2, quotes: 1 });
    expect(addPost(base, { kind: "quote", ref: "nope", text: "x" }, A("r1"))).toEqual(base);
    expect(addPost(base, { kind: "reply", ref: "p", text: "x".repeat(400) }, A("r1")).posts[0].text).toHaveLength(280);
  });

  it("pictures past IMAGE_CAP go back to their description", () => {
    const posts = Array.from({ length: IMAGE_CAP + 2 }, (_, i) => ({ id: `p${i}`, by: "npc:x", text: "", photo: "a view", image: `img${i}`, kind: "post", tick: 1, anchor: A("r1") }));
    const h = setPostImage({ ...emptyHandset("light"), posts }, "p0", "new");
    const pictured = h.posts.filter((p) => p.image);
    expect(pictured).toHaveLength(IMAGE_CAP);
    expect(h.posts[0].image).toBe("new");
    expect(h.posts.at(-1).image).toBeUndefined();
    expect(h.posts.at(-1).photo).toBe("a view");
  });
});

describe("profiles", () => {
  it("traits round-trip, sanitised and capped, with fame as a read-through alias", () => {
    const extra = Object.fromEntries(Array.from({ length: TRAIT_EXTRA_CAP + 3 }, (_, i) => [`x${i}`, `v${i}`]));
    const raw = {
      ...emptyHandset("light"),
      me: { followers: 10, traits: { fame: 2, looks: "tall,   dark   coat", job: "x".repeat(200), body: "", hobby: 7, "Bad Key": "no", ...extra }, traitsFrom: { fame: "stated", looks: "inferred", job: "guess", nope: "manual" } },
      people: { "npc:ana": { handle: "ana_b", name: "Ana", fame: 1, traits: { job: "barista" }, traitsFrom: { job: "stated" } } },
    };
    const h = normalizeHandset(raw);
    expect(h.me.fame).toBe(2);
    expect(h.me.traits).toMatchObject({ fame: 2, looks: "tall, dark coat" });
    expect(h.me.traits.job).toHaveLength(TRAIT_MAX);
    expect("body" in h.me.traits || "hobby" in h.me.traits || "Bad Key" in h.me.traits).toBe(false);
    expect(Object.keys(h.me.traits).filter((k) => k.startsWith("x"))).toHaveLength(TRAIT_EXTRA_CAP);
    expect(h.me.traitsFrom).toEqual({ fame: "stated", looks: "inferred" });
    expect(h.people["npc:ana"]).toMatchObject({ fame: 1, traits: { fame: 1, job: "barista" }, traitsFrom: { job: "stated" } });
    expect(normalizeHandset(h)).toEqual(h);
    expect(normalizeHandset(JSON.parse(JSON.stringify(h)))).toEqual(h);
  });

  it("traitsOf always has a fame; setMe edits traits and marks them manual", () => {
    expect(traitsOf(undefined)).toEqual({ fame: 0, wealth: 0 });
    expect(traitsOf({ fame: 3 })).toEqual({ fame: 3, wealth: 0 });
    expect(traitsOf({ traits: { fame: 1, wealth: 9, job: "chef" } })).toEqual({ fame: 1, wealth: 3, job: "chef" });
    let h = setMe(emptyHandset("light"), { fame: 2, traits: { job: "singer" } });
    expect(h.me).toMatchObject({ fame: 2, traits: { fame: 2, job: "singer" }, traitsFrom: { fame: "manual", job: "manual" } });
    h = setMe(h, { traits: { job: "", looks: "red hair" }, from: "inferred" });
    expect(h.me.traits).toEqual({ fame: 2, wealth: 0, looks: "red hair" });
    expect(h.me.traitsFrom).toEqual({ fame: "manual", looks: "inferred" });
    expect(normalizeHandset(h)).toEqual(h);
  });
});

describe("3.2 phone saves", () => {
  it("an old post whose reply ceiling was pinned to its stored replies is lifted on load", () => {
    const old = { ...emptyHandset("light"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true },
      posts: [
        { id: "big", by: "npc:x", text: "big", kind: "post", stats: { likes: 9000, replies: 1 }, pot: { likes: 20000, replies: 1 }, tick: 1, anchor: ROOT_ANCHOR },
        { id: "c1", by: "npc:y", text: "r", kind: "reply", ref: "big", stats: {}, tick: 1, anchor: ROOT_ANCHOR },
      ] };
    const h = normalizeHandset(old);
    const big = h.posts.find((p) => p.id === "big");
    expect(big.pot.replies).toBeGreaterThanOrEqual(1000);
    expect(big.stats.replies).toBe(1);
    expect(normalizeHandset(h)).toEqual(h);
  });
  it("an old clock gains sync (its at) and keeps its step; old seen gains mentions", () => {
    const h = normalizeHandset({ ...emptyHandset("light"), clock: { min: 40, at: { id: "r1", swipe: 0 }, step: "3h", last: 40 }, seen: { feed: 2, stories: [], messages: {}, bank: 0 } });
    expect(h.clock).toEqual({ min: 40, at: { id: "r1", swipe: 0 }, sync: { id: "r1", swipe: 0 }, step: "3h", last: 40 });
    expect(h.seen.mentions).toBe(2);
  });
});
