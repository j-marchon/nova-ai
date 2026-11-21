import { describe, expect, it, vi } from "vitest";
import {
  BUDGETS, accountResolver, budgetOf, mergeBatch, mergeProfile, owedSlots, parseBatch, parseProfile, phoneBatch, previewBatch,
  profileKeys, profileRequest, runPhoneBatch, runProfile, upsertPerson,
} from "../src/lib/phoneBatch.js";
import {
  POST_CAP, REPLIES_PER_POST, STORY_CAP, TEXT_LIMITS, YOU, addMessage, addPost, emptyHandset, normalizeHandset, setMe,
} from "../src/lib/phone.js";
import { ROOT_ANCHOR } from "../src/lib/anchor.js";
import { rng } from "../src/lib/phoneStats.js";
import { markSeen, toggleLike } from "../src/lib/phone.js";

const A = { id: "m2", swipe: 0 };
const messages = [
  { id: "m1", role: "user", content: "Hi Mira." },
  { id: "m2", role: "assistant", content: "Mira smiles and pours the coffee." },
];
const characters = [{ key: "char:mira", name: "Mira Sol", handle: "mira_sol", card: "Mira is a barista in Lisbon who paints at night.", present: true }];
const opts = { characters, userName: "Ana", messages };
const h0 = (level = "lively") => emptyHandset(level);
const J = (x) => JSON.stringify(x);
/* the persona's DM to `key` read and answered at once (handset.dmWait) */
const instant = (h, key) => { const w = h.dmWait[key]; return { ...h, dmWait: { ...h.dmWait, [key]: { ...w, due: w.sent, seen: w.sent } } }; };

describe("parseBatch aliases", () => {
  const cases = [
    ["feed", { feed: [{ by: "bob", text: "a" }] }],
    ["murmur", { murmur: [{ by: "bob", text: "a" }] }],
    ["tweets", { tweets: [{ by: "bob", text: "a" }] }],
    ["glimpse", { glimpse: [{ by: "bob", photo: "a cat", caption: "a" }] }],
    ["photos", { photos: [{ by: "bob", photo: "a cat", caption: "a" }] }],
  ];
  for (const [name, value] of cases) {
    it(`${name} are posts`, () => {
      const p = parseBatch(J(value));
      expect(p.posts).toHaveLength(1);
      expect(p.posts[0]).toMatchObject({ by: "bob", text: "a" });
    });
  }
  it("comments are replies, messages dms, people/users accounts", () => {
    const p = parseBatch(J({ posts: [{ id: "x", by: "bob", text: "t", comments: [{ author: "cy", content: "c" }] }], messages: [{ user: "dee", text: "hi" }], people: [{ handle: "dee" }], users: [{ handle: "eve" }] }));
    expect(p.posts[0].replies[0]).toMatchObject({ by: "cy", text: "c" });
    expect(p.dms[0]).toMatchObject({ from: "dee", text: "hi" });
    expect(p.accounts.map((a) => a.handle)).toEqual(["dee", "eve"]);
  });
  it("author|user|from -> by, caption|content -> text, on|parent -> replyTo", () => {
    const p = parseBatch(J({ posts: [{ author: "a1", caption: "x", on: "p1" }, { user: "a2", content: "y", parent: "#p2" }, { from: "a3", text: "z" }] }));
    expect(p.posts.map((x) => [x.by, x.text, x.replyTo])).toEqual([["a1", "x", "p1"], ["a2", "y", "p2"], ["a3", "z", ""]]);
  });
  it("no JSON is null", () => {
    expect(parseBatch("sorry, I cannot")).toBeNull();
  });
});

describe("mergeBatch", () => {
  it('"Mara Vol" and "@Mara_Vol" are one account', () => {
    const h = mergeBatch(h0(), { posts: [{ by: "Mara Vol", text: "one" }, { by: "@Mara_Vol", text: "two" }] }, { ...opts, mode: "refresh", anchor: A });
    const npcs = Object.keys(h.people).filter((k) => k.startsWith("npc:"));
    expect(npcs).toEqual(["npc:mara_vol"]);
    expect(h.people["npc:mara_vol"].name).toBe("Mara Vol");
    expect(h.posts.map((p) => p.by)).toEqual(["npc:mara_vol", "npc:mara_vol"]);
  });
  it("matches known accounts first, by handle or name", () => {
    const r = accountResolver(h0(), { characters, userName: "Ana" });
    expect(r("Mira Sol").key).toBe("char:mira");
    expect(r("@mira_sol").key).toBe("char:mira");
    expect(r("ana").key).toBe(YOU);
  });
  it("temp ids and nested replies", () => {
    const h = mergeBatch(h0(), {
      posts: [
        { id: "a", by: "bob", text: "root", replies: [{ by: "cy", text: "nested" }] },
        { by: "dee", text: "late reply", replyTo: "a" },
        { by: "eve", text: "quoting", quote: "a" },
        { by: "fay", text: "orphan", replyTo: "nope" },
      ],
    }, { ...opts, anchor: A });
    const root = h.posts.find((p) => p.text === "root");
    expect(root.kind).toBe("post");
    const kids = h.posts.filter((p) => p.ref === root.id);
    expect(kids.map((k) => [k.kind, k.text]).sort()).toEqual([["quote", "quoting"], ["reply", "late reply"], ["reply", "nested"]]);
    /* the reply count follows the stats, never below the stored replies */
    expect(root.stats.replies).toBeGreaterThanOrEqual(2);
    expect(root.stats.quotes).toBe(1);
    expect(h.posts.find((p) => p.text === "orphan").kind).toBe("post");
  });
  it("replies to an existing id, flattened to its root", () => {
    let h = mergeBatch(h0(), { posts: [{ by: "bob", text: "root", replies: [{ by: "cy", text: "r1" }] }] }, { ...opts, anchor: A });
    const reply = h.posts.find((p) => p.text === "r1");
    h = mergeBatch(h, { posts: [{ by: "dee", text: "r2", replyTo: reply.id }] }, { ...opts, anchor: A });
    const root = h.posts.find((p) => p.text === "root");
    expect(h.posts.find((p) => p.text === "r2").ref).toBe(root.id);
  });
  it("one bad item among good ones", () => {
    const h = mergeBatch(h0(), { posts: [{ by: "bob", text: "good" }, { by: 42, text: null }, "junk", { text: "no author" }, { by: "cy", text: "also good" }], stories: [{}, { by: "bob", text: "s" }] }, { ...opts, anchor: A });
    expect(h.posts.map((p) => p.text)).toEqual(["good", "also good"]);
    expect(h.stories).toHaveLength(1);
  });
  it("a cut-off answer keeps its finished items", () => {
    const text = '{"posts":[{"by":"bob","text":"first"},{"by":"cy","text":"second"},{"by":"dee","text":"thi';
    const p = parseBatch(text);
    expect(p.posts.map((x) => x.text)).toEqual(["first", "second"]);
    expect(previewBatch('{"posts":[{"by":"bo').posts).toEqual([]);
    expect(previewBatch("").posts).toEqual([]);
  });
  it("drops anything written as the persona", () => {
    const h = mergeBatch(h0(), {
      accounts: [{ handle: "ana", name: "Ana" }],
      posts: [{ by: "you", text: "x" }, { by: "Ana", text: "y" }, { by: "@ana", text: "z" }, { by: "bob", text: "ok" }],
      stories: [{ by: "ana", text: "s" }], dms: [{ from: "you", text: "d" }],
    }, { ...opts, anchor: A });
    expect(h.posts.map((p) => p.text)).toEqual(["ok"]);
    expect(h.stories).toEqual([]);
    expect(h.threads).toEqual({});
    expect(Object.keys(h.people)).toEqual(["npc:bob"]);
  });
  it("enforces caps: replies per post, posts, stories, text", () => {
    const replies = Array.from({ length: 20 }, (_, i) => ({ by: `u${i}x`, text: `r${i}` }));
    let h = mergeBatch(h0(), { posts: [{ id: "a", by: "bob", text: "x".repeat(400), replies }] }, { ...opts, anchor: A });
    expect(h.posts.filter((p) => p.kind === "reply")).toHaveLength(REPLIES_PER_POST);
    expect(h.posts.find((p) => p.kind === "post").text.length).toBe(TEXT_LIMITS.post);
    const many = { posts: Array.from({ length: 30 }, (_, i) => ({ by: `bob${i}`, text: `p${i}` })), stories: Array.from({ length: 30 }, (_, i) => ({ by: "bob", text: `s${i}` })) };
    for (let k = 0; k < 12; k++) h = mergeBatch(h, many, { ...opts, mode: "seed" });
    expect(h.posts.length).toBeLessThanOrEqual(POST_CAP);
    expect(h.stories.length).toBe(STORY_CAP);
  });
  it("seed anchors at the root and clamps model numbers", () => {
    const h = mergeBatch(h0(), { me: { fame: 3, followers: "9" }, accounts: [{ handle: "news", fame: 3, verified: true, role: "outlet" }], posts: [{ by: "news", text: "x", heat: 99, ago: "2h" }] }, { ...opts, mode: "seed" });
    expect(h.posts[0].anchor).toEqual(ROOT_ANCHOR);
    expect(h.posts[0].ago).toBe(120);
    expect(h.tick.seeded).toBe(true);
    expect(h.me.fame).toBe(3);
    expect(h.me.followers).toBe(300000);
    expect(h.people["npc:news"]).toMatchObject({ verified: true, role: "outlet", fame: 3 });
    expect(h.posts[0].pot.likes).toBeLessThanOrEqual(800000);
  });
  it("more appends, refresh prepends", () => {
    let h = mergeBatch(h0(), { posts: [{ by: "bob", text: "mid" }] }, { ...opts, anchor: A });
    h = mergeBatch(h, { posts: [{ by: "bob", text: "old" }] }, { ...opts, mode: "more", anchor: A });
    h = mergeBatch(h, { posts: [{ by: "bob", text: "new" }] }, { ...opts, anchor: A });
    expect(h.posts.map((p) => p.text)).toEqual(["new", "mid", "old"]);
  });
  it("events: viral lifts the ceiling, followers stay in the band", () => {
    let h = mergeBatch(h0(), { accounts: [{ handle: "bob", fame: 1 }], posts: [{ id: "a", by: "bob", text: "x" }] }, { ...opts, anchor: A });
    const id = h.posts[0].id;
    const before = h.posts[0].pot.likes;
    h = mergeBatch(h, { events: [{ post: id, what: "viral" }, { account: "bob", followers: "+999M" }] }, { ...opts, anchor: A });
    expect(h.posts[0].pot.likes).toBeGreaterThan(before);
    expect(h.people["npc:bob"].followers).toBe(30000);
  });
  it("clears tick.error on a merge", () => {
    const h = normalizeHandset({ ...h0(), tick: { n: 0, pending: false, seeded: false, error: { message: "x" } } });
    expect(mergeBatch(h, {}, { ...opts, anchor: A }).tick.error).toBeUndefined();
  });
});

describe("profiles", () => {
  const answer = J({ accounts: [
    { key: "you", fame: 2, job: "singer", looks: "red hair", other: { City: "Lisbon" }, from: { job: "stated", fame: "stated" } },
    { key: "char:mira", fame: 0, job: "barista", hobby: "painting", from: { job: "stated", hobby: "stated" } },
  ] });
  it("asks once per account, with the cards", () => {
    const req = profileRequest({ persona: { name: "Ana", description: "A famous singer." }, characters, story: "Lisbon, now." });
    expect(req.maxTokens).toBe(700);
    expect(req.user).toContain("[key: you]");
    expect(req.user).toContain("[key: char:mira]");
    expect(req.user).toContain("paints at night");
    expect(profileKeys(h0(), characters)).toEqual([YOU, "char:mira"]);
  });
  it("round trip with stated vs inferred", () => {
    const parsed = parseProfile(answer);
    const h = mergeProfile(h0(), parsed, { characters });
    expect(h.me.traits).toMatchObject({ fame: 2, job: "singer", looks: "red hair", city: "Lisbon" });
    expect(h.me.traitsFrom).toMatchObject({ fame: "stated", job: "stated", looks: "inferred", city: "inferred" });
    expect(h.people["char:mira"]).toMatchObject({ handle: "mira_sol", name: "Mira Sol", fame: 0 });
    expect(h.people["char:mira"].traitsFrom).toMatchObject({ job: "stated", hobby: "stated", fame: "inferred" });
    expect(profileKeys(h, characters)).toEqual([]);
  });
  it("a manual trait survives a new profile", () => {
    let h = setMe(h0(), { traits: { job: "dentist" }, fame: 1 });
    h = upsertPerson(h, "char:mira", { handle: "mira_sol", name: "Mira Sol", traits: { job: "pilot" }, traitsFrom: { job: "manual" } });
    h = mergeProfile(h, parseProfile(answer), { characters });
    expect(h.me.traits.job).toBe("dentist");
    expect(h.me.traits.fame).toBe(1);
    expect(h.me.traits.looks).toBe("red hair");
    expect(h.people["char:mira"].traits.job).toBe("pilot");
    expect(h.people["char:mira"].traits.hobby).toBe("painting");
  });
  it("runProfile goes through the injected requester", async () => {
    const requester = vi.fn(async () => ({ text: answer }));
    const out = await runProfile({ requester, persona: { name: "Ana" }, characters });
    expect(requester).toHaveBeenCalledTimes(1);
    expect(requester.mock.calls[0][0].maxTokens).toBe(700);
    expect(out.parsed.accounts).toHaveLength(2);
  });
});

describe("the request", () => {
  it("has the sections", () => {
    let h = mergeProfile(h0(), parseProfile(J({ accounts: [{ key: "you", fame: 1, job: "singer" }, { key: "char:mira", job: "barista" }] })), { characters });
    h = { ...h, world: { topics: ["the festival"] } };
    const req = phoneBatch({ mode: "refresh", handset: h, chat: { messages, scene: { text: "At the café." } }, persona: { name: "Ana", description: "Singer." }, characters, world: { story: "Lisbon.", log: [{ text: "A storm." }] } });
    for (const s of ["[Phone owner]", "[Profile]", "[Story]", "[People in the story]", "[Where the story stands]", "[Latest in the story]", "[Happening in the world]", "[Running in the feed]", "[On the phone]"]) expect(req.user).toContain(s);
    expect(req.user).toContain("job: singer (inferred)");
    expect(req.system).toContain("The world goes on regardless of the conversation");
  });
  it("latest story: 8 messages on Lively, 4 on Light", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, role: i % 2 ? "assistant" : "user", content: `line ${i}` }));
    const count = (level) => phoneBatch({ handset: h0(level), messages: many, persona: { name: "Ana" } }).user.split("[Latest in the story]\n")[1].split("\n\n")[0].split("\n").length;
    expect(count("lively")).toBe(8);
    expect(count("light")).toBe(4);
    expect(count("off")).toBe(4);
  });
  it("budgets per level and mode", () => {
    const max = (level, mode) => phoneBatch({ mode, handset: h0(level), persona: { name: "Ana" } }).maxTokens;
    expect([max("off", "seed"), max("off", "more"), max("off", "respond")]).toEqual([700, 600, 300]);
    expect([max("light", "seed"), max("light", "refresh"), max("light", "more"), max("light", "respond")]).toEqual([900, 500, 700, 400]);
    expect([max("lively", "seed"), max("lively", "refresh"), max("lively", "more"), max("lively", "respond")]).toEqual([1600, 900, 1200, 600]);
    expect(BUDGETS.off.refresh).toBeNull();
    expect(budgetOf("light", "seed")).toMatchObject({ posts: 6, stories: 3, dms: 2 });
  });
  it("[Owed] slots with a fixed seed, and the persona's actions", () => {
    let h = mergeBatch(h0(), { posts: [{ by: "Mira Sol", text: "new painting" }] }, { ...opts, anchor: A });
    const target = h.posts[0].id;
    h = addPost(h, { kind: "reply", ref: target, text: "Love it!" }, A);
    h = instant(addMessage(h, "char:mira", "See you tonight?", A), "char:mira");
    const slots = owedSlots({ handset: h, messages, characters, seed: "fixed" });
    expect(slots).toEqual(owedSlots({ handset: h, messages, characters, seed: "fixed" }));
    expect(slots[0]).toMatchObject({ id: "r1", kind: "dm", by: "char:mira", story: true, what: "answer", lines: ["See you tonight?"] });
    const req = phoneBatch({ mode: "respond", handset: h, messages, characters, persona: { name: "Ana" }, seed: "fixed" });
    expect(req.user).toContain("[Owed]\nr1: @mira_sol answers Ana's message: \"See you tonight?\" (dm)");
    expect(req.user).toContain("Each owed DM is one message; add \"end\":true when it closes the conversation.");
    expect(req.user).toContain("- messaged @mira_sol: See you tonight?");
    expect(req.user).toContain("[Ana did]");
    expect(req.user).toContain(`replied to #${target}`);
  });
  it("respond builds the DM context for a story character", () => {
    let h = h0("light");
    for (let i = 0; i < 12; i++) h = addMessage(h, "char:mira", `line ${i}`, A);
    h = instant(h, "char:mira");
    const req = phoneBatch({ mode: "respond", handset: h, messages, characters, persona: { name: "Ana" }, chat: { scene: { text: "Mira is at work." } } });
    expect(req.maxTokens).toBe(400);
    const part = req.user.split("[Texting Mira Sol (@mira_sol)]\n")[1];
    expect(part).toContain("paints at night");
    expect(part).toContain("line 11");
    expect(part).toContain("line 2");
    expect(part).not.toContain("line 1\n");
    expect(part).toContain("knows what they witnessed");
    expect(part).toContain("Thread state: Ana wrote last; answers come only through [Owed].");
    expect(part).toContain("They may end the conversation (mark \"end\":true) or send nothing.");
    expect(req.user).toContain("Mira is at work.");
    expect(req.user).toContain("Write only the owed items");
  });
  it("a DM slot answer is filled; a story character's missed answer is offered once more, then none comes", () => {
    const h = instant(addMessage(h0("light"), "char:mira", "hey", A), "char:mira");
    const owed = owedSlots({ handset: h, messages, characters });
    const answered = mergeBatch(h, { dms: [{ slot: "r1", text: "hey you" }], posts: [{ by: "bob", text: "ambient" }] }, { ...opts, mode: "respond", anchor: A, owed });
    expect(answered.threads["char:mira"].map((m) => m.text)).toEqual(["hey", "hey you"]);
    expect(answered.posts).toEqual([]);
    expect(answered.tick.pending).toBe(false);
    expect(answered.dmWait["char:mira"]).toBeUndefined();
    const missed = mergeBatch(h, {}, { ...opts, mode: "respond", anchor: A, owed });
    expect(missed.dmWait["char:mira"]).toMatchObject({ miss: 1, due: h.dmWait["char:mira"].due });
    const again = owedSlots({ handset: missed, messages, characters });
    expect(again[0]).toMatchObject({ kind: "dm", by: "char:mira", what: "answer" });
    const twice = mergeBatch(missed, {}, { ...opts, mode: "respond", anchor: A, owed: again });
    expect(twice.dmWait["char:mira"].due).toBeNull();
    expect(owedSlots({ handset: twice, messages, characters })).toEqual([]);
  });
});

describe("runPhoneBatch", () => {
  const good = J({ posts: [{ by: "bob", text: "hello" }] });
  it("passes max_tokens and previews the stream", async () => {
    const previews = [];
    const requester = vi.fn(async ({ onText }) => { onText('{"posts":[{"by":"bob","text":"hello"},'); return { text: good }; });
    const out = await runPhoneBatch({ mode: "seed", handset: h0("light"), persona: { name: "Ana" }, characters, requester, onPreview: (p) => previews.push(p), previewMs: 0 });
    expect(requester.mock.calls[0][0].maxTokens).toBe(900);
    expect(previews[0].posts[0].text).toBe("hello");
    expect(out.parsed.posts).toHaveLength(1);
    expect(out.retried).toBe(false);
  });
  it("seed retries once with a nudge, then fails", async () => {
    const requester = vi.fn().mockResolvedValueOnce({ text: "no json" }).mockResolvedValueOnce({ text: good });
    const ok = await runPhoneBatch({ mode: "seed", handset: h0(), persona: { name: "Ana" }, requester });
    expect(ok.retried).toBe(true);
    expect(requester.mock.calls[1][0].user).toContain("could not be used");
    const bad = vi.fn(async () => ({ text: '{"posts":[]}' }));
    const out = await runPhoneBatch({ mode: "more", handset: h0(), persona: { name: "Ana" }, requester: bad });
    expect(bad).toHaveBeenCalledTimes(2);
    expect(out.error).toMatchObject({ mode: "more" });
    expect(typeof out.error.message).toBe("string");
  });
  it("an empty refresh is fine", async () => {
    const requester = vi.fn(async () => "{}");
    const out = await runPhoneBatch({ mode: "refresh", handset: h0(), persona: { name: "Ana" }, requester });
    expect(requester).toHaveBeenCalledTimes(1);
    expect(out.error).toBeUndefined();
  });
});

describe("wealth, first counts, replies mode, payments", () => {
  it("the profile asks for wealth and records it like fame", () => {
    expect(profileRequest({ userName: "Ana", characters }).system).toMatch(/wealth \(0 modest, 1 comfortable, 2 wealthy, 3 very rich\)/);
    const parsed = parseProfile(J({ accounts: [{ key: "you", fame: 1, wealth: 2, job: "heir", from: { wealth: "stated" } }, { key: "char:mira", wealth: "1" }] }));
    expect(parsed.accounts[0].traits).toMatchObject({ fame: 1, wealth: 2 });
    expect(parsed.accounts[1].traits).toEqual({ wealth: 1 });
    const h = mergeProfile(h0(), parsed, { characters });
    expect(h.me.traits.wealth).toBe(2);
    expect(h.me.traitsFrom.wealth).toBe("stated");
    expect(h.people["char:mira"].traits).toMatchObject({ fame: 0, wealth: 1 });
    expect(h.bank.balance).toBeGreaterThanOrEqual(4000);
  });
  it("first batch posts show non-zero counts for a pot above 3, at their birth age", async () => {
    const { statsOf } = await import("../src/lib/phoneStats.js");
    const { ageUnits } = await import("../src/lib/phoneClock.js");
    const posts = Array.from({ length: 8 }, (_, i) => ({ by: `acct${i}`, text: `post ${i}`, heat: 2 }));
    const h = mergeBatch(h0(), { accounts: posts.map((p) => ({ handle: p.by, fame: 2 })), posts }, { ...opts, mode: "seed" });
    expect(h.posts.length).toBe(8);
    for (const p of h.posts) {
      for (const k of ["likes", "reposts", "replies", "quotes"]) if (p.pot[k] > 3) expect(p.stats[k]).toBeGreaterThan(0);
      expect(p.t0).toBeCloseTo(ageUnits(p, h, messages), 9);
      expect(statsOf(p, p.t0)).toEqual(p.stats);
    }
  });
  it("seed and refresh ask for replies under the top posts", () => {
    expect(phoneBatch({ mode: "seed", handset: h0("lively"), ...opts }).user).toMatch(/top 3 posts write up to 5 replies/);
    expect(phoneBatch({ mode: "seed", handset: h0("light"), ...opts }).user).toMatch(/top 2 posts write up to 3 replies/);
    expect(phoneBatch({ mode: "refresh", handset: h0("lively"), ...opts }).user).toMatch(/top 3 posts write up to 5 replies/);
  });
  const withPost = (level) => mergeBatch(h0(level), { posts: [{ by: "bob", text: "root post" }] }, { ...opts, mode: "seed" });
  it("replies mode: budget, one post only, merged with its ref under the cap", () => {
    const h = withPost("light");
    const id = h.posts[0].id;
    const req = phoneBatch({ mode: "replies", post: id, handset: h, ...opts });
    expect(req).toMatchObject({ mode: "replies", maxTokens: 400, post: id });
    expect(req.user).toContain(`#${id}`);
    expect(phoneBatch({ mode: "replies", post: id, handset: withPost("lively"), ...opts }).maxTokens).toBe(600);
    const many = Array.from({ length: 20 }, (_, i) => ({ by: `fan${i}`, text: `reply ${i}`, replyTo: "whatever" }));
    let out = mergeBatch(h, { posts: many, stories: [{ by: "x", text: "s" }], dms: [{ from: "x", text: "d" }] }, { ...opts, mode: "replies", anchor: A, post: id });
    const kids = out.posts.filter((p) => p.kind === "reply");
    expect(kids.length).toBe(6); /* twice Light's 3 at most */
    expect(kids.every((p) => p.ref === id)).toBe(true);
    expect(out.stories).toEqual([]);
    expect(out.threads).toEqual({});
    expect(out.posts.find((p) => p.id === id).stats.replies).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 3; i++) out = mergeBatch(out, { posts: many.map((x) => ({ ...x, text: `${x.text} ${i}` })) }, { ...opts, mode: "replies", anchor: A, post: id });
    expect(out.posts.filter((p) => p.kind === "reply" && p.ref === id)).toHaveLength(REPLIES_PER_POST);
    expect(mergeBatch(h, { posts: many }, { ...opts, mode: "replies", anchor: A, post: "nope" })).toEqual(h);
  });
  it("payments move the persona's bank and nothing else", () => {
    const h = h0("light");
    const bal = h.bank.balance;
    const out = mergeBatch(h, { payments: [
      { from: "Harbour Co.", to: "you", amount: 120, note: "wages" },
      { from: "you", to: "Landlord", amount: 50, note: "rent" },
      { from: "bob", to: "cy", amount: 5 },
      { from: "you", to: "Bank", amount: bal * 10, note: "too much" },
    ] }, { ...opts, mode: "refresh", anchor: A, now: 7 });
    expect(out.bank.balance).toBe(bal + 120 - 50);
    expect(out.bank.tx.map((x) => [x.kind, x.amount, x.note, x.world])).toEqual([["sent", 50, "rent", true], ["received", 120, "wages", true]]);
    expect(out.bank.tx[1]).toMatchObject({ from: "", fromName: "Harbour Co.", t: 7 });
    expect(out.people["npc:harbour_co"]).toBeUndefined();
    expect(out.tick.pending).toBe(false);
  });
  it("a transfer to a story character owes their reaction", async () => {
    const { transfer } = await import("../src/lib/phone.js");
    const h = transfer(h0("light"), { to: "char:mira", toName: "Mira", amount: 20 });
    const slots = owedSlots({ handset: h, messages, characters });
    expect(slots).toEqual([expect.objectContaining({ kind: "transfer", by: "char:mira", amount: 20, story: true })]);
    const user = phoneBatch({ mode: "respond", handset: h, ...opts }).user;
    expect(user).toMatch(/reacts to the 20 Ana sent them/);
    expect(user).toContain("[Money]\nAna sent 20 to Mira Sol.\nReact to the amount in character: thanks, surprise, guilt, suspicion or refusal");
    /* the answer fills the slot as a DM */
    const out = mergeBatch(h, { dms: [{ from: "mira_sol", text: "You didn't have to!" }] }, { ...opts, mode: "respond", anchor: A, owed: slots });
    expect(out.threads["char:mira"].map((m) => m.text)).toEqual(["You didn't have to!"]);
    /* another account follows the DM chance, as a plain dm slot */
    const bo = transfer(normalizeHandset({ ...h0("light"), people: { "npc:bo": { key: "npc:bo", handle: "bo", name: "Bo" } } }), { to: "npc:bo", amount: 5 });
    for (const s of owedSlots({ handset: bo, messages, characters })) expect(s).toMatchObject({ kind: "dm", what: "transfer", story: false });
  });
});

describe("payments: source, category, anchor, level", () => {
  const pay = { payments: [
    { from: "Studio", to: "you", amount: "1,200", note: "June", category: "wage" },
    { from: "you", to: "mira_sol", amount: 300, note: "rent share", category: "nonsense" },
    { from: "you", to: "Shop", amount: 2, note: "gum" },
    { from: "Gran", to: "you", amount: 20, category: "gift" },
  ] };
  it("records source and category, keeps the anchor, caps at 3 a batch", () => {
    let h = setMe(h0("light"), { traits: { wealth: 1 } });
    h = normalizeHandset({ ...h, people: { "char:mira": { key: "char:mira", handle: "mira_sol", name: "Mira Sol" } } });
    const out = mergeBatch(h, pay, { ...opts, mode: "refresh", anchor: A });
    expect(out.bank.tx).toHaveLength(3);
    const [gum, rent, wage] = out.bank.tx;
    expect(wage).toMatchObject({ kind: "received", source: "", fromName: "Studio", amount: 1200, category: "wage", world: true, anchor: A });
    expect(rent).toMatchObject({ kind: "sent", source: "you", to: "char:mira", toName: "Mira Sol", amount: 300, category: "other", anchor: A });
    expect(gum).toMatchObject({ kind: "sent", to: "", toName: "Shop", category: "other" });
    expect(normalizeHandset(out)).toEqual(out);
  });
  it("no automatic payments on Off; a sent one needs the balance", () => {
    expect(mergeBatch(h0("off"), pay, { ...opts, mode: "refresh", anchor: A }).bank.tx).toEqual([]);
    const h = h0("light");
    const out = mergeBatch(h, { payments: [{ from: "you", to: "Landlord", amount: h.bank.balance + 1 }] }, { ...opts, mode: "refresh", anchor: A });
    expect(out.bank).toMatchObject({ balance: h.bank.balance, tx: [] });
  });
  it("paymentsOf lists one story character's lines, newest first; phoneNote tells the story", async () => {
    const { paymentsOf, receive, transfer, phoneNote } = await import("../src/lib/phone.js");
    let h = h0("light");
    h = transfer(h, { to: "char:mira", toName: "Mira", amount: 30, note: "dinner", anchor: A });
    h = receive(h, { fromName: "Studio", amount: 1200, category: "wage", world: true, anchor: A });
    h = receive(h, { from: "char:mira", fromName: "Mira", amount: 10, note: "change", anchor: A });
    expect(paymentsOf(h, { character: "char:mira" }).map((x) => x.amount)).toEqual([10, 30]);
    expect(paymentsOf(h, {})).toEqual([]);
    const note = phoneNote({ handset: h, messages }, { userName: "Ana", nameOf: (k) => (k === "char:mira" ? "Mira" : k) });
    expect(note).toContain("Money: Ana received 10 from Mira (change); Ana received 1,200 from Studio (wage); Ana sent 30 to Mira (dinner).");
    /* a swiped-away anchor takes its line out */
    expect(phoneNote({ handset: h, messages: messages.slice(0, 1) }, { userName: "Ana" })).not.toContain("Money:");
  });
});

describe("first view, official accounts, setup, streaming", () => {
  const greeting = [{ id: "g", role: "assistant", content: "Hello." }];
  const seedOf = () => mergeBatch(h0("lively"), {
    accounts: [{ handle: "bundesliga", name: "Bundesliga", role: "league", verified: true }, { handle: "kicker", name: "kicker", role: "outlet" }, { handle: "tom", fame: 1 }],
    posts: [
      { by: "bundesliga", text: "Matchday 12 is here.", replies: [{ by: "fan1", text: "Finally" }, { by: "fan2", text: "Come on!" }] },
      { by: "kicker", text: "Team news.", ago: "2h" },
      { by: "tom", text: "Coffee.", ago: "15m", replies: [{ by: "lena", text: "Same" }] },
      { by: "lena", text: "Rain again." },
    ],
  }, { mode: "seed", messages: greeting, userName: "Ana" });

  it("the first render shows the stored share of the pot; reply counts never below the stored", async () => {
    const { statsOf } = await import("../src/lib/phoneStats.js");
    const { ageUnits } = await import("../src/lib/phoneClock.js");
    const { repliesTo } = await import("../src/lib/phone.js");
    const h = seedOf();
    for (const p of h.posts) {
      const shown = statsOf(p, ageUnits(p, h, greeting));
      expect(shown).toEqual(p.stats);
      expect(shown.replies).toBeGreaterThanOrEqual(repliesTo(h, p.id).length);
      if (p.pot.likes > 3) expect(shown.likes).toBeGreaterThanOrEqual(Math.round(p.pot.likes * 0.3));
    }
    const league = h.posts.find((p) => p.by === "npc:bundesliga");
    expect(h.people["npc:bundesliga"].fame).toBe(3);
    expect(h.people["npc:kicker"].fame).toBe(2);
    expect(league.pot.likes).toBeGreaterThanOrEqual(2000);
    expect(league.stats.likes).toBeGreaterThanOrEqual(700);
    expect(league.stats.reposts).toBeGreaterThan(0);
    expect(league.stats.replies).toBeGreaterThanOrEqual(2);
    expect(league.pot.replies).toBeGreaterThan(2);
    expect(h.posts.find((p) => p.by === "npc:kicker").pot.likes).toBeGreaterThanOrEqual(100);
    /* the story moving on lifts likes and replies toward the pot */
    const later = [...greeting, { id: "u", role: "user", content: "x" }, { id: "r", role: "assistant", content: "y" }];
    const grown = statsOf(league, ageUnits(league, h, later));
    expect(grown.likes).toBeGreaterThan(league.stats.likes);
    expect(grown.replies).toBeGreaterThanOrEqual(league.stats.replies);
    expect(grown.replies).toBeLessThanOrEqual(league.pot.replies);
  });

  it("official accounts default to fame 2 or 3 unless a profile says otherwise", async () => {
    const { officialTier } = await import("../src/lib/phone.js");
    expect(officialTier({ handle: "bundesliga", name: "Bundesliga" })).toBe(3);
    expect(officialTier({ role: "outlet", name: "Harbour Gazette" })).toBe(2);
    expect(officialTier({ role: "outlet", name: "National Herald" })).toBe(3);
    expect(officialTier({ role: "club", name: "FC Lisboa" })).toBe(2);
    expect(officialTier({ verified: true, name: "Some Singer" })).toBe(2);
    expect(officialTier({ role: "fan", name: "Bea" })).toBe(0);
    expect(officialTier({ name: "World Wanderer", handle: "world_wanderer" })).toBe(0);
    const stored = normalizeHandset({ ...h0(), people: {
      "npc:gazette": { key: "npc:gazette", handle: "gazette", name: "Gazette", role: "outlet", fame: 0 },
      "npc:club": { key: "npc:club", handle: "club", name: "Club", role: "club", traits: { fame: 1 }, traitsFrom: { fame: "manual" } },
    } });
    expect(stored.people["npc:gazette"].fame).toBe(2);
    expect(stored.people["npc:club"].fame).toBe(1);
    expect(normalizeHandset(stored)).toEqual(stored);
  });

  it("setup reads the chat's memory, adds to what is there, and dates posts from now", async () => {
    const { ageUnits, phoneNow } = await import("../src/lib/phoneClock.js");
    const long = [...greeting];
    for (let i = 0; i < 20; i++) long.push({ id: `u${i}`, role: "user", content: `u${i}` }, { id: `r${i}`, role: "assistant", content: `r${i}` });
    const chat = { messages: long, memory: { summary: "Ana and Mira found the hidden key." }, scene: { text: "At the harbour, night." } };
    const old = seedOf();
    const req = phoneBatch({ mode: "setup", handset: old, chat, ...opts, messages: long });
    expect(req.maxTokens).toBe(BUDGETS.lively.seed.maxTokens);
    expect(req.user).toContain("[Story so far]\nAna and Mira found the hidden key.");
    expect(req.user).toContain("[Where the story stands]\nAt the harbour, night.");
    expect(req.user).toMatch(/just switched on in a story already under way/);
    const out = mergeBatch(old, { posts: [{ by: "tom", text: "Heard about the key?", ago: "30m" }] }, { mode: "setup", messages: long, userName: "Ana" });
    expect(out.posts).toHaveLength(old.posts.length + 1);
    const p = out.posts[0];
    expect(p.anchor).toEqual(ROOT_ANCHOR);
    /* 21 replies of 5 minutes: now is 105; it went up 30 minutes before */
    expect(phoneNow(out, long)).toBe(105);
    expect(p.at).toBe(75);
    expect(ageUnits(p, out, long)).toBe(1);
    expect(normalizeHandset(out)).toEqual(out);
  });

  it("streams each finished item, top to bottom, and merges once", async () => {
    const { streamPreview } = await import("../src/lib/phoneBatch.js");
    const full = J({ posts: [{ by: "a1", text: "one", replies: [{ by: "b", text: "r" }] }, { by: "a2", text: "two" }, { by: "a3", text: "three" }], dms: [{ from: "x", text: "hi" }] });
    const push = streamPreview();
    const seen = [];
    for (let i = 1; i <= full.length; i++) { const p = push(full.slice(0, i)); if (p) seen.push([p.posts.map((x) => x.text), p.dms.length]); }
    expect(seen).toEqual([[["one"], 0], [["one", "two"], 0], [["one", "two", "three"], 0], [["one", "two", "three"], 1]]);
    /* a post still being written never shows */
    expect(streamPreview()('{"posts":[{"by":"a1","text":"one"},{"by":"a2","text":"tw')).toMatchObject({ posts: [{ text: "one" }] });
    const chunks = [];
    for (let i = 20; i < full.length; i += 20) chunks.push(full.slice(0, i));
    const previews = [];
    const requester = vi.fn(async ({ onText }) => { for (const c of chunks) onText(c); return { text: full }; });
    const res = await runPhoneBatch({ mode: "seed", handset: h0(), ...opts, requester, onPreview: (p) => previews.push(p.posts.length) });
    expect(previews.slice(0, 3)).toEqual([1, 2, 3]);
    expect(res.parsed.posts).toHaveLength(3);
  });
});

describe("stories, notifications, DM etiquette, waiting reactions", () => {
  const ph = async () => await import("../src/lib/phone.js");
  const seeded = (level = "light", fame = 0) => {
    let h = mergeBatch(h0(level), {
      accounts: [{ handle: "star", name: "Star", fame: 3, verified: true }],
      stories: [{ id: "s1", by: "star", text: "Backstage!", replies: [{ by: "fan1", text: "wow" }, { by: "fan2", text: "omg" }] }],
      posts: [{ by: "gossip", text: "Did you see her story?", story: "s1" }, { by: "fan3", text: "Nice", replyTo: "s1" }],
    }, { ...opts, mode: "seed" });
    if (fame) h = setMe(h, { fame });
    return h;
  };

  it("an account's story gets likes by fame and comments as replies; posts can be about a story", async () => {
    const { storyReactions } = await ph();
    const h = seeded();
    const st = h.stories[0];
    expect(st.stats.likes).toBeGreaterThanOrEqual(700); /* a star: 35% of at least 2,000 */
    expect(st.stats.replies).toBe(3);
    const r = storyReactions(h, st.id);
    expect(r.replies.map((p) => p.text).sort()).toEqual(["Nice", "omg", "wow"]);
    expect(r.replies.every((p) => p.kind === "reply" && p.ref === st.id)).toBe(true);
    expect(r.seen).toBe(false);
    expect(h.posts.find((p) => p.text === "Did you see her story?")).toMatchObject({ kind: "post", ref: st.id });
    expect(normalizeHandset(h)).toEqual(h);
  });

  it("the persona's story and post start at zero; the refresh brings reactions gated by fame", async () => {
    const { addStory, toggleStoryLike, markSeen, storyReactions } = await ph();
    const run = (fame) => {
      let h = setMe(seeded("lively"), { fame, followers: fame >= 3 ? 2e6 : 40 });
      h = addStory(h, { text: "On stage tonight" }, A);
      // Measure the story audience before the post takes a share of the batch budget.
      const audience = owedSlots({ handset: h, messages, characters: [] }).filter(s => s.kind === "story-reply").length;
      h = addPost(h, { text: "Thanks all" }, A);
      const mine = h.stories[0];
      expect(mine.stats).toEqual({ likes: 0, replies: 0 });
      expect(h.posts[0].stats.likes).toBe(0);
      const slots = owedSlots({ handset: h, messages, characters });
      const out = mergeBatch(h, { posts: slots.filter((s) => s.kind === "story-reply").map((s) => ({ by: s.by ? "mira_sol" : "someone", text: `c ${s.id}`, slot: s.id })) }, { ...opts, mode: "refresh", anchor: A, owed: slots });
      return { slots, out, mine, audience };
    };
    const star = run(3);
    const low = run(0);
    expect(star.audience).toBeGreaterThan(low.audience);
    const starStory = star.out.stories.find((x) => x.id === star.mine.id);
    const lowStory = low.out.stories.find((x) => x.id === low.mine.id);
    expect(starStory.stats.likes).toBeGreaterThan(lowStory.stats.likes);
    expect(starStory.stats.likes).toBeGreaterThan(100);
    expect(starStory.stats.replies).toBeGreaterThan(0);
    expect(star.out.posts.find((p) => p.text === "Thanks all").stats.likes).toBeGreaterThan(0);
    /* the persona likes someone's story, and seen.stories drives the ring */
    const s0 = seeded();
    let h = toggleStoryLike(s0, s0.stories[0].id);
    expect(h.stories[0]).toMatchObject({ liked: true });
    expect(storyReactions(markSeen(h, { story: h.stories[0].id }), h.stories[0].id).seen).toBe(true);
  });

  it("the persona comments on a story; its author may answer", async () => {
    const { storyReactions } = await ph();
    let h = seeded();
    h = addPost(h, { kind: "reply", ref: h.stories[0].id, text: "Love this" }, A);
    expect(h.posts[0]).toMatchObject({ kind: "reply", ref: h.stories[0].id, by: YOU });
    expect(storyReactions(h, h.stories[0].id).replies[0].text).toBe("Love this");
    expect(h.stories[0].stats.replies).toBe(4);
  });

  it("notifications are only DMs, money in and mentions, whatever the persona's fame", async () => {
    const { notificationsOf, receive, unread: unreadOf } = await ph();
    const build = (fame) => {
      let h = setMe(h0("light"), { fame });
      h = addPost(h, { text: "Mine" }, A);
      h = mergeBatch(h, { posts: [{ by: "bob", text: "on yours", replyTo: h.posts[0].id }, { by: "cy", text: "hey @ana look" }, { by: "cy", text: "Ana is great" }], dms: [{ from: "dee", text: "hi" }] }, { ...opts, mode: "refresh", anchor: A, answered: [h.posts[0].id] });
      h = receive(h, { fromName: "Studio", amount: 50 });
      return h;
    };
    const kinds = (list) => [...new Set(list.map((x) => x.kind))].sort();
    for (const fame of [0, 3]) {
      const list = notificationsOf(build(fame), { userName: "Ana" });
      expect(kinds(list)).toEqual(["comment", "mention", "request", "transfer"]);
      for (const x of list) expect(["dm", "request", "transfer", "comment", "quote", "mention"]).toContain(x.kind);
      /* a plain name is not a mention */
      expect(list.filter((x) => x.kind === "mention")).toHaveLength(1);
    }
    /* new feed posts and likes notify nothing and light no badge */
    let quiet = mergeBatch(h0("light"), { posts: [{ by: "cy", text: "just a post" }] }, { ...opts, mode: "refresh", anchor: A });
    quiet = toggleLike(quiet, quiet.posts[0].id);
    expect(notificationsOf(quiet, { userName: "Ana" })).toEqual([]);
    expect(unreadOf(quiet, messages, { userName: "Ana" }).total).toBe(0);
    expect(unreadOf(build(3), messages, { userName: "Ana" })).toMatchObject({ mentions: 2, messages: 1, bank: 1, total: 4 });
  });

  it("DM etiquette: nobody writes twice unanswered", async () => {
    const { threadStreak } = await ph();
    let h = normalizeHandset({ ...h0("light"), people: { "npc:fan": { key: "npc:fan", handle: "fan", name: "Fan", role: "fan" } } });
    h = mergeBatch(h, { dms: [{ from: "mira_sol", text: "You there?" }, { from: "fan", text: "Big fan!" }] }, { ...opts, mode: "refresh", anchor: A });
    expect(threadStreak(h, "char:mira")).toMatchObject({ theirs: 1, mine: 0, read: false });
    /* a second line while unanswered is dropped */
    const again = mergeBatch(h, { dms: [{ from: "mira_sol", text: "Hello??" }, { from: "fan", text: "Hi again" }] }, { ...opts, mode: "refresh", anchor: A });
    expect(again.threads["char:mira"].map((m) => m.text)).toEqual(["You there?"]);
    expect(again.threads["npc:fan"].map((m) => m.text)).toEqual(["Big fan!"]);
    /* and even half a day later: they wait on Ana */
    const later = mergeBatch(h, { dms: [{ from: "mira_sol", text: "Hello??" }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 2000 });
    expect(later.threads["char:mira"].map((m) => m.text)).toEqual(["You there?"]);
  });

  describe("left on read", () => {
    const away = [{ ...characters[0], present: false }];
    const fan = { key: "npc:fan", handle: "fan", name: "Fan", role: "fan" };
    /* a line id whose one roll lets a story character react */
    let id = null;
    for (let i = 0; !id; i++) if (rng(`l${i}:read`)() < 0.2) id = `l${i}`;
    const asked = (text = "You there?", extra = {}) => normalizeHandset({
      ...h0("light"), tick: { n: 3, lastMsgId: null, pending: false, seeded: true }, people: { "npc:fan": fan },
      threads: {
        "char:mira": [{ id, from: "char:mira", text, tick: 1, anchor: A, at: 100, ...extra }],
        "npc:fan": [{ id: `${id}f`, from: "npc:fan", text: "Big fan, you there?", tick: 1, anchor: A, at: 100 }],
      },
      seen: { feed: 0, stories: [], messages: { "char:mira": 1, "npc:fan": 1 }, bank: 0 },
    });
    const lor = (h, clockNow, chars = away, seed) => owedSlots({ handset: h, messages, characters: chars, clockNow, seed }).filter((s) => s.what === "left-on-read");

    it("a close person's read, unanswered question earns one nudge some hours later, the same for every seed", () => {
      const h = asked();
      expect(lor(h, 100 + 470)).toEqual([]);
      const slots = lor(h, 100 + 1440);
      expect(slots).toEqual([expect.objectContaining({ kind: "dm", by: "char:mira", what: "left-on-read", askedAt: 100, ask: "You there?", line: id })]);
      expect(slots[0].dueAt).toBeGreaterThanOrEqual(100 + 480);
      expect(lor(h, slots[0].dueAt - 1)).toEqual([]);
      for (let seed = 0; seed < 20; seed++) expect(lor(h, 100 + 1440, away, seed)).toEqual(slots);
      const req = phoneBatch({ mode: "refresh", handset: h, messages, characters: away, persona: { name: "Ana" }, clockNow: 100 + 1440 });
      expect(req.user).toMatch(/r1: @mira_sol asked Ana "You there\?" 1 day ago; Ana read it and never answered\. One message in character .*or nothing \("text":""\) \(dm\)/);
    });

    it("no nudge for a line that asks nothing or ended it, from a fan, or from someone in the scene", () => {
      expect(lor(asked("See you then."), 5000)).toEqual([]);
      expect(lor(asked("You there?", { end: true }), 5000)).toEqual([]);
      expect(lor(asked(), 5000, characters)).toEqual([]);
      for (let seed = 0; seed < 20; seed++) expect(owedSlots({ handset: asked(), messages, characters: away, clockNow: 5000, seed }).some((s) => s.by === "npc:fan")).toBe(false);
    });

    it("at most once: written or not, it is never owed again", () => {
      const h = asked();
      const owed = lor(h, 5000);
      const skipped = mergeBatch(h, {}, { ...opts, characters: away, mode: "refresh", anchor: A, owed, clockNow: 5000 });
      expect(skipped.threads["char:mira"].at(-1).end).toBe(true);
      expect(lor(markSeen(skipped, { thread: "char:mira" }), 9000)).toEqual([]);
      const empty = mergeBatch(h, { dms: [{ slot: "r1", text: "" }] }, { ...opts, characters: away, mode: "refresh", anchor: A, owed, clockNow: 5000 });
      expect(empty.threads["char:mira"]).toHaveLength(1);
      expect(lor(empty, 9000)).toEqual([]);
      const wrote = mergeBatch(h, { dms: [{ slot: "r1", text: "Wow, ok." }] }, { ...opts, characters: away, mode: "refresh", anchor: A, owed, clockNow: 5000 });
      expect(wrote.threads["char:mira"].map((m) => m.text)).toEqual(["You there?", "Wow, ok."]);
      expect(lor(markSeen(wrote, { thread: "char:mira" }), 9000)).toEqual([]);
      /* the persona writes again: their answer comes when it is due */
      const back = instant(addMessage(wrote, "char:mira", "Sorry, busy", A, { at: 5100 }), "char:mira");
      expect(owedSlots({ handset: back, messages, characters: away, clockNow: 5100 })).toEqual([expect.objectContaining({ kind: "dm", by: "char:mira", what: "answer" })]);
    });
  });

  describe("DM answers on the phone's clock", () => {
    const zed = { "npc:zed": { key: "npc:zed", handle: "zed", name: "Zed", role: "friend" } };
    const sent = (text = "hi", key = "npc:zed") => {
      const h = addMessage(normalizeHandset({ ...h0("light"), people: zed }), key, text, A, { at: 100 });
      return { ...h, dmWait: { ...h.dmWait, [key]: { ...h.dmWait[key], due: 400, seen: 300 } } };
    };
    const answer = (h, clockNow) => owedSlots({ handset: h, messages, characters, clockNow }).filter((s) => s.what === "answer");

    it("owed only once the clock reaches the minute decided at send", () => {
      const h = sent();
      expect(answer(h, 399)).toEqual([]);
      expect(answer(h, 400)).toEqual([expect.objectContaining({ kind: "dm", by: "npc:zed", what: "answer", dueAt: 400, sentAt: 100, lines: ["hi"], story: false })]);
      /* a time skip owes them too, with how late they are */
      const req = phoneBatch({ mode: "world", handset: h, messages, characters, persona: { name: "Ana" }, clockNow: 500 });
      expect(req.owed).toEqual([expect.objectContaining({ what: "answer", by: "npc:zed" })]);
      expect(req.user).toContain(`answers Ana's message: "hi" (dm; they read and answer it 5 hours after it was sent, and the answer can show that)`);
      expect(req.user).toContain("and the owed items in [Owed]");
    });

    it("the answer is dated at its minute (never before the last line) and ends the wait", () => {
      const h = sent();
      const owed = answer(h, 500);
      const out = mergeBatch(h, { dms: [{ slot: "r1", text: "hey!" }] }, { ...opts, mode: "refresh", anchor: A, owed, clockNow: 500 });
      expect(out.threads["npc:zed"].at(-1)).toMatchObject({ from: "npc:zed", text: "hey!", at: 400 });
      expect(out.dmWait["npc:zed"]).toBeUndefined();
      const two = addMessage(h, "npc:zed", "you around?", A, { at: 450 });
      expect(two.dmWait["npc:zed"]).toEqual(h.dmWait["npc:zed"]);
      const out2 = mergeBatch(two, { dms: [{ slot: "r1", text: "yes" }] }, { ...opts, mode: "refresh", anchor: A, owed: answer(two, 500), clockNow: 500 });
      expect(out2.threads["npc:zed"].at(-1).at).toBe(450);
      expect(answer(two, 500)[0].lines).toEqual(["hi", "you around?"]);
    });

    it("an empty answer or a missed one (not a story character) means none comes", () => {
      const h = sent();
      const owed = answer(h, 500);
      const empty = mergeBatch(h, { dms: [{ slot: "r1", text: "" }] }, { ...opts, mode: "refresh", anchor: A, owed, clockNow: 500 });
      expect(empty.threads["npc:zed"]).toHaveLength(1);
      expect(empty.dmWait["npc:zed"].due).toBeNull();
      const missed = mergeBatch(h, {}, { ...opts, mode: "refresh", anchor: A, owed, clockNow: 500 });
      expect(missed.dmWait["npc:zed"].due).toBeNull();
      expect(answer(missed, 9000)).toEqual([]);
    });

    it("a closer ends it: the answer may be a sign-off or nothing, and the line is marked as the end", () => {
      const h = sent("ok good night!");
      const owed = answer(h, 500);
      expect(owed[0].closer).toBe(true);
      const req = phoneBatch({ mode: "refresh", handset: h, messages, characters, persona: { name: "Ana" }, clockNow: 500 });
      expect(req.user).toContain(`Ana's line closed the conversation: a short sign-off or a reaction, or nothing ("text":"")`);
      const out = mergeBatch(h, { dms: [{ slot: "r1", text: "night x", end: true }] }, { ...opts, mode: "refresh", anchor: A, owed, clockNow: 500 });
      expect(out.threads["npc:zed"].at(-1).end).toBe(true);
      expect(parseBatch(J({ dms: [{ from: "zed", text: "bye", end: "true" }] })).dms[0].end).toBe(true);
    });
  });

  describe("closed conversations", () => {
    const line = (id, from, text, at, extra = {}) => ({ id, from, text, tick: 1, anchor: A, at, ...extra });
    const base = (threads) => normalizeHandset({ ...h0("light"), tick: { n: 2, lastMsgId: null, pending: false, seeded: true }, people: { "cast:x": { key: "cast:x", handle: "xan", name: "Xan" } }, threads });
    const ended = () => base({
      "char:mira": [line("a1", YOU, "see you!", 50), line("a2", "char:mira", "night!", 100, { end: true })],
      "cast:x": [line("b1", YOU, "thanks", 50), line("b2", "cast:x", "👍", 100)],
    });

    it("reopens one closed thread a refresh, six hours or more after it ended", () => {
      const dms = [{ from: "mira_sol", text: "Morning! Coffee?" }, { from: "xan", text: "Did you see the news?" }];
      const soon = mergeBatch(ended(), { dms }, { ...opts, mode: "refresh", anchor: A, clockNow: 300 });
      expect(soon.threads["char:mira"]).toHaveLength(2);
      expect(soon.threads["cast:x"]).toHaveLength(2);
      const out = mergeBatch(ended(), { dms }, { ...opts, mode: "refresh", anchor: A, clockNow: 600 });
      expect(out.threads["char:mira"].map((m) => m.text)).toEqual(["see you!", "night!", "Morning! Coffee?"]);
      expect(out.threads["cast:x"]).toHaveLength(2);
      /* respond never reopens one */
      const respond = mergeBatch(ended(), { dms }, { ...opts, mode: "respond", anchor: A, clockNow: 600 });
      expect(respond.threads["char:mira"]).toHaveLength(2);
    });

    it("a thread waiting on the owner is never written into", () => {
      const h = base({ "char:mira": [line("a1", YOU, "hey", 50), line("a2", "char:mira", "Where are you?", 100)] });
      const out = mergeBatch(h, { dms: [{ from: "mira_sol", text: "Hello??" }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 2000 });
      expect(out.threads["char:mira"]).toHaveLength(2);
    });

    it("the prompt says which threads are over, and why nobody writes again", () => {
      const req = phoneBatch({ mode: "refresh", handset: ended(), messages, characters, persona: { name: "Ana" }, clockNow: 600 });
      expect(req.user).toContain("Messages with @mira_sol (over, ended 8 hours ago; nobody writes here without a new reason):");
      expect(req.user).toContain("  @mira_sol (8h ago): night!");
      expect(req.system).toContain("DMs are conversations that end");
      expect(req.system).toContain('"end":false');
      expect(req.user).toContain("a closed one is reopened only for a real new reason, at most one.");
      const waiting = base({ "char:mira": [line("a2", "char:mira", "Where are you?", 590)] });
      expect(phoneBatch({ mode: "refresh", handset: waiting, messages, characters, persona: { name: "Ana" }, clockNow: 600 }).user).toContain("Messages with @mira_sol (waiting on Ana; they do not write again):");
    });
  });
});

describe("story likes", () => {
  it("a seed batch's stories show likes from their author's fame; refreshes add more; old stories get theirs", async () => {
    const { storyReactions, addStory } = await import("../src/lib/phone.js");
    const h = mergeBatch(h0("lively"), {
      accounts: [{ handle: "pop_star", fame: 3 }, { handle: "anchor", role: "outlet", name: "City News" }, { handle: "neighbour", fame: 0 }],
      stories: [{ by: "pop_star", text: "Tour!" }, { by: "anchor", text: "Live now" }, { by: "neighbour", photo: "a cat" }],
    }, { ...opts, mode: "seed" });
    const by = (k) => h.stories.find((x) => x.by === k);
    for (const k of ["npc:pop_star", "npc:anchor"]) {
      const r = storyReactions(h, by(k).id);
      expect(r.likes).toBeGreaterThan(0);
      expect(r.pot).toBeGreaterThanOrEqual(r.likes);
    }
    expect(storyReactions(h, by("npc:pop_star").id).likes).toBeGreaterThanOrEqual(700);
    expect(storyReactions(h, by("npc:anchor").id).likes).toBeGreaterThanOrEqual(35);
    /* a refresh moves them toward their ceiling */
    const later = mergeBatch(h, {}, { ...opts, mode: "refresh", anchor: A });
    expect(later.stories.find((x) => x.by === "npc:pop_star").stats.likes).toBeGreaterThan(by("npc:pop_star").stats.likes);
    /* a stored story from before counts is given its likes on load */
    const old = normalizeHandset({ ...h, stories: h.stories.map(({ stats, pot, ...rest }) => rest) });
    expect(old.stories.find((x) => x.by === "npc:pop_star").stats.likes).toBeGreaterThan(0);
    expect(normalizeHandset(old)).toEqual(old);
    /* the persona's story: zero until a refresh, then likes and named likers */
    let mine = setMe(addStory(h, { text: "Me on stage" }, A), { fame: 2, followers: 50000 });
    expect(mine.stories[0].stats.likes).toBe(0);
    const slots = owedSlots({ handset: mine, messages, characters, seed: 1 });
    mine = mergeBatch(mine, {}, { ...opts, mode: "refresh", anchor: A, owed: slots });
    const r = storyReactions(mine, mine.stories[0].id);
    expect(r.likes).toBeGreaterThan(100);
  });
});

describe("the phone's clock in a merge (at, ago, order)", () => {
  /* a seeded handset whose clock reads `min` on `messages` (hung on m2, the last one), last checked 2 hours before */
  const clocked = (min = 1000) => ({ ...mergeBatch(h0("lively"), {}, { ...opts, mode: "seed" }), clock: { min, at: A, step: "1h", last: min - 120 } });

  it("refresh: at = clockNow - ago, ago clamped to the window; stored order is the model's, ago made monotone", () => {
    const h = mergeBatch(clocked(), { posts: [
      { by: "a1", text: "newest", ago: "5m" },
      { by: "a2", text: "older", ago: "2h" },
      { by: "a3", text: "said newer, kept below", ago: "10m" },
      { by: "a4", text: "way back", ago: "3d" },
    ] }, { ...opts, mode: "refresh", anchor: A, clockNow: 1000, window: 60 });
    expect(h.posts.map((p) => p.text)).toEqual(["newest", "older", "said newer, kept below", "way back"]);
    expect(h.posts.map((p) => p.at)).toEqual([995, 940, 940, 940]);
    for (const p of h.posts) expect(p.t0).toBeCloseTo((1000 - p.at) / 30, 9);
  });

  it("window defaults to the time since the last check; seed reaches 3 days back; more goes below the oldest", () => {
    const r = mergeBatch(clocked(), { posts: [{ by: "a1", text: "x", ago: "1d" }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 1000 });
    expect(r.posts[0].at).toBe(1000 - 120);
    const s = mergeBatch(h0(), { posts: [{ by: "a1", text: "x", ago: "2w" }, { by: "a2", text: "y", ago: "2h" }] }, { ...opts, mode: "seed" });
    /* the seed's now: 5 minutes for the one story reply */
    expect(s.posts.map((p) => p.at)).toEqual([5 - 4320, 5 - 4320]);
    const m = mergeBatch(r, { posts: [{ by: "b1", text: "older one" }, { by: "b2", text: "older two", ago: "4d" }] }, { ...opts, mode: "more", anchor: A, clockNow: 1000 });
    const [o1, o2] = m.posts.slice(-2);
    expect(o1.at).toBeLessThan(r.posts[0].at);
    expect(o2.at).toBe(1000 - 5760);
  });

  it("a reply goes up between its parent and now; a DM line and a story at now", () => {
    const h = mergeBatch(clocked(), {
      posts: [{ by: "a1", text: "parent", ago: "40m", replies: [{ by: "b", text: "r1" }, { by: "c", text: "r2" }] }],
      stories: [{ by: "s1", text: "a story" }],
      dms: [{ from: "d1", text: "hi" }],
    }, { ...opts, mode: "refresh", anchor: A, clockNow: 1000, window: 60 });
    const parent = h.posts.find((p) => p.text === "parent");
    const kids = h.posts.filter((p) => p.kind === "reply");
    expect(parent.at).toBe(960);
    for (const k of kids) { expect(k.at).toBeGreaterThanOrEqual(960); expect(k.at).toBeLessThanOrEqual(1000); }
    /* halfway, then two thirds: a later reply is newer */
    expect(kids.map((k) => k.at)).toEqual([980, 987]);
    expect(h.stories[0].at).toBe(1000);
    expect(h.threads["npc:d1"][0].at).toBe(1000);
  });

  it("a refresh may bring comments on a story already up, which raise its replies", () => {
    const h = mergeBatch(clocked(), { stories: [{ by: "s1", text: "a story" }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 1000, window: 60 });
    const id = h.stories[0].id;
    expect(h.stories[0].stats.replies).toBe(0);
    const req = phoneBatch({ mode: "refresh", handset: h, ...opts, minutes: 60 });
    expect(req.user).toMatch(/About 1 hour passed since the phone was last checked/);
    expect(req.user).toMatch(/stories already up may get a few comments/);
    const next = mergeBatch(h, { posts: [{ by: "b", text: "love this", replyTo: id }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 1060, window: 60 });
    expect(next.stories[0].stats.replies).toBe(1);
    expect(next.posts[0].at).toBeGreaterThanOrEqual(1000);
  });

  it("items stored before the clock get an at from the old reply clock at the next merge", () => {
    const legacy = clocked();
    const old = { id: "old1", by: "npc:z", text: "old", kind: "post", stats: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, ago: 60, tick: 1, anchor: { id: "m1", swipe: 0 } };
    const h = normalizeHandset({ ...legacy, posts: [old], threads: { "npc:z": [{ id: "d1", from: "npc:z", text: "yo", tick: 1, anchor: { id: "m1", swipe: 0 } }] } });
    expect(h.posts[0].at).toBeUndefined();
    const next = mergeBatch(h, {}, { ...opts, mode: "respond", anchor: A, clockNow: 1000 });
    /* one reply since m1 (x 30) plus its 60 minutes */
    expect(next.posts.find((p) => p.id === "old1").at).toBe(1000 - 90);
    expect(next.threads["npc:z"][0].at).toBe(1000 - 30);
  });

  it("world mode takes minutes; span stays an alias", () => {
    const h = clocked();
    expect(phoneBatch({ mode: "world", handset: h, ...opts, span: "week" })).toMatchObject({ span: "week", minutes: 10080 });
    expect(phoneBatch({ mode: "world", handset: h, ...opts, span: "week" }).user).toMatch(/A week passes in the story/);
    const two = phoneBatch({ mode: "world", handset: h, ...opts, minutes: 2880 });
    expect(two.minutes).toBe(2880);
    expect(two.span).toBeUndefined();
    expect(two.user).toMatch(/About 2 days passes in the story/);
  });
});

describe("reply counts follow the stats (merge)", () => {
  it("placing a stored reply adds nothing; a quote still adds one; big posts start with replies", () => {
    let h = mergeBatch(h0(), { accounts: [{ handle: "star", fame: 3 }], posts: [{ id: "a", by: "star", text: "root", heat: 3 }] }, { ...opts, anchor: A });
    const root0 = h.posts.find((p) => p.text === "root");
    expect(root0.pot.replies).toBeGreaterThan(0);
    expect(root0.stats.replies).toBeGreaterThan(0);
    h = mergeBatch(h, { posts: [{ by: "cy", text: "a reply", replyTo: root0.id }, { by: "dee", text: "a quote", quote: root0.id }] }, { ...opts, anchor: A });
    const root1 = h.posts.find((p) => p.id === root0.id);
    expect(root1.stats.replies).toBe(root0.stats.replies);
    expect(root1.stats.quotes).toBe(root0.stats.quotes + 1);
  });
});

describe("time on the phone (prompt)", () => {
  const seededH = (extra = {}) => ({ ...h0("light"), tick: { ...h0("light").tick, seeded: true, n: 1 }, ...extra });
  it("a story's ago stays under a day", () => {
    const h = mergeBatch(seededH(), { stories: [{ by: "bob", text: "old", ago: "3d" }] }, { ...opts, mode: "world", anchor: A, clockNow: 10000, window: 10000 });
    expect(h.stories[0].at).toBe(10000 - (1440 - 60));
  });
  it("an hour on the phone past the last story message: nobody is in the scene; the prompt says time passed", async () => {
    const { storyPeople } = await import("../src/lib/phoneBatch.js");
    const msgs = [{ id: "m1", role: "user", content: "Hi Mira.", wt: 0 }, { id: "m2", role: "assistant", content: "Mira smiles.", wt: 5 }];
    const character = { id: "mira", name: "Mira Sol", description: "A barista." };
    const chat = { id: "c", messages: msgs };
    const near = seededH({ clock: { min: 30, at: { id: "m2", swipe: 0 }, step: "sync", last: 0 } });
    expect(storyPeople({ chat, character, handset: near, userName: "Ana", messages: msgs })[0].present).toBe(true);
    const far = seededH({ clock: { min: 65, at: { id: "m2", swipe: 0 }, step: "sync", last: 0 } });
    expect(storyPeople({ chat, character, handset: far, userName: "Ana", messages: msgs })[0].present).toBe(false);
    expect(phoneBatch({ mode: "refresh", handset: far, ...opts, messages: msgs }).user).toMatch(/\[Where the story stands\]\nAbout 1 hour has passed since the last story message; people are no longer in that scene unless they said so\./);
    expect(phoneBatch({ mode: "refresh", handset: seededH({ clock: { min: 10, at: { id: "m2", swipe: 0 }, step: "sync", last: 0 } }), ...opts, messages: msgs }).user).not.toMatch(/has passed since the last story message/);
  });
  it("world payments carry the batch's minute", () => {
    const h = mergeBatch(seededH(), { payments: [{ from: "Employer", to: "you", amount: 100, note: "wages" }] }, { ...opts, mode: "refresh", anchor: A, clockNow: 777 });
    expect(h.bank.tx[0]).toMatchObject({ kind: "received", at: 777 });
  });
});

describe("Sync to chat (prompt)", () => {
  const msgs = [{ id: "g", role: "assistant", content: "Mira waves." }];
  for (let i = 1; i <= 4; i++) msgs.push({ id: `u${i}`, role: "user", content: `Ana line ${i}` }, { id: `r${i}`, role: "assistant", content: `Mira line ${i}` });
  const h = { ...h0("light"), tick: { ...h0("light").tick, seeded: true, n: 1 }, clock: { min: 0, at: { id: "u2", swipe: 0, any: true }, sync: { id: "u2", swipe: 0, any: true }, step: "sync", last: 0 } };
  it("carries the story since the last sync and asks for elapsed", () => {
    const req = phoneBatch({ mode: "refresh", sync: true, handset: h, ...opts, messages: msgs });
    expect(req.sync).toBe(true);
    expect(req.user).toContain("[The story since Ana's phone was last checked]\nMira Sol: Mira line 2\nAna: Ana line 3\nMira Sol: Mira line 3\nAna: Ana line 4\nMira Sol: Mira line 4");
    expect(req.user).not.toContain("Ana line 2");
    expect(req.user).toMatch(/Return "elapsed": the whole minutes of story time these messages covered/);
    expect(req.maxTokens).toBe(budgetOf("light", "refresh").maxTokens);
    /* more than 6 messages: room for more */
    const all = { ...h, clock: { ...h.clock, sync: ROOT_ANCHOR, at: ROOT_ANCHOR } };
    expect(phoneBatch({ mode: "refresh", sync: true, handset: all, ...opts, messages: msgs }).maxTokens).toBe(budgetOf("light", "refresh").maxTokens + 300);
    /* a plain refresh does not */
    expect(phoneBatch({ mode: "refresh", handset: h, ...opts, messages: msgs }).user).not.toContain("elapsed");
  });
  it("parseBatch reads elapsed as a number or a numeric string", () => {
    expect(parseBatch(J({ elapsed: 180 })).elapsed).toBe(180);
    expect(parseBatch(J({ elapsed: "90 minutes" })).elapsed).toBe(90);
    expect(parseBatch(J({ elapsed: "soon" })).elapsed).toBeUndefined();
    expect(parseBatch(J({})).elapsed).toBeUndefined();
  });
});
