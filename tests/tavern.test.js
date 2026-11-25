import { describe, expect, it } from "vitest";
import { rollDice, runMacros, stripComments } from "../src/lib/macros.js";
import { applyPromptRegex, applyRegex, readTavernPreset, regexFile, tavernRegex } from "../src/lib/tavern.js";
import { parseStyleImport } from "../src/lib/styles.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { emptyData } from "../src/lib/data.js";

const msg = (role, content) => ({ id: `${role}-${Math.random().toString(36).slice(2)}`, role, content });

describe("macros", () => {
  it("removes notes and trims around {{trim}}", () => {
    expect(runMacros("{{// a note with {{setvar::x::1}} inside}}{{trim}}\n\nHello")).toBe("Hello");
    expect(runMacros("a\n{{trim}}\nb")).toBe("ab");
  });

  it("sets and reads variables left to right, nested arguments first", () => {
    const vars = {};
    const out = runMacros("{{setvar::r::{{roll::1d20}}}}Roll {{getvar::r}}{{setvar::seen::{{getvar::r}}}}", { vars, random: () => 0.5 });
    expect(out).toBe("Roll 11");
    expect(vars).toEqual({ r: "11", seen: "11" });
  });

  it("reads before a later reset in the same text", () => {
    const vars = { dice: "A 4" };
    expect(runMacros("<d>{{getvar::dice}}</d>{{setvar::dice::}}", { vars })).toBe("<d>A 4</d>");
    expect(vars.dice).toBe("");
  });

  it("keeps variables across calls and does arithmetic", () => {
    const vars = {};
    runMacros("{{setvar::n::2}}{{addvar::n::3}}", { vars });
    expect(runMacros("{{incvar::n}} {{decvar::n}} {{getvar::missing::None}}", { vars })).toBe("6 5 None");
  });

  it("fills names in any case and leaves unknown macros alone", () => {
    expect(runMacros("{{Char}} and {{USER}} {{lastMessage}}", { user: "Ana", char: "Mira" })).toBe("Mira and Ana {{lastMessage}}");
  });

  it("rolls dice in the usual shapes", () => {
    const max = () => 0.999;
    expect(rollDice("1d20", max)).toBe("20");
    expect(rollDice("2d6+3", max)).toBe("15");
    expect(rollDice("100", () => 0)).toBe("1");
    expect(runMacros("{{roll:d6}}", { random: () => 0 })).toBe("1");
    expect(rollDice("nonsense")).toBe("");
  });

  it("picks from {{random}}", () => {
    expect(runMacros("{{random::a::b::c}}", { random: () => 0.99 })).toBe("c");
    expect(runMacros("{{random:x,y}}", { random: () => 0 })).toBe("x");
  });

  it("strips only notes for an import", () => {
    expect(stripComments("{{// hi}}A {{getvar::x}} {{//b}}")).toBe("A {{getvar::x}} ");
  });
});

const preset = {
  temperature: 0.7,
  prompts: [
    { identifier: "main", role: "system", content: "{{// note}}{{trim}}\nMain rules.", injection_position: 0 },
    { identifier: "dice", role: "system", content: "{{setvar::d::{{roll::1d6}}}}Dice engine.", injection_position: 0 },
    { identifier: "gate", role: "system", content: "Last-mile gate.", injection_position: 1, injection_depth: 0 },
    { identifier: "cot", role: "assistant", content: "Think first.", injection_position: 1, injection_depth: 0 },
    { identifier: "show", role: "system", content: "<dice>{{getvar::d}}</dice>", injection_position: 1, injection_depth: 0, injection_trigger: ["normal", "swipe"] },
    { identifier: "deep", role: "system", content: "Two up.", injection_position: 1, injection_depth: 2 },
    { identifier: "imp", role: "user", content: "Write as {{user}}.", injection_position: 1, injection_depth: 0, injection_trigger: ["impersonate"] },
    { identifier: "jailbreak", role: "system", content: "After history.", injection_position: 0 },
    { identifier: "off", role: "system", content: "Switched off.", injection_position: 0 },
    { identifier: "chatHistory", marker: true },
    { identifier: "charDescription", marker: true },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: "main", enabled: true }, { identifier: "dice", enabled: true }, { identifier: "off", enabled: false },
      { identifier: "charDescription", enabled: true }, { identifier: "cot", enabled: true }, { identifier: "gate", enabled: true },
      { identifier: "show", enabled: true }, { identifier: "deep", enabled: true }, { identifier: "imp", enabled: true },
      { identifier: "chatHistory", enabled: true }, { identifier: "jailbreak", enabled: true },
    ],
  }],
  extensions: {
    regex_scripts: [
      { scriptName: "Saver", findRegex: "/<stats>[\\s\\S]*?<\\/stats>\\s*/g", replaceString: "", placement: [2], promptOnly: true, minDepth: 2, maxDepth: null, disabled: false },
      { scriptName: "Off", findRegex: "/x/g", replaceString: "", placement: [2], promptOnly: true, disabled: true },
      { scriptName: "Display", findRegex: "/x/g", replaceString: "", placement: [2], markdownOnly: true, disabled: false },
      { scriptName: "Tag", findRegex: "/\\[(\\w+)\\]/g", replaceString: "<$1|{{match}}>", trimStrings: ["["], placement: [1], promptOnly: true, disabled: false },
      { scriptName: "Broken", findRegex: "/(/g", replaceString: "", placement: [2], promptOnly: true, disabled: false },
    ],
  },
};

describe("SillyTavern preset import", () => {
  it("puts each enabled block where it goes and drops impersonate-only ones", () => {
    const st = readTavernPreset(preset);
    expect(st.text).toBe("Main rules.\n\n{{setvar::d::{{roll::1d6}}}}Dice engine.");
    /* depth 0 by role, system before assistant, then what follows the history */
    expect(st.post).toBe("Last-mile gate.\n\n<dice>{{getvar::d}}</dice>\n\nThink first.\n\nAfter history.");
    expect(st.inject).toEqual([{ depth: 2, text: "Two up." }]);
    expect(st.post).not.toContain("Write as");
  });

  it("keeps only enabled, prompt-only regex scripts that compile", () => {
    expect(tavernRegex(preset.extensions.regex_scripts).map((r) => r.name)).toEqual(["Saver", "Tag"]);
  });

  it("is what parseStyleImport saves", () => {
    const [x] = parseStyleImport(JSON.stringify(preset));
    expect(x.text).toContain("Main rules.");
    expect(x.post).toContain("Last-mile gate.");
    expect(x.inject).toHaveLength(1);
    expect(x.regex.map((r) => r.name)).toEqual(["Saver", "Tag"]);
  });
});

describe("prompt-only regex", () => {
  const rules = tavernRegex(preset.extensions.regex_scripts);

  it("trims old replies within its depths and leaves the saved messages alone", () => {
    const h = [msg("assistant", "A <stats>1</stats>"), msg("user", "hi"), msg("assistant", "B <stats>2</stats>"), msg("user", "go")];
    const out = applyPromptRegex(h, rules);
    expect(out.map((m) => m.content)).toEqual(["A ", "hi", "B <stats>2</stats>", "go"]);
    expect(h[0].content).toBe("A <stats>1</stats>");
    expect(out[1]).toBe(h[1]);
  });

  it("fills groups and {{match}}, minus trim strings", () => {
    expect(applyPromptRegex([msg("user", "say [hi]")], rules)[0].content).toBe("say <hi|hi]>");
  });
});

describe("an imported preset, sent", () => {
  const [x] = parseStyleImport(JSON.stringify(preset));
  const settings = { ...emptyData.settings, apiKey: "k", stylePreset: "custom", customStyles: [{ ...x, id: "imp-1" }], customStyleId: "imp-1" };
  const history = [
    msg("user", "one"), msg("assistant", "Reply <stats>old</stats>"), msg("user", "two"),
    msg("assistant", "Reply <stats>new</stats>"), msg("user", "three"),
  ];

  it("runs the macros, places the blocks and trims the history", () => {
    const vars = {};
    const msgs = buildApiMessages({ character: { name: "Mira", description: "A thief." }, username: "Ana", history, settings, vars });
    const all = msgs.map((m) => m.content).join("\n");
    expect(all).not.toMatch(/\{\{(setvar|getvar|roll|trim|\/\/)/);
    expect(vars.d).toMatch(/^[1-6]$/);
    expect(msgs[msgs.length - 1].content).toContain(`<dice>${vars.d}</dice>`);
    expect(msgs[msgs.length - 1].content).toContain("Last-mile gate.");
    expect(msgs[0].content).toContain("Dice engine.");
    expect(all).not.toContain("<stats>old</stats>");
    expect(all).toContain("<stats>new</stats>");
    /* two up from the newest: joined to "two", the user turn before it */
    expect(msgs.find((m) => m.content.startsWith("two")).content).toBe("two\n\nTwo up.");
    expect(all).not.toContain("Write as Ana");
  });
});

describe("a preset that places its own sections", () => {
  const st = {
    prompts: [
      { identifier: "main", role: "system", content: "Rules.", injection_position: 0 },
      { identifier: "lw", role: "system", content: "[World]", injection_position: 0 },
      { identifier: "worldInfoBefore", marker: true },
      { identifier: "lp", role: "system", content: "[{{user}}'s persona]", injection_position: 0 },
      { identifier: "personaDescription", marker: true },
      { identifier: "lc", role: "system", content: "[{{char}}'s sheet]", injection_position: 0 },
      { identifier: "charDescription", marker: true },
      { identifier: "imp", role: "system", content: "Only when writing for the user.", injection_trigger: ["impersonate"], injection_position: 0 },
      { identifier: "chatHistory", marker: true },
    ],
    prompt_order: [{ character_id: 1, order: ["main", "lw", "worldInfoBefore", "lp", "personaDescription", "lc", "charDescription", "imp", "chatHistory"].map((identifier) => ({ identifier, enabled: true })) }],
    impersonation_prompt: "Write as {{user}}.",
    extensions: { regex_scripts: [
      { scriptName: "Rewrite", findRegex: "/\\bAna\\b/g", replaceString: "you", placement: [2] },
      { scriptName: "Mine", findRegex: "/{{user}}/g", replaceString: "me", placement: [2], substituteRegex: 1, promptOnly: true },
    ] },
  };
  const [x] = parseStyleImport(JSON.stringify(st));
  const settings = { ...emptyData.settings, stylePreset: "custom", customStyles: [{ ...x, id: "i" }], customStyleId: "i" };
  const build = (extra = {}) => buildApiMessages({ character: { name: "Mira", description: "A thief." }, persona: { name: "Ana", description: "A pilot." }, username: "Ana", history: [msg("assistant", "Hi"), msg("user", "Hello")], settings, ...extra });

  it("sends each label right before what it labels, and the sections in the preset's order", () => {
    const sys = build()[0].content;
    expect(sys.indexOf("Rules.")).toBeLessThan(sys.indexOf("[Ana's persona]"));
    expect(sys).toMatch(/\[Ana's persona\]\n\nA pilot\.\n\n\[Mira's sheet\]\n\nA thief\./);
  });

  it("drops a label with nothing under it", () => {
    expect(build()[0].content).not.toContain("[World]");
  });

  it("keeps Impersonate's text for Impersonate only", () => {
    expect(x.modes.impersonate).toContain("Write as {{user}}.");
    expect(x.modes.impersonate).toContain("Only when writing for the user.");
    expect(build().map((m) => m.content).join("\n")).not.toContain("Write as Ana.");
    expect(build({ mode: "impersonate" }).map((m) => m.content).join("\n")).toContain("Write as Ana.");
  });

  it("keeps scripts that rewrite the saved reply, and fills macros in a pattern", () => {
    expect(x.saved.map((r) => r.name)).toEqual(["Rewrite"]);
    expect(applyRegex("Ana waves", x.saved, "assistant", 0)).toBe("you waves");
    const mine = x.regex.find((r) => r.name === "Mine");
    expect(applyRegex("Ana and Mira", [mine], "assistant", 0, { user: "Ana", char: "Mira" })).toBe("me and Mira");
  });
});


describe("as SillyTavern runs them", () => {
  const rule = (o) => tavernRegex([{ scriptName: "t", placement: [2], promptOnly: true, ...o }])[0];

  it("reads patterns as SillyTavern does: no slashes means no flags", () => {
    expect(applyRegex("a a a", [rule({ findRegex: "a", replaceString: "b" })], "assistant", 0)).toBe("b a a");
    expect(applyRegex("a a a", [rule({ findRegex: "/a/g", replaceString: "b" })], "assistant", 0)).toBe("b b b");
  });

  it("runs the macros in replacements and trim strings", () => {
    const r = rule({ findRegex: "/<name>(.*?)<\/name>/g", replaceString: "{{char}} meets {{user}}: $1", trimStrings: ["{{user}}"] });
    expect(applyRegex("<name>hi Ann</name>", [r], "assistant", 0, { user: "Ann", char: "Bo" })).toBe("Bo meets Ann: hi ");
  });
});

describe("SillyTavern's newer macros", () => {
  const fields = { description: "A {{char}} card", persona: "", lastUserMessage: "hello there" };
  const run = (t, vars = {}) => runMacros(t, { vars, user: "Ann", char: "Bo", fields, seed: "c1", now: new Date(2026, 10, 25, 15, 4) });

  it("branches with {{if}} and {{else}}, nested, on values, macros and variables", () => {
    expect(run("{{if description}}D: {{description}}{{else}}none{{/if}}")).toBe("D: A Bo card");
    expect(run("{{if persona}}P{{else}}no persona{{/if}}")).toBe("no persona");
    expect(run("{{if !persona}}empty{{/if}}")).toBe("empty");
    expect(run("{{setvar::hp::0}}{{if {{getvar::hp}}}}alive{{else}}dead{{/if}}")).toBe("dead");
    expect(run("{{if 1}}a{{if 0}}b{{else}}c{{/if}}d{{else}}e{{/if}}")).toBe("acd");
    expect(run("{{if .x}}set{{else}}unset{{/if}}", { x: "1" })).toBe("set");
  });

  it("does the variable shorthand, global variables and the rest", () => {
    expect(run("{{.mood = happy}}{{.mood}} {{$g = 1}}{{$g++}} {{.n += 2}}{{.n}} {{.n >= 2}}")).toBe("happy 2 2 true");
    expect(run("{{lastUserMessage}}|{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}")).toBe("hello there|3:04 PM|November 25, 2026|Wednesday|15:04|2026-11-25");
    expect(run("{{setvar::m::1}}{{reverse::abc}}{{space}}{{hasvar::m}} {{deletevar::m}}{{hasvar::m}}")).toBe("cba true false");
    expect(run("{{setglobalvar::x::5}}{{getglobalvar::x}} {{unknown::y}}")).toBe("5 {{unknown::y}}");
    expect(run("{{pick::a::b::c::d}}")).toBe(run("{{pick::a::b::c::d}}"));
    expect(runMacros("{{description}}", { user: "A" })).toBe("{{description}}");
  });
});

describe("SillyTavern's block macros", () => {
  const run = (t, vars = {}) => runMacros(t, { vars, user: "Ann", char: "Bo", fields: { persona: "p" } });

  it("passes a block's content as the last argument, trimmed and de-indented unless #", () => {
    expect(run("{{if persona}}\n  A\n    B\n{{/if}}")).toBe("A\n  B");
    expect(run("{{#if persona}}\n  A\n{{/if}}")).toBe("\n  A\n");
    expect(run("{{#setvar::x}}  long {{char}}  {{/setvar}}{{setvar::y}}\n  hi\n{{/setvar}}[{{getvar::x}}|{{.y}}]")).toBe("[  long Bo  |hi]");
  });

  it("does not take a complete macro inside a block for the start of another", () => {
    expect(run("{{#setvar::a}}x{{setvar::b::1}}y{{/setvar}}[{{.a}}|{{.b}}]")).toBe("[xy|1]");
  });

  it("reads on past a {{ that never closes, and keeps keyed variables", () => {
    expect(run("{{user|| acts {{user}}")).toBe("{{user|| acts Ann");
    expect(run("{{setvarkey::o::a::1}}{{setvarkey::l::0::x}}{{getvarkey::o::a}}|{{getvarkey::l::0}}|{{.o}}")).toBe('1|x|{"a":"1"}');
    expect(run("{{outlet::lore}}|{{/foo}}")).toBe("|{{/foo}}");
  });
});

describe("a regex file exported from SillyTavern", () => {
  it("is read as scripts, one or a list, and anything else is not", () => {
    const one = { scriptName: "s", findRegex: "/x/g", replaceString: "y", placement: [2], markdownOnly: true };
    expect(regexFile(JSON.stringify(one)).display).toHaveLength(1);
    expect(regexFile(JSON.stringify([one, { ...one, scriptName: "p", markdownOnly: false, promptOnly: true }])).regex).toHaveLength(1);
    expect(regexFile(JSON.stringify({ prompts: [] }))).toBeNull();
    expect(regexFile("not json")).toBeNull();
  });
});
