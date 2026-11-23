// @vitest-environment jsdom
/* The overlap pop-up: Apply hands back the parts left on and whether they
   go off for every chat. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryConflict } from "../src/components/MemoryConflict.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root = null;
let host = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; });

const open = (onApply) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(
    <MemoryConflict styleName="Shiro" conflicts={[{ part: "scene", why: "Writes its own tracker" }, { part: "summary", why: "Keeps its own summary" }]} onApply={onApply} onKeep={() => {}} />,
  ));
};
const press = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const byText = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

describe("overlap pop-up", () => {
  it("applies to this chat by default", () => {
    const onApply = vi.fn();
    open(onApply);
    press(byText("Apply"));
    expect(onApply).toHaveBeenCalledWith(["scene", "summary"], false);
  });

  it("can turn the parts off for all chats", () => {
    const onApply = vi.fn();
    open(onApply);
    const all = document.querySelector('[role="checkbox"]');
    expect(all.textContent).toContain("Turn off for all chats");
    expect(all.getAttribute("aria-checked")).toBe("false");
    press(all);
    expect(all.getAttribute("aria-checked")).toBe("true");
    press(document.querySelector('[role="switch"]'));
    press(byText("Apply"));
    expect(onApply).toHaveBeenCalledWith(["summary"], true);
  });
});
