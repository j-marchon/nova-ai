// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  bookFrom, chatBooks, keyMatches, newBook, newEntry, parseLorebook, selectLore, toCharacterBook, toWorldInfo,
} from "../src/lib/lore.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { cardFields, characterFromCard } from "../src/lib/cards.js";
import { emptyData } from "../src/lib/data.js";
import { MAX_ANIMATED_MB, animatedMime, readImage } from "../src/lib/util.js";

const msg = (role, content) => ({ id: `${role}${Math.random()}`, role, content });
const settings = (p = {}) => ({ ...emptyData.settings, ...p });

const vale = newEntry({ comment: "Vale", keys: ["Vale", "the valley"], content: "The Vale is a flooded valley ruled by {{char}}'s aunt." });
const tower = newEntry({ comment: "Tower", keys: ["tower"], secondaryKeys: ["black"], selective: true, content: "The Black Tower holds the archive." });
const sky = newEntry({ comment: "Sky", constant: true, content: "The sky has two moons." });
const book = newBook({ name: "World", entries: [vale, tower, sky] });

describe("keyword matching", () => {
  it("matches whole words, ignoring case", () => {
    expect(keyMatches("Vale", "we reach the vale at dusk", false)).toBe(true);
    expect(keyMatches("Vale", "a deep valley", false)).toBe(false);
    expect(keyMatches("Vale", "the vale", true)).toBe(false);
  });

  it("supports patterns and phrases with punctuation", () => {
    expect(keyMatches("/val+ey/", "the VALLEY", false)).toBe(true);
    expect(keyMatches("St. Mary's", "near st. mary's church", false)).toBe(true);
    expect(keyMatches("/[/", "anything", false)).toBe(false);
  });
});

describe("selectLore", () => {
  it("keeps always-on entries apart from keyword ones", () => {
    const r = selectLore([book], [msg("user", "Into the valley we go")]);
    expect(r.constant).toEqual([sky]);
    expect(r.triggered).toEqual([vale]);
  });

  it("needs a second keyword for selective entries", () => {
    expect(selectLore([book], [msg("user", "the tower")]).triggered).toEqual([]);
    expect(selectLore([book], [msg("user", "the black tower")]).triggered).toEqual([tower]);
  });

  it("only looks at the last few messages", () => {
    const h = [msg("user", "the Vale"), msg("assistant", "a"), msg("user", "b"), msg("assistant", "c"), msg("user", "d")];
    expect(selectLore([book], h, { depth: 4 }).triggered).toEqual([]);
    expect(selectLore([book], h, { depth: 5 }).triggered).toEqual([vale]);
  });

  it("drops the lowest priority first when over budget, and skips disabled entries", () => {
    const big = newEntry({ keys: ["x"], content: "x ".repeat(400), order: 1 });
    const small = newEntry({ keys: ["x"], content: "important", order: 500 });
    const off = newEntry({ keys: ["x"], content: "off", enabled: false });
    const r = selectLore([newBook({ entries: [big, small, off] })], [msg("user", "x")], { budget: 50 });
    expect(r.triggered).toEqual([small]);
  });
});

describe("prompt placement keeps the cache", () => {
  const ch = { id: "c", name: "Mira", description: "A thief." };
  const base = [msg("assistant", "Hello."), msg("user", "Tell me about the Vale.")];

  it("puts always-on lore in the system block and keyword lore at the end", () => {
    const msgs = buildApiMessages({ character: ch, history: base, settings: settings(), lorebooks: [book] });
    expect(msgs[0].content).toContain("[World info]\nThe sky has two moons.");
    expect(msgs[0].content).not.toContain("flooded valley");
    const tail = msgs[msgs.length - 1].content;
    expect(tail).toContain("World info, relevant right now");
    expect(tail).toContain("ruled by Mira's aunt");
  });

  it("sends the same system block whether a keyword matched or not", () => {
    const hit = buildApiMessages({ character: ch, history: base, settings: settings(), lorebooks: [book] });
    const miss = buildApiMessages({ character: ch, history: [base[0], msg("user", "Hi.")], settings: settings(), lorebooks: [book] });
    expect(hit[0].content).toBe(miss[0].content);
    expect(miss[miss.length - 1].content).not.toContain("World info");
  });

  it("sends nothing when lorebooks are off", () => {
    const msgs = buildApiMessages({ character: ch, history: base, settings: settings({ loreOn: false }), lorebooks: [book] });
    expect(msgs.map((m) => m.content).join("\n")).not.toContain("World info");
  });
});

describe("formats", () => {
  it("reads SillyTavern World Info and writes it back", () => {
    const wi = {
      entries: {
        0: { uid: 0, key: ["Vale"], keysecondary: [], comment: "Vale", content: "Flooded.", constant: false, selective: false, order: 120, disable: false },
        1: { uid: 1, key: ["x"], content: "Off.", disable: true },
      },
    };
    const b = parseLorebook(JSON.stringify(wi), "World");
    expect(b.name).toBe("World");
    expect(b.entries[0]).toMatchObject({ keys: ["Vale"], content: "Flooded.", order: 120, enabled: true });
    expect(b.entries[1].enabled).toBe(false);
    const again = bookFrom(toWorldInfo(b));
    expect(again.entries.map((e) => e.content)).toEqual(["Flooded.", "Off."]);
  });

  it("rejects files with no entries", () => {
    expect(() => parseLorebook("{}")).toThrow(/No lorebook entries/);
    expect(() => parseLorebook("nope")).toThrow(/not JSON/);
  });

  it("keeps a card's character_book on import and writes it on export", () => {
    const card = {
      spec: "chara_card_v2",
      data: {
        name: "Mira", description: "", first_mes: "",
        character_book: { entries: [{ keys: ["Vale"], content: "<BOT> grew up there.", insertion_order: 10, enabled: true }] },
      },
    };
    const ch = characterFromCard(cardFields(card), "", null, "");
    expect(ch.lorebook.name).toBe("Mira");
    expect(ch.lorebook.entries[0]).toMatchObject({ keys: ["Vale"], content: "{{char}} grew up there.", order: 10 });
    expect(toCharacterBook(ch.lorebook).entries[0]).toMatchObject({ keys: ["Vale"], insertion_order: 10 });
  });

  it("gathers a chat's books once each: cards first, then attached", () => {
    const own = newBook({ name: "Own", entries: [vale] });
    const shared = newBook({ name: "Shared", entries: [sky] });
    const books = chatBooks({
      chat: { lorebookIds: [shared.id, "gone"] },
      ensemble: [{ lorebook: own }, { lorebook: own }],
      lorebooks: [shared],
    });
    expect(books.map((b) => b.name)).toEqual(["Own", "Shared"]);
  });
});

describe("animated pictures", () => {
  const bytes = (...parts) => {
    const out = [];
    for (const p of parts) typeof p === "string" ? out.push(...[...p].map((c) => c.charCodeAt(0))) : out.push(...p);
    return new Uint8Array(out);
  };
  const chunk = (type, len = 0) => bytes([0, 0, 0, len], type, new Array(len + 4).fill(0));

  it("recognises GIF, animated WebP and APNG, and not a still PNG", () => {
    expect(animatedMime(bytes("GIF89a", [0, 0, 0, 0, 0, 0]))).toBe("image/gif");
    expect(animatedMime(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [0, 0, 0, 0], "ANIM"))).toBe("image/webp");
    expect(animatedMime(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ", [0, 0, 0, 0]))).toBeNull();
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(animatedMime(bytes(sig, chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT")))).toBe("image/png");
    expect(animatedMime(bytes(sig, chunk("IHDR", 13), chunk("IDAT"), chunk("acTL", 8)))).toBeNull();
  });

  it("keeps a GIF byte for byte, typed correctly even when the picker said otherwise", async () => {
    const gif = new Blob([bytes("GIF89a", [1, 2, 3, 4, 5, 6])], { type: "" });
    const r = await readImage(gif);
    expect(r.animated).toBe(true);
    expect(r.data).toBe(`data:image/gif;base64,${btoa("GIF89a\x01\x02\x03\x04\x05\x06")}`);
  });

  it("refuses an animation over the size cap", async () => {
    const big = new Blob([bytes("GIF89a"), new Uint8Array(MAX_ANIMATED_MB * 1024 * 1024 + 1)], { type: "image/gif" });
    await expect(readImage(big)).rejects.toThrow(/limit is 15 MB/);
  });
});
