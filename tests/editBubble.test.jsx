// @vitest-environment jsdom
/* Editing a message: the field holds the saved text exactly as written
   (no display scripts, no rendered HTML), saving it untouched is no edit,
   hidden notes go back on, and on a phone the confirm floats over the text. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableBubble } from "../src/pages/chat/bubbles.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root = null;
let host = null;
const realMatch = window.matchMedia;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; window.matchMedia = realMatch; });

const open = (text, handlers) => {
  host = document.createElement("div");
  host.className = "nv-root";
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<EditableBubble text={text} onSave={handlers.onSave || (() => {})} onCancel={handlers.onCancel || (() => {})} />));
};
const press = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

const raw = '<details><summary>Tracker</summary>Mood= calm</details>\n*She smiles.* <pink>"Hi."</pink>';

describe("editing a message", () => {
  it("shows the raw text, and saving it untouched changes nothing", () => {
    const onSave = vi.fn();
    open(`${raw}\n\n<!-- scene: rooftop -->`, { onSave });
    const field = document.querySelector('textarea[aria-label="Edit message"]');
    expect(field.value).toBe(raw);
    expect(document.querySelector(".nv-edit-box details, .nv-edit-box .nv-pv")).toBeNull();
    press(document.querySelector('[aria-label="Save edit"]'));
    expect(onSave).toHaveBeenCalledWith(`${raw}\n\n<!-- scene: rooftop -->`, false);
  });

  it("hints at double-click on a desktop", () => {
    open("Hello.", {});
    expect(document.querySelector(".nv-edit-tip").textContent).toContain("Double-click a message to edit it");
    expect(document.querySelector(".nv-edit-float")).toBeNull();
  });

  it("floats a check and a cross over the text on a phone", () => {
    window.matchMedia = (q) => ({ matches: q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} });
    const onSave = vi.fn();
    const onCancel = vi.fn();
    open("Hello.", { onSave, onCancel });
    expect(document.querySelector(".nv-edit-tip").textContent).toContain("Double-tap a message to edit it");
    const bar = document.querySelector(".nv-edit-float");
    expect(bar).not.toBeNull();
    expect(document.querySelectorAll('[aria-label="Save edit"]')).toHaveLength(1);
    press(bar.querySelector('[aria-label="Cancel edit"]'));
    expect(onCancel).toHaveBeenCalled();
    press(bar.querySelector('[aria-label="Save edit"]'));
    expect(onSave).toHaveBeenCalledWith("Hello.", false);
  });
});
