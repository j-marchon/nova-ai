// @vitest-environment jsdom
/* Chat files (SillyTavern .jsonl), History search and import, the reply
   continuation join, lorebook second-key logic, and the "pick a model"
   prompt. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { chatFromImport, chatToJsonl, readChatJsonl } from "../src/lib/chatFile.js";
import { joinContinuation } from "../src/lib/text.js";
import { bookFrom, toCharacterBook, toWorldInfo, triggered } from "../src/lib/lore.js";
import { emptyData } from "../src/lib/data.js";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { HistoryPage } from "../src/pages/HistoryPage.jsx";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

function Harness({ initial, render }) {
  const [data, setData] = useState(initial);
  const update = (p) => setData((prev) => (typeof p === "function" ? p(prev) : { ...prev, ...p }));
  Harness.data = data;
  return render(data, update);
}

const mount = async (el) => {
  await act(async () => root.render(el));
  await flush();
};

const mira = { id: "c1", name: "Mira", description: "A thief.", greetings: [], firstMessage: "" };

describe("continuing a reply", () => {
  it("adds a space after a finished sentence, and none inside a word", () => {
    expect(joinContinuation("She left.", "Then the door")).toBe("She left. Then the door");
    expect(joinContinuation("She left", " the room")).toBe("She left the room");
    expect(joinContinuation("She le", "ft the room")).toBe("She left the room");
    expect(joinContinuation("She left", ", quietly.")).toBe("She left, quietly.");
  });

  it("drops a restated ending before the new text", () => {
    expect(joinContinuation("The lamp flickered over the map.", "flickered over the map. Then it went out."))
      .toBe("The lamp flickered over the map. Then it went out.");
  });
});

describe("chat files", () => {
  const chat = {
    id: "k1", kind: "character", characterId: "c1", createdAt: Date.UTC(2026, 0, 2),
    messages: [
      { id: "a", role: "assistant", content: "Hello.", at: Date.UTC(2026, 0, 2) },
      { id: "b", role: "user", content: "Hi.", images: [{ url: "data:image/png;base64,AAA", name: "x.png" }] },
      { id: "c", role: "system", speaker: "Narrator", content: "Night falls." },
      { id: "d", role: "assistant", speaker: "Tom", content: "Two", swipes: [{ text: "One" }, { text: "Two" }], swipeIdx: 1 },
    ],
  };

  it("writes SillyTavern's .jsonl: a header line, then one message per line", () => {
    const lines = chatToJsonl(chat, { user: "Ana", char: "Mira" }).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ user_name: "Ana", character_name: "Mira" });
    expect(lines[1]).toMatchObject({ name: "Mira", is_user: false, is_system: false, mes: "Hello." });
    expect(lines[2]).toMatchObject({ name: "Ana", is_user: true, mes: "Hi." });
    expect(lines[3]).toMatchObject({ name: "Narrator", is_system: true, mes: "Night falls." });
    expect(lines[4]).toMatchObject({ name: "Tom", swipes: ["One", "Two"], swipe_id: 1 });
  });

  it("reads its own export back: roles, speakers, versions and pictures", () => {
    const back = readChatJsonl(chatToJsonl(chat, { user: "Ana", char: "Mira" }));
    expect(back.characterName).toBe("Mira");
    expect(back.messages.map((m) => m.role)).toEqual(["assistant", "user", "system", "assistant"]);
    expect(back.messages[1].images[0].name).toBe("x.png");
    expect(back.messages[2].speaker).toBe("Narrator");
    expect(back.messages[3]).toMatchObject({ speaker: "Tom", content: "Two", swipeIdx: 1 });
    expect(back.messages[0].speaker).toBeUndefined();
  });

  it("joins an import to the card of the same name, or to nothing", () => {
    const parsed = readChatJsonl(chatToJsonl(chat, { user: "Ana", char: "mira" }));
    expect(chatFromImport(parsed, [mira])).toMatchObject({ characterId: "c1", kind: "character" });
    expect(chatFromImport(parsed, [])).toBeNull();
  });

  it("says what is wrong with a file that is not a chat", () => {
    expect(() => readChatJsonl("not json")).toThrow(/not valid JSON/);
    expect(() => readChatJsonl('{"user_name":"A"}')).toThrow(/No messages/);
  });
});

describe("History", () => {
  const seed = () => ({
    ...JSON.parse(JSON.stringify(emptyData)),
    characters: [mira],
    chats: [1, 2, 3, 4].map((n) => ({
      id: `k${n}`, kind: "character", characterId: "c1", personaId: "", createdAt: n, updatedAt: n,
      ...(n === 4 ? { title: "Mira (Branch: Vault)" } : {}),
      messages: [{ id: `m${n}`, role: "assistant", content: n === 2 ? "The vault key is under the stair." : `Line ${n}` }],
    })),
  });

  it("searches chats by what was said in them, and shows a branch's title", async () => {
    await mount(<Harness initial={seed()} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    expect(host.textContent).toContain("Mira (Branch: Vault)");
    const box = host.querySelector("input[placeholder='Search chats']");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(box, "stair"); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await flush();
    expect(host.textContent).toContain("The vault key is under the stair.");
    expect(host.textContent).not.toContain("Line 1");
  });

  it("imports a SillyTavern chat for a card you have", async () => {
    await mount(<Harness initial={seed()} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    const jsonl = [
      { user_name: "Ana", character_name: "Mira", create_date: "2026-01-01T00:00:00Z", chat_metadata: {} },
      { name: "Mira", is_user: false, is_system: false, send_date: "2026-01-01T00:00:00Z", mes: "Imported hello." },
      { name: "Ana", is_user: true, is_system: false, send_date: "2026-01-01T00:01:00Z", mes: "Imported reply." },
    ].map((o) => JSON.stringify(o)).join("\n");
    const input = host.querySelector("[data-testid='chat-import-input']");
    Object.defineProperty(input, "files", { value: [new File([jsonl], "chat.jsonl")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(Harness.data.chats).toHaveLength(5);
    expect(Harness.data.chats[4].messages.map((m) => m.content)).toEqual(["Imported hello.", "Imported reply."]);
    expect(host.textContent).toContain("Imported 2 messages with Mira.");
  });

  it("explains an import whose character is missing", async () => {
    await mount(<Harness initial={seed()} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    const jsonl = [{ user_name: "Ana", character_name: "Nobody" }, { name: "Nobody", is_user: false, mes: "Hi." }].map((o) => JSON.stringify(o)).join("\n");
    const input = host.querySelector("[data-testid='chat-import-input']");
    Object.defineProperty(input, "files", { value: [new File([jsonl], "chat.jsonl")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(Harness.data.chats).toHaveLength(4);
    expect(host.textContent).toContain("Import their card first");
  });
});

describe("lorebook second keywords", () => {
  const entry = (logic) => ({ keys: ["vault"], secondaryKeys: ["key", "guard"], selective: true, logic });
  const cases = [
    ["and_any", "the vault and its key", true],
    ["and_any", "the vault", false],
    ["and_all", "the vault and its key", false],
    ["and_all", "the vault, the key, the guard", true],
    ["not_any", "the vault", true],
    ["not_any", "the vault and its key", false],
    ["not_all", "the vault and its key", true],
    ["not_all", "the vault, the key, the guard", false],
  ];
  it.each(cases)("%s on %j fires: %s", (logic, text, want) => {
    expect(triggered(entry(logic), text)).toBe(want);
  });

  it("reads SillyTavern's selectiveLogic numbers and writes them back", () => {
    const book = bookFrom({ entries: { 0: { key: ["vault"], keysecondary: ["key"], selective: true, selectiveLogic: 3, content: "x" } } });
    expect(book.entries[0].logic).toBe("and_all");
    expect(toWorldInfo(book).entries[0].selectiveLogic).toBe(3);
    expect(toCharacterBook(book).entries[0].extensions.selectiveLogic).toBe(3);
  });
});

describe("no model picked", () => {
  it("asks for a model instead of sending a request without one", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const d = JSON.parse(JSON.stringify(emptyData));
    d.settings.providers[0].key = "sk-test";
    d.characters = [mira];
    d.chats = [{ id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, messages: [{ id: "m0", role: "assistant", content: "Hello." }] }];
    await mount(<Harness initial={d} render={(data, update) => <ChatPage data={data} chatId="k1" update={update} goBack={() => {}} goSettings={() => {}} />} />);
    await act(async () => host.querySelector("[aria-label='Continue the story']").click());
    await flush();
    expect(host.textContent).toContain("Pick a model for OpenRouter");
    expect(fetch).not.toHaveBeenCalled();
  });
});
