import { describe, expect, it } from "vitest";
import { WORLD_LOG_CAP, addHappening, parseWorldNote, sceneHead, visibleLog, worldSceneRequest } from "../src/lib/memory.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { chatBooks } from "../src/lib/lore.js";
import { breakdownTokens } from "../src/lib/tokens.js";
import { emptyData, normalizeData } from "../src/lib/data.js";

const settings = { ...structuredClone(emptyData.settings), sceneEvery: 0 };
const universe = {
  id: "u", name: "Vale", story: "A valley of rivers.", rules: "No magic.",
  characters: [{ id: "rk", name: "Rook", description: "A ferryman." }, { id: "ln", name: "Lena" }],
  locations: [{ name: "The Mill" }, { name: "Old Bridge" }],
};
const msg = (id, role = "assistant", content = `${role} ${id}`) => ({ id, role, content });

const SAMPLE = `[Tuesday, 4 May | evening | The Mill | light rain, 12°C]

[Here: Rook mending a net by the stove; Ana drying her coat.]
[Ana: soaked through, tired.]

[Elsewhere:
- Lena: at the Old Bridge, waiting for a courier she was promised
- Marta: asleep upstairs, after a double shift]

[Happening: a lantern is moving along the river path toward the mill.]

[IMPORTANT STRINGS: the ledger is missing.]`;

describe("world tracker request", () => {
  it("lists the world's characters and places and holds the three new lines", () => {
    const req = worldSceneRequest({ previous: "", messages: [msg("a"), msg("b", "user")], userName: "Ana", worldName: "Vale", characters: universe.characters, locations: universe.locations });
    expect(req.system).toContain("Rook, Lena");
    expect(req.system).toContain("The Mill, Old Bridge");
    expect(req.system).toContain("[Here: everyone present");
    expect(req.system).toContain("[Elsewhere:");
    expect(req.system).toContain("[Happening: one thing going on off-screen right now");
    expect(req.system).toContain("| location | weather");
    expect(req.system).toContain("[Ana: current appearance");
    expect(req.system).toContain("IMPORTANT STRINGS");
    expect(req.system).toContain("under 450 tokens");
    expect(req.system).toContain("Never use em-dashes");
    expect(req.system).toContain("language the story itself is written in");
    expect(req.system).toMatch(/move only in ways the story and the time/);
  });
});

describe("parseWorldNote", () => {
  it("parses a full note", () => {
    const n = parseWorldNote(SAMPLE);
    expect(n.when).toBe("Tuesday, 4 May, evening");
    expect(n.place).toBe("The Mill");
    expect(n.weather).toBe("light rain, 12°C");
    expect(n.here).toContain("Rook mending a net");
    expect(n.elsewhere).toEqual([
      { name: "Lena", text: "at the Old Bridge, waiting for a courier she was promised" },
      { name: "Marta", text: "asleep upstairs, after a double shift" },
    ]);
    expect(n.happening).toBe("a lantern is moving along the river path toward the mill.");
  });
  it("tolerates missing lines and treats quiet as nothing", () => {
    expect(parseWorldNote("[Here: nobody]")).toEqual({ when: "", place: "", weather: "", here: "nobody", elsewhere: [], happening: "" });
    expect(parseWorldNote('[Happening: "quiet"]').happening).toBe("");
    expect(parseWorldNote("[Happening: Quiet.]").happening).toBe("");
    expect(parseWorldNote("").elsewhere).toEqual([]);
  });
  it("sceneHead reads a plain scene note", () => {
    expect(sceneHead("[Day 3, 10:30 | morning | Docks | fog]\n\n[Mira: wet]")).toEqual({ when: "Day 3, 10:30, morning", place: "Docks", weather: "fog" });
  });
});

describe("world log", () => {
  const a = (id, swipe = 0) => ({ id, swipe });
  it("appends, dedupes against the last entry and caps", () => {
    let w = addHappening(undefined, "A storm rolls in from the coast.", a("r1"), "e1");
    expect(w.log).toEqual([{ id: "e1", text: "A storm rolls in from the coast.", anchor: a("r1") }]);
    expect(addHappening(w, "a storm rolls in from the coast", a("r2"), "e2")).toBe(w);
    expect(addHappening(w, "", a("r2"), "e2")).toBe(w);
    const words = "storm rider lantern market fire wedding bells raiders ferry harvest feast courier fever thief duel flood songs eclipse wolves letter".split(" ");
    for (let i = 0; i < 20; i++) w = addHappening(w, `The ${words[i]} arrives.`, a(`r${i}`), `e${i}`);
    expect(w.log).toHaveLength(WORLD_LOG_CAP);
    expect(w.log.at(-1).id).toBe("e19");
  });
  it("visibleLog keeps entries whose anchor message still shows that version", () => {
    const chat = {
      messages: [msg("r1"), { ...msg("r2"), swipes: [{ text: "a" }, { text: "b" }], swipeIdx: 0 }],
      world: { log: [{ id: "1", text: "one", anchor: a("r1") }, { id: "2", text: "two", anchor: a("r2", 1) }, { id: "3", text: "three", anchor: a("gone") }] },
    };
    expect(visibleLog(chat).map((e) => e.id)).toEqual(["1"]);
    chat.messages[1].swipeIdx = 1;
    expect(visibleLog(chat).map((e) => e.id)).toEqual(["1", "2"]);
  });
  it("normalizeData keeps a world log's valid entries", () => {
    const d = structuredClone(emptyData);
    d.chats = [{ id: "c", kind: "universe", universeId: "u", messages: [], world: { log: [{ text: "ok", anchor: a("r") }, { text: 5 }, null] } }, { id: "d", kind: "universe", messages: [], world: "bad" }];
    const out = normalizeData(d);
    expect(out.chats[0].world.log).toEqual([{ text: "ok", anchor: a("r") }]);
    expect("world" in out.chats[1]).toBe(false);
  });
});

describe("universe prompt", () => {
  const history1 = [msg("g"), msg("u1", "user")];
  const history2 = [...history1, msg("r1"), msg("u2", "user")];
  it("has a static How this world runs block", () => {
    const one = buildApiMessages({ universe, username: "Ana", history: history1, settings });
    const two = buildApiMessages({ universe, username: "Ana", history: history2, settings, world: [{ text: "A storm." }], phone: "[On the phones lately: x]" });
    expect(one[0].content).toContain("[How this world runs]");
    expect(one[0].content).toContain("The world does not wait for Ana.");
    expect(one[0].content.indexOf("[How this world runs]")).toBeGreaterThan(one[0].content.indexOf("[Characters]"));
    expect(two[0].content).toBe(one[0].content);
  });
  it("adds Elsewhere lately only for visible entries, before the tracker", () => {
    const chat = { messages: history2, world: { log: [{ text: "Hidden.", anchor: { id: "gone", swipe: 0 } }] } };
    const none = buildApiMessages({ universe, username: "Ana", history: history2, settings, world: visibleLog(chat) });
    expect(none.at(-1).content).not.toContain("Elsewhere lately");
    chat.world.log.push(...["one", "two", "three", "four"].map((t) => ({ text: `Event ${t}.`, anchor: { id: "r1", swipe: 0 } })));
    const scene = { text: "[Day | night | Mill | rain]", lastId: "r1" };
    const out = buildApiMessages({ universe, username: "Ana", history: history2, settings, world: visibleLog(chat), scene, phone: "[On the phones lately (x):\n- Rook texted Ana: \"hi\"]" });
    const tail = out.at(-1).content;
    expect(tail).toContain("Elsewhere lately");
    expect(tail).not.toContain("Event one.");
    expect(tail).toContain("Event four.");
    /* a universe keeps its tracker in the prompt even with scene tracking off */
    expect(tail).toContain("(Private scene tracker");
    expect(tail.indexOf("Elsewhere lately")).toBeLessThan(tail.indexOf("(Private scene tracker"));
    expect(tail.indexOf("On the phones lately")).toBeLessThan(tail.indexOf("(Private scene tracker"));
  });
  it("character chats ignore the world log but take the phone note, also when impersonating", () => {
    const character = { id: "c", name: "Mira" };
    const out = buildApiMessages({ character, username: "Ana", history: history2, settings, world: [{ text: "Storm." }], phone: "[On the phones lately: y]" });
    expect(out.at(-1).content).not.toContain("Elsewhere lately");
    expect(out.at(-1).content).toContain("On the phones lately");
    const imp = buildApiMessages({ character, username: "Ana", history: history2, settings, mode: "impersonate", phone: "[On the phones lately: y]" });
    expect(imp.at(-1).content).toContain("On the phones lately");
  });
  it("token breakdown counts the ambient notes", () => {
    const base = breakdownTokens({ universe, username: "Ana", history: history2, settings });
    const more = breakdownTokens({ universe, username: "Ana", history: history2, settings, world: [{ text: "A long storm rolls over the hills tonight." }], phone: "[On the phones lately: a b c d e f]" });
    expect(more.memoryTokens).toBeGreaterThan(base.memoryTokens);
    expect(more.totalTokens).toBeGreaterThan(base.totalTokens);
  });
});

describe("chatBooks", () => {
  it("includes a universe's own lorebook", () => {
    const book = { id: "ub", entries: [{ keys: ["mill"], content: "The mill." }] };
    const extra = { id: "lb", entries: [{ keys: ["x"], content: "x" }] };
    const books = chatBooks({ chat: { lorebookIds: ["lb"] }, universe: { ...universe, lorebook: book }, lorebooks: [extra] });
    expect(books.map((b) => b.id)).toEqual(["ub", "lb"]);
    expect(chatBooks({ chat: {}, universe, lorebooks: [] })).toEqual([]);
  });
});
