// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PickRow } from "../src/components/ui.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(el) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return host;
}

describe("PickRow", () => {
  it("selected row is inverted, actions are sibling buttons with inverted colour", () => {
    const onPick = vi.fn(), onEdit = vi.fn(), onRemove = vi.fn();
    const host = mount(<PickRow on onPick={onPick} title="Noir" sub="Moody" onEdit={onEdit} onRemove={onRemove} editLabel="Noir" />);
    const row = host.firstChild;
    expect(row.getAttribute("data-inverted")).toBe("1");
    const btns = [...host.querySelectorAll("button")];
    expect(btns.length).toBe(3);
    expect(btns.every((b) => b.parentElement === row)).toBe(true);
    const edit = host.querySelector('[aria-label="Edit Noir"]');
    expect(edit.style.color).toBe("var(--nv-bg)");
    act(() => edit.click());
    expect(onEdit).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    const del = host.querySelector('[aria-label="Delete Noir"]');
    act(() => del.click());
    expect(onRemove).not.toHaveBeenCalled();
    act(() => host.querySelector('[aria-label="Confirm delete Noir"]').click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    act(() => btns[0].click());
    expect(onPick).toHaveBeenCalledTimes(1);
  });
  it("unselected row is not inverted and has no check", () => {
    const host = mount(<PickRow title="A" onPick={() => {}} />);
    expect(host.firstChild.getAttribute("data-inverted")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("button").getAttribute("aria-pressed")).toBe("false");
  });
});
