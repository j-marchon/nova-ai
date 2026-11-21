import { describe, expect, it } from "vitest";
import {
  PHONE_LEVELS, PHONE_NOTE_MAX, POST_CAP, THREAD_LINES, YOU, addMessage, addPost, emptyHandset, handsetOf, likeCount, markSeen, mergeTick,
  normalizeHandset, parsePhone, phoneAccounts, phoneDue, phoneNote, phoneRequest, setLevel, slug, toggleLike, unread, visiblePhone,
} from "../src/lib/phone.js";
import { ROOT_ANCHOR, anchorOf, anchorVisible, cleanAnchor, looseAnchorOf } from "../src/lib/anchor.js";
import {
  STORY_LIFE, addStory, addUsage, cleanUsage, keepPhoneOnDelete, mentionsOf, notificationsOf, phoneAct, receive, transfer, usageOf,
} from "../src/lib/phone.js";
import { addSwipe } from "../src/lib/swipes.js";
import { normalizeData, emptyData } from "../src/lib/data.js";
import { DM_WAIT_CAP, closenessOf, dmStatus, dueDms, isCloser, planDm, threadState } from "../src/lib/phone.js";

const msg = (id, role = "assistant", extra = {}) => ({ id, role, content: `${role} ${id}`, ...extra });
const story = (n) => {
  const out = [msg("g")];
  for (let i = 1; i <= n; i++) out.push(msg(`u${i}`, "user"), msg(`r${i}`));
  return out;
};
const chatWith = (handset, messages = story(1), extra = {}) => ({ id: "c1", kind: "character", characterId: "mira", messages, handset, ...extra });
const A = (id, swipe = 0) => ({ id, swipe });
const keyOf = (h) => (h === "you" || h === "ana" ? YOU : h === "mira" ? "char:mira" : null);

describe("phoneDue", () => {
  it("is never due when off or absent", () => {
    expect(phoneDue(chatWith(undefined, story(5)))).toBe(false);
    expect(phoneDue(chatWith(emptyHandset("off"), story(5)))).toBe(false);
  });
  it("first tick needs two story replies", () => {
    expect(phoneDue(chatWith(emptyHandset("light"), [msg("g"), msg("u1", "user")]))).toBe(false);
    expect(phoneDue(chatWith(emptyHandset("light"), story(1)))).toBe(true);
    /* an empty assistant bubble is not a story reply */
    expect(phoneDue(chatWith(emptyHandset("light"), [msg("g"), msg("u1", "user"), { id: "r1", role: "assistant", content: " " }]))).toBe(false);
  });
  it("counts replies since the last tick against the level", () => {
    const at = (level, lastMsgId) => ({ ...emptyHandset(level), tick: { n: 1, lastMsgId, pending: false } });
    const s = story(8);
    expect(phoneDue(chatWith(at("lively", "r5"), s))).toBe(true); // r6 r7 r8
    expect(phoneDue(chatWith(at("lively", "r6"), s))).toBe(false);
    expect(phoneDue(chatWith(at("light", "r3"), s))).toBe(false); // 5 < 6
    expect(phoneDue(chatWith(at("light", "r2"), s))).toBe(true);
  });
  it("is due right away with a pending persona action", () => {
    const h = { ...emptyHandset("light"), tick: { n: 1, lastMsgId: "r1", pending: true } };
    expect(phoneDue(chatWith(h, story(1)))).toBe(true);
  });
});

describe("anchors", () => {
  const base = story(2);
  const h = {
    ...emptyHandset("light"),
    posts: [
      { id: "p2", app: "murmur", by: "npc:bea", text: "two", tick: 2, anchor: A("r2", 1) },
      { id: "p1", app: "murmur", by: "npc:bea", text: "one", tick: 1, anchor: A("r1") },
    ],
    threads: { "char:mira": [{ id: "d1", from: "char:mira", text: "hey", tick: 2, anchor: A("r2", 1) }] },
  };
  const swiped = (i) => base.map((m) => (m.id === "r2" ? { ...m, swipes: [{ text: "a" }, { text: "b" }], swipeIdx: i } : m));

  it("anchorOf reads the swipe index", () => {
    expect(anchorOf(msg("x"))).toEqual({ id: "x", swipe: 0 });
    expect(anchorOf(swiped(1)[4])).toEqual({ id: "r2", swipe: 1 });
  });
  it("hides items of a deleted message", () => {
    const v = visiblePhone(h, base.filter((m) => m.id !== "r2"));
    expect(v.posts.map((p) => p.id)).toEqual(["p1"]);
    expect(v.threads).toEqual({});
  });
  it("hides items of another swipe and restores them on swiping back", () => {
    expect(visiblePhone(h, swiped(0)).posts.map((p) => p.id)).toEqual(["p1"]);
    expect(visiblePhone(h, swiped(1)).posts.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(visiblePhone(h, swiped(1)).threads["char:mira"]).toHaveLength(1);
  });
  it("a branch cut hides everything after it", () => {
    const branch = base.slice(0, 3); // g u1 r1
    expect(visiblePhone(h, branch).posts.map((p) => p.id)).toEqual(["p1"]);
    expect(anchorVisible(A("r2"), branch)).toBe(false);
  });
});

describe("mergeTick", () => {
  const messages = story(1);
  const anchor = A("r1");
  const parsed = (over = {}) => ({ people: [], murmur: [], glimpse: [], comments: [], messages: [], ...over });

  it("drops anything written as the persona and maps handles to keys", () => {
    const out = mergeTick(emptyHandset("lively"), parsed({
      murmur: [{ by: "you", text: "me" }, { by: "@ana", text: "also me" }, { by: "mira", text: "Mira here" }, { by: "@Bea_99", text: "Bea here" }],
      messages: [{ from: "you", text: "self" }, { from: "mira", text: "where are you" }],
    }), { anchor, keyOf, nameOf: (k) => (k === "char:mira" ? "Mira" : k), messages });
    expect(out.posts.map((p) => [p.by, p.text])).toEqual([["npc:bea_99", "Bea here"], ["char:mira", "Mira here"]]);
    expect(out.posts.every((p) => p.by !== YOU)).toBe(true);
    expect(out.threads[YOU]).toBeUndefined();
    expect(out.threads["char:mira"].map((m) => m.text)).toEqual(["where are you"]);
    expect(out.people["npc:bea_99"]).toMatchObject({ handle: "bea_99", name: "bea_99" });
    expect(out.people["char:mira"]).toMatchObject({ handle: "mira", name: "Mira" });
    expect(out.people[YOU]).toBeUndefined();
    expect(out.tick).toEqual({ n: 1, lastMsgId: "r1", pending: false, seeded: true });
  });
  it("creates npc people from the people list with name and bio", () => {
    const out = mergeTick(emptyHandset("light"), parsed({ people: [{ handle: "valenews", name: "Vale News", bio: "Local outlet" }, { handle: "bad handle!" }, { handle: "mira", name: "Not new" }] }), { anchor, keyOf });
    expect(out.people["npc:valenews"]).toEqual({ key: "npc:valenews", handle: "valenews", name: "Vale News", bio: "Local outlet", fame: 2, traits: { fame: 2, wealth: 0 } }); /* an outlet is a public figure */
    expect(Object.keys(out.people)).toEqual(["npc:valenews"]);
  });
  it("honours replyTo and on only when the target exists, in one feed", () => {
    const h = { ...emptyHandset("lively"), tick: { n: 1, lastMsgId: "g", pending: false }, posts: [
      { id: "m1a", app: "murmur", by: "npc:bea", text: "first", tick: 1, anchor },
      { id: "g1a", app: "glimpse", by: "npc:bea", text: "cap", photo: "a dog", tick: 1, anchor },
    ] };
    const out = mergeTick(h, parsed({
      murmur: [{ by: "mira", text: "reply", replyTo: "#m1a" }, { by: "mira", text: "orphan", replyTo: "zzz" }, { by: "mira", text: "to a photo", replyTo: "g1a" }],
      comments: [{ on: "g1a", by: "mira", text: "cute" }, { on: "m1a", by: "mira", text: "not a photo" }, { on: "nope", by: "mira", text: "x" }],
    }), { anchor, keyOf, messages });
    const byText = Object.fromEntries(out.posts.map((p) => [p.text, p]));
    expect(byText.reply).toMatchObject({ kind: "reply", ref: "m1a" });
    expect(byText.orphan).toMatchObject({ kind: "post" });
    expect(byText.orphan.ref).toBeUndefined();
    expect(byText["to a photo"]).toMatchObject({ kind: "reply", ref: "g1a" });
    expect(byText.cute).toMatchObject({ kind: "reply", ref: "g1a" });
    expect(byText["not a photo"]).toMatchObject({ kind: "reply", ref: "m1a" });
    expect(byText.x).toBeUndefined();
    /* real replies count at once */
    expect(byText.first.stats.replies).toBe(2);
    expect(byText.cap.stats.replies).toBe(2);
  });
  it("enforces the level's maxima and the caps", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ by: "mira", text: `post ${i}` }));
    const lim = PHONE_LEVELS.light;
    const out = mergeTick(emptyHandset("light"), parsed({
      murmur: many, glimpse: many.map((x) => ({ ...x, photo: "a view" })), messages: many.map((x) => ({ from: "mira", text: x.text })),
    }), { anchor, keyOf });
    expect(out.posts.filter((p) => !p.photo)).toHaveLength(lim.murmur);
    expect(out.posts.filter((p) => p.photo)).toHaveLength(lim.glimpse);
    expect(out.threads["char:mira"]).toHaveLength(lim.messages);

    const full = { ...emptyHandset("lively"), posts: Array.from({ length: POST_CAP }, (_, i) => ({ id: `o${i}`, app: "murmur", by: "npc:x", text: `old ${i}`, tick: 1, anchor })),
      threads: { "char:mira": Array.from({ length: THREAD_LINES }, (_, i) => ({ id: `t${i}`, from: "char:mira", text: `t${i}`, tick: 1, anchor })) } };
    const capped = mergeTick(full, parsed({ murmur: [{ by: "mira", text: "newest" }], messages: [{ from: "mira", text: "latest" }] }), { anchor, keyOf });
    expect(capped.posts).toHaveLength(POST_CAP);
    expect(capped.posts[0].text).toBe("newest");
    expect(capped.threads["char:mira"]).toHaveLength(THREAD_LINES);
    expect(capped.threads["char:mira"].at(-1).text).toBe("latest");
  });
  it("prunes items whose anchors are no longer visible", () => {
    const h = { ...emptyHandset("light"), posts: [{ id: "gone", app: "murmur", by: "npc:x", text: "old", tick: 1, anchor: A("deleted") }] };
    expect(mergeTick(h, parsed(), { anchor, keyOf, messages }).posts).toEqual([]);
  });
  it("keeps items anchored to another swipe of an existing message", () => {
    const h = { ...emptyHandset("light"), posts: [{ id: "s1", app: "murmur", by: "npc:x", text: "other swipe", tick: 1, anchor: A("r1", 1) }] };
    expect(mergeTick(h, parsed(), { anchor, keyOf, messages }).posts.map((p) => p.id)).toEqual(["s1"]);
  });
  it("keeps persona actions made while the tick ran new and pending", () => {
    let h = addPost(emptyHandset("light"), { text: "answered" }, anchor);
    const answered = h.posts.map((p) => p.id);
    h = addPost(h, { text: "made later" }, anchor);
    const out = mergeTick(h, parsed(), { anchor, keyOf, answered });
    expect(out.tick.pending).toBe(true);
    expect(out.posts.find((p) => p.text === "made later").tick).toBe(2);
    expect(out.posts.find((p) => p.text === "answered").tick).toBe(1);
  });
  it("never mutates its input", () => {
    const h = emptyHandset("light");
    const snap = JSON.stringify(h);
    mergeTick(h, parsed({ murmur: [{ by: "mira", text: "x" }] }), { anchor, keyOf });
    expect(JSON.stringify(h)).toBe(snap);
  });
});

describe("parsePhone", () => {
  it("reads fenced JSON with noise around it", () => {
    const out = parsePhone('Sure!\n```json\n{"murmur":[{"by":"mira","text":"hi"}],"messages":[]}\n```\nHope that helps');
    expect(out.murmur).toEqual([{ by: "mira", text: "hi" }]);
    expect(out.glimpse).toEqual([]);
  });
  it("keeps what is valid in a partly wrong shape", () => {
    const out = parsePhone('{"people":"nobody","murmur":[1,"x",{"by":"a1","text":"ok"}],"glimpse":{"by":"x"},"messages":[null,{"from":"mira","text":"yo"}]}');
    expect(out.people).toEqual([]);
    expect(out.murmur).toEqual([{ by: "a1", text: "ok" }]);
    expect(out.glimpse).toEqual([]);
    expect(out.messages).toEqual([{ from: "mira", text: "yo" }]);
  });
  it("returns null for no JSON, never throws", () => {
    expect(parsePhone("nothing here")).toBeNull();
    expect(parsePhone("")).toBeNull();
    expect(parsePhone(undefined)).toBeNull();
  });
  it("survives a cut-off answer", () => {
    const out = parsePhone('{"murmur":[{"by":"mira","text":"one"},{"by":"bea","text":"tw');
    expect(out?.murmur?.[0]).toEqual({ by: "mira", text: "one" });
  });
});

describe("phoneRequest", () => {
  const character = { id: "mira", name: "Mira", description: "A thief in the lower city. ".repeat(40) };
  const persona = { name: "Ana", description: "A courier. ".repeat(60) };
  const long = Array.from({ length: 30 }, (_, i) => msg(`m${i}`, i % 2 ? "user" : "assistant", { content: `Line ${i} `.repeat(80) }));

  it("holds the knowledge rules, the persona, the level's counts and the accounts", () => {
    const chat = chatWith(emptyHandset("lively"), long, { scope: { mode: "manual", cast: [{ id: "k1", name: "Old Kett", description: "the fence" }] } });
    const req = phoneRequest({ chat, character, persona, userName: "Ana", messages: long });
    expect(req.maxTokens).toBeLessThanOrEqual(1500);
    expect(req.system).toContain("This is Ana's phone, logged in as Ana");
    expect(req.system).toContain("knows only what it saw, was told, or what is public");
    expect(req.system).toContain("Never write anything as Ana");
    expect(req.system).toContain(`At most ${PHONE_LEVELS.lively.murmur} Murmur posts, ${PHONE_LEVELS.lively.glimpse} Glimpse photos`);
    expect(req.system).toContain(`${PHONE_LEVELS.lively.messages} messages`);
    expect(req.user).toContain("@you = Ana (never write as them)");
    expect(req.user).toContain("@mira Mira");
    expect(req.user).toContain("@old_kett Old Kett: the fence");
    expect(req.user).toContain("[Ana]");
    expect(req.user).toContain("Write what appeared on Ana's phone since then.");
  });
  it("caps its sections", () => {
    const chat = chatWith(emptyHandset("light"), long, { scene: { text: "Scene ".repeat(400), lastId: "m29" } });
    const req = phoneRequest({ chat, character, persona, userName: "Ana", messages: long });
    const section = (name) => req.user.split("\n\n").find((s) => s.startsWith(`[${name}]`)) || "";
    expect(section("Story").length).toBeLessThan(420);
    expect(section("Ana").length).toBeLessThan(320);
    expect(section("Where the story stands").length).toBeLessThan(830);
    expect(section("Latest in the story").length).toBeLessThan(2530);
    expect(req.user.length + req.system.length).toBeLessThan(12000);
  });
  it("shows existing posts with ids, new persona activity and open conversations", () => {
    let h = mergeTick(emptyHandset("light"), { murmur: [{ by: "mira", text: "Rooftops tonight." }], messages: [{ from: "mira", text: "Bring the map" }] }, { anchor: A("r1"), keyOf });
    h = addPost(h, { text: "Who wants coffee?" }, A("r1"));
    h = addMessage(h, "char:mira", "On my way", A("r1"));
    const req = phoneRequest({ chat: chatWith(h), character, persona, userName: "Ana", messages: story(1) });
    expect(req.user).toMatch(/#m1\w+ @mira \(post\): Rooftops tonight\./);
    expect(req.user).toContain("[Ana's new activity]");
    expect(req.user).toContain("- posted (#");
    expect(req.user).toContain("- messaged @mira: On my way");
    expect(req.user).toContain("[Open conversations]\nWith @mira:");
  });
  it("gives a universe its story and world log", () => {
    const universe = { id: "u", name: "Vale", story: "A valley of rivers.", characters: [{ id: "rk", name: "Rook" }] };
    const chat = { id: "c", kind: "universe", universeId: "u", messages: story(1), handset: emptyHandset("light") };
    const req = phoneRequest({ chat, universe, userName: "Ana", messages: chat.messages, worldLog: [{ text: "A storm rolls in from the coast." }] });
    expect(req.user).toContain('The world of "Vale". A valley of rivers.');
    expect(req.user).toContain("@rook Rook");
    expect(req.user).toContain("[Happening in the world]\n- A storm rolls in");
  });
});

describe("accounts", () => {
  it("keeps a story character's stored handle and avoids clashes", () => {
    const h = { ...emptyHandset("light"), people: { "char:mira": { key: "char:mira", handle: "mira_night", name: "Mira" }, "npc:tom": { key: "npc:tom", handle: "tom", name: "Tom" } } };
    const acc = phoneAccounts({ chat: chatWith(h, story(1), { scope: { mode: "manual", cast: [{ id: "t", name: "Tom" }] } }), character: { id: "mira", name: "Mira" }, userName: "Ana" });
    expect(acc.keyOf("mira_night")).toBe("char:mira");
    expect(acc.keyOf("tom2")).toBe("cast:t");
    expect(acc.keyOf("you")).toBe(YOU);
    expect(acc.keyOf("ana")).toBe(YOU);
    expect(acc.keyOf("stranger")).toBeNull();
    expect(acc.nameOf("char:mira")).toBe("Mira");
  });
  it("slug makes handles", () => {
    expect(slug("Élodie Marchand")).toBe("elodie_marchand");
    expect(slug("Ji-woo")).toBe("ji_woo");
    expect(slug("李")).toMatch(/^[a-z0-9_.]{2,20}$/);
  });
});

describe("persona actions", () => {
  const h0 = emptyHandset("light");
  it("set pending and never mutate their input", () => {
    const snap = JSON.stringify(h0);
    const p = addPost(h0, { app: "glimpse", photo: "sunset over the docks", text: "home" }, A("r1"));
    expect(p.tick.pending).toBe(true);
    expect(p.posts[0]).toMatchObject({ kind: "post", by: YOU, photo: "sunset over the docks", text: "home", tick: 1, stats: { likes: 0 } });
    const m = addMessage(p, "char:mira", "hi", A("r1"));
    expect(m.tick.pending).toBe(true);
    expect(m.threads["char:mira"][0]).toMatchObject({ from: YOU, text: "hi" });
    expect(JSON.stringify(h0)).toBe(snap);
    expect(p.threads).toEqual({});
  });
  it("ignore invalid input", () => {
    expect(addPost(h0, { text: "  " }, A("r1")).posts).toEqual([]);
    expect(addPost(h0, { text: "x" }, null).posts).toEqual([]);
    expect(addMessage(h0, YOU, "x", A("r1")).threads).toEqual({});
  });
  it("like, seen and level", () => {
    const p = addPost(h0, { text: "x" }, A("r1"));
    const id = p.posts[0].id;
    const liked = toggleLike(p, id);
    expect(liked.posts[0].liked).toBe(true);
    expect(toggleLike(liked, id).posts[0].liked).toBeUndefined();
    expect(p.posts[0].liked).toBeUndefined();
    const t = { ...h0, tick: { n: 4, lastMsgId: "r1", pending: false } };
    expect(markSeen(t, "feed").seen.feed).toBe(4);
    expect(markSeen(t, "murmur").seen.feed).toBe(4);
    expect(markSeen(t, { thread: "char:mira" }).seen.messages["char:mira"]).toBe(4);
    expect(setLevel(p, "off")).toMatchObject({ level: "off", posts: p.posts });
    expect(setLevel(undefined, "lively").level).toBe("lively");
  });
});

describe("unread and likes", () => {
  it("counts visible items newer than seen, not the persona's own", () => {
    let h = mergeTick(emptyHandset("lively"), { murmur: [{ by: "mira", text: "a" }, { by: "bea", text: "b" }], glimpse: [{ by: "bea", photo: "p", caption: "c" }], messages: [{ from: "mira", text: "m" }] }, { anchor: A("r1"), keyOf });
    h = addPost(h, { text: "mine" }, A("r1"));
    /* the badge counts messages, money in and mentions, never feed posts */
    expect(unread(h, story(1))).toMatchObject({ feed: 3, stories: 0, messages: 1, mentions: 0, bank: 0, total: 1 });
    expect(unread(markSeen(h, "feed"), story(1))).toMatchObject({ feed: 0, messages: 1, total: 1 });
    expect(unread(markSeen(markSeen(h, "feed"), { thread: "char:mira" }), story(1)).total).toBe(0);
    expect(unread(h, [msg("g")]).total).toBe(0);
  });
  it("likeCount is stable and grows with fame", () => {
    const p = { id: "m1a" };
    expect(likeCount(p)).toBe(likeCount(p));
    expect(likeCount(p, 3)).toBeGreaterThan(likeCount(p, 0));
    expect(likeCount({ ...p, liked: true })).toBe(likeCount(p) + 1);
  });
});

describe("phoneNote", () => {
  it("is empty when nothing shows; on Off it keeps character DMs and the persona's posts only", () => {
    let h = mergeTick(emptyHandset("light"), { murmur: [{ by: "mira", text: "Rooftops" }], messages: [{ from: "mira", text: "hey" }, { from: "bea", text: "hi stranger" }] }, { anchor: A("r1"), keyOf });
    h = addPost(h, { text: "Long day." }, A("r1"));
    const offNote = phoneNote(chatWith({ ...h, level: "off" }), { userName: "Ana", nameOf: (k) => (k === "char:mira" ? "Mira" : null) });
    expect(offNote.split("\n").slice(1)).toEqual(['- Mira texted Ana: "hey" (unread)', '- Ana posted: "Long day."]']);
    expect(phoneNote(chatWith(emptyHandset("light")), { userName: "Ana" })).toBe("");
    expect(phoneNote(chatWith(h, [msg("g")]), { userName: "Ana" })).toBe("");
  });
  it("puts the persona and story characters first and stays short", () => {
    let h = mergeTick(emptyHandset("lively"), {
      murmur: Array.from({ length: 6 }, (_, i) => ({ by: `npc${i}`, text: `Stranger chatter number ${i} `.repeat(6) })),
      messages: [{ from: "mira", text: "Meet me at the bridge" }],
    }, { anchor: A("r1"), keyOf });
    h = addPost(h, { text: "Long day." }, A("r1"));
    const note = phoneNote(chatWith(h), { userName: "Ana", nameOf: (k) => (k === "char:mira" ? "Mira" : null) });
    expect(note.length).toBeLessThanOrEqual(PHONE_NOTE_MAX);
    expect(note.startsWith("[On the phones lately")).toBe(true);
    const lines = note.split("\n");
    expect(lines[1]).toBe('- Mira texted Ana: "Meet me at the bridge" (unread)');
    expect(lines[2]).toBe('- Ana posted: "Long day."]');
    /* ambient accounts' posts stay out of the story */
    expect(note).not.toContain("Stranger chatter");
    /* opened: no longer unread */
    const read = phoneNote(chatWith(markSeen(h, { thread: "char:mira" })), { userName: "Ana", nameOf: (k) => (k === "char:mira" ? "Mira" : null) });
    expect(read.split("\n")[1]).toBe('- Mira texted Ana: "Meet me at the bridge"');
    expect(note.endsWith("]")).toBe(true);
  });
});

describe("normalizeHandset", () => {
  it("drops malformed data and keeps the valid parts", () => {
    expect(normalizeHandset(null)).toBeUndefined();
    expect(normalizeHandset({ level: "loud" })).toBeUndefined();
    const h = normalizeHandset({
      level: "light", tick: { n: -1, lastMsgId: 5, pending: "yes" },
      people: { "npc:ok": { handle: "ok", name: "Ok" }, "npc:bad": { handle: "no spaces" }, you: { handle: "you" } },
      posts: [{ id: "a", app: "murmur", by: "npc:ok", text: "t", tick: 1, anchor: { id: "r1" } }, { id: "b", app: "tiktok", by: "x", text: "t", tick: 1, anchor: A("r1") }, null],
      threads: { "npc:ok": [{ id: "d", from: "npc:ok", text: "hi", tick: 1, anchor: A("r1") }, { text: "broken" }], "npc:empty": [] },
      seen: { murmur: "x", messages: { "npc:ok": 1, bad: -2 } },
    });
    expect(h.tick).toEqual({ n: 0, lastMsgId: null, pending: false, seeded: true });
    expect(h.v).toBe(2);
    expect(Object.keys(h.people)).toEqual(["npc:ok"]);
    expect(h.posts.map((p) => p.id)).toEqual(["a"]);
    expect(h.posts[0].anchor).toEqual({ id: "r1", swipe: 0 });
    expect(Object.keys(h.threads)).toEqual(["npc:ok"]);
    expect(h.seen).toEqual({ feed: 0, stories: [], messages: { "npc:ok": 1 }, bank: 0, mentions: 0 });
  });
  it("handsetOf is always whole", () => {
    expect(handsetOf({})).toEqual(emptyHandset("off"));
  });
  it("normalizeData keeps a valid handset, drops a broken one, and defaults phoneDefault", () => {
    const d = structuredClone(emptyData);
    const handset = mergeTick(emptyHandset("light"), { murmur: [{ by: "bea", text: "hi" }] }, { anchor: A("r1"), keyOf });
    d.chats = [{ id: "a", kind: "character", characterId: "c", messages: story(1), handset }, { id: "b", kind: "character", characterId: "c", messages: [], handset: "junk" }];
    d.settings.phoneDefault = "chaos";
    const out = normalizeData(d);
    expect(out.chats[0].handset).toEqual(handset);
    expect("handset" in out.chats[1]).toBe(false);
    expect(out.settings.phoneDefault).toBe("off");
    expect(normalizeData({}).settings.phoneDefault).toBe("off");
  });
});

describe("wealth and the bank", () => {
  it("creates a bank on migration (v1 and v2 without one), idempotently", async () => {
    const { BALANCE_BANDS, bankOf } = await import("../src/lib/phone.js");
    const v1 = normalizeHandset({ level: "light", tick: { n: 1 }, posts: [], threads: {}, seen: {} });
    expect(v1.bank).toMatchObject({ tx: [], fresh: true });
    const { bank: _b, ...v2raw } = emptyHandset("lively");
    const v2 = normalizeHandset({ ...v2raw, me: { fame: 1, traits: { fame: 1, wealth: 2 } } });
    expect(v2.bank.balance).toBeGreaterThanOrEqual(BALANCE_BANDS[2][0]);
    expect(v2.bank.balance).toBeLessThanOrEqual(BALANCE_BANDS[2][1]);
    expect(normalizeHandset(v2)).toEqual(v2);
    expect(normalizeHandset(JSON.parse(JSON.stringify(v2)))).toEqual(v2);
    expect(bankOf(v2)).toEqual(v2.bank);
  });
  it("maps each wealth tier to its balance band, repeatably", async () => {
    const { BALANCE_BANDS, startingBalance } = await import("../src/lib/phone.js");
    for (let t = 0; t < 4; t++) {
      for (const job of ["", "baker", "pilot", "heir"]) {
        const me = { traits: { fame: 0, wealth: t, job } };
        const b = startingBalance(me);
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(BALANCE_BANDS[t][0]);
        expect(b).toBeLessThanOrEqual(BALANCE_BANDS[t][1]);
        expect(startingBalance(me)).toBe(b);
      }
    }
  });
  it("an unused bank follows a new wealth tier; a used one keeps its balance", async () => {
    const { setMe, transfer, BALANCE_BANDS } = await import("../src/lib/phone.js");
    const rich = setMe(emptyHandset("light"), { traits: { wealth: 3 }, from: "inferred" });
    expect(rich.bank.balance).toBeGreaterThanOrEqual(BALANCE_BANDS[3][0]);
    const used = transfer(emptyHandset("light"), { to: "char:mira", amount: 10 });
    expect(setMe(used, { traits: { wealth: 3 } }).bank.balance).toBe(used.bank.balance);
  });
  it("transfer rejects overdraft, non-positive amounts and no payee; records the tx", async () => {
    const { transfer, receive, reactingTo, BANK_TX_CAP } = await import("../src/lib/phone.js");
    const h = emptyHandset("light");
    const bal = h.bank.balance;
    for (const amount of [0, -5, NaN, Infinity, "x", bal + 1]) expect(transfer(h, { to: "char:mira", amount })).toBe(h);
    expect(transfer(h, { to: "", amount: 5 })).toBe(h);
    expect(transfer(h, { to: YOU, amount: 5 })).toBe(h);
    const out = transfer(h, { to: "char:mira", toName: "Mira", amount: 25, note: "coffee", t: 1000 });
    expect(out.bank.balance).toBe(bal - 25);
    expect(out.bank.fresh).toBeUndefined();
    expect(out.bank.tx[0]).toMatchObject({ kind: "sent", to: "char:mira", toName: "Mira", amount: 25, note: "coffee", t: 1000, tick: 1 });
    expect(out.tick.pending).toBe(true);
    expect(reactingTo(out, "char:mira")).toMatchObject({ amount: 25 });
    expect(reactingTo({ ...out, tick: { ...out.tick, n: 1 } }, "char:mira")).toBeNull();
    const all = transfer(h, { to: "char:mira", amount: bal });
    expect(all.bank.balance).toBe(0);
    const r = receive(out, { from: "npc:boss", fromName: "Boss", amount: 300, note: "wages", t: 2 });
    expect(r.bank.balance).toBe(bal - 25 + 300);
    expect(r.bank.tx[0]).toMatchObject({ kind: "received", from: "npc:boss", fromName: "Boss", amount: 300, note: "wages" });
    expect(r.bank.tx).toHaveLength(2);
    expect(receive(out, { from: "npc:boss", amount: 0 })).toBe(out);
    let many = h;
    for (let i = 0; i < BANK_TX_CAP + 5; i++) many = receive(many, { fromName: "Shop", amount: 1, note: `r${i}` });
    expect(many.bank.tx).toHaveLength(BANK_TX_CAP);
    expect(many.bank.tx[0].note).toBe(`r${BANK_TX_CAP + 4}`);
    expect(unread(many, []).bank).toBe(BANK_TX_CAP);
    expect(unread(markSeen(many, "bank"), []).bank).toBe(0);
  });
});

describe("replies and activity", () => {
  const seeded = () => normalizeHandset({ ...emptyHandset("lively"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true }, posts: [
    { id: "c2", by: "npc:bo", text: "second", kind: "reply", ref: "p1", tick: 1, anchor: A("r1") },
    { id: "c1", by: "char:mira", text: "first", kind: "reply", ref: "p1", tick: 1, anchor: A("r1") },
    { id: "q1", by: "char:mira", text: "look", kind: "quote", ref: "p1", tick: 1, anchor: A("r1") },
    { id: "rp", by: "char:mira", text: "", kind: "repost", ref: "p1", tick: 1, anchor: A("r1") },
    { id: "p1", by: "npc:bo", text: "root", kind: "post", stats: { likes: 9 }, tick: 1, anchor: A("r1") },
    { id: "m1", by: "char:mira", text: "mine", kind: "post", tick: 1, anchor: A("r1") },
  ] });
  it("stored children raise the stored counts", () => {
    const p1 = seeded().posts.find((p) => p.id === "p1");
    expect(p1.stats).toMatchObject({ likes: 9, replies: 2, quotes: 1, reposts: 1 });
    expect(p1.pot.replies).toBeGreaterThanOrEqual(2);
  });
  it("repliesTo lists the replies newest first", async () => {
    const { repliesTo } = await import("../src/lib/phone.js");
    expect(repliesTo(seeded(), "p1").map((p) => p.id)).toEqual(["c2", "c1"]);
    expect(repliesTo(seeded(), "m1")).toEqual([]);
  });
  it("activityOf returns an account's posts, replies, quotes and reposts", async () => {
    const { activityOf } = await import("../src/lib/phone.js");
    const a = activityOf(seeded(), "char:mira");
    expect(a.map((p) => p.id)).toEqual(["c1", "q1", "rp", "m1"]);
    expect(a[0].parent).toBe("p1");
    expect(activityOf(seeded(), "npc:nobody")).toEqual([]);
  });
  it("the persona's post starts at zero until a refresh", () => {
    const h = addPost(emptyHandset("light"), { text: "hello", pot: { likes: 40, reposts: 8, replies: 4, quotes: 2 } }, A("r1"));
    expect(h.posts[0].stats).toEqual({ likes: 0, reposts: 0, replies: 0, quotes: 0 });
    expect(h.posts[0].pot).toEqual({ likes: 0, reposts: 0, replies: 0, quotes: 0 });
  });
});

describe("switching off, items' in-world minute (round 4)", () => {
  it("setLevel off and on again keeps posts, stories, threads, bank and clock; normalizeHandset keeps an off handset", async () => {
    const { addStory, transfer, setRefreshStep } = await import("../src/lib/phone.js");
    let h = { ...emptyHandset("lively"), tick: { ...emptyHandset("lively").tick, seeded: true } };
    h = addPost(h, { text: "mine", at: 40 }, A("r1"));
    h = addStory(h, { text: "story", at: 41 }, A("r1"));
    h = addMessage(h, "char:mira", "hey", A("r1"), { at: 42 });
    h = transfer(h, { to: "char:mira", amount: 5 });
    h = setRefreshStep({ ...h, clock: { min: 500, at: A("r1"), step: "1h", last: 500 } }, "3h");
    const off = setLevel(h, "off");
    const stored = normalizeHandset(JSON.parse(JSON.stringify(off)));
    expect(stored.level).toBe("off");
    const on = setLevel(stored, "light");
    for (const k of ["posts", "stories", "threads", "bank", "clock", "tick"]) expect(on[k]).toEqual(normalizeHandset(h)[k]);
    expect(on.posts[0].at).toBe(40);
    expect(on.stories[0].at).toBe(41);
    expect(on.threads["char:mira"][0].at).toBe(42);
    expect(on.clock).toEqual({ min: 500, at: A("r1"), sync: A("r1"), step: "3h", last: 500 });
    /* data.js keeps it too */
    const data = normalizeData({ ...emptyData, chats: [chatWith(off)] });
    expect(data.chats[0].handset.posts).toHaveLength(1);
    expect(data.chats[0].handset.level).toBe("off");
  });

  it("at is kept when finite (negative too) and dropped otherwise", () => {
    const h = addPost(emptyHandset("light"), { text: "x", at: -300 }, A("r1"));
    expect(normalizeHandset(h).posts[0].at).toBe(-300);
    expect(normalizeHandset({ ...h, posts: [{ ...h.posts[0], at: "soon" }] }).posts[0].at).toBeUndefined();
    expect(addPost(emptyHandset("light"), { text: "x" }, A("r1")).posts[0].at).toBeUndefined();
  });

  it("social.js reads ages and counts off the phone's clock", async () => {
    const { ageLabel, shownStats } = await import("../src/components/phone/social.js");
    const messages = story(2);
    const h = { ...emptyHandset("light"), tick: { ...emptyHandset("light").tick, seeded: true }, clock: { min: 1000, at: A("r2"), step: "1h", last: 1000 } };
    const post = { id: "p", by: "npc:a", kind: "post", text: "x", stats: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 500, reposts: 0, replies: 0, quotes: 0 }, t0: 0, at: 1000 - 180, anchor: A("r1") };
    expect(ageLabel(post, messages, h)).toBe("3h");
    expect(ageLabel({ ...post, at: 1000 - 3 * 1440 }, messages, h)).toBe("3d");
    /* without a handset: the old reply clock (1 reply since r1 x 30 minutes) */
    expect(ageLabel(post, messages)).toBe("30m");
    expect(shownStats(post, messages, [], h).likes).toBeGreaterThan(shownStats(post, messages, []).likes);
  });
});

describe("DM waits (handset.dmWait)", () => {
  const seeded = (extra = {}) => normalizeHandset({ ...emptyHandset("light"), tick: { n: 2, lastMsgId: null, pending: false, seeded: true }, ...extra });
  const people = {
    "npc:zed": { key: "npc:zed", handle: "zed", name: "Zed" },
    "npc:outlet": { key: "npc:outlet", handle: "citynews", name: "City News", role: "outlet" },
    "npc:kim": { key: "npc:kim", handle: "kim", name: "Kim", role: "friend" },
    "npc:lee": { key: "npc:lee", handle: "lee", name: "Lee", traits: { fame: 0, relationship: "girlfriend" } },
  };

  it("emptyHandset has none; the first line of a streak gets one, a follow-up keeps it", () => {
    expect(emptyHandset("light").dmWait).toEqual({});
    let h = addMessage(seeded(), "char:mira", "hey", A("r1"), { at: 100 });
    const w = h.dmWait["char:mira"];
    expect(w).toMatchObject({ line: h.threads["char:mira"][0].id, sent: 100 });
    expect(h.threads["char:mira"][0].at).toBe(100);
    expect(w).toEqual(planDm(h, "char:mira", h.threads["char:mira"][0], h.threads["char:mira"]));
    h = addMessage(h, "char:mira", "you there?", A("r1"), { at: 200 });
    expect(h.dmWait["char:mira"]).toEqual(w);
    expect(normalizeHandset(h).dmWait).toEqual(h.dmWait);
  });

  it("a follow-up a day after no answer rolls once more", () => {
    let h = addMessage(seeded({ people }), "npc:zed", "hi", A("r1"), { at: 100 });
    h = { ...h, dmWait: { "npc:zed": { ...h.dmWait["npc:zed"], due: null } } };
    const soon = addMessage(h, "npc:zed", "hello?", A("r1"), { at: 1000 });
    expect(soon.dmWait["npc:zed"].due).toBeNull();
    const day = addMessage(h, "npc:zed", "hello?", A("r1"), { at: 100 + 1440 });
    expect(day.dmWait["npc:zed"]).toMatchObject({ re: 1, line: day.threads["npc:zed"].at(-1).id, sent: 1540 });
    const nulled = { ...day, dmWait: { "npc:zed": { ...day.dmWait["npc:zed"], due: null } } };
    const third = addMessage(nulled, "npc:zed", "??", A("r1"), { at: 5000 });
    expect(third.dmWait["npc:zed"]).toEqual(nulled.dmWait["npc:zed"]);
  });

  it("normalize keeps valid entries and drops bad ones, missing lines and other people's lines; at most DM_WAIT_CAP", () => {
    const line = (id, from, at = 10) => ({ id, from, text: "x", tick: 1, anchor: A("r1"), at });
    const threads = { "npc:a": [line("a1", YOU)], "npc:b": [line("b1", "npc:b")], "npc:c": [line("c1", YOU)], "npc:d": [line("d1", YOU)] };
    const h = normalizeHandset({ ...seeded(), threads, dmWait: {
      "npc:a": { line: "a1", sent: 10, due: 30, seen: null, miss: 1, re: 2 },
      "npc:b": { line: "b1", sent: 10, due: 30, seen: 20 },
      "npc:c": { line: "zz", sent: 10, due: 30, seen: 20 },
      "npc:d": { line: "d1", sent: 10, due: 5, seen: 20 },
      "npc:gone": { line: "g1", sent: 10, due: 30, seen: 20 },
    } });
    expect(h.dmWait["npc:a"]).toEqual({ line: "a1", sent: 10, due: 30, seen: null, miss: 1 });
    expect(h.dmWait["npc:b"]).toBeUndefined();
    expect(h.dmWait["npc:gone"]).toBeUndefined();
    /* c and d had bad entries; their old lines (tick 1, before the last batch) get none */
    expect(h.dmWait["npc:c"]).toBeUndefined();
    expect(h.dmWait["npc:d"]).toBeUndefined();
    const many = {};
    const wait = {};
    for (let i = 0; i < DM_WAIT_CAP + 5; i++) { many[`cast:p${i}`] = [line(`l${i}`, YOU, i)]; wait[`cast:p${i}`] = { line: `l${i}`, sent: i, due: null, seen: null }; }
    const capped = normalizeHandset({ ...seeded(), threads: many, dmWait: wait });
    expect(Object.keys(capped.dmWait)).toHaveLength(DM_WAIT_CAP);
    expect(capped.dmWait["cast:p0"]).toBeUndefined();
    expect(capped.dmWait[`cast:p${DM_WAIT_CAP + 4}`]).toBeTruthy();
  });

  it("a line saved before dmWait, not answered by a batch yet, gets the same entry every load", () => {
    const old = { ...seeded(), threads: { "char:mira": [{ id: "o1", from: YOU, text: "hey", tick: 3, anchor: A("r1"), at: 50 }] } };
    delete old.dmWait;
    const a = normalizeHandset(old);
    expect(a.dmWait["char:mira"]).toMatchObject({ line: "o1", sent: 50 });
    expect(normalizeHandset({ ...old }).dmWait).toEqual(a.dmWait);
    expect(normalizeHandset(a).dmWait).toEqual(a.dmWait);
    /* one a batch already ran after: no answer is coming */
    expect(normalizeHandset({ ...old, threads: { "char:mira": [{ ...old.threads["char:mira"][0], tick: 1 }] } }).dmWait).toEqual({});
  });

  it("closenessOf: partner 3, story 2, friend 2, someone who wrote 1, cold 0, an outlet that did not open 0", () => {
    const h = seeded({ people });
    const me = (id) => ({ id, from: YOU, text: "x", tick: 1, anchor: A("r1") });
    const them = (id, from) => ({ id, from, text: "x", tick: 1, anchor: A("r1") });
    expect(closenessOf(h, "npc:lee", [])).toBe(3);
    expect(closenessOf(h, "char:mira", [])).toBe(2);
    expect(closenessOf(h, "npc:kim", [])).toBe(2);
    expect(closenessOf(h, "npc:zed", [me("a"), them("b", "npc:zed")])).toBe(1);
    expect(closenessOf(h, "npc:zed", [me("a")])).toBe(0);
    expect(closenessOf(h, "npc:outlet", [me("a"), them("b", "npc:outlet")])).toBe(0);
    expect(closenessOf(h, "npc:outlet", [them("b", "npc:outlet"), me("a")])).toBe(1);
  });

  it("isCloser", () => {
    for (const t of ["good night!", "ok", "👍", "see you tomorrow", "Thanks!", "lol", "ok, see you later then"]) expect(isCloser(t)).toBe(true);
    for (const t of ["ok but where are you?", "Where are you?", "5", "", "Can we talk later?"]) expect(isCloser(t)).toBe(false);
  });

  it("dueDms, threadState and dmStatus read the clock", () => {
    let h = addMessage(seeded({ people }), "npc:zed", "hi", A("r1"), { at: 100 });
    h = { ...h, dmWait: { "npc:zed": { ...h.dmWait["npc:zed"], due: 400, seen: 300 } } };
    expect(dueDms(h, 399)).toEqual([]);
    expect(dueDms(h, 400)).toEqual([expect.objectContaining({ key: "npc:zed", due: 400 })]);
    expect(dueDms(h, 400, [msg("g")])).toEqual([]);
    expect(dmStatus(h, "npc:zed", 299)).toEqual({ seen: null });
    expect(dmStatus(h, "npc:zed", 300)).toEqual({ seen: 300 });
    expect(threadState(h, "npc:zed", 200)).toMatchObject({ turn: "them", closed: false, since: 100 });
    const answered = { ...h, threads: { "npc:zed": [...h.threads["npc:zed"], { id: "z1", from: "npc:zed", text: "hey", tick: 3, anchor: A("r1"), at: 400 }] } };
    expect(dueDms(answered, 500)).toEqual([]);
    expect(dmStatus(answered, "npc:zed", 500)).toBeNull();
    expect(threadState(answered, "npc:zed", 500)).toMatchObject({ turn: "you", closed: false });
    expect(threadState(answered, "npc:zed", 400 + 720).closed).toBe(true);
    const ended = { ...answered, threads: { "npc:zed": [...answered.threads["npc:zed"].slice(0, 1), { id: "z1", from: "npc:zed", text: "sure", tick: 3, anchor: A("r1"), at: 400, end: true }] } };
    expect(threadState(ended, "npc:zed", 401).closed).toBe(true);
    expect(normalizeHandset(ended).threads["npc:zed"][1].end).toBe(true);
  });

  it("phoneNote says whether the persona's last line was read and answered", () => {
    const name = { userName: "Ana", nameOf: (k) => (k === "char:mira" ? "Mira" : null) };
    const msgs = story(1);
    let h = addMessage(seeded(), "char:mira", "Where are you?", A("r1"), { at: 0 });
    /* a batch ran since (else a missing entry is planned on load) */
    h = { ...h, tick: { ...h.tick, n: 3 } };
    const note = (w) => phoneNote(chatWith({ ...h, dmWait: w === undefined ? {} : { "char:mira": { ...h.dmWait["char:mira"], ...w } } }, msgs), name);
    expect(note()).toContain('- Ana texted Mira: "Where are you?" (no answer)');
    expect(note({ seen: null, due: 50 })).toContain("(Mira has not read it yet)");
    expect(note({ seen: 100, due: 200 })).toContain("(Mira has not read it yet)");
    expect(note({ seen: 1, due: 200 })).toContain("(read, no answer yet)");
    expect(note({ seen: 1, due: null })).toContain("(read, no answer)]");
    expect(note()).toContain("a reply exists only if listed):");
  });
});

describe("loose anchors", () => {
  it("survive a swipe, go with the message, and are kept by cleanAnchor", () => {
    const m = story(2);
    const a = looseAnchorOf(m.at(-1));
    expect(a).toEqual({ id: "r2", swipe: 0, any: true });
    expect(looseAnchorOf(undefined)).toEqual(ROOT_ANCHOR);
    const swiped = m.map((x) => (x.id === "r2" ? addSwipe(x, "Other.") : x));
    expect(anchorVisible(a, swiped)).toBe(true);
    expect(anchorVisible(A("r2"), swiped)).toBe(false);
    expect(anchorVisible(a, story(1))).toBe(false);
    expect(cleanAnchor(a)).toEqual(a);
    expect(cleanAnchor({ id: "x", any: "yes" })).toEqual({ id: "x", swipe: 0 });
  });
});

describe("phoneAct", () => {
  const seeded = (level = "light") => ({ ...emptyHandset(level), tick: { ...emptyHandset(level).tick, seeded: true } });
  const dm = (text) => (h, o) => addMessage(h, "char:mira", text, o.anchor, { at: o.at });

  it("a DM stamps now + 1 and moves the clock by 1; an empty text spends nothing", () => {
    const m = story(2);
    const h = phoneAct(seeded(), m, "dm", dm("hi"));
    expect(h.threads["char:mira"][0]).toMatchObject({ at: 16, anchor: { id: "r2", any: true } });
    expect(h.dmWait["char:mira"].sent).toBe(16);
    expect(h.clock).toMatchObject({ min: 16, at: { id: "r2", any: true }, last: 0 });
    const same = seeded();
    expect(phoneAct(same, m, "dm", dm("   "))).toBe(same);
  });
  it("spends nothing before setup and leaves `at` out", () => {
    const h = phoneAct(emptyHandset("light"), story(1), "post", (x, o) => { expect(o.at).toBeUndefined(); return addPost(x, { text: "hello", at: o.at }, o.anchor); });
    expect(h.posts[0].at).toBeUndefined();
    expect(h.clock.min).toBe(0);
  });
  it("works in an empty chat: hung on the start, and it shows", () => {
    const h = phoneAct(seeded(), [], "post", (x, o) => addPost(x, { text: "first", at: o.at }, o.anchor));
    expect(h.posts[0]).toMatchObject({ text: "first", at: 3, anchor: ROOT_ANCHOR });
    expect(visiblePhone(h, []).posts).toHaveLength(1);
    expect(h.clock.min).toBe(3);
  });
  it("a story, a comment and a transfer each take their time", () => {
    const m = story(1);
    let h = phoneAct(seeded(), m, "story", (x, o) => addStory(x, { text: "sunset", at: o.at }, o.anchor));
    expect(h.stories[0].at).toBe(12);
    h = phoneAct(h, m, "transfer", (x, o) => transfer(x, { to: "char:mira", amount: 5, anchor: o.anchor, at: o.at }));
    expect(h.bank.tx[0].at).toBe(13);
    expect(normalizeHandset(h).bank.tx[0].at).toBe(13);
    /* too much money: nothing took, nothing spent */
    expect(phoneAct(h, m, "transfer", (x, o) => transfer(x, { to: "char:mira", amount: 1e12, at: o.at }))).toBe(h);
    expect(receive(h, { fromName: "Shop", amount: 3, at: 20 }).bank.tx[0].at).toBe(20);
  });
  it("the persona's DM survives a regenerated reply", () => {
    const m = story(2);
    const h = phoneAct(seeded(), m, "dm", dm("hi"));
    const swiped = m.map((x) => (x.id === "r2" ? addSwipe(x, "Other.") : x));
    expect(visiblePhone(h, swiped).threads["char:mira"]).toHaveLength(1);
  });
});

describe("keepPhoneOnDelete", () => {
  it("moves loose items, the clock's anchors and loose world log entries to the message before; strict ones stay", () => {
    const m = story(2);
    const loose = looseAnchorOf(m.at(-1));
    const h = normalizeHandset({
      ...emptyHandset("light"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true },
      clock: { min: 30, at: loose, sync: loose, step: "sync", last: 0 },
      posts: [{ id: "p1", by: YOU, text: "a", kind: "post", stats: {}, tick: 1, anchor: loose }, { id: "p2", by: "npc:x", text: "b", kind: "post", stats: {}, tick: 1, anchor: A("r2") }],
      threads: { "char:mira": [{ id: "l1", from: YOU, text: "hi", tick: 1, anchor: loose, at: 20 }] },
      bank: { balance: 100, tx: [{ id: "t1", kind: "sent", amount: 5, to: "char:mira", tick: 1, anchor: loose }] },
    });
    const chat = chatWith(h, m, { world: { log: [{ id: "w1", text: "x", anchor: loose }, { id: "w2", text: "y", anchor: A("r2") }] } });
    const out = keepPhoneOnDelete(chat, "r2");
    const to = looseAnchorOf(m.at(-2));
    expect(out.handset.posts.map((p) => p.anchor)).toEqual([to, A("r2")]);
    expect(out.handset.threads["char:mira"][0].anchor).toEqual(to);
    expect(out.handset.bank.tx[0].anchor).toEqual(to);
    expect(out.handset.clock).toMatchObject({ at: to, sync: to });
    expect(out.world.log.map((e) => e.anchor)).toEqual([to, A("r2")]);
    expect(out.messages).toBe(chat.messages);
    /* the first message: to the chat's start */
    expect(keepPhoneOnDelete(chatWith(h, [m[0]]), "g")).toBeTruthy();
    expect(keepPhoneOnDelete(chat, "nope")).toBe(chat);
  });
});

describe("stories expire", () => {
  it("after STORY_LIFE replies, or a day on the phone's clock", () => {
    const base = { ...emptyHandset("light"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true } };
    const st = (id, extra) => ({ id, by: "npc:x", text: "s", stats: { likes: 1, replies: 0 }, pot: { likes: 1 }, tick: 1, anchor: ROOT_ANCHOR, ...extra });
    const h = normalizeHandset({ ...base, stories: [st("old", { at: -1500 }), st("new", { at: -100 })] });
    expect(visiblePhone(h, story(1)).stories.map((s) => s.id)).toEqual(["new"]);
    expect(visiblePhone(h, story(STORY_LIFE)).stories).toEqual([]);
    /* before setup the clock is not read */
    expect(visiblePhone({ ...h, tick: { ...h.tick, seeded: false } }, story(1)).stories).toHaveLength(2);
  });
});

describe("mentions", () => {
  const seededWith = (posts, stories = []) => normalizeHandset({ ...emptyHandset("light"), tick: { n: 2, lastMsgId: null, pending: false, seeded: true }, posts, stories });
  const post = (id, by, text, extra = {}) => ({ id, by, text, kind: "post", stats: {}, tick: 2, anchor: ROOT_ANCHOR, ...extra });
  it("comments, quotes and @handles; not a plain name; one per post; a story's @handle", () => {
    const h = seededWith([
      post("c1", "npc:a", "nice", { kind: "reply", ref: "mine" }),
      post("q1", "npc:b", "lol @ana", { kind: "quote", ref: "mine" }),
      post("m1", "npc:c", "hey @Ana_Lee!"),
      post("m2", "npc:c", "@ana_leeds is someone else"),
      post("n1", "npc:d", "Ana Lee is here"),
      post("r1", "npc:e", "@you ok", { kind: "reply", ref: "theirs" }),
      post("theirs", "npc:f", "x"),
      post("mine", YOU, "mine", { tick: 1 }),
    ], [{ id: "s1", by: "npc:g", text: "with", photo: "selfie tagging @ana_lee", stats: {}, tick: 2, anchor: ROOT_ANCHOR }]);
    const list = mentionsOf(h, { userName: "Ana Lee" });
    expect(list.map((x) => [x.id, x.kind])).toEqual([["n:c1", "comment"], ["n:q1", "quote"], ["n:m1", "mention"], ["n:r1", "mention"], ["n:story:s1", "mention"]]);
    expect(list.at(-1)).toMatchObject({ story: "s1" });
    expect(list.at(-1).post).toBeUndefined();
    expect(list.every((x) => x.unread)).toBe(true);
    expect(notificationsOf(h, { userName: "Ana Lee" })).toHaveLength(5);
    /* seen */
    expect(mentionsOf(markSeen(h, "mentions"), { userName: "Ana Lee" }).some((x) => x.unread)).toBe(false);
    expect(unread(markSeen(h, "mentions"), [], { userName: "Ana Lee" }).total).toBe(0);
    expect(markSeen(h, { mentions: 5 }).seen.mentions).toBe(5);
    expect(markSeen(markSeen(h, { mentions: 5 }), { mentions: 1 }).seen.mentions).toBe(5);
  });
  it("seen.mentions defaults to seen.feed on an older save", () => {
    expect(normalizeHandset({ ...emptyHandset("light"), seen: { feed: 4 } }).seen.mentions).toBe(4);
    expect(normalizeHandset({ ...emptyHandset("light"), seen: { feed: 4, mentions: 2 } }).seen.mentions).toBe(2);
  });
});

describe("reply counts follow the stats", () => {
  it("a big post shows far more replies than are stored; never fewer than stored", () => {
    const big = { id: "p1", by: "npc:star", text: "x", kind: "post", stats: { likes: 50000 }, pot: { likes: 100000 }, tick: 1, anchor: ROOT_ANCHOR };
    const kids = [1, 2].map((i) => ({ id: `c${i}`, by: "npc:a", text: "r", kind: "reply", ref: "p1", stats: {}, tick: 1, anchor: ROOT_ANCHOR }));
    const h = normalizeHandset({ ...emptyHandset("light"), posts: [big, ...kids] });
    const p = h.posts.find((x) => x.id === "p1");
    expect(p.pot.replies).toBeGreaterThanOrEqual(5000);
    expect(p.stats.replies).toBeGreaterThanOrEqual(2);
    /* the persona's own post not yet woken stays at the stored count */
    const mine = normalizeHandset({ ...emptyHandset("light"), posts: [{ ...big, by: YOU, stats: {}, pot: {} }, ...kids] }).posts[0];
    expect(mine.pot.replies).toBe(2);
    expect(mine.stats.replies).toBe(2);
  });
});

describe("usage", () => {
  it("cleanUsage keeps finite non-negative numbers; addUsage counts", () => {
    expect(cleanUsage({ calls: -1, tokensIn: "x", tokensOut: 5.4, cost: 0.02, est: 1, byMode: { refresh: { calls: 2, tokensIn: 10, tokensOut: NaN }, junk: { calls: 1 } } }))
      .toEqual({ calls: 0, tokensIn: 0, tokensOut: 5, cost: 0.02, est: 1, byMode: { refresh: { calls: 2, tokensIn: 10, tokensOut: 0 } } });
    expect(usageOf(emptyHandset("light"))).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, est: 0, byMode: {} });
    const h = addUsage(addUsage(emptyHandset("light"), { mode: "refresh", tokensIn: 100, tokensOut: 20, est: true }), { mode: "sync", tokensIn: 50, tokensOut: 10, cost: 0.01 });
    expect(usageOf(h)).toEqual({ calls: 2, tokensIn: 150, tokensOut: 30, cost: 0.01, est: 1, byMode: { refresh: { calls: 1, tokensIn: 100, tokensOut: 20 }, sync: { calls: 1, tokensIn: 50, tokensOut: 10 } } });
    expect(normalizeHandset(h).usage).toEqual(h.usage);
    expect(normalizeHandset(emptyHandset("light")).usage).toBeUndefined();
  });
});

describe("phoneNote: since the last story message", () => {
  const nameOf = (k) => (k === "char:mira" ? "Mira" : null);
  const base = (extra = {}) => normalizeHandset({ ...emptyHandset("light"), tick: { n: 1, lastMsgId: null, pending: false, seeded: true }, ...extra });
  const msgs = [msg("u1", "user", { wt: 0 }), msg("r1", "assistant", { wt: 5 })];
  const line = (id, from, text, at) => ({ id, from, text, tick: 1, anchor: { id: "r1", swipe: 0, any: true }, at });

  it("says how long passed and carries the DMs since, with the thread's state", () => {
    const h = base({
      clock: { min: 185, at: { id: "r1", swipe: 0, any: true }, step: "sync", last: 0 },
      threads: { "char:mira": [line("old", "char:mira", "earlier", 2), line("a", YOU, "Where are you?", 100), line("b", "char:mira", "Home. Good night.", 120)] },
    });
    const note = phoneNote(chatWith(h, msgs), { userName: "Ana", nameOf });
    const lines = note.split("\n");
    expect(lines[0]).toBe("[Since the last story message, on Ana's phone (about 3 hours passed in the story):");
    expect(note).toContain('Texts with Mira:\nAna: "Where are you?"\nMira: "Home. Good night."\n(conversation ended)\nContinue the story from here, after this time.]');
    expect(note).not.toContain('earlier"\n(');
    /* the lines shown there are not repeated below */
    expect(note).not.toContain("Mira texted Ana: \"Home");
    expect(note).toContain('Mira texted Ana: "earlier"');
  });
  it("keeps the newest 12 lines of a thread; the state of an unread DM", () => {
    const many = Array.from({ length: 15 }, (_, i) => line(`l${i}`, i % 2 ? "char:mira" : YOU, `line ${i}`, 10 + i));
    many.push(line("last", YOU, "you there?", 40));
    const h = base({ clock: { min: 50, at: { id: "r1", swipe: 0, any: true }, step: "sync", last: 0 }, threads: { "char:mira": many }, dmWait: { "char:mira": { line: "last", sent: 40, due: 400, seen: 300 } } });
    const note = phoneNote(chatWith(h, msgs), { userName: "Ana", nameOf });
    expect(note).toContain("Texts with Mira:\n…\n");
    expect(note.match(/^(Ana|Mira): "/gm)).toHaveLength(12);
    expect(note).toContain("(Mira has not read it yet)");
    expect(note.split("\n")[0]).toContain("about 45 minutes passed");
  });
  it("stays inside its budget, and is absent before setup or with nothing since", () => {
    const long = Array.from({ length: 12 }, (_, i) => line(`l${i}`, YOU, "x".repeat(200), 10 + i));
    const h = base({ clock: { min: 50, at: { id: "r1", swipe: 0, any: true }, step: "sync", last: 0 }, threads: { "char:mira": long } });
    const note = phoneNote(chatWith(h, msgs), { userName: "Ana", nameOf });
    const block = note.slice(0, note.indexOf("after this time.]") + "after this time.]".length);
    expect(block.length).toBeLessThanOrEqual(1600);
    expect(phoneNote(chatWith({ ...h, tick: { ...h.tick, seeded: false } }, msgs), { userName: "Ana", nameOf })).not.toContain("Since the last story message");
    /* 5 minutes and nothing done: no block */
    expect(phoneNote(chatWith(base({ clock: { min: 10, at: { id: "r1", swipe: 0, any: true }, step: "sync", last: 0 } }), msgs), { userName: "Ana" })).toBe("");
  });
});

describe("settings cleanup", () => {
  it("normalizeData drops the retired automatic phone refresh", () => {
    const d = normalizeData({ ...structuredClone(emptyData), settings: { ...structuredClone(emptyData).settings, phoneAutoRefresh: true } });
    expect("phoneAutoRefresh" in d.settings).toBe(false);
  });
});
