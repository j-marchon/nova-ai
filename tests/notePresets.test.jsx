// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";
import { executeSlashCommand, parseSlashCommand } from "../src/lib/slash.js";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { CreatePage } from "../src/pages/CreatePage.jsx";
import { SettingsPage } from "../src/pages/SettingsPage.jsx";
import { clearToasts, toasts } from "../src/lib/toast.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  clearToasts();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const mount = async (el) => { await act(async () => root.render(el)); };
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
};
const click = async (el) => { await act(async () => el.click()); await flush(); };
const btn = (text, scope = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("tab order", () => {
  it("Settings tabs open with About and end with Backup and Update", async () => {
    await mount(<SettingsPage data={emptyData} update={() => {}} />);
    const labels = [...host.querySelectorAll("[aria-label='Settings tabs'] button")].map((b) => b.textContent.trim());
    expect(labels).toEqual(["About", "Nova Bridge", "Model", "Replies", "Memory", "Look", "Usage", "Backup", "Update"]);
  });

  it("Create tabs run characters, universes, personas, lorebooks, with no Social tab", async () => {
    await mount(<CreatePage data={emptyData} update={() => {}} onEdit={() => {}} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />);
    const pills = [...host.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent);
    const order = ["Characters", "Universes", "Personas", "Lorebooks"].map((l) => pills.findIndex((t) => t.startsWith(l)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(pills.some((t) => t.startsWith("Social"))).toBe(false);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("preset normalization", () => {
  it("drops bad entries, repairs names, and keeps only id, name and text", () => {
    const d = normalizeData({
      settings: {
        authorNotePresets: [
          null, "x", { id: "a", name: "Ok", text: "Slow down.", depth: 4, interval: 2, role: "system", createdAt: 5 },
          { id: "b", name: "Empty", text: "   " },
          { id: "c", text: "No name given here at all, long enough to cut", depth: 99, interval: "z", role: "bogus" },
          { id: "a", name: "Dup", text: "Same id" },
        ],
      },
    });
    const list = d.settings.authorNotePresets;
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ id: "a", name: "Ok", text: "Slow down." });
    expect(list[1]).toEqual({ id: "c", name: "No name given here at all, lon", text: "No name given here at all, long enough to cut" });
    expect(Object.keys(list[2]).sort()).toEqual(["id", "name", "text"]);
    expect(new Set(list.map((x) => x.id)).size).toBe(3);
    expect(normalizeData({ settings: { authorNotePresets: "nope" } }).settings.authorNotePresets).toEqual([]);
  });

  it("clears the retired Gemma writer model", () => {
    expect(normalizeData({ settings: { writerModel: "google/gemma-4-31b-it:free" } }).settings.writerModel).toBe("");
    expect(normalizeData({ settings: { writerModel: "x/y" } }).settings.writerModel).toBe("x/y");
  });

  it("survives a backup round-trip, and an old backup's extra fields are dropped", () => {
    const preset = { id: "p1", name: "Tense", text: "Keep it tense." };
    const data = normalizeData({ settings: { authorNotePresets: [{ ...preset, depth: 2, interval: 3, role: "assistant", createdAt: 9 }] } });
    expect(data.settings.authorNotePresets).toEqual([preset]);
    const { state } = readBackup(makeBackup(data));
    expect(state.settings.authorNotePresets).toEqual([preset]);
  });

  it("strips role, depth and interval from stored chat notes", () => {
    const d = normalizeData({ chats: [
      { id: "a", kind: "character", messages: [], authorsNote: { text: "Hush.", depth: 9, interval: 4, role: "system" } },
      { id: "b", kind: "character", messages: [] },
    ] });
    expect(d.chats[0].authorsNote).toEqual({ text: "Hush." });
    expect(d.chats[1].authorsNote).toEqual({ text: "" });
  });
});

describe("/note load", () => {
  const presets = [
    { id: "1", name: "Slow Burn", text: "Slow.", depth: 2, interval: 1, role: "user", createdAt: 1 },
    { id: "2", name: "Action", text: "Fast.", depth: 3, interval: 1, role: "user", createdAt: 2 },
  ];
  const run = (line, ctx) => executeSlashCommand(parseSlashCommand(line), ctx);

  it("loads by exact name, case-insensitive, or prefix", () => {
    const loaded = [];
    const ctx = { notePresets: presets, onLoadNotePreset: (p) => loaded.push(p.id) };
    expect(run("/note load slow burn", ctx).preset.id).toBe("1");
    expect(run("/note load act", ctx).preset.id).toBe("2");
    expect(loaded).toEqual(["1", "2"]);
  });

  it("reports an unknown name or no presets, and plain /note still sets text", () => {
    expect(run("/note load nope", { notePresets: presets }).success).toBe(false);
    expect(run("/note load x", { notePresets: [] }).error).toMatch(/No saved/);
    const texts = [];
    expect(run("/note hello", { onUpdateNote: (t) => texts.push(t) }).text).toBe("hello");
    expect(texts).toEqual(["hello"]);
  });
});

describe("Notes tab", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief." };
  const chat = {
    id: "chat-test", kind: "character", characterId: "c1", personaId: "",
    messages: [{ id: "m1", role: "assistant", content: "Hello!", at: 1 }],
    authorsNote: { text: "Be slow.\nVery slow." },
    createdAt: 1, updatedAt: 1,
  };
  let cur;
  function Host() {
    const [data, setData] = useState(cur);
    return (
      <ChatPage
        data={data}
        chatId="chat-test"
        update={(patch) => setData((prev) => { const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch }; cur = next; return next; })}
        goBack={() => {}}
        goSettings={() => {}}
      />
    );
  }
  const openNote = async () => {
    await mount(<Host />);
    await flush();
    await click(host.querySelector("button[aria-label='Chat settings']"));
    await click([...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "Quick tweaks"));
  };
  const noteBox = () => document.querySelector(".nv-sheet-body textarea");
  const nameBox = () => document.querySelector("input[aria-label='Preset name']");
  const exact = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const presetRow = (name) => [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.closest("[data-inverted], .nv-glass") && b.textContent.startsWith(name));
  const key = async (el, k) => { await act(async () => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))); await flush(); };
  const withPresets = (presets, note = chat.authorsNote) => ({ ...emptyData, settings: { ...emptyData.settings, authorNotePresets: presets }, characters: [mira], chats: [{ ...chat, authorsNote: note }] });

  it("loads a preset's text through a chat slash command", async () => {
    const preset = { id: "p1", name: "Slow Burn", text: "Keep tension." };
    cur = withPresets([preset]);
    await mount(<Host />);
    await flush();
    const composer = host.querySelector('textarea[aria-label="Write a message"]');
    await type(composer, "/note load Slow Burn");
    await act(async () => {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(cur.chats[0].authorsNote).toEqual({ text: preset.text });
    expect(cur.chats[0].messages[0]).toEqual(chat.messages[0]);
    expect(cur.chats[0].messages.at(-1)).toMatchObject({ role: "system", content: 'Author\'s Note loaded: "Slow Burn"' });
  });

  it("is labelled Quick tweaks, with just the note: no Sent as and no sliders", async () => {
    cur = withPresets([]);
    await openNote();
    const labels = [...host.querySelectorAll("[aria-label='Chat settings sections'] button")].map((b) => b.textContent.trim());
    expect(labels).toEqual(["Persona", "Look", "Memory", "Quick tweaks", "Bookmarks", "Scene art", "Tokens", "Export"]);
    const body = document.querySelector(".nv-sheet-body");
    expect(body.textContent).not.toContain("Sent as");
    expect(body.textContent).not.toContain("Placed");
    expect(body.querySelectorAll("input[type='range']")).toHaveLength(0);
    expect(body.querySelectorAll("[role='radio']")).toHaveLength(0);
    expect(noteBox().value).toBe("Be slow.\nVery slow.");
    expect(noteBox().placeholder).toContain("{{char}}");
    await type(noteBox(), "New note.");
    expect(cur.chats[0].authorsNote).toEqual({ text: "New note." });
    expect(nameBox()).toBeNull();
  });

  it("Save preset asks for a name, then stores and lists it", async () => {
    cur = withPresets([]);
    await openNote();
    await click(exact("Save preset"));
    expect(nameBox()).toBeTruthy();
    expect(exact("Confirm").disabled).toBe(true);
    await click(exact("Confirm"));
    expect(cur.settings.authorNotePresets).toEqual([]);
    await type(nameBox(), "  Slow  ");
    await click(exact("Confirm"));
    expect(cur.settings.authorNotePresets).toHaveLength(1);
    expect(cur.settings.authorNotePresets[0]).toEqual({ id: expect.any(String), name: "Slow", text: "Be slow.\nVery slow." });
    expect(toasts.get().some((t) => t.text === 'Saved preset "Slow"')).toBe(true);
    expect(nameBox()).toBeNull();
    const row = presetRow("Slow");
    expect(row.textContent).toContain("Be slow.");
    expect(row.textContent).not.toContain("Very slow.");
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter confirms, Escape cancels without closing the sheet", async () => {
    cur = withPresets([]);
    await openNote();
    await click(exact("Save preset"));
    await type(nameBox(), "Gone");
    await key(nameBox(), "Escape");
    expect(nameBox()).toBeNull();
    expect(cur.settings.authorNotePresets).toEqual([]);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    await flush();
    expect(document.body.textContent).toContain("Chat settings");
    expect(exact("Save preset")).toBeTruthy();
    await click(exact("Save preset"));
    expect(nameBox().value).toBe("");
    await type(nameBox(), "Kept");
    await key(nameBox(), "Enter");
    expect(cur.settings.authorNotePresets.map((p) => p.name)).toEqual(["Kept"]);
  });

  it("a duplicate name offers Replace, which updates that preset in place", async () => {
    cur = withPresets([{ id: "a", name: "Slow", text: "Old." }, { id: "b", name: "Other", text: "Other." }]);
    await openNote();
    await click(exact("Save preset"));
    await type(nameBox(), "slow");
    expect(exact("Replace")).toBeTruthy();
    expect(exact("Confirm")).toBeFalsy();
    await click(exact("Replace"));
    expect(cur.settings.authorNotePresets).toEqual([{ id: "a", name: "slow", text: "Be slow.\nVery slow." }, { id: "b", name: "Other", text: "Other." }]);
  });

  it("disables Save preset while the note is empty", async () => {
    cur = withPresets([], { text: "  \n " });
    await openNote();
    expect(exact("Save preset").disabled).toBe(true);
  });

  it("tapping a preset applies it and shows it selected; tapping it again clears the note", async () => {
    cur = withPresets([{ id: "a", name: "Tense", text: "Keep it tense." }]);
    await openNote();
    expect(presetRow("Tense").getAttribute("aria-pressed")).toBe("false");
    await click(presetRow("Tense"));
    expect(cur.chats[0].authorsNote.text).toBe("Keep it tense.");
    expect(noteBox().value).toBe("Keep it tense.");
    expect(presetRow("Tense").getAttribute("aria-pressed")).toBe("true");
    await type(noteBox(), "Keep it tense. Now.");
    expect(presetRow("Tense").getAttribute("aria-pressed")).toBe("false");
    await click(presetRow("Tense"));
    await click(presetRow("Tense"));
    expect(cur.chats[0].authorsNote.text).toBe("");
    expect(presetRow("Tense").getAttribute("aria-pressed")).toBe("false");
  });

  it("Edit renames and rewrites the stored preset, not the chat's note", async () => {
    cur = withPresets([{ id: "a", name: "Tense", text: "Keep it tense." }]);
    await openNote();
    await click(document.querySelector("[aria-label='Edit Tense']"));
    const [nameInput] = [...document.querySelectorAll(".nv-sheet-body input")].filter((i) => i.value === "Tense");
    const textInput = [...document.querySelectorAll(".nv-sheet-body textarea")].find((t) => t.value === "Keep it tense.");
    await type(nameInput, "Taut");
    await type(textInput, "Keep it taut.");
    await click(exact("Save"));
    expect(cur.settings.authorNotePresets).toEqual([{ id: "a", name: "Taut", text: "Keep it taut." }]);
    expect(cur.chats[0].authorsNote.text).toBe("Be slow.\nVery slow.");
    expect(presetRow("Taut")).toBeTruthy();
    /* Cancel leaves it as it was */
    await click(document.querySelector("[aria-label='Edit Taut']"));
    await click(exact("Cancel"));
    expect(cur.settings.authorNotePresets[0].name).toBe("Taut");
  });

  it("Remove deletes a preset, and Undo puts it back in place", async () => {
    cur = withPresets(["One", "Two", "Three"].map((name, i) => ({ id: `p${i}`, name, text: `${name} text.` })));
    await openNote();
    await click(document.querySelector("[aria-label='Delete Two']"));
    await click(document.querySelector("[aria-label='Confirm delete Two']"));
    expect(cur.settings.authorNotePresets.map((p) => p.name)).toEqual(["One", "Three"]);
    expect(presetRow("Two")).toBeFalsy();
    const undo = toasts.get().find((t) => t.undo);
    expect(undo.text).toBe("Preset deleted");
    await act(async () => undo.undo());
    await flush();
    expect(cur.settings.authorNotePresets.map((p) => p.name)).toEqual(["One", "Two", "Three"]);
    expect(cur.chats[0].authorsNote.text).toBe("Be slow.\nVery slow.");
  });
});
