import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { emptyData } from "../src/lib/data.js";
import { genParams, parseStyleImport } from "../src/lib/styles.js";
import { memoryConflicts, memoryOffEverywhere, withChatMemory } from "../src/lib/memory.js";

const shiroPath = "/home/mint/Downloads/Shiro-Mixtape.json";
const tracker = {
  prompts: [{ identifier: "m", role: "system", content: "Write the scene.", injection_position: 0 }, { identifier: "t", role: "user", content: "At the end append a <details>Tracker= ...</details> block.", injection_position: 1, injection_depth: 0 }],
  prompt_order: [{ character_id: 1, order: [{ identifier: "m", enabled: true }, { identifier: "t", enabled: true }] }],
};
const settingsWith = (preset, extra = {}) => {
  const [x] = parseStyleImport(JSON.stringify(preset));
  return { ...emptyData.settings, sceneEvery: 4, stylePreset: "custom", customStyles: [{ ...x, id: "i" }], customStyleId: "i", ...extra };
};

describe("a reply style with its own memory", () => {
  it("is found when it writes a tracker, and Nova's tracker can be switched off for one chat", () => {
    const s = settingsWith(tracker);
    const found = memoryConflicts(genParams(s), s, { messages: [1] });
    expect(found.map((x) => x.part)).toEqual(["scene"]);
    const chat = { memoryOff: { scene: true } };
    expect(withChatMemory(s, chat).sceneEvery).toBe(0);
    expect(withChatMemory(s, chat).memoryOn).toBe(s.memoryOn);
    expect(memoryConflicts(genParams(s), s, chat)).toEqual([]);
    expect(withChatMemory(s, null)).toBe(s);
  });

  it("can be switched off for every chat in settings", () => {
    const s = settingsWith(tracker, { memoryOn: true, ragOn: true });
    const all = memoryOffEverywhere(s, ["scene", "recall"]);
    expect(all.sceneEvery).toBe(0);
    expect(all.ragOn).toBe(false);
    expect(all.memoryOn).toBe(true);
    expect(memoryOffEverywhere(s, ["summary"]).memoryOn).toBe(false);
    expect(memoryOffEverywhere(s, [])).toBe(s);
    expect(memoryConflicts(genParams(all), all, { messages: [1] })).toEqual([]);
  });

  it("is not reported for a plain prompt", () => {
    const s = settingsWith({ prompts: [{ identifier: "m", role: "system", content: "Write vividly.", injection_position: 0 }], prompt_order: [{ character_id: 1, order: [{ identifier: "m", enabled: true }] }] });
    expect(memoryConflicts(genParams(s), s, {})).toEqual([]);
  });

  it.runIf(fs.existsSync(shiroPath))("finds Shiro's tracker", () => {
    const s = settingsWith(JSON.parse(fs.readFileSync(shiroPath, "utf8")));
    expect(memoryConflicts(genParams(s), s, {}).map((x) => x.part)).toContain("scene");
  });
});
