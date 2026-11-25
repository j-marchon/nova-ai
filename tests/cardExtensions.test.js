import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { cardFields, characterCardJson, characterFromCard, importCardFile, readCharx } from "../src/lib/cards.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { applyRegex, chatRegex, tavernRegex } from "../src/lib/tavern.js";
import { emptyData } from "../src/lib/data.js";

const settings = { ...emptyData.settings, apiKey: "k" };
const msg = (role, content) => ({ id: Math.random().toString(36).slice(2), role, content });
const history = ["a1", "u1", "a2", "u2", "a3", "u3"].map((t) => msg(t[0] === "a" ? "assistant" : "user", t));

const script = (o) => ({ scriptName: "s", findRegex: "/x/g", replaceString: "y", placement: [1, 2], ...o });
const card = {
  spec: "chara_card_v3",
  data: {
    name: "Mira", description: "A thief.", first_mes: "Hi.",
    character_book: { entries: [{ keys: ["vault"], content: "The vault is old.", enabled: true }] },
    extensions: {
      depth_prompt: { prompt: "<BOT> whispers to {{user}}.", depth: 2, role: "user" },
      regex_scripts: [script({ scriptName: "Mask", promptOnly: true }), script({ scriptName: "Pretty", markdownOnly: true }), { bad: 1 }],
    },
  },
};

describe("character's note (depth_prompt)", () => {
  it("is imported, kept on export and read back", () => {
    const ch = characterFromCard(cardFields(card), "", null, "");
    expect(ch.depthPrompt).toEqual({ prompt: "{{char}} whispers to {{user}}.", depth: 2, role: "user" });
    const out = characterCardJson(ch).data.extensions;
    expect(out.depth_prompt).toEqual(ch.depthPrompt);
    expect(characterFromCard(cardFields({ data: { name: "M", extensions: out } }), "", null, "").depthPrompt).toEqual(ch.depthPrompt);
    /* SillyTavern's defaults; nothing when empty */
    expect(cardFields({ data: { extensions: { depth_prompt: { prompt: "n" } } } }).depthPrompt).toEqual({ prompt: "n", depth: 4, role: "system" });
    expect(cardFields({ data: { extensions: { depth_prompt: { prompt: " ", depth: 4 } } } }).depthPrompt).toBeNull();
  });

  it("is sent every turn at its depth, in its role, with macros filled", () => {
    const at = (note) => {
      const msgs = buildApiMessages({ character: { name: "Mira", description: "d", depthPrompt: note }, username: "Ana", history, settings });
      return msgs.findIndex((m) => m.content.includes("whispers"));
    };
    const msgs = buildApiMessages({ character: { name: "Mira", description: "d", depthPrompt: { prompt: "{{char}} whispers to {{user}}.", depth: 2, role: "assistant" } }, username: "Ana", history, settings });
    const i = msgs.findIndex((m) => m.content.includes("whispers"));
    expect(msgs[i]).toEqual({ role: "assistant", content: "Mira whispers to Ana." });
    /* two messages after it: u3 and a3 */
    expect(msgs.length - i).toBe(3);
    /* a user (or system) note joins the user turn at that point */
    const user = buildApiMessages({ character: { name: "Mira", description: "d", depthPrompt: { prompt: "whispers", depth: 2, role: "system" } }, username: "Ana", history, settings });
    const j = user.findIndex((m) => m.content.includes("whispers"));
    expect(user[j].role).toBe("user");
    expect(user[j].content.startsWith("u2")).toBe(true);
    /* depth 0 as assistant would be a prefill: it goes as user instead */
    const zero = buildApiMessages({ character: { name: "Mira", description: "d", depthPrompt: { prompt: "whispers", depth: 0, role: "assistant" } }, username: "Ana", history, settings });
    expect(zero.at(-1).role).toBe("user");
    expect(at(null)).toBe(-1);
    expect(at({ prompt: "whispers", depth: 2, role: "user" })).toBeGreaterThan(0);
    /* off with the card's instructions */
    const off = buildApiMessages({ character: { name: "Mira", description: "d", depthPrompt: { prompt: "whispers" } }, username: "Ana", history, settings: { ...settings, cardInstructions: false } });
    expect(off.some((m) => m.content.includes("whispers"))).toBe(false);
  });
});

describe("card regex scripts", () => {
  it("are imported whole and go back out on export", () => {
    const ch = characterFromCard(cardFields(card), "", null, "");
    expect(ch.regexScripts.map((x) => x.scriptName)).toEqual(["Mask", "Pretty"]);
    expect(characterCardJson(ch).data.extensions.regex_scripts).toEqual(ch.regexScripts);
  });

  it("run after the prompt's own, in each kind, switched-off ones skipped", () => {
    const style = { regex: tavernRegex([script({ scriptName: "P", findRegex: "/a/g", replaceString: "b", promptOnly: true })]), display: [], saved: [] };
    const character = { name: "Mira", description: "d", regexScripts: [
      script({ scriptName: "C", findRegex: "/b/g", replaceString: "c", promptOnly: true }),
      script({ scriptName: "Off", findRegex: "/c/g", replaceString: "z", promptOnly: true, disabled: true }),
      script({ scriptName: "Show", findRegex: "/q/g", replaceString: "Q", markdownOnly: true }),
    ] };
    const rules = chatRegex(style, character, "prompt");
    expect(rules.map((r) => r.name)).toEqual(["P", "C"]);
    expect(applyRegex("aaa", rules, "user", 0)).toBe("ccc");
    expect(chatRegex(style, character, "display").map((r) => r.name)).toEqual(["Show"]);
    expect(chatRegex(style, null, "saved")).toEqual([]);
    /* and in what is sent */
    const msgs = buildApiMessages({ character, username: "Ana", history: [msg("user", "a cab")], settings: { ...settings, stylePreset: "custom", customStyleId: "p", customStyles: [{ id: "p", name: "P", text: "Be brief.", regex: style.regex }] } });
    expect(msgs.at(-1).content.startsWith("c ccc")).toBe(true);
  });

  it("a prompt script switched off is kept but not run", () => {
    const [rule] = tavernRegex([script({ findRegex: "/a/g", replaceString: "b", promptOnly: true })]);
    expect(applyRegex("a", [rule], "user", 0)).toBe("b");
    expect(applyRegex("a", [{ ...rule, disabled: true }], "user", 0)).toBe("a");
    expect(chatRegex({ regex: [{ ...rule, disabled: true }] }, null, "prompt")).toEqual([]);
  });
});

describe("CharX", () => {
  const v3 = {
    spec: "chara_card_v3",
    data: {
      ...card.data,
      assets: [
        { type: "icon", uri: "embeded://assets/icon/images/other.png", name: "alt", ext: "png" },
        { type: "icon", uri: "embeded://assets/icon/images/main.png", name: "main", ext: "png" },
        { type: "background", uri: "embeded://assets/other/bg.png", name: "bg", ext: "png" },
      ],
    },
  };
  const zip = zipSync({
    "card.json": strToU8(JSON.stringify(v3)),
    "assets/icon/images/main.png": new Uint8Array([1, 2, 3]),
    "assets/icon/images/other.png": new Uint8Array([9]),
  });

  it("reads card.json and the main icon", async () => {
    const { json, image } = readCharx(zip);
    expect(json.data.name).toBe("Mira");
    expect(image.type).toBe("image/png");
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("imports as a character with its lorebook, note and scripts", async () => {
    const ch = await importCardFile(new File([zip], "mira.charx"));
    expect(ch.name).toBe("Mira");
    expect(ch.lorebook.entries[0].content).toBe("The vault is old.");
    expect(ch.depthPrompt.depth).toBe(2);
    expect(ch.regexScripts).toHaveLength(2);
    await expect(importCardFile(new File([zipSync({ "x.txt": strToU8("x") })], "x.charx"))).rejects.toThrow(/not a CharX card/);
  });
});
