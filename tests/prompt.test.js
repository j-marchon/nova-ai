import { describe, expect, it } from "vitest";
import { hideNotes, notesOf, stripTracker } from "../src/lib/text.js";
import { buildApiMessages, cardText, languageRule, repetitionNotes } from "../src/lib/prompt.js";
import { historyCut, trimHistory } from "../src/lib/window.js";
import { emptyData } from "../src/lib/data.js";

const settings = (patch = {}) => ({ ...emptyData.settings, memoryOn: true, sceneEvery: 4, apiKey: "k", ...patch });
const msg = (role, content, extra = {}) => ({ id: `${role}-${Math.random().toString(36).slice(2)}`, role, content, ...extra });
const mira = {
  id: "c1", name: "Mira", description: "A thief. {{char}} hates {{user}}'s boss.", personality: "wry",
  exampleDialogs: "{{char}}: Hm.", systemPrompt: "{{original}}\nRun a heist game.", postHistoryInstructions: "Keep {{char}} sarcastic.",
};
const tom = { id: "c2", name: "Tom Reyes", description: "A guard.", personality: "", exampleDialogs: "" };
const last = (msgs) => msgs[msgs.length - 1].content;

describe("buildApiMessages", () => {
  it("expands universe story, rules, locations and all character text in prompt order", () => {
    const universe = { name: "Vale", story: "{{setvar::place::harbor}}{{user}} visits {{char}}.", rules: "{{user}} obeys {{getvar::place}} rules.", locations: [{ name: "{{user}}'s dock", description: "In {{char}} by the {{getvar::place}}." }], characters: [{ name: "Elder", description: "{{char}} greets {{user}}.", personality: "{{char}} is kind.", secret: "{{user}} knows {{getvar::place}}." }] };
    const [sys] = buildApiMessages({ universe, username: "Ana", history: [], settings: settings() });
    for (const text of ["Ana visits Vale.", "Ana obeys harbor rules.", "Ana's dock: In Vale by the harbor.", "Elder greets Ana.", "Elder is kind.", "[secret] Ana knows harbor."]) expect(sys.content).toContain(text);
    expect(sys.content).not.toContain("{{");
  });
  const history = [msg("assistant", "Hello."), msg("user", "Hi Mira")];

  it("follows the user's language instead of forcing English", () => {
    const [sys] = buildApiMessages({ character: mira, username: "Ana", history, settings: settings() });
    expect(sys.content).not.toMatch(/Write in English/);
    expect(sys.content).not.toContain("[Style]");
    
  });

  it("sends the card's own instructions, filled, with {{original}} removed", () => {
    const msgs = buildApiMessages({ character: mira, username: "Ana", history, settings: settings() });
    expect(msgs[0].content).toContain("[Instructions from the card's author]\nRun a heist game.");
    expect(msgs[0].content).not.toContain("{{original}}");
    expect(msgs[0].content).toContain("Mira hates Ana's boss");
    expect(last(msgs)).toContain("[Keep Mira sarcastic.]");
  });

  it("leaves card instructions out when switched off", () => {
    const msgs = buildApiMessages({ character: mira, username: "Ana", history, settings: settings({ cardInstructions: false }) });
    expect(msgs[0].content).not.toContain("Run a heist game");
    expect(last(msgs)).not.toContain("sarcastic");
  });

  it("adds the story so far only while the message it covers exists", () => {
    const h = [msg("assistant", "a"), msg("user", "b"), msg("assistant", "c"), msg("user", "d")];
    const memory = { summary: "They met at the docks.", lastId: h[1].id };
    const withMem = buildApiMessages({ character: mira, history: h, settings: settings(), memory });
    expect(withMem[0].content).toContain("[Story so far]");
    expect(withMem[0].content).toContain("They met at the docks.");
    const stale = buildApiMessages({ character: mira, history: h, settings: settings(), memory: { ...memory, lastId: "gone" } });
    expect(stale[0].content).not.toContain("[Story so far]");
    const off = buildApiMessages({ character: mira, history: h, settings: settings({ memoryOn: false }), memory });
    expect(off[0].content).not.toContain("[Story so far]");
  });

  it("puts scene notes at the end, never in the cached system block", () => {
    const scene = { text: "Time: night\nLocation: roof", lastId: history[1].id };
    const msgs = buildApiMessages({ character: mira, history, settings: settings(), scene });
    expect(msgs[0].content).not.toContain("Location: roof");
    expect(last(msgs)).toContain("Private scene tracker");
    expect(last(msgs)).toContain("Location: roof");
    const off = buildApiMessages({ character: mira, history, settings: settings({ sceneEvery: 0 }), scene });
    expect(last(off)).not.toContain("Location: roof");
  });

  it("sends every linked card in full, with one label rule, the same bytes every turn", () => {
    const ivy = { id: "c3", name: "Ivy", description: "{{char}} picks locks for {{user}}.", personality: "Restless.", exampleDialogs: "Ivy: Got it.", systemPrompt: "Ivy whispers.", postHistoryInstructions: "Ivy never trusts {{user}}." };
    const h1 = [msg("assistant", "Evening.", { speaker: "Tom Reyes", speakerId: "c2" }), msg("user", "Mira, look")];
    const h2 = [...h1, msg("assistant", "**Mira:** What?\n\n**Ivy:** Shh."), msg("user", "Over there.")];
    const a = buildApiMessages({ character: mira, ensemble: [tom, ivy], history: h1, settings: settings(), username: "Ana", scope: "[Nova Scope. note one]" });
    const b = buildApiMessages({ character: mira, ensemble: [tom, ivy], history: h2, settings: settings(), username: "Ana", scope: "[Nova Scope. note two]" });
    const sys = a[0].content;
    expect(b[0].content).toBe(sys);
    expect(sys).toContain(`You are ${mira.name}, Tom Reyes and Ivy, and you voice everyone else in`);
    for (const t of ["[Character: Mira]", "[Character: Tom Reyes]\nA guard.", "[Character: Ivy]\nIvy picks locks for Ana.", "[Ivy's personality]\nRestless.", "[Ivy's example dialogue]", "Ivy: Got it.", "[Ivy: instructions from the card's author]\nIvy whispers."]) expect(sys).toContain(t);
    expect(sys).toContain("When more than one of them speaks or acts, begin each one's part with **Name:** on its own line. That is the only place double asterisks are allowed.");
    expect(a[1].content).toBe("Tom Reyes: Evening.");
    for (const msgs of [a, b]) expect(last(msgs)).not.toContain("[Next:");
    /* the host's post-history instructions as before, and each linked card's by name */
    expect(last(a)).toContain("Keep Mira sarcastic");
    expect(last(a)).toContain("[Ivy: Ivy never trusts Ana.]");
  });

  it("is a plain one-card prompt with no ensemble", () => {
    const [sys] = buildApiMessages({ character: mira, ensemble: [], history, settings: settings(), username: "Ana" });
    expect(sys.content).toContain(`You are ${mira.name} in`);
    expect(sys.content).not.toContain("[Character: Mira]");
  });

  it("asks for the user's next message in impersonate mode, without the style line", () => {
    const msgs = buildApiMessages({ character: mira, username: "Ana", history, settings: settings(), mode: "impersonate", direction: "she asks about the vault" });
    const t = last(msgs);
    expect(t).toContain("write Ana's next turn");
    expect(t).toContain("Build it from this idea: she asks about the vault");
    expect(t).not.toContain("[Reply style");
  });

  it("gives a reply its own user turn when the newest message is not the user's", () => {
    const msgs = buildApiMessages({ character: mira, history: [msg("assistant", "Hello.")], settings: settings() });
    expect(msgs[msgs.length - 1].role).toBe("user");
  });

  it("writes as Default when a saved setting still names the retired Bare style", () => {
    const msgs = buildApiMessages({ character: mira, history, settings: settings({ stylePreset: "bare" }) });
    expect(msgs[0].content).not.toContain("\n[Style]\n");
  });
});

describe("cardText", () => {
  it("strips the {{original}} slot", () => {
    expect(cardText("{{original}}\n\nBe terse.")).toBe("Be terse.");
  });
});

describe("repetitionNotes", () => {
  const replies = [
    "*Her eyes narrow slowly.* The crimson moonlight spills over cobblestones. Fine.",
    "*Her eyes narrow slowly.* The crimson moonlight spills over the docks. Sure.",
    "*Her eyes narrow slowly.* The crimson moonlight spills over everything. Go.",
  ];
  const h = replies.flatMap((r) => [msg("user", "x"), msg("assistant", r)]);

  it("still notices repeated openers and phrases", () => {
    const notes = repetitionNotes(h);
    expect(notes.some((n) => /opened the same way/.test(n))).toBe(true);
    expect(notes.some((n) => /wording keeps coming back/.test(n))).toBe(true);
  });

  it("never quotes the repeated words back to the model", () => {
    const text = repetitionNotes(h).join(" ").toLowerCase();
    for (const w of ["eyes narrow", "crimson", "moonlight", "spills"]) expect(text).not.toContain(w);
  });
});

describe("conversation window", () => {
  const long = Array.from({ length: 80 }, (_, i) => msg(i % 2 ? "user" : "assistant", "word ".repeat(60)));

  it("cuts on the step grid", () => {
    const cut = historyCut(long, 2000);
    expect(cut).toBeGreaterThan(0);
    expect(cut % 20).toBe(0);
  });

  it("never drops what the memory has not covered yet", () => {
    const cut = historyCut(long, 2000);
    expect(trimHistory(long, 2000, cut - 20)).toHaveLength(long.length - (cut - 20));
    expect(trimHistory(long, 2000, Infinity)).toHaveLength(long.length - cut);
  });

  it("trims anyway once the uncovered window passes twice the budget", () => {
    expect(trimHistory(long, 1000, 0)).toHaveLength(long.length - historyCut(long, 1000));
  });
});

describe("user prompts", () => {
  it("ships no prompt library and preserves the user's exact instructions", async () => {
    const { customStyleList, genParams } = await import("../src/lib/styles.js");
    expect(customStyleList(emptyData.settings)).toEqual([]);
    expect(genParams(settings()).prompt).toBe("");
    expect(genParams(settings({ stylePreset: "custom", customStyles: [{ id: "mine", text: "Write my way." }], customStyleId: "mine" })).prompt).toBe("Write my way.");
  });
});

describe("stripTracker", () => {
  const tracker = "[Monday, 3 May | evening | the docks | rain, 12°C]\n\n[Mira: wet coat, tired.]\n\n[IMPORTANT STRINGS: the ledger is missing.]";
  const story = "*She pulls the coat tighter.* \"Rain again.\"";

  it("drops a tracker echoed after or before the reply", () => {
    expect(stripTracker(`${story}\n\n${tracker}`, tracker)).toBe(story);
    expect(stripTracker(`${tracker}\n\n${story}`, tracker)).toBe(story);
    expect(stripTracker(`${story}\n\n(Private scene tracker, for continuity only.)\n${tracker}\n(End of private tracker.)`, tracker)).toBe(story);
  });

  it("drops a rewritten tracker by its shape", () => {
    const echoed = "[Tuesday, 4 May | night | Mira's flat | clear, 9°C]\n[Mira: dry clothes now.]";
    expect(stripTracker(`${story}\n\n${echoed}`, tracker)).toBe(story);
  });

  it("keeps ordinary brackets and a reply with no tracker", () => {
    expect(stripTracker(story, tracker)).toBe(story);
    expect(stripTracker(`${story}\n\n[OOC: shall we skip ahead?]`, tracker)).toBe(`${story}\n\n[OOC: shall we skip ahead?]`);
  });
});

describe("imported generation settings", () => {
  const st = {
    name: "ST preset", temperature: 1.1, top_p: 0.92, top_k: 50, min_p: 0.03, frequency_penalty: 0.1,
    presence_penalty: 0, repetition_penalty: 1.07, openai_max_tokens: 900,
    prompts: [{ identifier: "main", content: "Play {{char}}." }],
  };

  it("keeps a SillyTavern preset's whole sampler, not only its temperature", async () => {
    const { parseStyleImport } = await import("../src/lib/styles.js");
    const [x] = parseStyleImport(JSON.stringify(st));
    expect(x.text).toBe("Play {{char}}.");
    expect(x.sampler).toEqual({ temperature: 1.1, top_p: 0.92, top_k: 50, min_p: 0.03, frequency_penalty: 0.1, presence_penalty: 0, repetition_penalty: 1.07, max_tokens: 900 });
  });

  it("reads settings on top of a plain-text prompt, bare or fenced, and turns the rest off", async () => {
    const { parseStyleImport } = await import("../src/lib/styles.js");
    const [a] = parseStyleImport('{ "temperature": 0.8, "top_p": 0.9, "min_p": 0.02 }\n\nYou are {{char}}.');
    expect(a.text).toBe("You are {{char}}.");
    expect(a.sampler).toMatchObject({ temperature: 0.8, top_p: 0.9, min_p: 0.02, top_k: 0, frequency_penalty: 0, repetition_penalty: 1 });
    const [b] = parseStyleImport('```json\n{ "generation_settings": { "temp": 1.2, "topK": 40, "rep_pen": 1.1 } }\n```\nWrite well.');
    expect(b.text).toBe("Write well.");
    expect(b.sampler).toMatchObject({ temperature: 1.2, top_k: 40, repetition_penalty: 1.1 });
  });

  it("keeps the old shape for a temperature and cap alone, and plain text untouched", async () => {
    const { parseStyleImport } = await import("../src/lib/styles.js");
    expect(parseStyleImport('{ "name": "x", "prompt": "p", "temperature": 0.5, "maxTokens": 700 }')).toEqual([{ name: "x", text: "p", temperature: 0.5, maxTokens: 700 }]);
    expect(parseStyleImport("{not json} hello")).toEqual([{ name: "Imported prompt", text: "{not json} hello" }]);
  });

  it("takes a settings-only file when asked to, and clamps values out of range", async () => {
    const { parseStyleImport } = await import("../src/lib/styles.js");
    expect(() => parseStyleImport('{ "temperature": 0.7, "top_p": 0.9 }')).toThrow();
    const [x] = parseStyleImport('{ "temperature": 9, "top_p": 0.9 }', "x", { allowEmpty: true });
    expect(x.text).toBe("");
    expect(x.sampler.temperature).toBe(2);
  });

  it("sends an imported sampler with fine tuning off, in place of the app's own", async () => {
    const { genParams, parseStyleImport } = await import("../src/lib/styles.js");
    const { samplerBody } = await import("../src/lib/api.js");
    const [x] = parseStyleImport(JSON.stringify(st));
    const g = genParams(settings({ stylePreset: "custom", customStyles: [{ ...x, id: "imp-1" }], customStyleId: "imp-1" }));
    expect(g.temperature).toBe(1.1);
    expect(g.max_tokens).toBe(900);
    const or = samplerBody(g, { src: "openrouter", preset: { samplers: "full" } });
    expect(or).toEqual({ temperature: 1.1, max_tokens: 900, top_p: 0.92, top_k: 50, min_p: 0.03, frequency_penalty: 0.1, presence_penalty: 0, repetition_penalty: 1.07 });
    /* a strict first-party API gets only what it takes */
    expect(samplerBody(g, { src: "groq", preset: { samplers: "basic" } })).toEqual({ temperature: 1.1, max_tokens: 900, top_p: 0.92, frequency_penalty: 0.1, presence_penalty: 0 });
  });

  it("does not add hidden penalties without user tuning", async () => {
    const { genParams } = await import("../src/lib/styles.js");
    const { samplerBody } = await import("../src/lib/api.js");
    const g = genParams(settings({ stylePreset: "neutral" }));
    expect(samplerBody(g, { src: "openrouter", preset: { samplers: "full" } })).toEqual({ temperature: 1, max_tokens: 1000 });
  });
});

describe("hidden notes", () => {
  const reply = `The door creaks open.\n\n<!--\n* Name: Joran\n* Psychology: wary\n-->\n\n"Who's there?"`;

  it("leaves <!-- comments --> out of what is shown", () => {
    expect(hideNotes(reply)).toBe(`The door creaks open.\n\n"Who's there?"`);
  });

  it("hides a comment still streaming in", () => {
    expect(hideNotes("She nods.\n<!--\n* Name: Ka")).toBe("She nods.");
  });

  it("keeps the notes so an edit can put them back", () => {
    expect(notesOf(reply)).toBe("<!--\n* Name: Joran\n* Psychology: wary\n-->");
    expect(notesOf("plain")).toBe("");
    expect(hideNotes("plain *text*")).toBe("plain *text*");
  });

  it("a reply of only notes shows as empty", () => {
    expect(hideNotes("<!-- sheet -->")).toBe("");
  });
});

describe("author's note", () => {
  const plain = { id: "c9", name: "Mira", description: "A thief.", personality: "", exampleDialogs: "" };
  const history = [msg("assistant", "Hi."), msg("user", "Hello."), msg("assistant", "Well?"), msg("user", "Go on."), msg("assistant", "Fine.")];
  const build = (authorsNote, h = history) => buildApiMessages({ character: plain, username: "Ana", history: h, settings: settings({ memoryOn: false }), authorsNote });
  const note = { role: "user", content: "[Author's note: Mira stalls Ana.]" };

  it("is always sent three messages up, every turn, as a user message", () => {
    const base = build(undefined);
    const expected = [...base];
    expected.splice(Math.max(1, base.length - 3), 0, note);
    /* a note that never changed the old settings, a note with none, and one with old non-default ones */
    expect(build({ text: "{{char}} stalls {{user}}.", depth: 3, interval: 1, role: "user" })).toEqual(expected);
    expect(build({ text: "{{char}} stalls {{user}}." })).toEqual(expected);
    expect(build({ text: "{{char}} stalls {{user}}.", depth: 9, interval: 4, role: "system" })).toEqual(expected);
  });

  it("ignores an old interval on any turn count", () => {
    for (const n of [1, 2, 3]) {
      const h = history.slice(0, n);
      const msgs = build({ text: "Hush.", interval: 4, role: "assistant", depth: 0 }, h);
      const hit = msgs.filter((m) => m.content === "[Author's note: Hush.]");
      expect(hit).toHaveLength(1);
      expect(hit[0].role).toBe("user");
      expect(msgs.indexOf(hit[0])).toBe(Math.max(1, msgs.length - 1 - 3));
    }
  });

  it("is left out when empty", () => {
    expect(build({ text: "  \n" })).toEqual(build(undefined));
  });
});
