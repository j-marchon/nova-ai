// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Plus } from "lucide-react";
import { AccBtn, Button, MoreBtn } from "../src/components/ui.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(el) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return host;
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("Button", () => {
  it("maps variant and size to classes and keeps className", () => {
    const host = mount(<>
      <Button>Plain</Button>
      <Button variant="primary" size="lg" className="w-full">Go</Button>
      <Button variant="ghost" size="sm">Ghost</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="icon" icon={Plus} aria-label="Add" />
    </>);
    const [plain, primary, ghost, danger, icon] = host.querySelectorAll("button");
    expect(plain.className).toBe("nv-btn nv-btn--secondary");
    expect(primary.classList.contains("nv-btn--primary")).toBe(true);
    expect(primary.classList.contains("nv-primary")).toBe(true);
    expect(primary.classList.contains("nv-btn--lg")).toBe(true);
    expect(primary.classList.contains("w-full")).toBe(true);
    expect(ghost.classList.contains("nv-btn--ghost")).toBe(true);
    expect(ghost.classList.contains("nv-btn--sm")).toBe(true);
    expect(danger.classList.contains("nv-btn--danger")).toBe(true);
    expect(icon.classList.contains("nv-btn--icon")).toBe(true);
    expect(icon.querySelector("svg.nv-btn-icon")).not.toBeNull();
    expect(plain.querySelector(".nv-btn-label").textContent).toBe("Plain");
  });

  it("selected sets the inverted state", () => {
    const host = mount(<><Button selected>On</Button><Button>Off</Button></>);
    const [on, off] = host.querySelectorAll("button");
    expect(on.getAttribute("data-inverted")).toBe("1");
    expect(on.style.background).toBe("var(--nv-ink)");
    expect(off.hasAttribute("data-inverted")).toBe(false);
  });

  it("nudge writes the optical offset", () => {
    const host = mount(<Button icon={Plus} nudge={1.5}>Play</Button>);
    const b = host.querySelector("button");
    expect(b.hasAttribute("data-nudge")).toBe(true);
    expect(b.style.getPropertyValue("--nv-btn-nudge")).toBe("1.5px");
  });

  it("honours disabled", () => {
    const onClick = vi.fn();
    const host = mount(<Button disabled onClick={onClick}>No</Button>);
    const b = host.querySelector("button");
    expect(b.disabled).toBe(true);
    act(() => b.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("warns in dev for an icon-only button without a label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(<Button variant="icon" icon={Plus} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aria-label"));
    warn.mockClear();
    mount(<Button variant="icon" icon={Plus} aria-label="Add" />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("AccBtn and MoreBtn are Buttons", () => {
    const onMore = vi.fn(), onParent = vi.fn();
    const host = mount(<div onClick={onParent}><AccBtn>Save</AccBtn><MoreBtn onClick={onMore} label="Chat options"><Plus /></MoreBtn></div>);
    const [acc, more] = host.querySelectorAll("button");
    expect(acc.classList.contains("nv-btn--primary")).toBe(true);
    expect(more.classList.contains("nv-btn--icon")).toBe(true);
    expect(more.getAttribute("aria-label")).toBe("Chat options");
    act(() => more.click());
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onParent).not.toHaveBeenCalled();
  });
});

describe("Button labels", () => {
  it("keeps a run of text in one label", () => {
    const n = 3;
    const host = mount(<Button>Show more ({n} left)</Button>);
    const labels = host.querySelectorAll(".nv-btn-label");
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toBe("Show more (3 left)");
  });
});
