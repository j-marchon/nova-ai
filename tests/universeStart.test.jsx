// @vitest-environment jsdom
/* New chats from Create (App.jsx startChat): a universe starts as a living
   world (Scope Auto with play-on), and any chat starts with the phone level
   chosen in settings. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/App.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearActivity } from "../src/lib/activity.js";
import { loadData, resetStorageForTests, saveData } from "../src/lib/storage.js";
import { gsap, settleMotion } from "../src/components/motion/runtime.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(HTMLMediaElement.prototype, { play: () => Promise.resolve(), pause() {}, load() {} });

let root, host;
const flush = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const buttons = () => [...host.querySelectorAll("button")];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  clearActivity();
  /* the card scan a Scope chat starts with: an empty answer */
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "[]" } }], usage: {} }), { status: 200 }))));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => { root.unmount(); clearActivity(); });
  host.remove(); settleMotion(); gsap.globalTimeline.clear(); gsap.ticker.sleep();
  vi.unstubAllGlobals();
});

async function startFromCreate(tab, settings = {}) {
  const d = JSON.parse(JSON.stringify(emptyData));
  d.username = "Ana";
  Object.assign(d.settings, settings);
  d.characters = [{ id: "c1", name: "Mira", description: "A thief.", greetings: [{ id: "g1", label: "", text: "Hello." }], firstMessage: "Hello." }];
  d.universes = [{ id: "u1", name: "Vale", story: "A valley.", rules: "", characters: [{ id: "uc", name: "Elder" }], locations: [], greetings: [{ id: "g1", label: "", text: "Rain." }] }];
  await saveData(d);
  resetStorageForTests();
  await act(async () => root.render(<App />));
  await flush();
  if (tab !== "Characters") await click(buttons().find((b) => b.textContent.trim().startsWith(tab)));
  await click(buttons().find((b) => b.getAttribute("aria-label") === "New chat" || b.textContent.trim() === "New"));
  /* saved through the debounce; the chat page itself loads lazily */
  let chats = [];
  for (let i = 0; i < 100 && !chats.length; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    chats = (await loadData()).chats;
  }
  expect(chats).toHaveLength(1);
  return (await loadData()).chats.at(-1);
}

it("a new universe chat starts with Scope Auto and play-on, and no phone by default", async () => {
  const saved = await startFromCreate("Universes");
  expect(saved.kind).toBe("universe");
  expect(saved.scope).toMatchObject({ mode: "auto", carry: true, turns: 3 });
  expect(saved.handset).toBeUndefined();
});

it("respects the Scope mode chosen for new chats, and starts the phone at the chosen level", async () => {
  const saved = await startFromCreate("Universes", { scopeDefault: "manual", phoneDefault: "lively" });
  expect(saved.scope).toMatchObject({ mode: "manual", carry: true });
  expect(saved.handset).toMatchObject({ level: "lively", tick: { n: 0, lastMsgId: null, pending: false }, posts: [] });
});

it("a character chat keeps its old start, plus the phone level", async () => {
  const saved = await startFromCreate("Characters", { phoneDefault: "light" });
  expect(saved.kind).toBe("character");
  expect(saved.scope).toBeUndefined();
  expect(saved.handset.level).toBe("light");
});
