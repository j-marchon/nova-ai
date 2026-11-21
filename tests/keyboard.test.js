// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { anchorTranscript, watchKeyboard } from "../src/lib/keyboard.js";
let cleanup;
afterEach(() => { cleanup?.(); cleanup = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const inset = () => Number.parseFloat(document.documentElement.style.getPropertyValue("--kb"));
describe("keyboard clearance", () => {
  it("clears only the overlap remaining after native resize, in either event order", () => {
    const listeners = {};
    vi.stubGlobal("Capacitor", { Plugins: { Keyboard: { addListener: (name, callback) => { listeners[name] = callback; return { remove() {} }; } } } });
    vi.stubGlobal("innerHeight", 844);
    cleanup = watchKeyboard();
    listeners.keyboardWillShow({ keyboardHeight: 300 });
    expect(inset()).toBe(300);
    vi.stubGlobal("innerHeight", 544);
    window.dispatchEvent(new Event("resize"));
    expect(inset()).toBe(0);
    expect(document.documentElement.dataset.kb).toBe("1");
    listeners.keyboardDidShow({ keyboardHeight: 300 });
    expect(inset()).toBe(0);
    listeners.keyboardWillHide();
    vi.stubGlobal("innerHeight", 844);
    window.dispatchEvent(new Event("resize"));
    listeners.keyboardDidHide();
    expect(inset()).toBe(0);
    expect(document.documentElement.dataset.kb).toBeUndefined();
    // Some Android versions resize before delivering keyboardWillShow.
    vi.stubGlobal("innerHeight", 644);
    window.dispatchEvent(new Event("resize"));
    listeners.keyboardWillShow({ keyboardHeight: 300 });
    expect(inset()).toBe(100);
  });
  it("follows a browser visual viewport without moving the document", () => {
    vi.stubGlobal("Capacitor", undefined);
    vi.stubGlobal("innerHeight", 844);
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 544, offsetTop: 0 });
    vi.stubGlobal("visualViewport", viewport);
    cleanup = watchKeyboard();
    viewport.dispatchEvent(new Event("resize"));
    expect(inset()).toBe(300);
    viewport.height = 844;
    viewport.dispatchEvent(new Event("resize"));
    expect(inset()).toBe(0);
    expect(document.documentElement.dataset.kb).toBeUndefined();
  });
  it("announces a change before and after --kb moves, once per height", () => {
    const listeners = {};
    vi.stubGlobal("Capacitor", { Plugins: { Keyboard: { addListener: (name, callback) => { listeners[name] = callback; return { remove() {} }; } } } });
    vi.stubGlobal("innerHeight", 844);
    cleanup = watchKeyboard();
    const seen = [];
    const will = (e) => seen.push(["will", e.detail.height, e.detail.from, inset() || 0]);
    const did = (e) => seen.push(["did", e.detail.height, e.detail.from, inset()]);
    window.addEventListener("nova-kb-will", will);
    window.addEventListener("nova-kb", did);
    listeners.keyboardWillShow({ keyboardHeight: 300 });
    listeners.keyboardDidShow({ keyboardHeight: 300 });
    listeners.keyboardWillHide();
    window.removeEventListener("nova-kb-will", will);
    window.removeEventListener("nova-kb", did);
    expect(seen).toEqual([["will", 300, 0, 0], ["did", 300, 0, 300], ["will", 0, 300, 300], ["did", 0, 300, 0]]);
  });
  it("marks a keyboard opened for an edit in place until another field takes the focus", () => {
    vi.stubGlobal("Capacitor", undefined);
    cleanup = watchKeyboard();
    const edit = document.createElement("div");
    edit.className = "nv-edit-box";
    const field = document.createElement("textarea");
    edit.append(field);
    const composer = document.createElement("textarea");
    document.body.append(edit, composer);
    field.focus();
    expect(document.documentElement.dataset.kbFor).toBe("edit");
    field.blur();
    expect(document.documentElement.dataset.kbFor).toBe("edit");
    composer.focus();
    expect(document.documentElement.dataset.kbFor).toBeUndefined();
    edit.remove(); composer.remove();
  });
  it("carries what was above the message box up with the keyboard and back down", () => {
    const list = document.createElement("div");
    list.append(document.createElement("div"));
    document.body.append(list);
    let pad = 24;
    let top = 500;
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ paddingBottom: `${pad}px` }));
    Object.defineProperties(list, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 2000 + pad },
      scrollTop: { configurable: true, get: () => top, set: (v) => { top = Math.max(0, Math.min(v, 2000 + pad - 600)); } },
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const stop = anchorTranscript(list);
    const kb = (height, from, nextPad) => {
      window.dispatchEvent(new CustomEvent("nova-kb-will", { detail: { height, from } }));
      pad = nextPad;
      window.dispatchEvent(new CustomEvent("nova-kb", { detail: { height, from } }));
    };
    kb(300, 0, 300);
    expect(top).toBe(776);
    kb(0, 300, 24);
    expect(top).toBe(500);
    stop(); list.remove();
  });
});
