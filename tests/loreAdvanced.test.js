import { describe, expect, it } from "vitest";
import { bookFrom, newBook, newEntry, parseLorebook, selectLore, toCharacterBook, toWorldInfo } from "../src/lib/lore.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { emptyData } from "../src/lib/data.js";

/* SillyTavern's world-info behaviours in lore.js */

let n = 0;
const msg = (content, role = "user") => ({ id: `m${n++}`, role, content });
const chat = (...texts) => texts.map((t) => msg(t));
const pick = (r) => r.triggered.map((e) => e.comment);
const ent = (comment, keys, content, patch = {}) => newEntry({ comment, keys, content, ...patch });

describe("recursive scan", () => {
  const a = ent("A", ["vale"], "The Vale has a tower.");
  const b = ent("B", ["tower"], "The tower holds a bell.");
  const c = ent("C", ["bell"], "The bell is cracked.");
  const h = chat("we reach the vale");

  it("is off unless asked for, then follows entries for that many steps", () => {
    const book = newBook({ entries: [a, b, c] });
    expect(pick(selectLore([book], h))).toEqual(["A"]);
    expect(pick(selectLore([book], h, { recursion: 1 }))).toEqual(["A", "B"]);
    expect(pick(selectLore([book], h, { recursion: 99 }))).toEqual(["A", "B", "C"]);
  });

  it("honours excludeRecursion and preventRecursion", () => {
    const shy = { ...b, excludeRecursion: true };
    expect(pick(selectLore([newBook({ entries: [a, shy] })], h, { recursion: 3 }))).toEqual(["A"]);
    expect(pick(selectLore([newBook({ entries: [a, shy] })], chat("vale and tower"), { recursion: 3 }))).toEqual(["A", "B"]);
    const quiet = { ...a, preventRecursion: true };
    expect(pick(selectLore([newBook({ entries: [quiet, b] })], h, { recursion: 3 }))).toEqual(["A"]);
  });

  it("holds delayUntilRecursion entries back until a recursive pass", () => {
    const late = ent("L", ["moon"], "Two moons.", { delayUntilRecursion: 1 });
    const book = newBook({ entries: [a, late] });
    expect(pick(selectLore([book], chat("the moon over the vale")))).toEqual(["A"]);
    expect(pick(selectLore([book], chat("the moon over the vale"), { recursion: 1 }))).toEqual(["A", "L"]);
    expect(pick(selectLore([newBook({ entries: [late] })], chat("the moon"), { recursion: 1 }))).toEqual([]);
  });

  it("lets always-on text trigger entries", () => {
    const sky = ent("Sky", [], "A bell tolls.", { constant: true });
    expect(pick(selectLore([newBook({ entries: [sky, c] })], chat("hi"), { recursion: 1 }))).toEqual(["C"]);
  });
});

describe("trigger chance", () => {
  const coin = ent("Coin", ["coin"], "Heads.", { probability: 50 });
  const book = newBook({ entries: [coin] });
  const h = chat("a coin");

  it("rolls per activation", () => {
    expect(pick(selectLore([book], h, { rng: () => 0.3 }))).toEqual(["Coin"]);
    expect(pick(selectLore([book], h, { rng: () => 0.7 }))).toEqual([]);
    expect(pick(selectLore([newBook({ entries: [{ ...coin, useProbability: false }] })], h, { rng: () => 0.9 }))).toEqual(["Coin"]);
  });

  it("draws the same for the same point in the chat", () => {
    const first = pick(selectLore([book], h));
    for (let i = 0; i < 5; i++) expect(pick(selectLore([book], h))).toEqual(first);
  });

  it("sends a chancy always-on entry with the keyword entries, not the fixed block", () => {
    const event = ent("Event", [], "A storm rolls in.", { constant: true, probability: 10 });
    const r = selectLore([newBook({ entries: [event] })], h, { rng: () => 0.05 });
    expect(r.constant).toEqual([]);
    expect(pick(r)).toEqual(["Event"]);
    expect(pick(selectLore([newBook({ entries: [event] })], h, { rng: () => 0.5 }))).toEqual([]);
  });
});

describe("timed effects", () => {
  /* one turn: select with the saved record, keep the next one */
  const turns = (book, texts) => {
    const h = [];
    let timed;
    return texts.map((t) => {
      h.push(msg(t));
      const r = selectLore([book], [...h], { timed, depth: 1 });
      timed = r.timed;
      return pick(r).length > 0;
    });
  };

  it("keeps a sticky entry for N messages", () => {
    const book = newBook({ entries: [ent("S", ["storm"], "It storms.", { sticky: 2 })] });
    expect(turns(book, ["a storm", "quiet", "quiet", "quiet"])).toEqual([true, true, false, false]);
  });

  it("blocks an entry during its cooldown", () => {
    const book = newBook({ entries: [ent("C", ["storm"], "It storms.", { cooldown: 2 })] });
    expect(turns(book, ["storm", "storm", "storm", "storm"])).toEqual([true, false, true, false]);
  });

  it("starts the cooldown when sticky runs out", () => {
    const book = newBook({ entries: [ent("SC", ["storm"], "It storms.", { sticky: 1, cooldown: 2 })] });
    expect(turns(book, ["storm", "storm", "storm", "storm"])).toEqual([true, false, false, true]);
  });

  it("waits for the chat to reach the delay", () => {
    const book = newBook({ entries: [ent("D", ["storm"], "It storms.", { delay: 3 })] });
    expect(turns(book, ["storm", "storm", "storm"])).toEqual([false, false, true]);
  });

  it("does not count a retried turn twice", () => {
    const book = newBook({ entries: [ent("S", ["storm"], "It storms.", { sticky: 2 })] });
    const h = chat("a storm");
    const once = selectLore([book], h);
    const again = selectLore([book], h, { timed: once.timed });
    expect(again.timed).toEqual(once.timed);
    const swiped = selectLore([book], chat("calm"), { timed: once.timed });
    expect(pick(swiped)).toEqual([]);
    expect(swiped.timed).toBeUndefined();
  });

  it("leaves no record for books without timed entries", () => {
    expect(selectLore([newBook({ entries: [ent("A", ["x"], "x")] })], chat("x")).timed).toBeUndefined();
  });
});

describe("inclusion groups", () => {
  const x = ent("X", ["door"], "A red door.", { group: "door" });
  const y = ent("Y", ["door"], "A blue door.", { group: "door", groupWeight: 300 });
  const h = chat("a door");

  it("keeps one entry per group by weighted roll", () => {
    const book = newBook({ entries: [x, y] });
    expect(pick(selectLore([book], h, { rng: () => 0.2 }))).toEqual(["X"]);
    expect(pick(selectLore([book], h, { rng: () => 0.5 }))).toEqual(["Y"]);
  });

  it("lets a prioritized entry win, the highest order first", () => {
    const book = newBook({ entries: [x, { ...y, groupOverride: true, order: 5 }, ent("Z", ["door"], "A green door.", { group: "door", groupOverride: true, order: 50 })] });
    expect(pick(selectLore([book], h, { rng: () => 0 }))).toEqual(["Z"]);
  });

  it("keeps the best key match with group scoring", () => {
    const one = ent("One", ["door"], "One.", { group: "g", useGroupScoring: true });
    const two = ent("Two", ["door", "red"], "Two.", { group: "g", useGroupScoring: true });
    expect(pick(selectLore([newBook({ entries: [one, two] })], chat("a red door"), { rng: () => 0 }))).toEqual(["Two"]);
  });

  it("leaves entries outside a group alone", () => {
    const free = ent("F", ["door"], "Free.");
    expect(pick(selectLore([newBook({ entries: [x, y, free] })], h, { rng: () => 0 }))).toEqual(["X", "F"]);
  });
});

describe("per-entry matching", () => {
  it("uses an entry's own scan depth", () => {
    const h = chat("the vale", "b", "c");
    const near = ent("Near", ["vale"], "Near.", { scanDepth: 1 });
    const far = ent("Far", ["vale"], "Far.", { scanDepth: 10 });
    expect(pick(selectLore([newBook({ entries: [near, far] })], h, { depth: 2 }))).toEqual(["Far"]);
  });

  it("matches inside words when whole words are off", () => {
    const e = ent("V", ["vale"], "V.", { matchWholeWords: false });
    expect(pick(selectLore([newBook({ entries: [e] })], chat("a vat")))).toEqual([]);
    expect(pick(selectLore([newBook({ entries: [e] })], chat("the valeyard")))).toEqual(["V"]);
    expect(pick(selectLore([newBook({ entries: [{ ...e, matchWholeWords: null }] })], chat("the valeyard")))).toEqual([]);
  });
});

describe("import and export", () => {
  const st = {
    probability: 40, useProbability: true, sticky: 2, cooldown: 3, delay: 4,
    group: "doors, rooms", groupOverride: true, groupWeight: 250, useGroupScoring: true,
    excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 2, scanDepth: 6, matchWholeWords: false,
  };

  it("round-trips a SillyTavern World Info file", () => {
    const file = { entries: { 0: { uid: 0, key: ["door"], keysecondary: [], content: "A door.", comment: "Door", order: 100, ...st } } };
    const book = parseLorebook(JSON.stringify(file), "Doors");
    expect(book.entries[0]).toMatchObject(st);
    expect(toWorldInfo(book).entries[0]).toMatchObject(st);
  });

  it("round-trips a card's character_book extensions", () => {
    const ext = {
      probability: 40, useProbability: true, sticky: 2, cooldown: 3, delay: 4,
      group: "doors", group_override: true, group_weight: 250, use_group_scoring: true,
      exclude_recursion: true, prevent_recursion: true, delay_until_recursion: 2, scan_depth: 6, match_whole_words: false,
      case_sensitive: true, position: 1, depth: 4,
    };
    const card = { entries: [{ id: 0, keys: ["door"], content: "A door.", enabled: true, insertion_order: 100, extensions: ext }] };
    const book = bookFrom(card);
    expect(book.entries[0]).toMatchObject({ ...st, group: "doors", caseSensitive: true });
    expect(toCharacterBook(book).entries[0].extensions).toMatchObject(ext);
  });

  it("reads old files with the defaults", () => {
    const book = bookFrom({ entries: [{ keys: ["a"], content: "A" }] });
    expect(book.entries[0]).toMatchObject({ probability: 100, useProbability: true, sticky: 0, group: "", groupWeight: 100, scanDepth: null, matchWholeWords: null });
  });
});

describe("prompt", () => {
  it("hands the next timed record to the caller", () => {
    const book = newBook({ entries: [ent("S", ["storm"], "It storms.", { sticky: 2 })] });
    let timed;
    const out = buildApiMessages({
      character: { name: "Ann", description: "d" }, username: "Bo", history: chat("a storm"),
      settings: { ...emptyData.settings }, lorebooks: [book], onLoreTimed: (t) => { timed = t; },
    });
    expect(JSON.stringify(out)).toContain("It storms.");
    expect(Object.keys(timed.sticky)).toHaveLength(1);
  });
});
