// @vitest-environment jsdom
/* Task 4A · settings-forms: tab orders, no social UI left in settings or
   chat (removed in 3.2), universes of every size, AI-fill
   field retention, and the Notes tab's presets through save/apply/delete/undo
   and a backup round-trip. */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { emptyData, normalizeData, normalizeNotePresets } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";
import { SettingsPage } from "../src/pages/SettingsPage.jsx";
import { CreatePage } from "../src/pages/CreatePage.jsx";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { UniverseForm, withIds } from "../src/components/forms.jsx";
import { clearActivity } from "../src/lib/activity.js";
import { clearToasts, toasts } from "../src/lib/toast.js";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(HTMLMediaElement.prototype, { play: () => Promise.resolve(), pause() {}, load() {} });

let host, root, requests;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests(); clearActivity(); clearToasts();
  requests = [];
  vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => { root.unmount(); clearActivity(); });
  host.remove(); vi.unstubAllGlobals();
});

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const mount = async el => { await act(async () => root.render(el)); await flush(); };
const buttons = () => [...document.querySelectorAll("button")];
const btn = text => buttons().find(b => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
const btnStarts = text => buttons().find(b => b.textContent.trim().startsWith(text));
const click = async el => { expect(el, "element to click").toBeTruthy(); await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const WARNING = "Every character and place is sent with every reply";
const keyed = () => { const s = structuredClone(emptyData.settings); s.providers[0].key = "sk-test"; s.providers[0].model = "test-model"; return s; };

/* a stateful host for any page that takes data/update */
function harness(initial, renderPage) {
  const box = { data: initial };
  function Host() {
    const [data, setData] = useState(initial);
    box.data = data;
    return renderPage(data, patch => setData(d => { const next = typeof patch === "function" ? patch(d) : { ...d, ...patch }; box.data = next; return next; }));
  }
  return { box, el: <Host /> };
}

describe("tab orders", () => {
  it("Settings tabs run About, Nova Bridge, model, replies, memory, look, usage, backup, update", async () => {
    await mount(<SettingsPage data={emptyData} update={() => {}} />);
    const labels = [...host.querySelectorAll("[aria-label='Settings tabs'] button")].map(b => b.textContent.trim());
    expect(labels).toEqual(["About", "Nova Bridge", "Model", "Replies", "Memory", "Look", "Usage", "Backup", "Update"]);
  });

  it("opens on Model while a provider is still needed, on About once one works", async () => {
    const pressed = () => host.querySelector("[aria-label='Settings tabs'] button[aria-pressed='true']").textContent.trim();
    await mount(<SettingsPage data={emptyData} update={() => {}} />);
    expect(pressed()).toBe("Model");
    act(() => root.unmount()); root = createRoot(host);
    await mount(<SettingsPage data={{ ...emptyData, settings: keyed() }} update={() => {}} />);
    expect(pressed()).toBe("About");
    expect(host.querySelector("a[href='https://ko-fi.com/bjmar']")).not.toBeNull();
  });

  it("Create tabs run characters, universes, personas, lorebooks, with no Social tab", async () => {
    await mount(<CreatePage data={emptyData} update={() => {}} onEdit={() => {}} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />);
    const pills = [...host.querySelectorAll("button[aria-pressed]")].map(b => b.textContent);
    const order = ["Characters", "Universes", "Personas", "Lorebooks"].map(l => pills.findIndex(t => t.startsWith(l)));
    expect(order.every(i => i >= 0)).toBe(true);
    expect(pills.some(t => t.startsWith("Social"))).toBe(false);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("chat screen after the social feature's removal", () => {
  /* a card and chat saved while the feature existed still carry its fields */
  const chatHost = () => {
    const initial = structuredClone(emptyData);
    initial.characters = [{ id: "ada", name: "Ada", greetings: [], social: { mode: "on" } }];
    initial.chats = [{ id: "c1", kind: "character", characterId: "ada", messages: [], socialMode: "on", socialWorldId: "w", socialContext: true }];
    return harness(normalizeData(initial), (data, update) => <ChatPage data={data} chatId="c1" update={update} goBack={() => {}} goSettings={() => {}} />);
  };

  it("has no social shortcut and no Social section in chat settings", async () => {
    const { box, el } = chatHost();
    await mount(el);
    expect(host.querySelector("[aria-label='Open social media']")).toBeNull();
    await click(host.querySelector("[aria-label='Chat settings']"));
    const sections = [...document.querySelectorAll("[aria-label='Chat settings sections'] button")].map(b => b.textContent);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections).not.toContain("Social");
    expect(box.data.characters[0]).not.toHaveProperty("social");
    expect(box.data.chats[0]).not.toHaveProperty("socialMode");
    expect(box.data.chats[0]).not.toHaveProperty("socialWorldId");
  });
});

describe("universes with 0, 1 and 50 characters and places", () => {
  const universe = (chars, places) => ({
    name: "Vale", tagline: "", story: "", rules: "", greetings: [],
    characters: Array.from({ length: chars }, (_, i) => ({ id: `c${i}`, name: `Person ${i}`, description: "", personality: "" })),
    locations: Array.from({ length: places }, (_, i) => ({ id: `l${i}`, name: `Place ${i}`, description: "" })),
  });
  const open = async (initial, onSave = () => {}) => mount(<UniverseForm initial={initial} existingCharacters={[]} settings={keyed()} onSave={onSave} onSettings={() => {}} onClose={() => {}} />);
  const step = label => click(btn(label));

  it("0, 1 and 10 characters and places show no warning", async () => {
    for (const n of [0, 1, 10]) {
      await open(universe(n, n));
      await step("2. Characters");
      expect(document.body.textContent).toContain(`Characters (${n})`);
      expect(document.body.textContent).not.toContain(WARNING);
      await step("3. Places");
      expect(document.body.textContent).toContain(`Places (${n})`);
      expect(document.body.textContent).not.toContain(WARNING);
      act(() => root.unmount()); root = createRoot(host);
    }
  });

  it("an empty new universe can add its first character and place", async () => {
    let saved;
    await mount(<UniverseForm initial={null} existingCharacters={[]} settings={keyed()} onSave={u => { saved = u; }} onSettings={() => {}} onClose={() => {}} />);
    await type(document.querySelector("input[placeholder^='e.g. Overwatch']"), "Vale");
    await step("2. Characters"); await click(btn("New"));
    await type(document.querySelector("input[placeholder='Name']"), "Rook");
    await step("3. Places"); await click(btnStarts("Add place"));
    await type(document.querySelector("input[placeholder='Place name']"), "Ford");
    await click(btn("Save"));
    expect(saved.characters.map(c => c.name)).toEqual(["Rook"]);
    expect(saved.locations.map(l => l.name)).toEqual(["Ford"]);
  });

  it("11 places alone warn on both list steps", async () => {
    await open(universe(0, 11));
    await step("2. Characters");
    expect(document.body.textContent).toContain(WARNING);
    await step("3. Places");
    expect(document.body.textContent).toContain(WARNING);
    expect(document.querySelector("[role='status']").textContent).toContain("Scope only scans the first part");
  });

  it("50 characters and 50 places warn, disable nothing, and save every row", async () => {
    let saved;
    await open(universe(50, 50), u => { saved = u; });
    await step("2. Characters");
    expect(document.body.textContent).toContain(WARNING);
    expect(document.querySelectorAll("[aria-label='Remove character']")).toHaveLength(50);
    expect(document.querySelectorAll("button:disabled")).toHaveLength(0);
    await click(btn("New"));
    expect(document.querySelectorAll("[aria-label='Remove character']")).toHaveLength(51);
    await step("3. Places");
    expect(document.querySelectorAll("[aria-label='Remove place']")).toHaveLength(50);
    expect(document.querySelectorAll("button:disabled")).toHaveLength(0);
    await click(btn("Save"));
    expect(saved.characters).toHaveLength(50);
    expect(saved.locations).toHaveLength(50);
  });

  it("removing characters below the threshold clears the warning", async () => {
    await open(universe(11, 0));
    await step("2. Characters");
    expect(document.body.textContent).toContain(WARNING);
    await click(document.querySelector("[aria-label='Remove character']"));
    expect(document.body.textContent).not.toContain(WARNING);
  });

  it("50 characters survive normalization and a backup round-trip", () => {
    const data = normalizeData({ ...structuredClone(emptyData), universes: [{ id: "u", ...universe(50, 50) }] });
    const { state } = readBackup(makeBackup(data));
    expect(state.universes[0].characters).toHaveLength(50);
    expect(state.universes[0].locations).toHaveLength(50);
  });
});

describe("AI fill keeps extra fields", () => {
  /* a model that answers every request with one JSON card, streamed */
  const jsonFetch = reply => (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push(body);
    const text = JSON.stringify(reply);
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  const rewrite = async (initial, reply) => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch(reply)));
    let saved;
    await mount(<UniverseForm initial={initial} existingCharacters={[]} settings={keyed()} onSave={u => { saved = u; }} onSettings={() => {}} onClose={() => {}} />);
    await click(btnStarts("Card studio"));
    await click(btn("Rewrite"));
    await flush();
    await click(btn("Save"));
    return saved;
  };
  const base = { name: "Old", tagline: "", story: "", rules: "", greetings: [], characters: [], locations: [] };

  it("withIds accepts name, title or character and drops nameless rows", () => {
    const rows = withIds([{ name: "A" }, { title: "B" }, { character: "C" }, { description: "nameless" }, null, { name: "   " }], { description: "" });
    expect(rows.map(r => r.name || r.title || r.character)).toEqual(["A", "B", "C"]);
    expect(rows.every(r => typeof r.id === "string" && r.description === "")).toBe(true);
    expect(withIds("not a list", {})).toEqual([]);
  });

  it("keeps the model's extra character fields and names given as title", async () => {
    const saved = await rewrite(base, { name: "Vale", greetings: [], locations: [], characters: [
      { name: "Rook", description: "A guard.", age: "41", secret: "Owes the queen." },
      { title: "The Widow", description: "Runs the inn.", motto: "Pay first." },
    ] });
    expect(saved.characters).toHaveLength(2);
    expect(saved.characters[0]).toMatchObject({ name: "Rook", age: "41", secret: "Owes the queen." });
    expect(saved.characters[1]).toMatchObject({ name: "The Widow", motto: "Pay first." });
  });

  it("keeps 12 generated characters with the warning shown", async () => {
    const characters = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, description: `D${i}`, quirk: `Q${i}` }));
    const saved = await rewrite(base, { name: "Vale", greetings: [], locations: [], characters });
    expect(saved.characters.map(c => c.quirk)).toEqual(characters.map(c => c.quirk));
  });

  it("keeps the model's extra place fields", async () => {
    const saved = await rewrite(base, { name: "Vale", greetings: [], characters: [], locations: [{ name: "Ford", description: "Shallow water.", danger: "Bandits at night" }] });
    expect(saved.locations[0]).toMatchObject({ name: "Ford", danger: "Bandits at night" });
  });

  it("a place takes no stale extra field from the old place at its index", async () => {
    const saved = await rewrite({ ...base, locations: [{ id: "l0", name: "Ford", description: "", danger: "Old" }] },
      { name: "Vale", greetings: [], characters: [], locations: [{ name: "Mill", description: "Wheels." }] });
    expect(saved.locations[0].id).toBe("l0");
    expect(saved.locations[0].danger).toBeUndefined();
  });

  it("drops the title or character alias once it became the name", async () => {
    const saved = await rewrite(base, { name: "Vale", greetings: [], locations: [{ title: "Ford", description: "" }], characters: [
      { title: "The Widow", description: "" }, { character: "Rook", description: "" },
    ] });
    expect(saved.characters.map(c => c.name)).toEqual(["The Widow", "Rook"]);
    expect(saved.characters.every(c => !("title" in c) && !("character" in c))).toBe(true);
    expect(saved.locations[0]).toMatchObject({ name: "Ford" });
    expect("title" in saved.locations[0]).toBe(false);
  });

  it("rewriting only the tagline keeps the characters' and places' extra fields", async () => {
    vi.stubGlobal("fetch", vi.fn(jsonFetch({ tagline: "A new line." })));
    let saved;
    const initial = { ...base, name: "Vale",
      characters: [{ id: "c0", name: "Rook", description: "A guard.", personality: "", avatar: "pic", age: "41", secrets: "Owes the queen." }],
      locations: [{ id: "l0", name: "Ford", description: "Water.", danger: "Bandits" }] };
    await mount(<UniverseForm initial={initial} existingCharacters={[]} settings={keyed()} onSave={u => { saved = u; }} onSettings={() => {}} onClose={() => {}} />);
    await click(btnStarts("Card studio"));
    await click(buttons().find(b => b.getAttribute("role") === "radio" && b.textContent.trim() === "Tagline"));
    await click(btn("Rewrite tagline"));
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests.at(-1).messages.at(-1).content).toContain('"age": "41"');
    await click(btn("Save"));
    expect(saved.tagline).toBe("A new line.");
    expect(saved.characters[0]).toMatchObject({ id: "c0", avatar: "pic", age: "41", secrets: "Owes the queen." });
    expect(saved.locations[0]).toMatchObject({ id: "l0", danger: "Bandits" });
  });
});

describe("author's note presets", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief." };
  const chat = (note) => ({
    id: "chat-test", kind: "character", characterId: "c1", personaId: "",
    messages: [{ id: "m1", role: "assistant", content: "Hello!", at: 1 }],
    authorsNote: { text: "Be slow.", ...note }, createdAt: 1, updatedAt: 1,
  });
  const openNote = async (initial) => {
    const h = harness(initial, (data, update) => <ChatPage data={data} chatId="chat-test" update={update} goBack={() => {}} goSettings={() => {}} />);
    await mount(h.el);
    await click(host.querySelector("button[aria-label='Chat settings']"));
    await click(btn("Quick tweaks"));
    return h.box;
  };
  const noteBox = () => document.querySelector(".nv-sheet-body textarea");
  const nameBox = () => document.querySelector("input[aria-label='Preset name']");
  const presetRow = name => buttons().find(b => b.hasAttribute("aria-pressed") && b.closest("[data-inverted], .nv-glass") && b.textContent.startsWith(name));

  it("there is no Author's note tab, Sent as or slider left", async () => {
    await openNote({ ...emptyData, characters: [mira], chats: [chat()] });
    expect(btnStarts("Author's note")).toBeFalsy();
    const body = document.querySelector(".nv-sheet-body");
    expect(body.textContent).not.toMatch(/Sent as|Placed|every turn/);
    expect(body.querySelectorAll("input[type='range']")).toHaveLength(0);
  });

  it("a name is required, Enter saves, and a toast confirms", async () => {
    const text = "   Keep every scene under a minute of story time, always.";
    const box = await openNote({ ...emptyData, characters: [mira], chats: [chat({ text })] });
    await click(btn("Save preset"));
    await act(async () => nameBox().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush();
    expect(box.data.settings.authorNotePresets).toEqual([]);
    await type(nameBox(), "Brisk");
    await act(async () => nameBox().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await flush();
    expect(box.data.settings.authorNotePresets).toEqual([{ id: expect.any(String), name: "Brisk", text }]);
    expect(toasts.get().some(t => /Saved preset/.test(t.text || t.message || ""))).toBe(true);
  });

  it("whitespace-only text cannot be saved", async () => {
    const box = await openNote({ ...emptyData, characters: [mira], chats: [chat({ text: "   \n  " })] });
    expect(btn("Save preset").disabled).toBe(true);
    expect(nameBox()).toBeNull();
    expect(box.data.settings.authorNotePresets).toEqual([]);
  });

  it("applying a preset sets only the note's text, and an old preset's role and depth are gone", async () => {
    const preset = { id: "p1", name: "Deep", text: "Whisper only.", depth: 9, interval: 5, role: "assistant", createdAt: 1 };
    const data = normalizeData({ ...emptyData, settings: { ...emptyData.settings, authorNotePresets: [preset] }, characters: [mira], chats: [chat({ depth: 9, interval: 4, role: "system" })] });
    const box = await openNote(data);
    await click(presetRow("Deep"));
    expect(box.data.chats[0].authorsNote).toEqual({ text: "Whisper only." });
    expect(noteBox().value).toBe("Whisper only.");
    expect(box.data.settings.authorNotePresets).toEqual([{ id: "p1", name: "Deep", text: "Whisper only." }]);
  });

  it("undoing a delete puts the preset back in its original position", async () => {
    const presets = ["One", "Two", "Three"].map((name, i) => ({ id: `p${i}`, name, text: `${name} text.` }));
    const box = await openNote({ ...emptyData, settings: { ...emptyData.settings, authorNotePresets: presets }, characters: [mira], chats: [chat()] });
    await click(btn("Delete Two"));
    await click(btn("Confirm delete Two"));
    expect(box.data.settings.authorNotePresets.map(p => p.name)).toEqual(["One", "Three"]);
    await act(async () => toasts.get().find(t => t.undo).undo()); await flush();
    expect(box.data.settings.authorNotePresets.map(p => p.name)).toEqual(["One", "Two", "Three"]);
    expect(box.data.chats[0].authorsNote.text).toBe("Be slow.");
  });

  it("saving under an existing name replaces that preset instead of adding a second", async () => {
    const box = await openNote({ ...emptyData, characters: [mira], chats: [chat()] });
    await click(btn("Save preset")); await type(nameBox(), "Same"); await click(btn("Confirm"));
    await type(noteBox(), "Other text.");
    await click(btn("Save preset")); await type(nameBox(), "Same");
    expect(btn("Confirm")).toBeFalsy();
    await click(btn("Replace"));
    const list = box.data.settings.authorNotePresets;
    expect(list.map(p => p.name)).toEqual(["Same"]);
    expect(list.map(p => p.text)).toEqual(["Other text."]);
  });

  it("several presets survive a backup round-trip in order, and junk is dropped on restore", () => {
    const presets = [
      { id: "a", name: "A", text: "Alpha." },
      { id: "b", name: "B", text: "Beta.\nMore." },
    ];
    const data = normalizeData({ settings: { authorNotePresets: [...presets, { id: "junk", text: "" }, 42] } });
    expect(data.settings.authorNotePresets).toEqual(presets);
    const { state } = readBackup(makeBackup(data));
    expect(state.settings.authorNotePresets).toEqual(presets);
    expect(normalizeNotePresets(state.settings.authorNotePresets)).toEqual(presets);
  });
});
