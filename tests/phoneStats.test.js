import { describe, it, expect } from "vitest";
import {
  rng, potBand, newPot, statsOf, ageOf, rebase, applyEvent, personaAction,
  responseChance, ownPostPot, ownReplySlots, replyPot, DM_GAP_MIN, followersAfter, clampModelNumber, dmReply, DM_TABLE, DM_PROFILES, DM_ORDER,
} from "../src/lib/phoneStats.js";

const mk = (id, fame = 1) => {
  const author = { fame };
  const post = { id, tick: 3, ago: 0, t0: 0, stats: { likes: 2, reposts: 0, replies: 0, quotes: 0 } };
  post.pot = newPot(post, author);
  post.pot.likes = Math.max(post.pot.likes, 2);
  return { post, author };
};

describe("phoneStats", () => {
  it("rng is deterministic and in [0,1)", () => {
    const a = rng("x"), b = rng("x");
    for (let i = 0; i < 20; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect(rng("y")()).not.toBe(rng("x")());
  });
  it("bands", () => {
    expect(potBand(0).likes).toEqual([0, 15]);
    expect(potBand(3).likes).toEqual([2000, 400000]);
  });
  it("same seed gives same pot", () => {
    const { post, author } = mk("p1", 2);
    expect(newPot(post, author)).toEqual(newPot(post, author));
  });
  it("is monotone with age, never above pot or below stats", () => {
    for (let i = 0; i < 30; i++) {
      const { post } = mk("m" + i, i % 4);
      let prev = statsOf(post, 0);
      for (let age = 0; age < 40; age += 0.5) {
        const s = statsOf(post, age);
        for (const k of Object.keys(s)) {
          expect(s[k]).toBeGreaterThanOrEqual(prev[k]);
          expect(s[k]).toBeGreaterThanOrEqual(post.stats[k]);
          expect(s[k]).toBeLessThanOrEqual(Math.max(post.pot[k], post.stats[k]));
        }
        prev = s;
      }
    }
  });
  it("handles missing t0, pot and negative age", () => {
    expect(statsOf({ stats: { likes: 4 } }, -3).likes).toBe(4);
    expect(ageOf({}, 2)).toBe(2);
    expect(ageOf({ ago: 60 }, 1)).toBe(3);
  });
  it("scales with fame", () => {
    const avg = (t) => { let s = 0; for (let i = 0; i < 200; i++) s += newPot({ id: "s" + i, tick: 1 }, { fame: t }).likes; return s / 200; };
    const a = [0, 1, 2, 3].map(avg);
    expect(a[0]).toBeLessThan(a[1]); expect(a[1]).toBeLessThan(a[2]); expect(a[2]).toBeLessThan(a[3]);
  });
  it("heat is clamped", () => {
    const p = { id: "h", tick: 0 };
    expect(newPot(p, { fame: 1 }, { heat: 100 }).likes).toBeLessThanOrEqual(300);
    expect(newPot(p, { fame: 1 }, { heat: 3 }).likes).toBeGreaterThanOrEqual(newPot(p, { fame: 1 }, { heat: 0.5 }).likes);
  });
  it("like and repost show at once; reply and quote too", () => {
    const { post, author } = mk("a", 1);
    const before = statsOf(post, 5);
    const l = personaAction(post, "like", { persona: { fame: 0 }, author, age: 5 });
    expect(statsOf(l, 5).likes).toBe(before.likes + 1);
    const r = personaAction(post, "repost", { persona: { fame: 0 }, author, age: 5 });
    expect(statsOf(r, 5).reposts).toBe(before.reposts + 1);
    expect(statsOf(personaAction(post, "reply", { persona: {}, author, age: 5 }), 5).replies).toBe(before.replies + 1);
    expect(statsOf(personaAction(post, "quote", { persona: {}, author, age: 5 }), 5).quotes).toBe(before.quotes + 1);
  });
  it("star repost of a small account raises pot 2-6x", () => {
    const { post, author } = mk("b", 0);
    const base = rebase(post, 0);
    const r = personaAction(post, "repost", { persona: { fame: 3 }, author, age: 0 });
    expect(r.pot.likes).toBeGreaterThanOrEqual(base.pot.likes * 2 - 1);
    expect(r.pot.likes).toBeLessThanOrEqual(base.pot.likes * 6 + 1);
  });
  it("events", () => {
    const { post, author } = mk("e", 1);
    const shown = statsOf(post, 4);
    const v = applyEvent(post, "viral", { author, age: 4 });
    expect(v.pot.likes).toBeGreaterThan(post.pot.likes);
    expect(v.pot.likes).toBeLessThanOrEqual(300);
    expect(statsOf(v, 4)).toEqual(shown);
    const ra = applyEvent(post, "ratio", { author, age: 4 });
    expect(ra.pot.replies).toBeGreaterThanOrEqual(Math.ceil(0.9 * ra.pot.likes));
    expect(ra.pot.quotes).toBeGreaterThanOrEqual(Math.ceil(0.9 * ra.pot.likes));
    const f = applyEvent(post, "fades", { author, age: 4 });
    expect(f.pot).toEqual(f.stats);
    expect(statsOf(f, 100)).toEqual(shown);
  });
  it("clampModelNumber", () => {
    expect(clampModelNumber("12.4K", [0, 50000])).toBe(12400);
    expect(clampModelNumber("1.2M", [2000, 400000])).toBe(400000);
    expect(clampModelNumber(3, potBand(1))).toBe(5);
    expect(clampModelNumber("x", [0, 9])).toBeNull();
  });
  it("response chances match the table", () => {
    expect(responseChance({ fame: 2 }, { fame: 1 }, "like", {})).toBe(0.25);
    expect(responseChance({ fame: 1 }, { fame: 1 }, "like", {})).toBe(0);
    expect(responseChance({ fame: 3 }, { fame: 0 }, "repost", {})).toBe(0.5);
    expect(responseChance({ fame: 0 }, { fame: 0 }, "reply", {})).toBeCloseTo(0.7);
    expect(responseChance({ fame: 0 }, { fame: 3 }, "reply", {})).toBeCloseTo(0.04);
    expect(responseChance({ fame: 2 }, { fame: 0 }, "reply", {})).toBe(0.95);
    expect(responseChance({ fame: 2 }, { fame: 1 }, "reply", {})).toBeCloseTo(0.65);
    expect(responseChance({ fame: 0 }, { fame: 3 }, "reply", { storyCharacter: true })).toBe(0.9);
    expect(responseChance({ fame: 0 }, { fame: 0 }, "quote", {})).toBeCloseTo(0.42);
    expect(responseChance({ fame: 0 }, { fame: 3 }, "dm", { storyCharacter: true })).toBe(1);
    expect(responseChance({ fame: 0 }, { fame: 2 }, "dm", {})).toBeCloseTo(0.15);
  });
  it("own post pot and followers", () => {
    for (let t = 0; t < 4; t++) {
      const p = ownPostPot({ fame: t }, 1000, "z" + t);
      const lim = [[0, 1], [1, 3], [3, 6], [5, 8]][t];
      expect(p.replies).toBeGreaterThanOrEqual(lim[0]);
      /* replies: the larger of the reply slots and the ratio of likes */
      const slots = ownReplySlots({ fame: t }, "z" + t);
      expect(slots).toBeGreaterThanOrEqual(lim[0]); expect(slots).toBeLessThanOrEqual(lim[1]);
      expect(p.replies).toBeGreaterThanOrEqual(slots);
      expect(p.replies).toBeLessThanOrEqual(Math.max(slots, Math.round(p.likes * 0.12)));
    }
    expect(ownPostPot({ fame: 3 }, 1e6, "q")).toEqual(ownPostPot({ fame: 3 }, 1e6, "q"));
    expect(followersAfter(100, 500)).toBeGreaterThan(100);
    expect(followersAfter(-5, -10)).toBe(0);
    expect(followersAfter(100, 50)).toBeLessThanOrEqual(followersAfter(100, 60));
  });
  it("defect 1: overflowed age stays finite and keeps growth", () => {
    const age = ageOf({ ago: Number.MAX_VALUE }, Number.MAX_VALUE);
    expect(Number.isFinite(age)).toBe(true);
    expect(age).toBeLessThanOrEqual(1e9);
    const post = { stats: { likes: 2 }, pot: { likes: 100 } };
    expect(statsOf(post, age).likes).toBe(100);
    expect(statsOf(post, Infinity).likes).toBe(100);
  });
  it("defect 2: repost multiplication never overflows the pot", () => {
    const post = { stats: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, pot: { likes: 1e308, reposts: 1e308, replies: 1e308, quotes: 1e308 } };
    const r = personaAction(post, "repost", { persona: { fame: 3 }, author: { fame: 0 }, age: 0 });
    for (const k of Object.keys(r.pot)) {
      expect(Number.isFinite(r.pot[k])).toBe(true);
      expect(r.pot[k]).toBeLessThanOrEqual(1e15);
      expect(r.pot[k]).toBeGreaterThanOrEqual(r.stats[k]);
    }
  });
  it("defect 3: followersAfter is finite and capped", () => {
    expect(followersAfter(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(1e12);
    expect(followersAfter(Number.MAX_VALUE, 1e6)).toBeLessThanOrEqual(1e12);
    expect(Number.isFinite(followersAfter(5, Infinity))).toBe(true);
  });
  it("defect 4: newPot is log-uniform over [lo, hi]", () => {
    for (let i = 0; i < 100; i++) {
      const post = { id: "lg" + i, tick: 2 };
      const u = rng("lg" + i + ":2")();
      const expected = Math.round(Math.exp(Math.log(100) + (Math.log(8000) - Math.log(100)) * u));
      expect(newPot(post, { fame: 2 }).likes).toBe(expected);
    }
  });
  it("defect 5: one seed helper, omitted seed is own", () => {
    const a = { fame: 1 };
    expect(newPot(undefined, a)).toEqual(newPot("own", a));
    expect(ownPostPot(a, 100, null)).toEqual(ownPostPot(a, 100));
    expect(ownPostPot(a, 100)).toEqual(ownPostPot(a, 100, "own"));
    expect(ownPostPot(a, 100, { id: "a", tick: 1 })).toEqual(ownPostPot(a, 100, "a:1"));
  });
  it("defect 6: own post likes floor at 1", () => {
    expect(ownPostPot({ fame: 0 }, 0, "s").likes).toBeGreaterThanOrEqual(1);
  });
  it("defect 7: clampModelNumber returns an integer inside the band", () => {
    expect(clampModelNumber(1.1, [1.1, 2.9])).toBe(2);
    expect(clampModelNumber(2.9, [1.1, 2.9])).toBe(2);
    expect(clampModelNumber(1.2, [1.1, 1.9])).toBe(2);
  });
});

describe("birthStats", () => {
  it("is about 35% of pot, never zero above 3, never above pot", async () => {
    const { birthStats } = await import("../src/lib/phoneStats.js");
    expect(birthStats({ likes: 100, reposts: 20, replies: 4, quotes: 3 })).toEqual({ likes: 35, reposts: 7, replies: 1, quotes: 1 });
    expect(birthStats({ likes: 0, reposts: 1 })).toEqual({ likes: 0, reposts: 0, replies: 0, quotes: 0 });
    for (let p = 0; p < 50; p++) { const s = birthStats({ likes: p }).likes; expect(s).toBeLessThanOrEqual(p); if (p > 3) expect(s).toBeGreaterThan(0); }
  });
});

describe("dmReply", () => {
  const many = (opts, n = 1000) => Array.from({ length: n }, (_, i) => dmReply({ ...opts, seed: `s${i}:dm` }));
  const share = (list, f) => list.filter(f).length / list.length;

  it("is the same for the same seed", () => {
    for (let i = 0; i < 20; i++) expect(dmReply({ gap: 1, closeness: 1, seed: `x${i}` })).toEqual(dmReply({ gap: 1, closeness: 1, seed: `x${i}` }));
  });

  it("a cold DM to a star three tiers up almost never gets an answer, never at once, and is never opened", () => {
    const out = many({ gap: 3, closeness: 0 });
    expect(share(out, (r) => r.answer)).toBeLessThanOrEqual(0.05);
    for (const r of out.filter((x) => x.answer)) expect(r.delay).toBeGreaterThanOrEqual(2);
    for (const r of out.filter((x) => !x.answer)) { expect(r.delay).toBeNull(); expect(r.seen).toBeNull(); }
  });

  it("someone close at the same fame answers nearly always, often at once, mostly within three hours", () => {
    const out = many({ gap: 0, closeness: 3 });
    const yes = out.filter((r) => r.answer);
    expect(yes.length / out.length).toBeGreaterThanOrEqual(0.95);
    expect(share(yes, (r) => r.delay === 0)).toBeGreaterThanOrEqual(0.35);
    expect(share(yes, (r) => r.delay <= 180)).toBeGreaterThanOrEqual(0.85);
    for (const r of yes) { expect(r.seen).toBeLessThanOrEqual(r.delay); expect(r.seen).toBeGreaterThanOrEqual(0); }
  });

  it("the table: the chance never rises with the fame gap and never falls with closeness; profiles sum to 1", () => {
    for (let g = 0; g < DM_TABLE.length; g++) for (let c = 0; c < 4; c++) {
      if (g) expect(DM_TABLE[g][c][0]).toBeLessThanOrEqual(DM_TABLE[g - 1][c][0]);
      if (c) expect(DM_TABLE[g][c][0]).toBeGreaterThanOrEqual(DM_TABLE[g][c - 1][0]);
      expect(DM_ORDER).toContain(DM_TABLE[g][c][1]);
    }
    for (const p of Object.values(DM_PROFILES)) expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("the table has seven rows, gaps -3..+3; friends and close people ignore fame", () => {
    expect(DM_GAP_MIN).toBe(-3);
    expect(DM_TABLE).toHaveLength(7);
    for (const row of DM_TABLE) expect(row).toHaveLength(4);
    for (let i = 0; i < 20; i++) for (const c of [2, 3]) {
      const at0 = dmReply({ gap: 0, closeness: c, seed: `k${i}` });
      expect(dmReply({ gap: -3, closeness: c, seed: `k${i}` })).toEqual(at0);
      expect(dmReply({ gap: 3, closeness: c, seed: `k${i}` })).toEqual(at0);
    }
    /* beyond the table: clamped */
    for (let i = 0; i < 20; i++) expect(dmReply({ gap: -7, closeness: 0, seed: `k${i}` })).toEqual(dmReply({ gap: -3, closeness: 0, seed: `k${i}` }));
  });

  it("someone far below the persona answers nearly always and fast; more so the bigger the gap", () => {
    const out = many({ gap: -3, closeness: 0 });
    const yes = out.filter((r) => r.answer);
    expect(yes.length / out.length).toBeGreaterThanOrEqual(0.9);
    expect(share(yes, (r) => r.delay <= 30)).toBeGreaterThanOrEqual(0.6);
    const answered = (g) => share(many({ gap: g, closeness: 0 }), (r) => r.answer);
    expect(answered(-1)).toBeLessThan(answered(-2));
    expect(answered(-2)).toBeLessThan(answered(-3));
  });

  it("someone active in the thread answers sooner; a closer halves the chance", () => {
    const mean = (list) => { const d = list.filter((r) => r.answer).map((r) => r.delay); return d.reduce((a, b) => a + b, 0) / d.length; };
    expect(mean(many({ gap: 1, closeness: 1, active: true }))).toBeLessThan(mean(many({ gap: 1, closeness: 1 })));
    expect(share(many({ gap: 1, closeness: 1, active: true }), (r) => r.answer)).toBeGreaterThanOrEqual(0.85);
    const plain = share(many({ gap: 1, closeness: 1 }), (r) => r.answer);
    const closer = share(many({ gap: 1, closeness: 1, closer: true }), (r) => r.answer);
    expect(closer).toBeGreaterThan(plain * 0.4);
    expect(closer).toBeLessThan(plain * 0.6);
  });
});

describe("replyPot", () => {
  it("is 5-12% of the likes ceiling, repeatable", () => {
    for (let i = 0; i < 50; i++) {
      const post = { id: `p${i}`, pot: { likes: 10000 } };
      const r = replyPot(post);
      expect(r).toBeGreaterThanOrEqual(500);
      expect(r).toBeLessThanOrEqual(1200);
      expect(replyPot(post)).toBe(r);
    }
    expect(replyPot({ id: "x" })).toBe(0);
  });
});
