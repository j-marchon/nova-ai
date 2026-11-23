// @vitest-environment jsdom
/* Chat backgrounds by screen shape, and the size of each reply style. */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSection, bgsForScreen } from "../src/components/theme.jsx";
import { ChatBackdrop } from "../src/components/backdrops.jsx";
import { StyleChips } from "../src/components/StylePicker.jsx";
import { estimateTokens, styleTokens } from "../src/lib/tokens.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const size0 = { w: innerWidth, h: innerHeight };
const screenAt = (w, h) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
};
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); screenAt(size0.w, size0.h); });
const render = async (ui) => { await act(async () => root.render(ui)); };

const img = (name) => `data:image/jpeg;base64,${btoa(name)}`;
/* framed only for a computer, only for a phone, for both, and an old one with no shape saved */
const desk = { image: img("desk"), aspect: 1.7778, opacity: 1 };
const tall = { image: img("tall"), aspect: 0.4621, opacity: 1 };
const both = { image: img("both-wide"), aspect: 1.7778, opacity: 1, alt: { image: img("both-tall"), aspect: 0.4621 } };
const old = { image: img("old"), opacity: 1 };

describe("backgrounds by screen shape", () => {
  it("a portrait screen skips pictures framed only for a computer", () => {
    expect(bgsForScreen([desk, tall, both, old], { w: 390, h: 844 })).toEqual([tall, both, old]);
  });
  it("a wide screen shows every picture, or only desktop ones when asked", () => {
    expect(bgsForScreen([desk, tall, both, old], { w: 1600, h: 900 })).toEqual([desk, tall, both, old]);
    expect(bgsForScreen([desk, tall, both, old], { w: 1600, h: 900 }, true)).toEqual([desk, both]);
  });

  it("the chat on a phone rotates only phone-shaped crops, and uses the phone crop of a picture with both", async () => {
    screenAt(390, 844);
    await render(<ChatBackdrop list={[desk, tall, both]} seconds={20} />);
    const srcs = [...host.querySelectorAll("[data-backdrop-layer] img")].map((e) => e.getAttribute("src"));
    expect(host.querySelectorAll("[data-backdrop-layer]").length).toBe(2);
    expect(srcs).toContain(tall.image);
    expect(srcs).toContain(both.alt.image);
    expect(srcs).not.toContain(desk.image);
    expect(srcs).not.toContain(both.image);
  });

  it("the chat on a computer skips phone-only pictures when Only desktop pictures is on", async () => {
    screenAt(1600, 900);
    await render(<ChatBackdrop list={[desk, tall, both]} seconds={20} />);
    expect(host.querySelectorAll("[data-backdrop-layer]").length).toBe(3);
    await render(<ChatBackdrop list={[desk, tall, both]} seconds={20} desktopOnly />);
    const srcs = [...host.querySelectorAll("[data-backdrop-layer] img")].map((e) => e.getAttribute("src"));
    expect(host.querySelectorAll("[data-backdrop-layer]").length).toBe(2);
    expect(srcs).not.toContain(tall.image);
    expect(srcs).toContain(both.image);
  });

  it("a phone shows desktop-only pictures greyed in the row and has no desktop switch", async () => {
    screenAt(390, 844);
    await render(<ThemeSection theme={{ bgs: [desk, tall] }} onChange={() => {}} />);
    const thumbs = [...host.querySelectorAll('button[aria-label^="Crop background"]')];
    expect(thumbs.length).toBe(2);
    expect(thumbs[0].dataset.skipped).toBe("1");
    expect(thumbs[1].dataset.skipped).toBeUndefined();
    expect(host.textContent).not.toContain("Only desktop pictures");
  });

  it("a computer saves Only desktop pictures in the theme and greys the phone-only pictures", async () => {
    screenAt(1600, 900);
    let saved;
    function Form() {
      const [theme, setTheme] = useState({ bgs: [desk, tall] }); saved = theme;
      return <ThemeSection theme={theme} onChange={setTheme} />;
    }
    await render(<Form />);
    const toggle = [...host.querySelectorAll('[role="switch"]')].find((b) => b.textContent.includes("Only desktop pictures"));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector("[data-skipped]")).toBeNull();
    await act(async () => toggle.click());
    expect(saved.bgDesktopOnly).toBe(true);
    const thumbs = [...host.querySelectorAll('button[aria-label^="Crop background"]')];
    expect(thumbs[0].dataset.skipped).toBeUndefined();
    expect(thumbs[1].dataset.skipped).toBe("1");
  });

  it("row thumbnails keep each picture's own shape", async () => {
    screenAt(1600, 900);
    await render(<ThemeSection theme={{ bgs: [desk, tall] }} onChange={() => {}} />);
    const [a, b] = [...host.querySelectorAll('button[aria-label^="Crop background"] img')];
    expect(parseFloat(a.style.aspectRatio)).toBe(1.7778);
    expect(parseFloat(b.style.aspectRatio)).toBe(0.4621);
  });
});

describe("reply style sizes", () => {
  const big = {
    id: "big", name: "Big preset", text: "Write vividly. ".repeat(400), post: "Stay in the scene.",
    inject: [{ depth: 4, text: "Keep it short." }], modes: { impersonate: "Write as the user. ".repeat(200) },
  };
  const small = { id: "small", name: "Small", text: "Be brief." };

  it("counts the system text, the post-history block and the in-chat blocks, not Impersonate", () => {
    expect(styleTokens(big)).toBe(estimateTokens(big.text.trim()) + estimateTokens(big.post) + estimateTokens("Keep it short."));
    expect(styleTokens(null)).toBe(0);
    /* an imported preset with a layout sends its blocks, not the markers */
    expect(styleTokens({ text: "x", layout: [{ text: "One block." }, { marker: "charDescription" }] })).toBe(estimateTokens("One block."));
  });

  it("shows each prompt's size beside its name, and none for No prompt", async () => {
    await render(<StyleChips settings={{ stylePreset: "custom", customStyleId: "big", customStyles: [big, small] }} onChange={() => {}} />);
    const sizes = [...host.querySelectorAll("[data-prompt-tokens]")];
    const by = (name) => sizes.find((s) => s.parentElement.textContent.includes(name));
    expect(by("Big preset").textContent).toMatch(/^~\d+(\.\d)?k$/);
    expect(Number(by("Big preset").dataset.promptTokens)).toBe(styleTokens(big));
    expect(by("Small").textContent).toBe(`~${styleTokens(small)}`);
    const none = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("No prompt"));
    expect(none.querySelector("[data-prompt-tokens]")).toBeNull();
  });
});
