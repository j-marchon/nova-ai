// @vitest-environment jsdom
/* The World UI of a universe chat: the strip's World chip, the World
   sheet (now, places, where everyone is, lately, narrate) and "Go here",
   which adds a narrator line and starts one ordinary reply. The network is
   a fake model; a held reply stays running until it is let go. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearActivity } from "../src/lib/activity.js";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(HTMLMediaElement.prototype, { play: () => Promise.resolve(), pause() {}, load() {} });

let root, host, requests, hold, held;

const isSide = (body) => /You keep the (?:tracker|long-term memory|cast list)|You read .*character card/.test(body.messages?.[0]?.content || "");
const replies = () => requests.filter((r) => r.stream === true && !isSide(r));
const sentText = (r) => r.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

function fakeFetch(url, init = {}) {
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push(body);
  if (body.stream === false) {
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "Note" } }], usage: {} }), { status: 200 }));
  }
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "The scene moves." } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(c) {
      const go = () => { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); };
      if (hold && !isSide(body)) {
        held.push(go);
        init.signal?.addEventListener("abort", () => { try { c.error(new DOMException("Stopped", "AbortError")); } catch { /* closed */ } }, { once: true });
      } else go();
    },
  });
  return Promise.resolve(new Response(stream, { status: 200 }));
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  clearActivity();
  requests = [];
  hold = false;
  held = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  for (const go of held) go();
  await flush();
  act(() => { root.unmount(); clearActivity(); });
  host.remove();
  vi.unstubAllGlobals();
});

const NOTE = "[Monday, 3 May | evening | The Mill | rain, 9°C]\n\n[Here: Rook at the stove, Ana by the door.]\n[Ana: wet coat.]\n\n[Elsewhere:\n- Lena: at the Old Bridge, waiting for the ferry]\n\n[Happening: a lantern moves along the river path.]\n\n[IMPORTANT STRINGS: none]";

const universe = {
  id: "u1", name: "Vale", story: "A valley.", rules: "", greetings: [],
  characters: [{ id: "rk", name: "Rook" }, { id: "ln", name: "Lena" }, { id: "ot", name: "Otto" }],
  locations: [
    { id: "l1", name: "The Mill", description: "A wet old mill by the river." },
    { id: "l2", name: "Old Bridge", description: "Stone, and a ferry below." },
  ],
};

const uniChat = (extra = {}) => ({
  id: "uu", kind: "universe", universeId: "u1", personaId: "", createdAt: 1, updatedAt: 1,
  messages: [
    { id: "m0", role: "assistant", content: "Rain on the mill roof." },
    { id: "m1", role: "user", content: "I knock." },
    { id: "m2", role: "assistant", content: "Rook opens the door." },
  ],
  ...extra,
});

function seed(chats) {
  const d = JSON.parse(JSON.stringify(emptyData));
  d.username = "Ana";
  d.settings.providers[0].key = "sk-test";
  d.settings.providers[0].model = "test-model";
  d.settings.sceneEvery = 0;
  d.characters = [{ id: "c1", name: "Mira", description: "A thief.", personality: "", greetings: [], firstMessage: "", avatar: "" }];
  d.universes = [universe];
  d.chats = chats;
  return d;
}

function Harness({ initial, chatId }) {
  const [data, setData] = useState(initial);
  const update = (p) => setData((prev) => (typeof p === "function" ? p(prev) : { ...prev, ...p }));
  Harness.data = data;
  return <ChatPage data={data} chatId={chatId} update={update} goBack={() => {}} goSettings={() => {}} />;
}

const mount = async (chats, chatId = "uu") => {
  await act(async () => root.render(<Harness initial={seed(chats)} chatId={chatId} />));
  await flush();
};
const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const worldChip = () => host.querySelector('button[aria-label^="World:"]');
const sheet = () => document.body.querySelector('[role="dialog"][aria-label="Vale"]');
const place = (name) => sheet().querySelector(`[data-place="${name}"]`);
const person = (name) => [...sheet().querySelectorAll("button[aria-pressed]")].find((b) => b.querySelector("p")?.textContent === name);
const stripChip = (name) => [...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.trim() === name);
const chat = () => Harness.data.chats.find((c) => c.id === "uu");

describe("World chip", () => {
  it("shows the place and time from the tracker note", async () => {
    await mount([uniChat({ scene: { text: NOTE, lastId: "m2" } })]);
    expect(worldChip().textContent).toBe("The Mill · evening");
    expect(worldChip().getAttribute("aria-label")).toBe("World: The Mill, evening");
    /* it leads the strip, before the Narrator chip */
    const chips = [...host.querySelectorAll("[data-motion-key] > button")];
    expect(chips[0]).toBe(worldChip());
    expect(chips[1].textContent).toBe("Narrator");
  });

  it("shows the universe's name before the first note", async () => {
    await mount([uniChat()]);
    expect(worldChip().textContent).toBe("Vale");
  });

  it("is not shown in a character chat", async () => {
    const k = {
      id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1,
      scope: { mode: "manual", carry: false, cardScanned: true, cast: [{ id: "t", name: "Tom", description: "A guard." }] },
      messages: [{ id: "m0", role: "assistant", content: "Evening." }],
    };
    await mount([k], "k1");
    expect(stripChip("Tom")).toBeTruthy();
    expect(worldChip()).toBeNull();
  });
});

describe("World sheet", () => {
  it("lists places, people and the latest happenings, without entries whose message is gone", async () => {
    const log = [
      { id: "w1", text: "A cart overturns by the bridge.", anchor: { id: "m0", swipe: 0 } },
      { id: "w2", text: "Deleted news.", anchor: { id: "gone", swipe: 0 } },
      { id: "w3", text: "A lantern moves along the river path.", anchor: { id: "m2", swipe: 0 } },
    ];
    await mount([uniChat({ scene: { text: NOTE, lastId: "m2" }, world: { log } })]);
    await click(worldChip());
    const s = sheet();
    expect(s).toBeTruthy();
    expect(s.textContent).toContain("The Mill · Monday, 3 May, evening");
    expect(s.textContent).toContain("rain, 9°C");
    expect(s.textContent).toContain("Rook at the stove, Ana by the door.");

    /* places: the current one marked, the other one can be gone to */
    expect(place("The Mill").dataset.here).toBe("1");
    expect(place("The Mill").textContent).toContain("A wet old mill by the river.");
    expect(place("The Mill").querySelector('[aria-label="Go to The Mill"]')).toBeNull();
    expect(place("Old Bridge").dataset.here).toBeUndefined();
    expect(place("Old Bridge").querySelector('[aria-label="Go to Old Bridge"]')).toBeTruthy();

    /* where everyone is */
    expect(person("Rook").textContent).toContain("here");
    expect(person("Lena").textContent).toContain("at the Old Bridge, waiting for the ferry");
    expect(person("Lena").textContent).not.toMatch(/here$/);
    expect(person("Otto").textContent).toBe("Otto");

    /* lately: newest first, the deleted message's entry left out */
    const items = [...s.querySelectorAll("[data-world-log] li")].map((li) => li.textContent);
    expect(items).toEqual(["A lantern moves along the river path.", "A cart overturns by the bridge."]);
  });

  it("says the world is still coming into focus before the first note, and hides Lately", async () => {
    await mount([uniChat()]);
    await click(worldChip());
    expect(sheet().textContent).toContain("The world comes into focus after a couple of replies.");
    expect(sheet().querySelector("[data-world-log]")).toBeNull();
    expect(place("The Mill").dataset.here).toBeUndefined();
  });

  it("sets a character as the next lead from their row, and toggles the narration", async () => {
    await mount([uniChat({ scene: { text: NOTE, lastId: "m2" } })]);
    await click(worldChip());
    await click(person("Lena"));
    expect(sheet()).toBeNull();
    expect(stripChip("Lena").getAttribute("aria-pressed")).toBe("true");
    /* tapping the same row again keeps them as lead */
    await click(worldChip());
    await click(person("Lena"));
    expect(stripChip("Lena").getAttribute("aria-pressed")).toBe("true");

    await click(worldChip());
    const narrate = [...sheet().querySelectorAll('[role="switch"]')].find((b) => b.textContent.includes("Narrate the next reply"));
    expect(narrate.getAttribute("aria-checked")).toBe("false");
    await click(narrate);
    expect(narrate.getAttribute("aria-checked")).toBe("true");
    expect(stripChip("Narrator").getAttribute("aria-pressed")).toBe("true");
    expect(stripChip("Lena").getAttribute("aria-pressed")).toBe("false");
    await click(narrate);
    expect(narrate.getAttribute("aria-checked")).toBe("false");
    expect(stripChip("Narrator").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Go here", () => {
  it("adds a narrator line and starts exactly one narrated reply with the move instruction", async () => {
    await mount([uniChat({ scene: { text: NOTE, lastId: "m2" } })]);
    /* a character picked on the strip does not take over the move */
    await click(stripChip("Rook"));
    await click(worldChip());
    await click(place("Old Bridge").querySelector('[aria-label="Go to Old Bridge"]'));
    expect(sheet()).toBeNull();
    const msgs = chat().messages;
    const line = msgs.find((m) => m.content === "*Ana heads to Old Bridge.*");
    expect(line).toMatchObject({ role: "system", speaker: "Narrator" });
    expect(msgs.indexOf(line)).toBe(3);
    expect(replies()).toHaveLength(1);
    const prompt = sentText(replies()[0]);
    expect(prompt).toContain("Move the scene to Old Bridge: the arrival, who is there and what is going on there right now.");
    expect(prompt).toContain("world narration only");
    expect(prompt).toContain("Ana heads to Old Bridge.");
    expect(prompt).not.toContain("Reply only as Rook");
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", content: "The scene moves." });
    expect(stripChip("Rook").getAttribute("aria-pressed")).toBe("false");
  });

  it("is disabled while a reply is running", async () => {
    hold = true;
    await mount([uniChat({ scene: { text: NOTE, lastId: "m2" } })]);
    const box = host.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value").set;
    await act(async () => { setter.call(box, "Hello?"); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(host.querySelector('[aria-label="Send"]'));
    expect(replies()).toHaveLength(1);
    await click(worldChip());
    const go = place("Old Bridge").querySelector('[aria-label="Go to Old Bridge"]');
    expect(go.disabled).toBe(true);
    await click(go);
    expect(replies()).toHaveLength(1);
    expect(chat().messages.some((m) => m.content.includes("heads to"))).toBe(false);
    /* once the reply is in, it can be used */
    for (const g of held.splice(0)) g();
    await flush();
    expect(place("Old Bridge").querySelector('[aria-label="Go to Old Bridge"]').disabled).toBe(false);
  });
});
