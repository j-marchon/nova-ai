// @vitest-environment jsdom
/* The Create tab's header: New as the main action, a labelled Group chat,
   a folded search, and a folded card-size control with three sizes. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreatePage, CARD_SIZES } from "../src/pages/CreatePage.jsx";
import { emptyData } from "../src/lib/data.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;
beforeEach(() => {
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const char = (id, name, description = "") => ({ id, name, description, greetings: [], avatar: "" });
function seed({ characters = [char("c1", "Mira", "A thief."), char("c2", "Tom", "A guard.")], cardSize } = {}) {
  const d = JSON.parse(JSON.stringify(emptyData));
  d.characters = characters;
  d.chats = [{ id: "x" }];
  if (cardSize !== undefined) d.appearance = { ...d.appearance, cardSize };
  return d;
}
function Harness({ initial, edits = [], groups = [] }) {
  const [data, setData] = useState(initial);
  const update = (p) => setData((prev) => (typeof p === "function" ? p(prev) : { ...prev, ...p }));
  Harness.data = data;
  return <CreatePage data={data} update={update} onEdit={(t, i) => edits.push([t, i])} startChat={() => {}} startGroupChat={(g) => groups.push(g)} openChat={() => {}} />;
}
const mount = async (el) => { await act(async () => root.render(el)); await flush(); };
const $ = (sel) => host.querySelector(sel);
const byLabel = (label) => $(`[aria-label="${label}"]`);
const buttonText = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const key = async (el, k) => {
  await act(async () => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
  await flush();
};
const names = () => [...host.querySelectorAll("[data-chat-card] p")].map((p) => p.textContent);

describe("Create tab header", () => {
  it("keeps the two larger card sizes and reads an old or unknown size as large", async () => {
    expect(Object.keys(CARD_SIZES)).toEqual(["large", "xl"]);
    for (const old of ["xs", "small", "constructor"]) {
      await mount(<Harness initial={seed({ cardSize: old })} />);
      expect(host.querySelector('[aria-label^="Card size: large."]')).toBeTruthy();
      expect($(".grid-cols-2")).toBeTruthy();
    }
  });

  it("flips between the two sizes with one button, never unfolding a row", async () => {
    await mount(<Harness initial={seed({ cardSize: "large" })} />);
    const toggle = host.querySelector('[aria-label^="Card size: large."]');
    expect(toggle.getAttribute("aria-label")).toBe("Card size: large. Switch to largest cards");
    expect(host.querySelector('[role="radiogroup"][aria-label="Card size"]')).toBeNull();
    await click(toggle);
    expect(Harness.data.appearance.cardSize).toBe("xl");
    expect($(".grid-cols-1")).toBeTruthy();
    expect(host.querySelector('[role="radiogroup"][aria-label="Card size"]')).toBeNull();
    await click(host.querySelector('[aria-label^="Card size: largest."]'));
    expect(Harness.data.appearance.cardSize).toBe("large");
  });

  it("keeps the description switch", async () => {
    await mount(<Harness initial={seed()} />);
    const info = byLabel("Card descriptions");
    expect(info.getAttribute("aria-pressed")).toBe("true");
    await click(info);
    expect(Harness.data.appearance.cardDesc).toBe(false);
    expect(byLabel("Card descriptions").getAttribute("aria-pressed")).toBe("false");
  });

  it("unfolds search, filters, and folds clearing the query", async () => {
    await mount(<Harness initial={seed()} />);
    expect($('input[aria-label^="Search"]')).toBeNull();
    const open = byLabel("Search characters");
    expect(open.tagName).toBe("BUTTON");
    await click(open);
    const field = $('input[aria-label^="Search"]');
    expect(field).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(field.placeholder).toBe("Search characters");
    await type(field, "thief");
    await flush();
    expect(names()).toContain("Mira");
    expect(names()).not.toContain("Tom");
    await click(byLabel("Close search"));
    expect($('input[aria-label^="Search"]')).toBeNull();
    expect(names()).toEqual(expect.arrayContaining(["Mira", "Tom"]));

    /* Escape does the same; switching tabs clears and folds it too */
    await click(byLabel("Search characters"));
    await type($('input[aria-label^="Search"]'), "tom");
    await key($('input[aria-label^="Search"]'), "Escape");
    expect($('input[aria-label^="Search"]')).toBeNull();
    expect(names()).toEqual(expect.arrayContaining(["Mira", "Tom"]));
    await click(byLabel("Search characters"));
    await type($('input[aria-label^="Search"]'), "tom");
    await click([...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.startsWith("Universes")));
    expect($('input[aria-label^="Search"]')).toBeNull();
    expect(byLabel("Search universes")).toBeTruthy();
  });

  it("labels Group chat, opens the group sheet, and disables it below two characters", async () => {
    const groups = [];
    await mount(<Harness initial={seed()} groups={groups} />);
    const group = buttonText("Group chat");
    expect(group).toBeTruthy();
    expect(group.disabled).toBe(false);
    await click(group);
    expect(document.body.textContent).toContain("Start group chat");

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<Harness initial={seed({ characters: [char("c1", "Mira")] })} />);
    const lone = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Group chat"));
    expect(lone.disabled).toBe(true);
    const why = document.getElementById(lone.getAttribute("aria-describedby"));
    expect(why.textContent).toMatch(/at least two characters/);
  });

  it("makes New the main action, named for the tab, calling onEdit(tab, null)", async () => {
    const edits = [];
    await mount(<Harness initial={seed()} edits={edits} />);
    await click(buttonText("New character"));
    await click([...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.startsWith("Lorebooks")));
    await click(buttonText("New lorebook"));
    expect(edits).toEqual([["characters", null], ["lorebooks", null]]);
    expect(byLabel("Import lorebook").textContent.trim()).toBe("Import");
  });
});
