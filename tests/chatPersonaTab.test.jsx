// @vitest-environment jsdom
/* The chat settings sheet's Persona tab, in the whole app: the personas are
   listed and picked in place, Edit and New open the Create tab's persona
   form over the sheet and come back to it, and Remove goes through the same
   delete (lib/removal.js) as the Create tab, with Undo. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.jsx";
import { emptyData } from "../src/lib/data.js";
import { loadData, saveData } from "../src/lib/storage.js";
import { clearActivity, startActivity } from "../src/lib/activity.js";
import { clearToasts, toasts } from "../src/lib/toast.js";
import { gsap, settleMotion } from "../src/components/motion/runtime.js";
import { removalPatch } from "../src/lib/removal.js";

vi.mock("../src/lib/storage.js", async (original) => ({
  ...await original(), loadData: vi.fn(), askForPersistence: vi.fn(), saveData: vi.fn(async () => {}),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const buttons = () => [...document.querySelectorAll("button")];
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
const row = (name) => buttons().find((b) => b.hasAttribute("aria-pressed") && b.closest("[data-inverted], .nv-glass") && b.textContent.startsWith(name));
const click = async (el) => { expect(el, "element to click").toBeTruthy(); await act(async () => el.click()); await flush(); };
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
};
/* what the app last saved, once the save debounce has passed */
const saved = async () => { await wait(400); return saveData.mock.calls.at(-1)?.[0]; };

beforeEach(async () => {
  clearActivity(); clearToasts(); saveData.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const data = structuredClone(emptyData);
  data.username = "Ana";
  data.settings.dailyBackup = false;
  data.appearance.motion = "off";
  data.characters = [{ id: "ada", name: "Ada", greetings: [] }];
  data.personas = [
    { id: "p1", name: "Edda", description: "A lighthouse keeper.\nQuiet.", avatar: "" },
    { id: "p2", name: "Bram", description: "", avatar: "" },
  ];
  data.chats = [
    { id: "c1", kind: "character", characterId: "ada", personaId: "", messages: [{ id: "m1", role: "assistant", content: "Hello." }] },
    { id: "c2", kind: "character", characterId: "ada", personaId: "p1", messages: [{ id: "m2", role: "assistant", content: "Again." }] },
  ];
  loadData.mockResolvedValue(data);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { await import("../src/pages/ChatPage.jsx"); await import("../src/components/forms.jsx"); root.render(<App />); });
  await flush();
  /* into chat c1 through the activity island, as activityOpen.test does */
  await act(async () => { startActivity({ kind: "Reply", label: "Go", owner: { chatId: "c1" } }); });
  await act(async () => host.querySelector('.nv-activity [aria-label="Open Go"]').click());
  await vi.waitFor(async () => { await wait(20); expect(host.querySelector(".nv-chat-root")).not.toBeNull(); }, { timeout: 5000 });
  await act(async () => clearActivity());
  await flush();
  await click(byLabel("Chat settings"));
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

const chatOf = (d, id = "c1") => d.chats.find((c) => c.id === id);

describe("chat Persona tab", () => {
  it("lists every persona in place, with no Change persona button", async () => {
    expect(buttons().some((b) => b.textContent.includes("Change persona"))).toBe(false);
    expect(document.body.textContent).not.toContain("Play as");
    expect(row("Edda")).toBeTruthy();
    expect(row("Edda").textContent).toContain("A lighthouse keeper.");
    expect(row("Edda").textContent).not.toContain("Quiet.");
    expect(row("Bram")).toBeTruthy();
    expect(document.body.textContent).toContain("Playing as yourself");
    expect(byLabel("Edit Edda")).toBeTruthy();
    expect(byLabel("Delete Edda")).toBeTruthy();
  });

  it("tapping a persona plays as it in this chat, and tapping it again goes back to yourself", async () => {
    await click(row("Edda"));
    expect(row("Edda").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Playing as yourself");
    expect(chatOf(await saved()).personaId).toBe("p1");
    await click(row("Bram"));
    expect(row("Bram").getAttribute("aria-pressed")).toBe("true");
    expect(row("Edda").getAttribute("aria-pressed")).toBe("false");
    await click(row("Bram"));
    /* playing as yourself asks for this chat's name first */
    await vi.waitFor(() => expect(document.body.textContent).toContain("Your name in this chat"));
    await type(document.querySelector("input[aria-label='Your name']"), "Kit");
    await click(buttons().filter((b) => b.textContent.trim() === "Use").at(-1));
    await vi.waitFor(() => expect(row("Bram").getAttribute("aria-pressed")).toBe("false"));
    expect(document.body.textContent).toContain("Playing as yourself: Kit");
    const d = await saved();
    expect(chatOf(d).personaId).toBe("");
    expect(chatOf(d).userName).toBe("Kit");
    expect(chatOf(d, "c2").personaId).toBe("p1");
  });

  it("Edit opens the persona form over the sheet and comes back to it, edit applied and still selected", async () => {
    await click(row("Edda"));
    await click(byLabel("Edit Edda"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Edit persona"));
    const name = [...document.querySelectorAll("input")].find((i) => i.value === "Edda");
    await type(name, "Edda Vane");
    await click(buttons().filter((b) => b.textContent.trim() === "Save").at(-1));
    await wait(400);
    expect(document.body.textContent).not.toContain("Edit persona");
    expect(host.querySelector(".nv-chat-root")).not.toBeNull();
    expect(row("Edda Vane").getAttribute("aria-pressed")).toBe("true");
    const d = await saved();
    expect(d.personas.find((p) => p.id === "p1").name).toBe("Edda Vane");
    expect(chatOf(d).personaId).toBe("p1");

    /* closing without saving comes back too, nothing changed */
    await click(byLabel("Edit Bram"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Edit persona"));
    await click([...document.querySelectorAll('[aria-label="Close"]')].at(-1));
    await wait(400);
    expect(document.body.textContent).not.toContain("Edit persona");
    expect(row("Bram")).toBeTruthy();
    expect(row("Edda Vane").getAttribute("aria-pressed")).toBe("true");
  });

  it("New persona opens the form and the saved persona becomes this chat's", async () => {
    await click(buttons().find((b) => b.textContent.trim() === "New persona"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("New persona"));
    const name = [...document.querySelectorAll("input")].find((i) => i.placeholder === "What characters should call you");
    await type(name, "Cleo");
    await click(buttons().filter((b) => b.textContent.trim() === "Save").at(-1));
    await wait(400);
    expect(row("Cleo").getAttribute("aria-pressed")).toBe("true");
    const d = await saved();
    const cleo = d.personas.find((p) => p.name === "Cleo");
    expect(cleo).toBeTruthy();
    expect(chatOf(d).personaId).toBe(cleo.id);
  });

  it("Remove deletes the persona the Create-tab way, and Undo restores it and this chat's choice", async () => {
    await click(row("Edda"));
    await click(byLabel("Delete Edda"));
    await click(byLabel("Confirm delete Edda"));
    expect(row("Edda")).toBeFalsy();
    expect(document.body.textContent).toContain("Playing as yourself");
    let d = await saved();
    expect(d.personas.map((p) => p.id)).toEqual(["p2"]);
    const undo = toasts.get().find((t) => t.undo);
    expect(undo.text).toBe("Edda deleted");
    await act(async () => undo.undo());
    await flush();
    expect(row("Edda").getAttribute("aria-pressed")).toBe("true");
    d = await saved();
    expect(d.personas.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(chatOf(d).personaId).toBe("p1");
    expect(chatOf(d, "c2").personaId).toBe("p1");
  });
});

describe("removalPatch", () => {
  it("drops a persona without touching chats, and a lorebook from the chats that use it", () => {
    const d = { personas: [{ id: "p1" }, { id: "p2" }], lorebooks: [{ id: "b" }], chats: [{ id: "c", personaId: "p1", lorebookIds: ["b", "x"] }], characters: [] };
    expect(removalPatch(d, "personas", "p1")).toEqual({ personas: [{ id: "p2" }] });
    expect(removalPatch(d, "lorebooks", "b").chats[0].lorebookIds).toEqual(["x"]);
  });
});
