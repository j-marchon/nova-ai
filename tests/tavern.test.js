import { describe, expect, it } from "vitest";
import { rollDice, runMacros, stripComments } from "../src/lib/macros.js";
import { applyPromptRegex, readTavernPreset, tavernRegex } from "../src/lib/tavern.js";
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
