// @vitest-environment jsdom
/* The update dialog is not closed by a tap beside it (it appears a moment
   after launch, so a tap meant for the page used to dismiss it unseen); Later
   still closes it. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "../src/components/UpdateDialog.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root = null;
let host = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; });

const render = (node) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
};
const press = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("update dialog", () => {
  it("stays open when the area beside it is tapped", () => {
    const onLater = vi.fn();
    render(<UpdateDialog detail="Nova 9.9.9" prepare={async () => {}} install={async () => {}} onLater={onLater} />);
    press(document.querySelector(".nv-scrim"));
    expect(onLater).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("Later still closes it", () => {
    const onLater = vi.fn();
    render(<UpdateDialog detail="Nova 9.9.9" prepare={async () => {}} install={async () => {}} onLater={onLater} />);
    press([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Later"));
    expect(onLater).toHaveBeenCalledTimes(1);
  });
});
