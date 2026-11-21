// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/App.jsx";
import { emptyData } from "../src/lib/data.js";
import { loadData } from "../src/lib/storage.js";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { createStreamStore } from "../src/pages/chat/streamStore.js";
import { gsap, settleMotion } from "../src/components/motion/runtime.js";

vi.mock("../src/lib/storage.js", async (original) => ({
  ...await original(), loadData: vi.fn(), askForPersistence: vi.fn(), saveData: vi.fn(async () => {}),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
beforeEach(async () => {
  clearActivity();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const data = structuredClone(emptyData);
  data.settings.dailyBackup = false;
  data.appearance.motion = "off";
  data.characters = [{ id: "ada", name: "Ada", greetings: [] }];
  data.chats = ["c1", "c2"].map(id => ({ id, kind: "character", characterId: "ada", messages: [{ id: `m-${id}`, role: "assistant", content: `Greeting for ${id}` }] }));
  loadData.mockResolvedValue(data);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    await import("../src/pages/ChatPage.jsx");
    root.render(<App />);
  });
  await flush();
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const open = async (owner) => {
  await act(async () => { clearActivity(); startActivity({ kind: "Reply", label: "Navigation test", owner }); });
  await act(async () => host.querySelector('.nv-activity [aria-label="Open Navigation test"]').click());
  await flush();
  if (owner.chatId) await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(host.querySelector('.nv-chat-root'), host.textContent).not.toBeNull();
  }, { timeout: 5000 });
};

it("opens chat jobs from a tab and switches chats", async () => {
  await open({ chatId: "c1" });
  expect(host.querySelector('.nv-chat-root').textContent).toContain("Greeting for c1");
  await open({ chatId: "c2" });
  expect(host.querySelector('.nv-chat-root').textContent).toContain("Greeting for c2");
  expect(host.querySelector('.nv-chat-root').textContent).not.toContain("Greeting for c1");
});

it("hides the real reply on its chat, leaves other shown work visible, keeps side work quiet, and restores it after leaving", async () => {
  await open({ chatId: "c1" });
  let reply;
  const stream = createStreamStore();
  stream.set({ kind: "generate", text: "Visible streaming output" });
  await act(async () => {
    clearActivity();
    reply = startActivity({ kind: "reply", label: "Focused reply", owner: { chatId: "c1" }, stream });
    startActivity({ kind: "memory", label: "Background memory", owner: { chatId: "c1" }, quiet: true });
    startActivity({ kind: "Card Studio · Character", label: "Background card", owner: { cardKind: "characters", itemId: null } });
  });
  expect(host.querySelector(".nv-chat-root").textContent).toContain("Visible streaming output");
  expect(host.querySelector(".nv-activity").textContent).toContain("Background card");
  expect(host.querySelector(".nv-activity").textContent).not.toContain("Background memory");
  expect(activity.get().some(j => j.label === "Background memory")).toBe(true);
  expect(host.querySelector(".nv-activity").textContent).not.toContain("Focused reply");
  expect(activity.get().find(j => j.id === reply.id).focused).toBe(true);
  await act(async () => host.querySelector('[aria-label="Go back"]').click());
  await flush();
  expect(activity.get().find(j => j.id === reply.id).focused).toBe(false);
  expect(reply.signal.aborted).toBe(false);
  await act(async () => host.querySelector('.nv-activity [aria-expanded]').click());
  await act(async () => host.querySelector('[aria-label="Open Focused reply"]').click());
  await flush();
  expect(activity.get().find(j => j.id === reply.id).focused).toBe(true);
  expect(host.querySelector(".nv-activity").textContent).not.toContain("Focused reply");
});

/* Card Studio jobs reopen their own card, and never drop another form's edits unasked */
const tapJob = async (label, owner, result, wait = true) => {
  let h;
  await act(async () => { h = startActivity({ kind: "Card Studio", label, owner }); if (result) h.done(result); });
  await clickJob(label, wait);
  return h;
};
async function clickJob(label, wait = true) {
  const sel = `.nv-activity [aria-label="Open ${label}"]`;
  if (!host.querySelector(sel)) await act(async () => host.querySelector(".nv-activity [aria-expanded]").click());
  await act(async () => host.querySelector(sel).click());
  await flush();
  if (wait) await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(studioPanel()).not.toBeNull();
  }, { timeout: 4000 });
}
const studioPanel = () => document.querySelector('section[aria-label^="Card studio · "]');
const collapse = async () => { await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Card studio")).click()); await flush(); };
const useHeld = async () => { await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Use it").click()); await flush(); };
const closeTop = async () => { await act(async () => [...document.querySelectorAll('[aria-label="Close"]')].at(-1).click()); await flush(); };
const inputs = () => [...document.querySelectorAll("input")];
const typeIn = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
};

it("a rewrite of an existing character reopens that character, not a new form", async () => {
  await tapJob("Rewrite Ada", { cardKind: "characters", itemId: "ada" }, { name: "Ada Prime", description: "Rewritten." });
  expect(document.querySelector('[role="dialog"][aria-label="Edit character"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"][aria-label="New character"]')).toBeNull();
  await useHeld();
  expect(inputs().some((i) => i.value === "Ada Prime")).toBe(true);
});

it("a new-card result does not hydrate an existing card's studio", async () => {
  await tapJob("Rewrite Ada", { cardKind: "characters", itemId: "ada" });
  await closeTop();
  await act(async () => { startActivity({ owner: { cardKind: "characters", itemId: null } }).done({ name: "Stranger" }); });
  await tapJob("Rewrite Ada again", { cardKind: "characters", itemId: "ada" }, { name: "Ada Two" });
  await useHeld();
  expect(inputs().some((i) => i.value === "Stranger")).toBe(false);
  expect(inputs().some((i) => i.value === "Ada Two")).toBe(true);
});

it("asks before replacing a form with unsaved edits, and only signals a form that is already the job's", async () => {
  await tapJob("New persona job", { cardKind: "personas", itemId: null });
  await collapse();
  await typeIn(inputs().find((i) => i.placeholder === "What characters should call you"), "Unsaved name");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  // Keep it running: this checks navigation guards, not the completion linger timer.
  await tapJob("Universe job", { cardKind: "universes", itemId: null }, undefined, false);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("New persona");
  expect(inputs().some((i) => i.value === "Unsaved name")).toBe(true);
  /* the persona job is the open form's own: no question, no lost text */
  await clickJob("New persona job");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(studioPanel()?.getAttribute("aria-label")).toBe("Card studio · persona");
  await collapse();
  expect(inputs().some((i) => i.value === "Unsaved name")).toBe(true);
  confirm.mockReturnValue(true);
  await clickJob("Universe job");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(studioPanel()?.getAttribute("aria-label")).toBe("Card studio · universe");
});
