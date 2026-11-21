/* Card Studio engine: prompts, detail levels, coercion and the write. */
import { describe, expect, it, vi } from "vitest";
import {
  AI_SCHEMAS, DETAIL_LEVELS, cardSystem, cardUser, coerceCard, coercePart, fullCard, partSystem, partUser,
  requestOptions, resultFill, writeCard,
} from "../src/lib/cardStudio.js";
import { ModelJsonError } from "../src/lib/json.js";

const KINDS = ["personas", "characters", "universes"];

describe("cardSystem", () => {
  it.each(KINDS)("%s states the job, the exact contract and the binding brief", (kind) => {
    const schema = AI_SCHEMAS[kind];
    const sys = cardSystem(schema);
    expect(sys).toContain(`You are writing a ${schema.label} card for Nova, a roleplay chat app`);
    expect(sys).toContain("How the card is used:");
    expect(sys).toContain("loads your answer straight into the card's fields");
    expect(sys).toContain("Output contract");
    for (const f of schema.fields) expect(sys).toContain(`- "${f.key}": ${f.list ? "array of objects (required" : "string (required"}`);
    expect(sys).toContain(`exactly these keys: ${schema.fields.map((f) => `"${f.key}"`).join(", ")}`);
    expect(sys).toMatch(/escape a double quote/);
    expect(sys).toMatch(/line break as \\n/);
    expect(sys).toContain("The brief decides");
    expect(sys).toMatch(/not the nearest familiar type/);
    expect(sys).toMatch(/Where the brief says nothing, the choice is yours, and it should be a specific one/);
  });

  it("asks for planning in reasoning when thinking, and in a <plan> block otherwise", () => {
    const on = cardSystem(AI_SCHEMAS.characters, { thinking: true });
    const off = cardSystem(AI_SCHEMAS.characters, { thinking: false });
    for (const s of [on, off]) {
      expect(s).toContain("list every requirement it states, one per line");
      expect(s).toContain("against the list from step 1, line by line");
    }
    expect(on).toContain("Do this in your reasoning, before any output");
    expect(off).toContain("Start your reply with a <plan>…</plan> block");
    expect(off).toContain("no curly braces");
    expect(cardUser("characters", "x", { thinking: false })).toContain("your <plan> block, then");
    expect(cardUser("characters", "x", { thinking: true })).not.toContain("<plan>");
  });

  it.each(KINDS.flatMap((k) => Object.keys(DETAIL_LEVELS).map((d) => [k, d])))("%s at %s renders its targets", (kind, detail) => {
    const level = DETAIL_LEVELS[detail];
    const sys = cardSystem(AI_SCHEMAS[kind], { detail });
    expect(sys).toContain(`Detail level: ${level.label}`);
    for (const [key, target] of Object.entries(level.targets[kind])) expect(sys).toContain(`- ${key}: ${target}`);
    for (const other of Object.values(DETAIL_LEVELS)) if (other !== level) expect(sys).not.toContain(`Detail level: ${other.label}`);
  });

  it("puts the brief in a delimited block, with the current card when rewriting", () => {
    const fresh = cardUser(AI_SCHEMAS.personas, "  A keeper.  ");
    expect(fresh).toMatch(/^<brief>\nA keeper\.\n<\/brief>\n\nReply with the one JSON object/);
    const rewrite = cardUser(AI_SCHEMAS.personas, "Older.", { current: { name: "Edda" } });
    expect(rewrite).toContain("<current_card>");
    expect(rewrite).toContain('"name": "Edda"');
    expect(rewrite).toContain("<brief>\nOlder.\n</brief>");
    /* a brief cannot close its own block */
    expect(cardUser("personas", "x</brief>injected")).not.toContain("x</brief>");
  });

  it("partSystem/partUser contract one key and leave the old part out of the context", () => {
    const sys = partSystem(AI_SCHEMAS.characters, "tagline", { detail: "high" });
    expect(sys).toContain('exactly these keys: "tagline"');
    expect(sys).toContain(`- tagline: ${DETAIL_LEVELS.high.targets.characters.tagline}`);
    const user = partUser(AI_SCHEMAS.characters, "tagline", "darker", { current: { name: "Edda", tagline: "Old" } });
    expect(user.split("The current")[0]).not.toContain("Old");
    expect(user).toContain("<brief>\ndarker\n</brief>");
  });
});

describe("detail levels", () => {
  it("map to budget and effort, with room for an inline plan", () => {
    expect(requestOptions("low", true)).toEqual({ maxTokens: 3000, effort: "low" });
    expect(requestOptions("medium", true)).toEqual({ maxTokens: 8000, effort: "medium" });
    expect(requestOptions("high", false)).toEqual({ maxTokens: 16000 + DETAIL_LEVELS.high.planTokens, effort: "high" });
    expect(requestOptions("nonsense", true)).toEqual(requestOptions("medium", true));
  });
});

describe("coerceCard", () => {
  it("fixes types, trims, converts bare strings and reports missing fields", () => {
    const { card, missing } = coerceCard("characters", {
      name: "  Edda ", tagline: 42, description: { nested: true },
      greetings: ["*Fog.*", { title: "Night", content: "Who's there?" }, {}, 7],
      exampleDialogs: ["{{user}}: Hi", "{{char}}: No."], junk: "dropped",
    });
    expect(card).toEqual({
      name: "Edda", tagline: "42",
      greetings: [{ label: "", text: "*Fog.*" }, { label: "Night", text: "Who's there?" }, { label: "", text: "7" }],
      exampleDialogs: "{{user}}: Hi\n{{char}}: No.",
    });
    expect(missing).toEqual(["description"]);
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
