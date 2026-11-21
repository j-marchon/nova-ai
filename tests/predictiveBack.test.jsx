// @vitest-environment jsdom
/* Predictive back, driven through a fake NovaBack plugin: the app turns the
   plugin on only while there is somewhere to go back to, moves what is on
   top with the gesture, and goes back on commit (or springs back on cancel). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/App.jsx";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host, plugin;

function fakePlugin() {
  const listeners = {};
  return {
    enabled: [],
    setEnabled: vi.fn(function ({ enabled }) { this.enabled.push(enabled); return Promise.resolve(); }),
    addListener(name, fn) { (listeners[name] ||= []).push(fn); return Promise.resolve({ remove() {} }); },
    emit(name, data) { for (const fn of listeners[name] || []) fn(data); },
  };
}

const flush = async (n = 12) => {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const current = () => host.querySelector('nav button[aria-current="page"]')?.textContent.trim();
const navTo = async (label) => {
  const b = [...host.querySelectorAll("nav button")].find((x) => x.textContent.trim() === label);
  await act(async () => b.click());
  await flush();
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  plugin = fakePlugin();
  window.Capacitor = { Plugins: { NovaBack: plugin } };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.Capacitor;
});

describe("predictive back", () => {
  it("is on only while there is somewhere to go back to", async () => {
    expect(plugin.enabled.at(-1)).toBe(false);
    await navTo("Settings");
    expect(plugin.enabled.at(-1)).toBe(true);
    await navTo("Create");
    expect(plugin.enabled.at(-1)).toBe(false);
  });

  it("moves the tab with the gesture and goes back to Create on commit", async () => {
    await navTo("Chats");
    expect(current()).toBe("Chats");
    act(() => plugin.emit("start", { progress: 0.1 }));
    act(() => plugin.emit("progress", { progress: 0.5 }));
    const tab = [...host.querySelectorAll(".nv-tab")].find((d) => d.style.transform);
    expect(tab.style.transform).toContain("translate");
    act(() => plugin.emit("commit"));
    await wait(250);
    await flush();
    expect(current()).toBe("Create");
    expect([...host.querySelectorAll(".nv-tab")].every((d) => !d.style.transform)).toBe(true);
  });

  it("springs back on cancel and stays where it was", async () => {
    await navTo("Settings");
    act(() => plugin.emit("start", { progress: 0 }));
    act(() => plugin.emit("progress", { progress: 0.6 }));
    act(() => plugin.emit("cancel"));
    await wait(260);
    await flush();
    expect(current()).toBe("Settings");
    expect([...host.querySelectorAll(".nv-tab")].every((d) => !d.style.transform)).toBe(true);
  });

  it("closes an open sheet first, and is on while one is open", async () => {
    expect(current()).toBe("Create");
    expect(plugin.enabled.at(-1)).toBe(false);
    /* any sheet: one opened beside the app, as a page would open one */
    const { Modal } = await import("../src/components/ui.jsx");
    function Sheet() {
      const [on, setOn] = React.useState(true);
      return on ? <Modal title="A sheet" onClose={() => setOn(false)}><p>inside</p></Modal> : null;
    }
    const other = document.createElement("div");
    document.body.appendChild(other);
    const r2 = createRoot(other);
    await act(async () => r2.render(<Sheet />));
    await flush();
    const open = () => !!document.querySelector(".nv-sheet");
    expect(open()).toBe(true);
    expect(plugin.enabled.at(-1)).toBe(true);
    act(() => plugin.emit("start", { progress: 0 }));
    act(() => plugin.emit("progress", { progress: 0.7 }));
    expect(document.querySelector(".nv-sheet").style.transform).toContain("translate");
    act(() => plugin.emit("commit"));
    await wait(250);
    await flush();
    expect(open()).toBe(false);
    expect(current()).toBe("Create");
    expect(plugin.enabled.at(-1)).toBe(false);
    act(() => r2.unmount());
    other.remove();
  });

  it("shows the tab a chat came from under it, and returns there", async () => {
    act(() => root.unmount());
    const { saveData, resetStorageForTests: reset } = await import("../src/lib/storage.js");
    const { emptyData } = await import("../src/lib/data.js");
    reset();
    await saveData({
      ...JSON.parse(JSON.stringify(emptyData)),
      characters: [{ id: "c1", name: "Aria", greetings: [{ id: "g", text: "Hi" }] }],
      chats: [{ id: "k1", kind: "character", characterId: "c1", personaId: "", createdAt: 1, updatedAt: 1, messages: [{ id: "m1", role: "assistant", content: "Hi" }] }],
    });
    reset();
    root = createRoot(host);
    await act(async () => root.render(<App />));
    await flush();
    await navTo("Chats");
    await act(async () => host.querySelector(".nv-hold").click());
    /* the chat is its own chunk: wait for it to load */
    for (let i = 0; i < 100 && !host.querySelector(".nv-chat-root"); i++) await wait(20);
    expect(host.querySelector(".nv-chat-root")).toBeTruthy();
    const chatsTab = () => [...host.querySelectorAll(".nv-tab")].find((d) => d.textContent.includes("Aria") && d.querySelector(".nv-hold"));
    act(() => plugin.emit("start", { progress: 0 }));
    await flush();
    act(() => plugin.emit("progress", { progress: 0.5 }));
    expect(host.querySelector(".nv-chat-root").style.transform).toContain("scale");
    /* the Chats tab is shown under the chat while peeking */
    expect(chatsTab()?.parentElement && getComputedStyle(chatsTab()).display).not.toBe("none");
    act(() => plugin.emit("commit"));
    await wait(250);
    await flush();
    expect(host.querySelector(".nv-chat-root")).toBeNull();
    expect(current()).toBe("Chats");
  });

  it("goes back without a gesture (three-button navigation)", async () => {
    await navTo("Settings");
    act(() => plugin.emit("commit"));
    await flush();
    expect(current()).toBe("Create");
  });
});
