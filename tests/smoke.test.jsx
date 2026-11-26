// @vitest-environment jsdom
/* Renders the real screens and drives the new flows end to end, with the
   network replaced by a fake model that streams a numbered reply. A render
   error (like update 18's black screen) fails here instead of on a phone. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/App.jsx";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { CreatePage } from "../src/pages/CreatePage.jsx";
import { HistoryPage } from "../src/pages/HistoryPage.jsx";
import { SettingsPage } from "../src/pages/SettingsPage.jsx";
import { CharacterForm, PersonaForm, UniverseForm } from "../src/components/forms.jsx";
import { LorebookForm } from "../src/components/LorebookForm.jsx";
import { ChatBackdrop } from "../src/components/backdrops.jsx";
import { Avatar } from "../src/components/ui.jsx";
import { isVideo, isVideoFile } from "../src/lib/video.js";
import { emptyData } from "../src/lib/data.js";
import { AI_SCHEMAS } from "../src/components/AiFill.jsx";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { version } from "../package.json";
import { resetStorageForTests } from "../src/lib/storage.js";
import { shortVersion } from "../src/lib/updates.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom has <video> but cannot play one */
Object.assign(HTMLMediaElement.prototype, { play: () => Promise.resolve(), pause() {}, load() {} });

let root, host, requests, replyNo;

const isSide = body => /You keep the (?:tracker|long-term memory|cast list)|You read .*character card/.test(body.messages?.[0]?.content || "");

/* Side requests use the same SSE transport as replies. */
function fakeFetch(url, init = {}) {
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push(body);
  replyNo += 1;
  const text = isSide(body) ? `Note ${replyNo}` : `Reply ${replyNo}.`;
  if (body.stream === false) {
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: `Note ${replyNo}` } }], usage: {} }), { status: 200 }));
  }
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.close();
    },
  });
  return Promise.resolve(new Response(stream, { status: 200 }));
}

const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  clearActivity();
  requests = [];
  replyNo = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); clearActivity(); });
  host.remove();
  vi.unstubAllGlobals();
});

const bg = "data:image/jpeg;base64," + "A".repeat(800);
const mira = {
  id: "c1", name: "Mira", description: "A thief.", personality: "", exampleDialogs: "",
  greetings: [{ id: "g1", label: "", text: "Hello, {{user}}." }], firstMessage: "Hello, {{user}}.",
  systemPrompt: "Run a heist.", postHistoryInstructions: "", avatar: "",
  theme: { userBubble: "accent", aiBubble: "#18181b", bubbleAlpha: 0, bgs: [{ image: bg, opacity: 0.8, scale: 1, nx: 0, ny: 0 }] },
};
const tom = { ...mira, id: "c2", name: "Tom", theme: undefined, systemPrompt: "" };

function seed(chats) {
  const d = JSON.parse(JSON.stringify(emptyData));
  d.username = "Ana";
  d.settings.providers[0].key = "sk-test";
  d.settings.providers[0].model = "test-model";
  d.settings.sceneEvery = 2;
  d.characters = [mira, tom];
  d.universes = [{ id: "u1", name: "Vale", story: "A valley.", rules: "", characters: [{ id: "uc", name: "Elder" }], locations: [], greetings: [] }];
  d.chats = chats;
  return d;
}

/* The page under test with real state behind `update`, as App provides. */
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
const byLabel = (label) => host.querySelector(`[aria-label="${label}"]`);
/* by label anywhere on the page: a sheet opened from a menu is drawn at
   the app root, outside the chat */
const docLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
/* Nova Scope's button, in the composer's island */
const openScope = async () => {
  await click(byLabel("Nova Scope"));
};
const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const textOf = () => host.textContent;
/* a row of the menu that is open, by its text */
const row = (text) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(text));

const chatPage = (chatId) => (data, update) => (
  <ChatPage data={data} chatId={chatId} update={update} goBack={() => {}} goSettings={() => {}} />
);

describe("chat", () => {
  const chat = () => ({
    id: "k1", kind: "character", characterId: "c1", personaId: "", greetingId: "g1", createdAt: 1, updatedAt: 1,
    messages: [{ id: "m0", role: "assistant", content: "Hello, Ana." }],
  });

  it("consolidates chat tools and persona in settings", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    expect(byLabel("More")).toBeFalsy();
    expect(byLabel("Change persona")).toBeFalsy();
    await click(byLabel("Chat settings"));
    for (const label of ["Persona", "Look", "Memory", "Quick tweaks", "Bookmarks", "Scene art", "Tokens", "Export"]) {
      expect(row(label)).toBeTruthy();
    }
    expect(row("Author's note")).toBeFalsy();
    expect(textOf()).not.toContain("Visual novel view");
    /* the Persona tab is the persona list itself, not a button to one */
    expect(row("Change persona")).toBeFalsy();
    expect(row("New persona")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Play as");
  });

  it("impersonation selects the dedicated mode in the actual outgoing request", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "ask about the vault");
    await click(byLabel("More options"));
    await click(row("Write my reply"));
    const sent = requests.find((r) => r.stream === true);
    expect(JSON.stringify(sent.messages)).toContain("write Ana's next turn instead");
    expect(JSON.stringify(sent.messages)).toContain("Build it from this idea: ask about the vault");
    expect(host.querySelector("textarea").value).toContain("Reply");
    expect(Harness.data.chats[0].messages).toHaveLength(1);
  });

  it("the branch command creates a real, independently stored chat", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "/branch Another path");
    await click(byLabel("Send"));
    expect(Harness.data.chats).toHaveLength(2);
    const branch = Harness.data.chats[1];
    expect(branch.title).toBe("Another path");
    expect(branch.id).not.toBe("k1");
    expect(branch.messages[0].content).toBe("Hello, Ana.");
    expect(Harness.data.chats[0].branches).toBeUndefined();
  });

  it("sends, swipes between versions, and edits without losing later messages", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    expect(textOf()).toContain("Hello, Ana.");

    await type(host.querySelector("textarea"), "Hi there");
    await click(byLabel("Send"));
    expect(textOf()).toContain("Reply 1.");
    /* the card's instructions and the language rule went out with it */
    const sent = requests.find((r) => r.stream === true);
    expect(sent.messages[0].content).toContain("Run a heist.");
    expect(sent.messages[0].content).not.toContain("[Style]");

    /* a new version keeps the old one */
    await click(byLabel("New version"));
    expect(textOf()).toContain("Reply ");
    expect(textOf()).toContain("2/2");
    await click(byLabel("Previous version"));
    expect(textOf()).toContain("1/2");
    expect(textOf()).toContain("Reply 1.");

    /* editing the opening keeps everything after it */
    const before = Harness.data.chats[0].messages.length;
    await act(async () => host.querySelector(".nv-msg").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();
    const edit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    await click(edit);
    /* the message opens in its own field, holding the text as written */
    const field = byLabel("Edit message");
    expect(field.value).toBe("Hello, Ana.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Hello again, Ana.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(document.querySelector('[aria-label="Save edit"]'));
    const after = Harness.data.chats[0].messages;
    expect(after).toHaveLength(before);
    expect(after[0].content).toBe("Hello again, Ana.");
    expect(after[after.length - 1].content).toBe("Reply 1.");
  });

  it("has no write-my-message button in the composer", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    expect(byLabel("Write my message for me")).toBeNull();
    expect(byLabel("Continue the story")).toBeTruthy();
  });

  it("writes scene notes in the background and shows them under Memory in the chat settings", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "Hi");
    await click(byLabel("Send"));
    await flush();
    expect(Harness.data.chats[0].scene?.text).toMatch(/^Note \d$/);
    await click(byLabel("Chat settings"));
    expect(textOf()).toContain("No personas yet. You play as yourself: Ana.");
    await click([...host.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === "Memory"));
    expect(textOf()).toContain("Story so far");
    const notes = [...host.querySelectorAll("textarea")].map((t) => t.value);
    expect(notes).toContain(Harness.data.chats[0].scene.text);
  });

  it("deletes one message and leaves the rest", async () => {
    const c = chat();
    c.messages.push({ id: "m1", role: "user", content: "Hi" }, { id: "m2", role: "assistant", content: "Yes?" });
    await mount(<Harness initial={seed([c])} render={chatPage("k1")} />);
    await act(async () => host.querySelectorAll(".nv-msg")[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Delete only this message")));
    /* gone at once, no confirmation; Undo puts it back where it was */
    expect(Harness.data.chats[0].messages.map((m) => m.id)).toEqual(["m0", "m2"]);
    const { toasts } = await import("../src/lib/toast.js");
    const offer = toasts.get().find((t) => t.text === "Message deleted");
    await act(async () => offer.undo());
    expect(Harness.data.chats[0].messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });
});

describe("several of your characters in one chat", () => {
  const rook = { id: "r1", name: "Rook", description: "A guard at the gate." };
  const ensemble = (extra = {}) => ({
    id: "g", kind: "character", characterId: "c1", personaId: "", greetingId: "", createdAt: 1, updatedAt: 1,
    scope: { mode: "manual", carry: false, cardScanned: true, cast: [{ id: "t", name: "Tom", characterId: "c2", description: "" }, rook] },
    messages: [{ id: "m0", role: "assistant", content: "**Mira:** Evening.\n\n**Tom:** *nods* Ana." }],
    ...extra,
  });
  const pressed = (name) => [...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.trim() === name);

  it("starts from Create → Group chat as a character chat with Scope on and the others linked", async () => {
    act(() => root.unmount());
    const { saveData, loadData, resetStorageForTests: reset } = await import("../src/lib/storage.js");
    const d = seed([]);
    d.settings.scopeDefault = "off";
    await saveData(d);
    reset();
    root = createRoot(host);
    await act(async () => root.render(<App />));
    await flush();
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.trim() === "Group chat"));
    const pick = (name) => [...host.querySelectorAll("button")].find((b) => b.textContent.endsWith(name));
    await type(host.querySelector('input[placeholder="Named after its members if left empty"]'), "The Crew");
    await click(pick("Mira"));
    await click(pick("Tom"));
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Start group chat"));
    /* no persona: the name for this chat is asked first */
    await type(document.querySelector("input[aria-label='Your name']"), "Ana");
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Use"));
    for (let i = 0; i < 100 && !host.querySelector(".nv-chat-root"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(host.querySelector(".nv-chat-root")).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const saved = (await loadData()).chats.at(-1);
    expect(saved.kind).toBe("character");
    expect(saved.characterId).toBe("c1");
    expect(saved.memberIds).toBeUndefined();
    expect(saved.title).toBe("The Crew");
    expect(saved.scope.mode).toBe("manual");
    expect(saved.scope.carry).toBe(true);
    expect(saved.scope.cast.map((m) => [m.name, m.characterId, m.description])).toEqual([["Tom", "c2", ""]]);
    /* the host's own opening */
    expect(saved.messages.map((m) => m.content)).toEqual(["Hello, Ana."]);
    expect(textOf()).toContain("The Crew");
  });

  it("shows a reply with several speakers as one bubble, the names in bold, and sends every card", async () => {
    await mount(<Harness initial={seed([ensemble()])} render={chatPage("g")} />);
    const bubbles = [...host.querySelectorAll(".nv-msg")];
    expect(bubbles).toHaveLength(1);
    expect([...bubbles[0].querySelectorAll("strong")].map((b) => b.textContent)).toEqual(["Mira:", "Tom:"]);
    expect(textOf()).not.toContain("**Mira:**");
    expect(textOf()).not.toContain("Members");
    await type(host.querySelector("textarea"), "Tom, open the gate");
    await click(byLabel("Send"));
    const sent = requests.find((r) => r.stream === true && !isSide(r));
    expect(sent.messages[0].content).toContain("[Character: Tom]");
    const last = sent.messages[sent.messages.length - 1].content;
    expect(last).toContain("- Tom (card above)");
    expect(last).toContain("Rook: A guard at the gate.");
    expect(last).not.toContain("[Next:");
    expect(last).not.toContain("leads this reply");
    /* nobody was picked: the reply is the chat's own */
    expect(Harness.data.chats[0].messages.at(-1).speaker).toBeUndefined();
  });

  it("lets a tap on a cast chip lead the next reply, once", async () => {
    await mount(<Harness initial={seed([ensemble()])} render={chatPage("g")} />);
    expect(pressed("Tom").getAttribute("aria-pressed")).toBe("false");
    await click(pressed("Tom"));
    expect(pressed("Tom").getAttribute("aria-pressed")).toBe("true");
    await click(pressed("Tom"));
    expect(pressed("Tom").getAttribute("aria-pressed")).toBe("false");
    await click(pressed("Tom"));
    await type(host.querySelector("textarea"), "Well?");
    await click(byLabel("Send"));
    const sent = requests.filter((r) => r.stream === true && !isSide(r));
    expect(sent[0].messages.at(-1).content).toContain("- Tom leads this reply");
    const reply = Harness.data.chats[0].messages.at(-1);
    expect(reply.speaker).toBe("Tom");
    expect(reply.speakerId).toBe("c2");
    expect(pressed("Tom").getAttribute("aria-pressed")).toBe("false");
    await type(host.querySelector("textarea"), "And?");
    await click(byLabel("Send"));
    expect(requests.filter((r) => r.stream === true && !isSide(r))[1].messages.at(-1).content).not.toContain("leads this reply");
  });

  it("manages linked members in the Scope sheet: the full card, removable, and added from your characters", async () => {
    await mount(<Harness initial={seed([ensemble()])} render={chatPage("g")} />);
    await openScope();
    expect(document.body.textContent).toContain("Full card: Tom's whole card goes with every reply.");
    await click(docLabel("Remove Tom"));
    expect(Harness.data.chats[0].scope.cast.map((m) => m.name)).toEqual(["Rook"]);
    await click(docLabel("Bring in Tom"));
    expect(Harness.data.chats[0].scope.cast.at(-1)).toMatchObject({ name: "Tom", characterId: "c2", description: "" });
  });

  it("lists the chat under its title, or everyone's names, with no button that opens a list", async () => {
    await mount(<Harness initial={seed([ensemble({ title: "The Crew" }), ensemble({ id: "g2" })])} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    expect(textOf()).toContain("The Crew");
    expect(textOf()).toContain("Mira, Tom");
    expect(host.querySelectorAll('button[aria-label*="more:"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-scope="1"]')).toHaveLength(2);
  });

  it("lets a universe's characters or its narration lead, with Scope off", async () => {
    const u = { id: "uu", kind: "universe", universeId: "u1", personaId: "", createdAt: 1, updatedAt: 1, messages: [] };
    await mount(<Harness initial={seed([u])} render={chatPage("uu")} />);
    await click(pressed("Elder"));
    await type(host.querySelector("textarea"), "Hello?");
    await click(byLabel("Send"));
    const sent = requests.find((r) => r.stream === true && !isSide(r));
    expect(sent.messages.at(-1).content).toContain("Reply only as Elder in this message");
    expect(Harness.data.chats[0].messages.at(-1).speaker).toBe("Elder");
    await click(pressed("Narrator"));
    await type(host.querySelector("textarea"), "Look around.");
    await click(byLabel("Send"));
    expect(requests.filter((r) => r.stream === true && !isSide(r))[1].messages.at(-1).content).toContain("world narration only");
  });

  it("shows a universe reply with several speakers as one bubble", async () => {
    const u = {
      id: "uu", kind: "universe", universeId: "u1", personaId: "", createdAt: 1, updatedAt: 1,
      scope: { mode: "auto", cardScanned: true, cast: [rook] },
      messages: [{ id: "m0", role: "assistant", content: 'Wind moves through the valley.\n\n**Elder:** "Welcome."\n\nRook lowers his spear.' }],
    };
    await mount(<Harness initial={seed([u])} render={chatPage("uu")} />);
    expect(host.querySelectorAll(".nv-msg")).toHaveLength(1);
    expect(pressed("Rook")).toBeTruthy();
    expect(textOf()).not.toContain("**Elder:**");
  });
});

describe("screens", () => {
  it("renders a universe chat", async () => {
    const u = { id: "uu", kind: "universe", universeId: "u1", personaId: "", createdAt: 1, updatedAt: 1, messages: [] };
    await mount(<Harness initial={seed([u])} render={chatPage("uu")} />);
    expect(textOf()).toContain("Narrator");
  });

  it("starts a group from the Create page", async () => {
    const started = [];
    await mount(
      <Harness
        initial={seed([])}
        render={(data, update) => (
          <CreatePage data={data} update={update} onEdit={() => {}} startChat={() => {}} startGroupChat={(g) => started.push(g)} openChat={() => {}} />
        )}
      />
    );
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.trim() === "Group chat"));
    const pick = (name) => [...host.querySelectorAll("button")].find((b) => b.textContent.endsWith(name));
    await click(pick("Mira"));
    await click(pick("Tom"));
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Start group chat"));
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel"));
    expect(started[0].memberIds).toEqual(["c1", "c2"]);
  });

  it("renders Settings and the character form", async () => {
    await mount(<Harness initial={seed([])} render={(data, update) => <SettingsPage data={data} update={update} />} />);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Memory"));
    expect(textOf()).toContain("Story summary");
    expect(textOf()).toContain(`Nova ${shortVersion(version)}`);

    await mount(<CharacterForm initial={mira} settings={emptyData.settings} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Card instructions")));
    expect([...host.querySelectorAll("textarea")].some((t) => t.value === "Run a heist.")).toBe(true);
  });

  it("boots the whole app from an empty database", async () => {
    await mount(<App />);
    await flush();
    expect(textOf()).toContain("Create");
    expect(textOf()).toContain("Settings");
    expect(host.querySelector(".nv-nav-dock")).toBeTruthy();
    expect(host.querySelector(".nv-root").dataset.theme).toBe("dark");
    expect(host.querySelector(".nv-nav-brand")).toBeNull();
    expect(host.querySelector('[aria-label="Browse Chub"]')).toBeTruthy();
  });
});

describe("lorebooks", () => {
  const worldBook = {
    id: "lb1", name: "World", description: "",
    entries: [
      { id: "e1", comment: "Vale", keys: ["Vale"], secondaryKeys: [], content: "The Vale floods every spring.", enabled: true, constant: false, selective: false, caseSensitive: false, order: 100 },
    ],
  };
  const chat = () => ({
    id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, lorebookIds: [],
    messages: [{ id: "m0", role: "assistant", content: "Hello, Ana." }],
  });

  it("attaches a book from the Memory sheet and sends a matched entry at the end only", async () => {
    const d = seed([chat()]);
    d.lorebooks = [worldBook];
    await mount(<Harness initial={d} render={chatPage("k1")} />);
    await click(byLabel("Chat settings"));
    await click([...host.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === "Memory"));
    expect(textOf()).toContain("Lorebooks");
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("World")));
    expect(Harness.data.chats[0].lorebookIds).toEqual(["lb1"]);
    await click(byLabel("Close"));

    await type(host.querySelector("textarea"), "Shall we go to the Vale?");
    await click(byLabel("Send"));
    const sent = requests.find((r) => r.stream === true);
    expect(sent.messages[0].content).not.toContain("floods every spring");
    expect(sent.messages[sent.messages.length - 1].content).toContain("The Vale floods every spring.");
  });

  it("lets keywords be typed with commas and saves them as a list", async () => {
    let saved = null;
    await mount(<LorebookForm initial={null} onSave={(b) => { saved = b; }} onClose={() => {}} />);
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add an entry")));
    const keys = [...document.querySelectorAll("input")].find((i) => /Comma-separated/.test(i.placeholder));
    await type(keys, "Vale, ");
    expect(keys.value).toBe("Vale, ");
    await type(keys, "Vale, the valley");
    await type([...document.querySelectorAll("textarea")][0], "Flooded.");
    await click([...document.querySelectorAll("button")].find((b) => b.textContent === "Save lorebook"));
    expect(saved.entries[0].keys).toEqual(["Vale", "the valley"]);
    expect(saved.name).toBe("Untitled lorebook");
  });

  it("closes only the lorebook editor on Escape, not the character form under it", async () => {
    let closed = 0;
    await mount(<CharacterForm initial={mira} settings={emptyData.settings} onSave={() => {}} onSettings={() => {}} onClose={() => { closed += 1; }} />);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Lorebook")));
    expect(document.body.textContent).toContain("Mira — lorebook");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await flush();
    expect(document.body.textContent).not.toContain("Mira — lorebook");
    expect(closed).toBe(0);
  });

  it("opens the Lorebooks tab and its editor", async () => {
    const edits = [];
    const d = seed([]);
    d.lorebooks = [worldBook];
    await mount(
      <Harness
        initial={d}
        render={(data, update) => (
          <CreatePage data={data} update={update} onEdit={(t, i) => edits.push([t, i])} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />
        )}
      />
    );
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Lorebooks")));
    expect(textOf()).toContain("1 entry");
    expect(byLabel("Import lorebook")).toBeTruthy();
  });
});

describe("animated backgrounds", () => {
  it("lays a GIF out from its framing instead of a baked crop", async () => {
    const gif = "data:image/gif;base64," + "R0lGODlh".padEnd(800, "A");
    await mount(<ChatBackdrop list={[{ image: gif, animated: true, opacity: 0.7, scale: 1.5, nx: 0.1, ny: 0 }]} seconds={20} />);
    const img = host.querySelector("img");
    expect(img.getAttribute("src")).toBe(gif);
    expect(img.closest("[data-backdrop-layer]").style.opacity).toBe("0.7");
  });
});

describe("video pictures", () => {
  const vid = "data:video/mp4;base64," + "AAAA".repeat(200);

  it("tells videos from images, by data URL and by picked file", () => {
    expect(isVideo(vid)).toBe(true);
    expect(isVideo("data:image/gif;base64,R0lG")).toBe(false);
    expect(isVideoFile({ type: "video/mp4", name: "x" })).toBe(true);
    expect(isVideoFile({ type: "", name: "clip.MP4" })).toBe(true);
    expect(isVideoFile({ type: "image/gif", name: "a.gif" })).toBe(false);
  });

  it("plays a video avatar as a muted, looping video", async () => {
    await mount(<Avatar src={vid} name="Mira" />);
    const v = host.querySelector("video");
    expect(v).toBeTruthy();
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(host.querySelector("img")).toBeNull();
  });

  it("stretches a cut video background like a still, and loops a kept original over its cut", async () => {
    /* cut for a screen this shape: covers it */
    const here = innerWidth / innerHeight;
    await mount(<ChatBackdrop list={[{ image: vid, video: true, opacity: 0.4, aspect: here }]} seconds={20} />);
    let v = host.querySelector("video");
    expect(v.className).toContain("object-cover");
    expect(v.closest("[data-backdrop-layer]").style.opacity).toBe("0.4");
    /* cut for a screen of another shape (a phone's crop on a wide window): fitted in whole */
    await mount(<ChatBackdrop list={[{ image: vid, video: true, opacity: 0.4, aspect: here / 3 }]} seconds={20} />);
    expect(host.querySelector("video").className).toContain("object-contain");

    await mount(<ChatBackdrop list={[{ image: vid, animated: true, t0: 1, t1: 3, opacity: 0.6, scale: 1, nx: 0, ny: 0 }]} seconds={20} />);
    v = host.querySelector("video");
    /* the segment is looped by hand, so the element's own loop is off */
    expect(v.loop).toBe(false);
    expect(v.closest("[data-backdrop-layer]").style.opacity).toBe("0.6");
  });
});

describe("look and menus", () => {
  it("fills in the appearance settings, migrates old ones and rejects unknown values", async () => {
    const { normalizeData } = await import("../src/lib/data.js");
    const d = normalizeData({ appearance: { scheme: "sepia", motion: "wild", font: "grotesk", shape: "sharp", uiAlpha: 0.5, bgPreset: "ghost", fx: { grain: true, grid: true } } });
    expect(d.appearance.scheme).toBe("dark");
    expect(d.appearance.motion).toBe("full");
    expect(d.appearance.shape).toBeUndefined();
    expect(d.appearance.font).toBeUndefined();
    expect(d.appearance.bgPreset).toBe("none");
    expect(d.appearance.uiAlpha).toBeUndefined();
    expect(d.appearance.fx).toEqual({ flow: false, grain: true });
    expect(normalizeData({ appearance: { scheme: "auto" } }).appearance.scheme).toBe("auto");
  });

  it("deletes a chat from its menu in the Chats list, with an undo", async () => {
    const c = { id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, messages: [] };
    await mount(<Harness initial={seed([c])} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    await click(byLabel("Chat options"));
    expect(textOf()).toContain("Open chat");
    await click([...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Delete chat")));
    expect(Harness.data.chats).toHaveLength(0);
    const { toasts } = await import("../src/lib/toast.js");
    await act(async () => toasts.get().at(-1).undo());
    expect(Harness.data.chats.map((x) => x.id)).toEqual(["k1"]);
  });

  it("opens a card's menu with edit and delete on the Create page", async () => {
    const edits = [];
    await mount(
      <Harness
        initial={seed([])}
        render={(data, update) => (
          <CreatePage data={data} update={update} onEdit={(t, i) => edits.push([t, i.id])} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />
        )}
      />
    );
    await click(host.querySelectorAll('[aria-label="Card options"]')[0]);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Edit"));
    expect(edits).toEqual([["characters", "c1"]]);
  });

  it("deleting a character hands its group chats on, deletes only chats left with nobody, and Undo restores all", async () => {
    const both = { id: "e1", kind: "character", characterId: "c1", personaId: "", greetingId: "g1", createdAt: 1, updatedAt: 1, title: "Crew",
      scope: { mode: "manual", cast: [{ id: "t", name: "Tom", characterId: "c2", description: "" }] },
      messages: [{ id: "m0", role: "assistant", content: "Hello, Ana." }] };
    const alone = { id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, messages: [] };
    const guest = { id: "k2", kind: "character", characterId: "c2", personaId: "", createdAt: 1, updatedAt: 1,
      scope: { mode: "manual", cast: [{ id: "m", name: "Mira", characterId: "c1", description: "" }] }, messages: [] };
    const before = seed([both, alone, guest]);
    await mount(
      <Harness
        initial={before}
        render={(data, update) => (
          <CreatePage data={data} update={update} onEdit={() => {}} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />
        )}
      />
    );
    const chatsBefore = JSON.parse(JSON.stringify(Harness.data.chats));
    await click(host.querySelectorAll('[aria-label="Card options"]')[0]);
    /* only the chat with nobody left is counted as going */
    expect(row("Delete character").textContent).toContain("and its 1 chat");
    await click(row("Delete character"));
    expect(document.body.textContent).toContain("1 chat will be deleted too.");
    await click([...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete"));
    const after = Harness.data.chats;
    expect(after.map((c) => c.id)).toEqual(["e1", "k2"]);
    expect(after[0]).toMatchObject({ characterId: "c2", title: "Crew" });
    expect(after[0].scope.cast.map((m) => [m.name, m.characterId])).toEqual([["Mira", undefined]]);
    expect(after[0].messages[0].speaker).toBe("Mira");
    expect(after[1].scope.cast[0]).toMatchObject({ name: "Mira", description: "A thief." });
    expect(after[1].scope.cast[0].characterId).toBeUndefined();
    const { toasts } = await import("../src/lib/toast.js");
    await act(async () => toasts.get().at(-1).undo());
    expect(Harness.data.chats).toEqual(chatsBefore);
    expect(Harness.data.characters.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("switches the whole app to light mode from Appearance", async () => {
    await mount(<Harness initial={seed([])} render={(data, update) => <SettingsPage data={data} update={update} />} />);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Look"));
    await click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Light"));
    expect(Harness.data.appearance.scheme).toBe("light");
    expect(textOf()).not.toContain("Film grain");
    expect(textOf()).not.toContain("Accent");
    await click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Off"));
    expect(Harness.data.appearance.motion).toBe("off");
    expect(textOf()).not.toContain("Typeface");
    expect(textOf()).not.toContain("Corners");
  });
});

describe("who replies", () => {
  it("has no who-replies button in a one-card chat any more", async () => {
    const c = {
      id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1,
      messages: [{ id: "m0", role: "assistant", content: "Mira waves at Elena across the bar." }],
    };
    await mount(<Harness initial={seed([c])} render={chatPage("k1")} />);
    expect(byLabel("Who replies")).toBeNull();
    await type(host.querySelector("textarea"), "Well?");
    await click(byLabel("Send"));
    const sent = requests.find((r) => r.stream === true);
    expect(sent.messages[sent.messages.length - 1].content).not.toContain("point of view");
  });
});

describe("chats", () => {
  it("clears every chat after a confirmation", async () => {
    const c = { id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, messages: [] };
    await mount(<Harness initial={seed([c, { ...c, id: "k2" }])} render={(data, update) => <HistoryPage data={data} update={update} openChat={() => {}} />} />);
    await click(byLabel("Clear all chats"));
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Delete all"));
    expect(Harness.data.chats).toHaveLength(0);
  });
});

describe("card studio", () => {
  /* a model that answers every request with one JSON card, streamed */
  const jsonFetch = (reply, finish = () => "stop") => (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push(body);
    const answer = reply(body);
    const text = typeof answer === "string" ? answer : JSON.stringify(answer);
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish(body) }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  const all = () => [...document.querySelectorAll("button")].map((b) => Object.assign(b, { t: b.textContent.trim() }));
  const studioRow = () => all().find((b) => b.t.startsWith("Card studio"));
  const studioPanel = () => document.querySelector('section[aria-label^="Card studio · "]');
  const openStudio = async () => { if (!studioPanel()) await click(studioRow()); };
  const fullCharacter = { name: "Edda", tagline: "Old tagline", description: "A keeper.", personality: "Protective.", scenario: "A storm.", greetings: [{ label: "", text: "*Fog.* Who's there?" }], exampleDialogs: "{{user}}: Hi\n{{char}}: No." };
  const fullUniverse = { name: "Vale", tagline: "A valley", story: "A valley.", rules: "None.", greetings: [{ label: "", text: "*Mist.*" }], characters: [{ name: "Elder", description: "Old.", personality: "Kind" }], locations: [{ name: "Mill", description: "Loud." }] };

  it("writes a character into the form, rewrites one part, and saves", async () => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch((body) => {
      const sys = body.messages[0].content;
      if (sys.includes("rewriting one part")) return { tagline: "Keeps the light, not the peace" };
      return fullCharacter;
    })));
    const settings = JSON.parse(JSON.stringify(emptyData.settings));
    settings.providers[0].key = "sk-test";
    settings.providers[0].model = "test-model";
    let saved = null;
    await mount(<CharacterForm initial={null} settings={settings} onSave={(c) => { saved = c; }} onSettings={() => {}} onClose={() => {}} />);
    await openStudio();
    const brief = [...document.querySelectorAll("textarea")].find((t) => /librarian/.test(t.placeholder));
    await type(brief, "A lighthouse keeper who hears voices in the fog.");
    await click(all().find((b) => b.t === "Write the character"));
    await flush();

    const sent = requests[0].messages[1].content;
    expect(sent).toContain("lighthouse keeper");
    expect(sent).not.toContain("Parameters:");
    expect(document.body.textContent).not.toContain("Gemma");
    expect([...document.querySelectorAll("input")].some((i) => i.value === "Edda")).toBe(true);

    await openStudio();
    await click(all().find((b) => b.t === "Tagline" && b.getAttribute("role") === "radio"));
    await click(all().find((b) => b.t === "Rewrite tagline"));
    await flush();
    expect(requests[1].messages[1].content).toContain('"name": "Edda"');

    expect(activity.get().filter((j) => j.owner.cardKind)).toHaveLength(0);
    await click(all().find((b) => b.t === "Save"));
    expect(saved.name).toBe("Edda");
    expect(saved.tagline).toBe("Keeps the light, not the peace");
    expect(saved.greetings[0].text).toBe("*Fog.* Who's there?");
  });

  const studioSettings = () => {
    const settings = structuredClone(emptyData.settings);
    settings.providers[0].key = "sk-test";
    settings.providers[0].model = "test-model";
    return settings;
  };
  const begin = async (label = "character") => {
    await openStudio();
    await type(studioPanel().querySelector("textarea"), "A keeper of forgotten stories.");
    await click(all().find((b) => b.t === `Write the ${label}`));
    await flush();
  };

  it.each([
    ["persona", PersonaForm, { name: "Edda", description: "A keeper." }],
    ["universe", UniverseForm, fullUniverse],
  ])("writes a %s into the form and saves it", async (label, Form, card) => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => card)));
    let saved;
    await mount(<Form initial={null} existingCharacters={[]} settings={studioSettings()} onSave={(c) => { saved = c; }} onSettings={() => {}} onClose={() => {}} />);
    await begin(label);
    expect(requests).toHaveLength(1);
    await click(all().find((b) => b.t === "Save"));
    expect(saved.name).toBe(card.name);
    expect(activity.get().filter((j) => j.owner.cardKind)).toHaveLength(0);
  });

  it("ignores stale parameters and saves the studio preferences", async () => {
    const settings = studioSettings();
    settings.cardStudio = { personas: { brief: "A keeper.", params: { cast: 8, length: "Concise", name: "Wrong" } } };
    const onSettings = vi.fn();
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => ({ name: "Edda", description: "A keeper." }))));
    await mount(<PersonaForm initial={null} settings={settings} onSave={() => {}} onSettings={onSettings} onClose={() => {}} />);
    await openStudio();
    await click(all().find((b) => b.t === "Write the persona"));
    await flush();
    expect(onSettings).toHaveBeenCalledWith({ cardStudio: { personas: { brief: "A keeper.", interview: false, promptMode: "default" } } });
    expect(requests[0].messages[1].content).not.toContain("Wrong");
  });

  it.each([false, true])("repairs broken JSON once (repair fails: %s)", async (fails) => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => requests.length === 1 || fails ? "{bad json}" : { name: "Edda", description: "Fixed." })));
    await mount(<PersonaForm initial={null} settings={studioSettings()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await begin("persona");
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0].content).toContain("repair broken JSON");
    if (fails) expect(activity.get().find((j) => j.owner.cardKind)?.status).toBe("error");
    else expect([...document.querySelectorAll("input")].some((i) => i.value === "Edda")).toBe(true);
  });

  it("keeps all 12 AI-filled universe characters and extra fields while preserving existing identity", async () => {
    const characters = Array.from({ length: 12 }, (_, i) => ({ name: `Person ${i}`, description: `Description ${i}`, secret: `New secret ${i}` }));
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => ({ ...fullUniverse, characters }))));
    let saved;
    const initial = { name: "Old world", tagline: "", story: "", rules: "", characters: [{ id: "original", name: "Old name", description: "", personality: "", avatar: "portrait.png", links: { card: "card-id" }, secret: "Old secret" }], locations: [], greetings: [] };
    await mount(<UniverseForm initial={initial} existingCharacters={[]} settings={studioSettings()} onSave={c => { saved = c; }} onSettings={() => {}} onClose={() => {}}/>);
    await openStudio();
    await click(all().find(b => b.t === "Rewrite"));
    await flush();
    expect(document.body.textContent).toContain("Every character and place is sent with every reply");
    await click(all().find(b => b.t === "Save"));
    expect(saved.characters).toHaveLength(12);
    saved.characters.forEach((c, i) => expect(c).toMatchObject(characters[i]));
    expect(saved.characters[0]).toMatchObject({ id: "original", avatar: "portrait.png", links: { card: "card-id" }, secret: "New secret 0" });
  });

  it("warns at 12 universe characters while keeping add, navigation and save enabled", async () => {
    let saved;
    const initial = { name: "Vale", characters: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Person ${i}` })), locations: [], greetings: [] };
    await mount(<UniverseForm initial={initial} existingCharacters={[]} settings={studioSettings()} onSave={c => { saved = c; }} onSettings={() => {}} onClose={() => {}}/>);
    await click(all().find(b => b.t === "2. Characters"));
    expect(document.body.textContent).toContain("Every character and place is sent with every reply");
    expect(document.querySelectorAll('[aria-label="Remove character"]')).toHaveLength(12);
    expect(document.querySelectorAll("button:disabled")).toHaveLength(0);
    for (const label of ["Save", "Next", "New"]) expect(all().find(b => b.t === label).disabled).toBe(false);
    await click(all().find(b => b.t === "New"));
    expect(document.querySelectorAll('[aria-label="Remove character"]')).toHaveLength(13);
    await click(all().find(b => b.t === "Save"));
    expect(saved.characters).toHaveLength(12);
  });

  it.each(['{"name":"Edda","description":"unfin', '{"name":"Edda","description":"Short."}'])("continues a truncated reply once: %s", async (first) => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => requests.length === 1 ? first : { name: "Edda", description: "Finished." }, () => requests.length === 1 ? "length" : "stop")));
    await mount(<PersonaForm initial={null} settings={studioSettings()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await begin("persona");
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[1].content).toContain("Continue from where you stopped");
    expect([...document.querySelectorAll("textarea")].some((t) => t.value === "Finished.")).toBe(true);
  });

  it("shows the repair phase and stops after one truncated continuation", async () => {
    let resolve;
    const response = jsonFetch(() => ({ name: "Edda" }), () => "length");
    vi.stubGlobal("fetch", vi.fn((url, init) => requests.length === 0 ? response(url, init)
      : new Promise((done) => { resolve = () => response(url, init).then(done); })));
    await mount(<PersonaForm initial={null} settings={studioSettings()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await begin("persona");
    expect(document.body.textContent).toContain("Fixing format…");
    await act(async () => { resolve(); });
    await flush();
    expect(requests).toHaveLength(2);
    expect(activity.get().find((j) => j.owner.cardKind)?.status).toBe("error");
    expect(document.body.textContent).toContain("still cut off");
  });

  it("keeps generation after closing the form, shows it on reopen and offers a result that landed while closed", async () => {
    let resolve;
    const response = jsonFetch(() => ({ name: "Edda", description: "Finished." }));
    vi.stubGlobal("fetch", vi.fn((url, init) => new Promise((done) => { resolve = () => response(url, init).then(done); })));
    const form = (key) => <PersonaForm key={key} initial={null} settings={studioSettings()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />;
    await mount(form("a"));
    await begin("persona");
    const job = activity.get().find((j) => j.owner.cardKind);
    expect(job.status).toBe("running");
    await mount(<div />);
    expect(job.controller.signal.aborted).toBe(false);
    await mount(form("b"));
    expect(all().some((b) => b.t === "Stop")).toBe(true);
    await mount(<div />);
    await act(async () => { resolve(); });
    await flush();
    expect(activity.get().find((j) => j.id === job.id)?.result).toBeTruthy();
    await mount(form("c"));
    expect(all().some((b) => b.t === "Use it")).toBe(true);
    await click(all().find((b) => b.t === "Use it"));
    expect([...document.querySelectorAll("input")].some((i) => i.value === "Edda")).toBe(true);
  });

  it("shows the writer picker for a non-OpenRouter provider without Gemma chips", async () => {
    const settings = studioSettings();
    settings.providers[0].preset = "custom";
    settings.providers[0].base = "http://localhost:1234/v1";
    await mount(<PersonaForm initial={{ id: "p", name: "Edda", description: "" }} settings={settings} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await openStudio();
    const picker = all().find((b) => b.t.startsWith("Written by"));
    expect(picker.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Gemma");
    expect(document.body.textContent).not.toContain("Same as chat");
    await click(picker);
    expect(document.body.textContent).toContain("Choose a model");
  });

  it.each(["bare", "wrapped", "whole"])("accepts a %s list rewrite without keeping the old count", async (shape) => {
    const greetings = [{ label: "Arrival", text: "Welcome." }, { label: "Departure", text: "Goodbye." }];
    vi.stubGlobal("fetch", vi.fn(jsonFetch(() => shape === "bare" ? greetings : shape === "whole" ? { name: "Changed", greetings } : { greetings })));
    let saved;
    await mount(<CharacterForm initial={{ id: "e", name: "Edda", greetings: [{ id: "g", label: "", text: "Old" }] }} settings={studioSettings()} onSave={(c) => { saved = c; }} onSettings={() => {}} onClose={() => {}} />);
    await openStudio();
    await click(all().find((b) => b.t === "Openings" && b.getAttribute("role") === "radio"));
    await click(all().find((b) => b.t === "Rewrite openings"));
    await flush();
    expect(requests).toHaveLength(1);
    await click(all().find((b) => b.t === "Save"));
    expect(saved.greetings.map(({ label, text }) => ({ label, text }))).toEqual(greetings);
    expect(saved.name).toBe("Edda");
  });

  it.each(["Characters", "Places", "Look"])("opens an island universe job from %s without losing the form draft", async step => {
    await mount(<UniverseForm initial={null} existingCharacters={[]} settings={studioSettings()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} />);
    await type([...document.querySelectorAll("input")].find(el => el.placeholder.includes("Overwatch")), "My unsaved world");
    await click(all().find(b => b.t.endsWith(`. ${step}`)));
    await act(async () => {
      startActivity({ kind: "Card Studio", owner: { cardKind: "universes" } }).done({ name: "Generated world", story: "A valley.", characters: [], locations: [], greetings: [] });
      window.dispatchEvent(new CustomEvent("nova-card-studio", { detail: "universes" }));
    });
    await flush();
    expect(studioPanel().getAttribute("aria-label")).toBe("Card studio · universe");
    expect(all().some((b) => b.t === "Use it")).toBe(true);
    await click(studioRow());
    await click(all().find(b => b.t === "1. World"));
    expect([...document.querySelectorAll("input")].find(el => el.placeholder.includes("Overwatch")).value).toBe("My unsaved world");
  });

  it.each(["characters", "personas", "universes"])("reopens the pending and completed %s studio from the island", async (kind) => {
    await mount(<App />);
    let h;
    await act(async () => { h = startActivity({ kind: "Card Studio", label: "Studio navigation", owner: { cardKind: kind } }); });
    const openFromIsland = async () => {
      const sel = '[aria-label="Open Studio navigation"]';
      if (!document.querySelector(sel)) await click(document.querySelector(".nv-activity [aria-expanded]"));
      await click(document.querySelector(sel));
      expect(studioPanel()?.getAttribute("aria-label")).toBe(`Card studio · ${AI_SCHEMAS[kind].label}`);
    };
    await openFromIsland();
    expect(all().some((b) => b.t === "Stop")).toBe(true);
    /* collapsed, the running job is back in the pill */
    await click(studioRow());
    await openFromIsland();
    expect(all().some((b) => b.t === "Stop")).toBe(true);
    await click([...document.querySelectorAll('[aria-label="Close"]')].at(-1));
    await act(async () => h.done({ name: "Recovered draft" }));
    await openFromIsland();
    await click(all().find((b) => b.t === "Use it"));
    expect([...document.querySelectorAll("input")].some((input) => input.value === "Recovered draft")).toBe(true);
    expect(activity.get().some((j) => j.id === h.id)).toBe(false);
  });
});

describe("Nova Scope", () => {
  /* a model with scripted replies; side requests get a note or a description */
  const scripted = (replies) => (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push(body);
    const sys = body.messages[0].content;
    const side = isSide(body);
    const text = side ? (sys.includes("cast list") ? "The bartender at the inn. Dry and watchful."
      : sys.includes("character card") ? '[{"name":"Tobias","description":"Her brother, who owes everyone money."}]'
      : "Note") : replies.shift() ?? "Fine.";
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  const streamed = () => requests.filter((r) => r.stream === true && !isSide(r));
  const lastNote = (r) => r.messages[r.messages.length - 1].content;
  const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
  const chat = (scope) => ({
    id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1,
    messages: [{ id: "m0", role: "assistant", content: "Mira waves at Elena behind the bar." }],
    ...(scope ? { scope } : {}),
  });

  it("is a plain chat when off: no cast strip and nothing extra in the prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(scripted(["Hello."])));
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    expect(byLabel("Nova Scope")).toBeTruthy();
    expect(byLabel("Step in")).toBeNull();
    await type(host.querySelector("textarea"), "Hi");
    await click(byLabel("Send"));
    expect(lastNote(streamed()[0])).not.toContain("Nova Scope");
    expect(Harness.data.chats[0].messages.at(-1).content).toBe("Hello.");
  });

  it("opens the sheet from the button and switches on", async () => {
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    await openScope();
    expect(document.body.textContent).toContain("Your story, with everyone in it.");
    await click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Auto"));
    expect(Harness.data.chats[0].scope.mode).toBe("auto");
  });

  it("lets several people speak, plays on by itself, and stops at the turn limit", async () => {
    vi.stubGlobal("fetch", vi.fn(scripted([
      "*Mira laughs.* Sure.\n\n**Elena:**\nDon't encourage her.\n[[continue]]",
      "**Mira:** You love it.\n\n**Elena:** I tolerate it.\n[[continue]]",
      "**Elena:** Anyway. What'll it be?",
      "should never be asked for",
    ])));
    const sc = { mode: "manual", carry: true, turns: 3, cast: [{ id: "e", name: "Elena", description: "The bartender." }] };
    await mount(<Harness initial={seed([chat(sc)])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "Two beers.");
    await click(byLabel("Send"));
    await wait(1000);
    await wait(1000);
    const msgs = Harness.data.chats[0].messages;
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.content).join(" ")).not.toContain("[[continue]]");
    expect(streamed()).toHaveLength(3);
    expect(lastNote(streamed()[0])).toContain("Elena: The bartender.");
    expect(lastNote(streamed()[1])).toContain("playing on by itself");
    /* one bubble per reply, the speakers' names in bold inside it */
    const texts = [...host.querySelectorAll(".nv-msg")].map((b) => b.textContent);
    expect(texts).toHaveLength(5);
    expect(texts.some((t) => t.includes("Sure.") && t.includes("Elena:") && t.includes("Don't encourage her."))).toBe(true);
  });

  it("stops playing on the moment you type", async () => {
    vi.stubGlobal("fetch", vi.fn(scripted([
      "**Elena:** Busy night.\n[[continue]]",
      "should never be asked for",
    ])));
    const sc = { mode: "manual", carry: true, turns: 4, cast: [{ id: "e", name: "Elena", description: "The bartender." }] };
    await mount(<Harness initial={seed([chat(sc)])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "Hey.");
    await click(byLabel("Send"));
    expect(byLabel("Step in")).toBeTruthy();
    await type(host.querySelector("textarea"), "W");
    await wait(1100);
    expect(streamed()).toHaveLength(1);
    expect(byLabel("Step in")).toBeNull();
  });

  it("adds someone who keeps coming up in auto mode and describes them from the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(scripted(["Elena slides you a glass. Elena never smiles."])));
    const sc = { mode: "auto", carry: false, threshold: 3, cast: [], cardScanned: true };
    await mount(<Harness initial={seed([chat(sc)])} render={chatPage("k1")} />);
    await type(host.querySelector("textarea"), "Who is Elena?");
    await click(byLabel("Send"));
    await flush();
    const cast = Harness.data.chats[0].scope.cast;
    expect(cast.map((c) => c.name)).toEqual(["Elena"]);
    expect(cast[0].description).toBe("The bartender at the inn. Dry and watchful.");
  });

  it("reads the card for its cast as Scope is switched on, and only once", async () => {
    vi.stubGlobal("fetch", vi.fn(scripted([])));
    await mount(<Harness initial={seed([chat()])} render={chatPage("k1")} />);
    await openScope();
    await click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Manual"));
    await flush();
    const sc = Harness.data.chats[0].scope;
    expect(sc.cardScanned).toBe(true);
    expect(sc.cast.map((c) => [c.name, c.description])).toEqual([["Tobias", "Her brother, who owes everyone money."]]);
    const scans = requests.filter((r) => r.messages?.[0]?.content.includes("character card")).length;
    await click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Auto"));
    await flush();
    expect(requests.filter((r) => r.messages?.[0]?.content.includes("character card")).length).toBe(scans);
  });

});

 describe("optional settings integration", () => {
   it("persists retrieval and translation options from the settings screen", async () => {
     await mount(<Harness initial={seed([])} render={(data, update) => <SettingsPage data={data} update={update} />} />);
     const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
     await click(button("Memory"));
     await click([...host.querySelectorAll("button")].find((b) => b.textContent.includes("Recall")));
     expect(Harness.data.settings.ragOn).toBe(true);
     await click(button("Replies"));
     await click([...host.querySelectorAll("button")].find((b) => b.textContent.includes("Translate new replies")));
     expect(Harness.data.settings.translateReplies).toBe(true);
     const select = byLabel("Translation language");
     await act(async () => { select.value = "pt"; select.dispatchEvent(new Event("change", { bubbles: true })); });
     expect(Harness.data.settings.translateTargetLang).toBe("pt");
     expect(host.textContent).not.toContain("Evening Truth");
     expect(host.textContent).not.toContain("Voyage Universal");
   });
 });
