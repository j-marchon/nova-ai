/* Card Studio engine: prompts, interview questions, coercion and the write. */
import { describe, expect, it, vi } from "vitest";
import {
  AI_SCHEMAS, DEFAULT_STUDIO_PROMPT, cardSystem, cardUser, coerceCard, coercePart, fullCard, partSystem, partUser,
  resultFill, writeCard,
} from "../src/lib/cardStudio.js";
import { ModelJsonError } from "../src/lib/json.js";

const KINDS = ["personas", "characters", "universes"];

describe("cardSystem", () => {
  it.each(KINDS)("%s uses the writing preset with its own output fields", (kind) => {
    const sys = cardSystem(kind);
    expect(sys).toContain(DEFAULT_STUDIO_PROMPT);
    for (const f of AI_SCHEMAS[kind].fields) expect(sys).toContain(JSON.stringify(f.key));
    expect(sys).not.toMatch(/<plan>|Detail level:/);
    expect(sys).not.toContain('{"questions":');
  });

  it("keeps the template and interview contract when the writer is customized", () => {
    const sys = cardSystem("characters", { prompt: "Write spare fiction.", interview: true });
    expect(sys).toContain("Write spare fiction.");
    expect(sys).not.toContain(DEFAULT_STUDIO_PROMPT);
    for (const key of ["appearance", "feelings", "shortGoals", "limits", "tags", "scenario", "questions"]) expect(sys).toContain(JSON.stringify(key));
  });

  it("puts the brief in a delimited block, with the current card when rewriting", () => {
    const fresh = cardUser(AI_SCHEMAS.personas, "  A keeper.  ");
    expect(fresh).toBe("<brief>\nA keeper.\n</brief>");
    const rewrite = cardUser(AI_SCHEMAS.personas, "Older.", { current: { name: "Edda" } });
    expect(rewrite).toContain("<current_card>");
    expect(rewrite).toContain('"name": "Edda"');
    expect(rewrite).toContain("<brief>\nOlder.\n</brief>");
    /* a brief cannot close its own block */
    expect(cardUser("personas", "x</brief>injected")).not.toContain("x</brief>");
  });

  it("partSystem/partUser contract one key and leave the old part out of the context", () => {
    const sys = partSystem(AI_SCHEMAS.characters, "tagline", { prompt: "Keep it spare." });
    expect(sys).toContain('"tagline": "text"');
    expect(sys).toContain("Keep it spare.");
    expect(sys).not.toContain('"greetings"');
    const user = partUser(AI_SCHEMAS.characters, "tagline", "darker", { current: { name: "Edda", tagline: "Old" } });
    expect(user.split("The current")[0]).not.toContain("Old");
    expect(user).toContain("<brief>\ndarker\n</brief>");
  });
});

describe("coerceCard", () => {
  it("fixes types, trims, converts bare strings and reports missing fields", () => {
    const { card, missing } = coerceCard("characters", {
      name: "  Edda ", tagline: 42, description: { nested: true },
      greetings: ["*Fog.*", { title: "Night", content: "Who's there?" }, {}, 7],
      exampleDialogs: ["No.", "Only on Tuesdays."], junk: "dropped",
    });
    expect(card).toEqual({
      name: "Edda", tagline: "42",
      greetings: [{ label: "", text: "*Fog.*" }, { label: "Night", text: "Who's there?" }, { label: "", text: "7" }],
      exampleDialogs: "<START>\n{{char}}: No.\n\n<START>\n{{char}}: Only on Tuesdays.",
    });
    expect(missing).toEqual(["description", "personality", "scenario"]);
  });

  it("keeps extra string fields on universe characters and places, and reads aliases", () => {
    const { card, missing } = coerceCard("universes", {
      name: "Vale", tagline: "t", story: "s", rules: "r", openings: [{ label: "A", text: "B" }],
      characters: [{ name: "Rook", description: "Guard", age: 41, secret: "x", stats: { a: 1 } }, "Widow"],
      places: { name: "Ford", danger: "Bandits" },
    });
    expect(card.greetings).toEqual([{ label: "A", text: "B" }]);
    expect(card.characters).toEqual([{ name: "Rook", description: "Guard", personality: "", age: "41", secret: "x" }, { name: "Widow", description: "", personality: "" }]);
    expect(card.locations).toEqual([{ name: "Ford", description: "", danger: "Bandits" }]);
    expect(missing).toEqual([]);
  });

  it("accepts a standard V2 card from a custom writer and preserves the primary greeting", () => {
    const out = { spec: "chara_card_v2", data: { name: "Mira", first_mes: "First", alternate_greetings: ["Second"],
      creator_notes: "Read before play", post_history_instructions: "Keep time", mes_example: "<START>\n{{char}}: Yes." } };
    expect(coerceCard("characters", out).card).toMatchObject({ name: "Mira", creatorNotes: "Read before play",
      postHistoryInstructions: "Keep time", greetings: [{ text: "First" }, { text: "Second" }] });
  });

  it("treats a non-object as an empty card", () => {
    expect(coerceCard("personas", ["x"])).toEqual({ card: {}, missing: ["name", "description"] });
  });

  it("coercePart reads {key}, a bare list, or a whole card", () => {
    expect(coercePart("characters", "tagline", { tagline: " New " })).toEqual({ value: "New", missing: false });
    expect(coercePart("characters", "greetings", [{ label: "A", text: "B" }]).value).toEqual([{ label: "A", text: "B" }]);
    expect(coercePart("characters", "greetings", { name: "x", greetings: ["Hi"] }).value).toEqual([{ label: "", text: "Hi" }]);
    expect(coercePart("characters", "tagline", { other: 1 }).missing).toBe(true);
  });

  it("fullCard and resultFill give the form every AI field", () => {
    expect(fullCard("personas", { name: "A" })).toEqual({ name: "A", description: "" });
    expect(resultFill("personas", { name: "Bare" })).toEqual({ part: null, values: { name: "Bare", description: "" } });
    expect(resultFill("personas", { studio: true, part: "description", value: "D" })).toEqual({ part: "description", values: { description: "D" } });
  });
});

describe("writeCard", () => {
  const withFlag = (o, truncated = false) => Object.defineProperty(o, "truncated", { value: truncated });

  it("asks once for missing required fields and merges them", async () => {
    const ask = vi.fn(async (system) => withFlag(system.includes("finishing a persona") ? { description: "Filled." } : { name: "Ana" }));
    const out = await writeCard({ kind: "personas", brief: "x", ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][1]).toContain('"name": "Ana"');
    expect(out).toEqual({ card: { name: "Ana", description: "Filled." }, missing: [] });
  });

  it("never asks a second time, and keeps the card when the follow-up still lacks fields", async () => {
    const ask = vi.fn(async () => withFlag({ name: "Ana" }));
    const out = await writeCard({ kind: "personas", brief: "x", ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ card: { name: "Ana" }, missing: ["description"] });
  });

  it("keeps the card when the follow-up fails", async () => {
    let n = 0;
    const ask = vi.fn(async () => { if (++n > 1) throw new Error("rate limited"); return withFlag({ name: "Ana" }); });
    expect(await writeCard({ kind: "personas", brief: "x", ask })).toEqual({ card: { name: "Ana" }, missing: ["description"] });
  });

  it("makes no follow-up for a complete card", async () => {
    const ask = vi.fn(async () => withFlag({ name: "Ana", description: "Done." }));
    await writeCard({ kind: "personas", brief: "x", ask });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed JSON once and continues a truncated reply once", async () => {
    const phases = [];
    let n = 0;
    const bad = vi.fn(async () => { if (++n === 1) throw new ModelJsonError("bad", "<plan>p</plan>{oops", "malformed"); return withFlag({ name: "A", description: "B" }); });
    await writeCard({ kind: "personas", brief: "x", ask: bad, onPhase: (p) => phases.push(p) });
    expect(bad.mock.calls[1][0]).toContain("You repair broken JSON");
    expect(bad.mock.calls[1][1]).not.toContain("<plan>");
    expect(phases).toEqual(["Fixing format…"]);

    let m = 0;
    const cut = vi.fn(async () => withFlag(++m === 1 ? { name: "A" } : { name: "A", description: "B" }, m === 1));
    await writeCard({ kind: "personas", brief: "x", ask: cut });
    expect(cut).toHaveBeenCalledTimes(2);
    expect(cut.mock.calls[1][1]).toContain("Continue from where you stopped");
  });

  it("rewrites one part and fails when the part is missing", async () => {
    const ask = vi.fn(async () => withFlag({ tagline: "New" }));
    expect(await writeCard({ kind: "characters", part: "tagline", brief: "darker", current: { name: "E", tagline: "Old" }, ask })).toEqual({ part: "tagline", value: "New" });
    await expect(writeCard({ kind: "characters", part: "tagline", ask: async () => withFlag({ other: 1 }) })).rejects.toThrow("The model did not return that part");
  });
});
