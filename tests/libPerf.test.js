// @vitest-environment jsdom
/* The faster src/lib functions give exactly what the old ones gave. Each is
   checked against a copy of its old implementation (tests/legacy/) on large
   generated inputs (tests/legacy/gen.js). Timings: tests/perf.bench.js. */
import { describe, expect, it } from "vitest";
import { keyMatches, selectLore, triggered, withLoreMemo } from "../src/lib/lore.js";
import { indexMessages, searchRelevantContext } from "../src/lib/rag.js";
import { displayHtml } from "../src/lib/html.js";
import { breakdownTokens, calculateHistoryTokens, calculateMemoryTokens, estimateTokens } from "../src/lib/tokens.js";
import { tavernRegex } from "../src/lib/tavern.js";
import * as oldLore from "./legacy/lore.js";
import * as oldRag from "./legacy/rag.js";
import * as oldHtml from "./legacy/html.js";
import * as oldTokens from "./legacy/tokens.js";
import { LORE_WORDS, history, lorebooks, rng, scopeReplies } from "./legacy/gen.js";

const HISTORY = history(1000);
const BOOKS = lorebooks(300);
const REPLIES = scopeReplies(80);

describe("lore matching (compiled keys, one lowercase per scan)", () => {
  const texts = [0, 3, 10, 40].map((depth) => oldLore.scanText(HISTORY.slice(0, 500 + depth * 7), depth || 1));

  it("keyMatches agrees on every key of a 300-entry lorebook", () => {
    let hits = 0;
    for (const b of BOOKS) {
      for (const e of b.entries) {
        for (const k of [...e.keys, ...e.secondaryKeys]) {
          for (const t of texts) {
            for (const cs of [false, true]) {
              const want = oldLore.keyMatches(k, t, cs);
              expect(keyMatches(k, t, cs)).toBe(want);
              /* twice: a cached /g or /y key must start from the top */
              expect(keyMatches(k, t, cs)).toBe(want);
              hits += want ? 1 : 0;
            }
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("triggered and selectLore pick the same entries", () => {
    for (const t of texts) {
      for (const b of BOOKS) for (const e of b.entries) expect(triggered(e, t)).toBe(oldLore.triggered(e, t));
    }
    for (const [depth, budget] of [[1, 600], [4, 2000], [10, 100000], [40, 800]]) {
      for (const end of [10, 300, 1000]) {
        const h = HISTORY.slice(0, end);
        const want = oldLore.selectLore(BOOKS, h, { depth, budget });
        expect(want.triggered.length + want.constant.length).toBeGreaterThan(0);
        expect(selectLore(BOOKS, h, { depth, budget })).toEqual(want);
        expect(withLoreMemo(() => [selectLore(BOOKS, h, { depth, budget }), selectLore(BOOKS, h, { depth, budget })])).toEqual([want, want]);
      }
    }
  });

  it("keeps the old handling of odd keys", () => {
    const t = "The Vale at dawn. VALE! valley. St. Mary's bell. c++ and $5.";
    for (const k of ["Vale", "vale", "/vale/", "/VALE/g", "/vale/y", "/([broken/", "St. Mary's", "C++", "$5", "/a/z", "//", "Vale ", " Vale"]) {
      for (const cs of [false, true, 0, 1]) expect(keyMatches(k, t, cs)).toBe(oldLore.keyMatches(k, t, cs));
    }
    expect(() => keyMatches(5, t, false)).toThrow();
    expect(() => oldLore.keyMatches(5, t, false)).toThrow();
  });
});

describe("recall (cached term counts)", () => {
  const queries = [
    ...HISTORY.slice(-30).map((m) => m.content),
    "the and of",
    "Ember Court ledger",
    "café naïve résumé",
    "漢字のテキスト",
    ...LORE_WORDS,
  ];

  it("indexes 1,000 messages exactly as before, cached or not", () => {
    const want = oldRag.indexMessages(HISTORY);
    expect(indexMessages(HISTORY)).toEqual(want);
    expect(indexMessages(HISTORY)).toEqual(want);
    expect(indexMessages(["plain", "strings", "", null])).toEqual(oldRag.indexMessages(["plain", "strings", "", null]));
  });

  it("recalls the same messages in the same order", () => {
    const older = HISTORY.slice(0, 900);
    /* the old search on a list builds exactly this index first; built once
       here so the test does not rebuild it per query */
    const oldIndex = oldRag.indexMessages(older);
    let found = 0;
    for (const q of queries) {
      for (const opts of [undefined, { topK: 8, threshold: 0.05 }]) {
        const want = oldRag.searchRelevantContext(q, oldIndex, opts);
        expect(searchRelevantContext(q, older, opts)).toEqual(want);
        found += want.length;
      }
    }
    expect(found).toBeGreaterThan(queries.length);
    expect(searchRelevantContext(queries[0], older)).toEqual(oldRag.searchRelevantContext(queries[0], older));
  }, 30000);

  it("follows edits, whether the message is replaced or changed in place", () => {
    const msgs = HISTORY.slice(0, 50).map((m) => ({ ...m }));
    searchRelevantContext("lantern", msgs);
    msgs[5] = { ...msgs[5], content: "A wholly different lantern ember Nightbell." };
    msgs[6].content = "Changed in place: Nightbell Nightbell.";
    expect(indexMessages(msgs)).toEqual(oldRag.indexMessages(msgs));
    expect(searchRelevantContext("Nightbell", msgs, { topK: 5, threshold: 0 })).toEqual(oldRag.searchRelevantContext("Nightbell", msgs, { topK: 5, threshold: 0 }));
  });
});

describe("displayHtml (memo)", () => {
  const rules = tavernRegex([
    { scriptName: "Color", findRegex: "/<(pink|teal)>([\"“][^\"”]+[\"”])<\\/\\1>/gi", replaceString: "<span style=\"color:$1;\">$2</span>", placement: [2], markdownOnly: true },
    { scriptName: "Bars", findRegex: "/BOND: (\\d+)/g", replaceString: "<div style=\"width:$1%;position:fixed\">$1</div>", placement: [2], markdownOnly: true, minDepth: 0, maxDepth: 1 },
    { scriptName: "Users", findRegex: "/Mira/g", replaceString: "<b>Mira</b>", placement: [1], markdownOnly: true },
  ], "display");
  const other = tavernRegex([{ scriptName: "Teal", findRegex: "/Elena/g", replaceString: "<i>Elena</i>", placement: [1, 2], markdownOnly: true }], "display");

  it("renders replies exactly as before, cached or not", () => {
    const texts = [
      ...REPLIES.slice(0, 20),
      ...HISTORY.slice(0, 40).map((m) => m.content),
      '*She waves.* <pink>"Hi!"</pink> BOND: 40',
      "Text.\n\n<details>\n<summary>BONDS</summary>\n- <b>A</b>\n</details><!-- hidden --><script>x()</script>",
    ];
    for (const t of texts) {
      for (const [r, role, depth] of [[rules, "assistant", 0], [rules, "assistant", 3], [rules, "user", 0], [other, "assistant", 0], [undefined, "assistant", 0]]) {
        const want = oldHtml.displayHtml(t, r, role, depth);
        expect(displayHtml(t, r, role, depth)).toBe(want);
        expect(displayHtml(t, r, role, depth)).toBe(want);
      }
    }
  });

  it("keeps odd arguments apart from strings that look like them", () => {
    expect(displayHtml(undefined, rules, "assistant", 0)).toBe(oldHtml.displayHtml(undefined, rules, "assistant", 0));
    expect(displayHtml("undefined", rules, "assistant", 0)).toBe(oldHtml.displayHtml("undefined", rules, "assistant", 0));
    expect(displayHtml("BOND: 5", rules, "assistant", "3")).toBe(oldHtml.displayHtml("BOND: 5", rules, "assistant", "3"));
  });
});

describe("token counts", () => {
  it("estimateTokens counts exactly as before", () => {
    const r = rng(5);
    const samples = [
      "", " ", "\n\n\n", "it's they're I'll we've", "漢字のテキスト、カタカナ ｶﾀｶﾅ", "emoji 😀😀 👍🏽 done",
      "numbers 123 4.56 7,890", "   trailing   ", "a b c", "x".repeat(10000),
      "lone \ud800 high, \udc00 low, combining é and ﻿ marks",
      ...HISTORY.map((m) => m.content),
      ...REPLIES,
      ...Array.from({ length: 200 }, () => Array.from({ length: 50 }, () => String.fromCharCode(32 + Math.floor(r() * 0x3000))).join("")),
    ];
    for (const s of samples) expect(estimateTokens(s)).toBe(oldTokens.estimateTokens(s));
    expect(estimateTokens(HISTORY.map((m) => m.content).join("\n"))).toBe(oldTokens.estimateTokens(HISTORY.map((m) => m.content).join("\n")));
    expect(estimateTokens(12345)).toBe(oldTokens.estimateTokens(12345));
  });

  const character = {
    name: "Mira",
    description: "A smuggler who keeps {{user}}'s secrets.",
    personality: "Dry, careful.",
    scenario: "Harbor town at night.",
    exampleDialogs: "<START>\n{{char}}: Keep your voice down.",
    systemPrompt: "Stay terse.",
    firstMessage: "*Mira looks up.*",
  };
  const base = {
    character,
    persona: { name: "Rowan", description: "A courier." },
    username: "Rowan",
    lorebooks: BOOKS,
    authorsNote: { text: "Keep it tense.", interval: 2, depth: 4 },
    memory: { summary: "Earlier, Mira and Rowan crossed the Old Road.", lastId: "m400" },
    scene: { text: "Night, the Lantern Guild hall, Mira and Rowan." },
    history: HISTORY,
    maxTokens: 16000,
    settings: { historyTokens: 12000, loreDepth: 6, loreBudget: 3000 },
    vars: { mood: "tense" },
  };

  it("breakdownTokens gives the same numbers on a 1,000-message chat", () => {
    const cases = [
      base,
      { ...base, settings: { ...base.settings, memoryOn: false } },
      { ...base, settings: { ...base.settings, loreOn: false } },
      { ...base, memory: "A plain summary string." },
      { ...base, memory: { summary: "Stale.", lastId: "gone" } },
      { ...base, memory: undefined, scene: "A plain scene." },
      { ...base, history: HISTORY.slice(0, 7) },
      { ...base, history: [] },
      { ...base, lorebooks: undefined, authorsNote: "Plain note." },
      { ...base, character: undefined, universe: { name: "Saltmarsh", story: "A drowned city.", characters: [{ name: "Jule" }] } },
      { ...base, maxTokens: undefined, settings: {} },
    ];
    for (const c of cases) {
      const want = oldTokens.breakdownTokens(c);
      expect(want.totalTokens).toBeGreaterThan(0);
      expect(breakdownTokens(c)).toEqual(want);
    }
  });

  it("keeps the section helpers as they were", () => {
    for (const memory of [base.memory, "string", { summary: "x", lastId: "nope" }, { text: "fallback" }, null]) {
      expect(calculateMemoryTokens({ memory, scene: base.scene, history: HISTORY })).toBe(oldTokens.calculateMemoryTokens({ memory, scene: base.scene, history: HISTORY }));
      for (const settings of [base.settings, { memoryOn: false }, {}]) {
        const args = { history: HISTORY, settings, memory, maxTokens: 9000 };
        expect(calculateHistoryTokens(args)).toBe(oldTokens.calculateHistoryTokens(args));
      }
    }
    expect(calculateHistoryTokens()).toBe(oldTokens.calculateHistoryTokens());
  });
});
