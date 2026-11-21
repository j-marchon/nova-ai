import { describe, expect, it } from "vitest";
import {
  activeSummary, afterDeleting, cleanNote, keepIfCovered, memoryCovered, memoryDue,
  sceneDue, sceneWindow, summaryRequest, transcript,
} from "../src/lib/memory.js";
import { historyCut } from "../src/lib/window.js";
import { addSwipe, editMessage, showSwipe, swipeIndex, swipeList } from "../src/lib/swipes.js";
import { ensembleTitle, linkedCards, scopeNote } from "../src/lib/scope.js";
import { buildApiMessages } from "../src/lib/prompt.js";

let n = 0;
const msg = (role, content = "word ".repeat(60), extra = {}) => ({ id: `m${n++}`, role, content, ...extra });
const chatOf = (k) => Array.from({ length: k }, (_, i) => msg(i % 2 ? "user" : "assistant"));

describe("memory", () => {
  it("is due exactly when the window start passes what is covered", () => {
    const h = chatOf(80);
    const cut = historyCut(h, 2000);
    expect(memoryDue(h, 2000, null)).toEqual({ from: 0, to: cut, previous: "" });
    const memory = { summary: "S", lastId: h[cut - 1].id };
    expect(memoryDue(h, 2000, memory)).toBeNull();
    expect(memoryCovered(h, memory)).toBe(cut);
  });

  it("is not due while everything fits", () => {
    expect(memoryDue(chatOf(6), 100000, null)).toBeNull();
  });

  it("is dropped when the chat is cut back before what it covers", () => {
    const h = chatOf(10);
    const memory = { summary: "S", lastId: h[6].id };
    expect(keepIfCovered(memory, h.slice(0, 8))).toBe(memory);
    expect(keepIfCovered(memory, h.slice(0, 5))).toBeNull();
    expect(activeSummary(h.slice(0, 5), memory)).toBe("");
  });

  it("moves back one when the message it ends on is deleted", () => {
    const h = chatOf(10);
    const memory = { summary: "S", lastId: h[6].id };
    expect(afterDeleting(memory, h, h[6].id).lastId).toBe(h[5].id);
    expect(afterDeleting(memory, h, h[2].id)).toBe(memory);
    expect(afterDeleting({ summary: "S", lastId: h[0].id }, h, h[0].id)).toBeNull();
  });

  it("asks for the summary in the story's language, with names on each line", () => {
    const h = [msg("user", "Olá"), msg("assistant", "Oi", { speaker: "Mira" })];
    const req = summaryRequest({ previous: "", messages: h, userName: "Ana", charName: "Group" });
    expect(req.system).toMatch(/language the story itself is written in/);
    expect(transcript(h, { userName: "Ana", charName: "X" })).toBe("Ana: Olá\n\nMira: Oi");
  });

  it("cleans think blocks and headings from a note", () => {
    expect(cleanNote("<think>hmm</think>\n# Updated memory\nThey met.")).toBe("They met.");
  });
});

describe("scene", () => {
  it("is due after the first exchange, then every N replies", () => {
    const h = [msg("assistant"), msg("user"), msg("assistant")];
    expect(sceneDue(h.slice(0, 1), null, 4)).toBe(false);
    expect(sceneDue(h, null, 4)).toBe(true);
    const scene = { text: "Time: night", lastId: h[2].id };
    const more = [...h, msg("user"), msg("assistant"), msg("user"), msg("assistant")];
    expect(sceneDue(more, scene, 4)).toBe(false);
    expect(sceneDue(more, scene, 2)).toBe(true);
    expect(sceneDue(more, scene, 0)).toBe(false);
  });

  it("reads only what came after the last note, at most a dozen messages", () => {
    const h = chatOf(30);
    expect(sceneWindow(h, { text: "x", lastId: h[25].id })).toEqual(h.slice(26));
    expect(sceneWindow(h, null)).toHaveLength(12);
  });
});

describe("swipes", () => {
  const base = { id: "a", role: "assistant", content: "first" };

  it("treats a plain message as one version", () => {
    expect(swipeList(base)).toEqual([{ text: "first" }]);
    expect(swipeIndex(base)).toBe(0);
  });

  it("adds a version and shows it, keeping the old one", () => {
    const m = addSwipe(base, "second", "other/model");
    expect(m.content).toBe("second");
    expect(m.via).toBe("other/model");
    expect(swipeList(m).map((v) => v.text)).toEqual(["first", "second"]);
    const back = showSwipe(m, 0);
    expect(back.content).toBe("first");
    expect(back.via).toBeUndefined();
    expect(showSwipe(m, 9).content).toBe("second");
  });

  it("edits only the version on screen", () => {
    const m = showSwipe(addSwipe(base, "second"), 0);
    const e = editMessage(m, "first, fixed");
    expect(e.content).toBe("first, fixed");
    expect(swipeList(e).map((v) => v.text)).toEqual(["first, fixed", "second"]);
    expect(editMessage(base, "x")).toEqual({ ...base, content: "x" });
  });
});

describe("chats with several of your characters", () => {
  const mira = { id: "1", name: "Mira", description: "A trader." };
  const tom = { id: "2", name: "Tom Reyes", description: "A smith.", postHistoryInstructions: "Tom never lies." };
  const ivy = { id: "3", name: "Ivy" };
  const scope = { mode: "manual", carry: true, turns: 3, cast: [{ id: "a", name: "Tom Reyes", characterId: "2", description: "" }, { id: "b", name: "Ivy", characterId: "3", description: "" }], dismissed: [] };
  const said = (c, text = "…") => ({ id: `s${n++}`, role: "assistant", content: text, speaker: c.name, speakerId: c.id });

  it("finds the linked cards and names the chat after everyone", () => {
    const linked = linkedCards(scope, [mira, tom, ivy], mira.id);
    expect(linked).toEqual([tom, ivy]);
    expect(ensembleTitle([mira, ...linked])).toBe("Mira, Tom Reyes, Ivy");
  });

  it("labels earlier replies by whoever spoke, and adds each linked card's own instructions by name", () => {
    const history = [said(mira, "Hi."), said(tom, "Hey."), { id: "u", role: "user", content: "Both of you, sit." }];
    const msgs = buildApiMessages({ character: mira, ensemble: [tom, ivy], username: "Ana", history, settings: {},
      scope: scopeNote({ scope, character: mira, ensemble: [tom, ivy], userName: "Ana" }) });
    expect(msgs[1].content).toBe("Hi.");
    expect(msgs[2].content).toBe("Tom Reyes: Hey.");
    const last = msgs.at(-1).content;
    expect(last).toContain("[Tom Reyes: Tom never lies.]");
    expect(last).toContain("- Tom Reyes (card above)");
    expect(last).not.toContain("[Next:");
  });
});
