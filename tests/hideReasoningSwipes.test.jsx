// @vitest-environment jsdom
/* Hidden messages (never sent, summarised or scanned for lore, kept in
   files), a reply's kept thinking (per version, never sent, SillyTavern
   placement 6 scripts on it) and the versions sheet. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { emptyData } from "../src/lib/data.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { summaryRequest } from "../src/lib/memory.js";
import { selectLore } from "../src/lib/lore.js";
import { chatToJsonl, readChatJsonl } from "../src/lib/chatFile.js";
import { addSwipe, editMessage, showSwipe, swipeList } from "../src/lib/swipes.js";
import { applyRegex, readTavernPreset, tavernRegex } from "../src/lib/tavern.js";
import { displaySource } from "../src/lib/html.js";
import { ChatPage } from "../src/pages/ChatPage.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mira = { id: "c1", name: "Mira", description: "A thief." };
const settings = { ...emptyData.settings, memoryOn: false };
const sentText = (msgs) => msgs.map((m) => m.content).join("\n");

describe("a message hidden from the AI", () => {
  const history = [
    { id: "a", role: "assistant", content: "Welcome to the inn." },
    { id: "b", role: "user", content: "SECRET dragon plan", hidden: true },
    { id: "c", role: "user", content: "A room, please." },
  ];

  it("is left out of what is sent", () => {
    const msgs = buildApiMessages({ character: mira, username: "Ana", history, settings });
    expect(sentText(msgs)).toContain("A room, please.");
    expect(sentText(msgs)).not.toContain("SECRET");
  });

  it("is left out of the memory summary", () => {
    const { user } = summaryRequest({ previous: "", messages: history, userName: "Ana", charName: "Mira" });
    expect(user).toContain("A room, please.");
    expect(user).not.toContain("SECRET");
  });

  it("does not trigger lorebook entries", () => {
    const books = [{ entries: [{ keys: ["dragon"], content: "Dragons are extinct." }] }];
    expect(selectLore(books, history, { depth: 4, budget: 1000 }).triggered).toHaveLength(0);
    const shown = history.map(({ hidden, ...m }) => m);
    expect(selectLore(books, shown, { depth: 4, budget: 1000 }).triggered).toHaveLength(1);
  });

  it("does not use up the lore scan depth", () => {
    const books = [{ entries: [{ keys: ["inn"], content: "The inn is old." }] }];
    expect(selectLore(books, history, { depth: 2, budget: 1000 }).triggered).toHaveLength(1);
  });
});

describe("chat files keep hidden messages and thinking", () => {
  const chat = {
    id: "k1", kind: "character", characterId: "c1",
    messages: [
      { id: "a", role: "assistant", content: "Hello.", reasoning: "Greet her.", reasoningMs: 4000 },
      { id: "b", role: "user", content: "Psst.", hidden: true },
      { id: "c", role: "system", speaker: "Narrator", content: "Night falls." },
      { id: "d", role: "assistant", content: "Off the record.", hidden: true },
      { id: "e", role: "assistant", content: "Two", swipes: [{ text: "One", reasoning: "first try" }, { text: "Two", reasoning: "second try", reasoningMs: 2000 }], swipeIdx: 1, reasoning: "second try", reasoningMs: 2000 },
    ],
  };

  it("round-trips through Nova's own export", () => {
    const lines = chatToJsonl(chat, { user: "Ana", char: "Mira" }).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[1].extra).toMatchObject({ reasoning: "Greet her.", reasoning_duration: 4000 });
    expect(lines[2]).toMatchObject({ is_user: true, is_system: true });
    expect(lines[4]).toMatchObject({ is_user: false, is_system: true });
    const back = readChatJsonl(chatToJsonl(chat, { user: "Ana", char: "Mira" })).messages;
    expect(back.map((m) => m.role)).toEqual(["assistant", "user", "system", "assistant", "assistant"]);
    expect(back.map((m) => !!m.hidden)).toEqual([false, true, false, true, false]);
    expect(back[0]).toMatchObject({ reasoning: "Greet her.", reasoningMs: 4000 });
    expect(back[4].swipes.map((v) => v.reasoning)).toEqual(["first try", "second try"]);
    expect(back[4]).toMatchObject({ content: "Two", reasoning: "second try", reasoningMs: 2000 });
  });

  it("reads SillyTavern's is_system messages as hidden, and its reasoning", () => {
    const jsonl = [
      { user_name: "Ana", character_name: "Mira", chat_metadata: {} },
      { name: "Mira", is_user: false, is_system: true, mes: "Hidden reply.", extra: { reasoning: "hmm", reasoning_duration: 1500 } },
      { name: "Ana", is_user: true, is_system: true, mes: "Hidden line." },
      { name: "Mira", is_user: false, is_system: false, mes: "Shown." },
      { name: "System", is_user: false, is_system: false, mes: "Rain.", extra: { type: "narrator" } },
    ].map((o) => JSON.stringify(o)).join("\n");
    const ms = readChatJsonl(jsonl).messages;
    expect(ms.map((m) => [m.role, !!m.hidden])).toEqual([["assistant", true], ["user", true], ["assistant", false], ["system", false]]);
    expect(ms[0]).toMatchObject({ reasoning: "hmm", reasoningMs: 1500 });
  });

  it("keeps an older Nova file's narration as narration", () => {
    const jsonl = [
      { user_name: "Ana", character_name: "Mira", chat_metadata: { nova: { kind: "character" } } },
      { name: "Narrator", is_user: false, is_system: true, mes: "Night falls.", extra: {} },
    ].map((o) => JSON.stringify(o)).join("\n");
    expect(readChatJsonl(jsonl).messages[0]).toMatchObject({ role: "system", speaker: "Narrator" });
    expect(readChatJsonl(jsonl).messages[0].hidden).toBeUndefined();
  });
});

describe("thinking kept with each version", () => {
  const base = { id: "r", role: "assistant", content: "first", reasoning: "plan A", reasoningMs: 3000 };

  it("travels with its version", () => {
    const m = addSwipe(base, "second", null, { reasoning: "plan B" });
    expect(m).toMatchObject({ content: "second", reasoning: "plan B" });
    expect(m.reasoningMs).toBeUndefined();
    expect(swipeList(m)).toEqual([{ text: "first", reasoning: "plan A", reasoningMs: 3000 }, { text: "second", reasoning: "plan B" }]);
    expect(showSwipe(m, 0)).toMatchObject({ content: "first", reasoning: "plan A", reasoningMs: 3000 });
    expect(editMessage(showSwipe(m, 0), "first, fixed").reasoning).toBe("plan A");
    expect("reasoning" in addSwipe({ id: "x", role: "assistant", content: "a" }, "b")).toBe(false);
  });

  it("is never sent back to the model", () => {
    const history = [{ id: "u", role: "user", content: "Hi." }, base];
    expect(JSON.stringify(buildApiMessages({ character: mira, username: "Ana", history, settings }))).not.toContain("plan A");
  });
});

describe("SillyTavern placement 6 (reasoning)", () => {
  const scripts = [
    { scriptName: "Think style", findRegex: "/plan/g", replaceString: "<b>plan</b>", placement: [6], markdownOnly: true },
    { scriptName: "Think trim", findRegex: "/secret/g", replaceString: "", placement: [6] },
    { scriptName: "Both", findRegex: "/x/g", replaceString: "y", placement: [2, 6], markdownOnly: true },
  ];

  it("is kept as the reasoning role", () => {
    const display = tavernRegex(scripts, "display");
    expect(display.map((r) => r.roles)).toEqual([["reasoning"], ["assistant", "reasoning"]]);
    expect(tavernRegex(scripts, "saved").map((r) => r.roles)).toEqual([["reasoning"]]);
    expect(readTavernPreset({ prompts: [], extensions: { regex_scripts: scripts } }).display).toHaveLength(2);
  });

  it("restyles the shown thinking only, and rewrites it when saved", () => {
    const display = tavernRegex(scripts, "display");
    expect(displaySource("a plan", display, "reasoning", 0)).toBe("a <b>plan</b>");
    expect(displaySource("a plan", display, "assistant", 0)).toBe("a plan");
    expect(applyRegex("my secret plan", tavernRegex(scripts, "saved"), "reasoning", 0)).toBe("my  plan");
  });
});

describe("the versions sheet", () => {
  let root, host;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const flush = async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };
  const data = {
    ...emptyData,
    characters: [mira],
    chats: [{
      id: "k", kind: "character", characterId: "c1", bookmarks: [],
      messages: [
        { id: "m1", role: "user", content: "Psst.", hidden: true },
        { id: "m2", role: "assistant", content: "Third take.", reasoning: "Think it over.", reasoningMs: 3000,
          swipes: [{ text: "First take." }, { text: "Second take." }, { text: "Third take.", reasoning: "Think it over.", reasoningMs: 3000 }], swipeIdx: 2 },
      ],
    }],
  };
  const button = (pred) => [...document.body.querySelectorAll("button")].find(pred);

  it("lists every version and jumps to the one picked", async () => {
    let current = data;
    const update = vi.fn((fn) => { current = typeof fn === "function" ? fn(current) : { ...current, ...fn }; });
    await act(async () => root.render(<ChatPage data={data} chatId="k" update={update} goBack={vi.fn()} goSettings={vi.fn()} />));
    await flush();

    /* the hidden message is marked; the kept thinking opens */
    expect(host.querySelector("[data-hidden-mark]")).not.toBeNull();
    const thought = button((b) => b.textContent === "Thought for 3s");
    expect(host.textContent).not.toContain("Think it over.");
    await act(async () => thought.click());
    expect(host.textContent).toContain("Think it over.");

    await act(async () => button((b) => b.textContent === "3/3").click());
    await flush();
    const sheet = document.body.querySelector("[data-testid='versions-sheet']");
    expect(sheet.textContent).toContain("First take.");
    expect(sheet.textContent).toContain("Second take.");
    expect(sheet.querySelector("[aria-current='true']").textContent).toContain("Third take.");
    await act(async () => [...sheet.querySelectorAll("button")][0].click());
    await flush();
    const m2 = current.chats[0].messages[1];
    expect(m2).toMatchObject({ content: "First take.", swipeIdx: 0 });
    expect(m2.reasoning).toBeUndefined();
    expect(document.body.querySelector("[data-testid='versions-sheet']")).toBeNull();
  });

  it("hides and shows a message from its menu", async () => {
    let current = data;
    const update = vi.fn((fn) => { current = typeof fn === "function" ? fn(current) : { ...current, ...fn }; });
    await act(async () => root.render(<ChatPage data={data} chatId="k" update={update} goBack={vi.fn()} goSettings={vi.fn()} />));
    await flush();
    const bubble = (id) => host.querySelector(`[data-msg-id='${id}'] [role='group']`);
    await act(async () => bubble("m2").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await flush();
    await act(async () => button((b) => b.textContent.includes("Hide from AI")).click());
    await flush();
    expect(current.chats[0].messages[1].hidden).toBe(true);
    await act(async () => bubble("m1").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await flush();
    await act(async () => button((b) => b.textContent.includes("Show to AI")).click());
    await flush();
    expect("hidden" in current.chats[0].messages[0]).toBe(false);
  });
});
