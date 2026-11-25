// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatAppearance } from "../src/components/chatAppearance.js";
import { applyUiScale, layoutRect, layoutViewport, normalizeUiScale, toLayout } from "../src/lib/uiScale.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { AppearancePanel } from "../src/pages/SettingsPage.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { applyUiScale(1); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); applyUiScale(1); });
describe("global UI size", () => {
  it("defaults to 100% and safely normalizes saved settings", () => {
    expect(emptyData.appearance.uiScale).toBe(1); expect(emptyData.appearance.scheme).toBe("dark");
    expect(normalizeData({ appearance: { uiScale: 1.2 } }).appearance.uiScale).toBe(1.2);
    expect(normalizeData({ appearance: { uiScale: 0 } }).appearance.uiScale).toBe(.7);
    expect(normalizeData({ appearance: { uiScale: 3 } }).appearance.uiScale).toBe(1.3);
    expect(normalizeData({ appearance: { uiScale: "bad" } }).appearance.uiScale).toBe(1);
    expect(normalizeUiScale(NaN)).toBe(1);
    expect(normalizeData({ appearance: { scheme: "light" } }).appearance.scheme).toBe("light");
  });
  it("scales the document once so portaled and fixed surfaces share the same value", () => {
    applyUiScale(1.25);
    expect(document.documentElement.style.zoom).toBe("1.25");
    expect(document.documentElement.style.getPropertyValue("--nv-ui-scale")).toBe("1.25");
    expect(toLayout(125)).toBe(100);
    expect(layoutRect({ top: 125, left: 250, width: 375, height: 500 })).toEqual({ top: 100, left: 200, width: 300, height: 400 });
    expect(layoutViewport().width).toBe(window.innerWidth / 1.25);
  });
  it("the global slider saves and resets UI size without changing theme or chat opacity", async () => {
    let current;
    function Settings() {
      const [appearance, setAppearance] = useState({ ...emptyData.appearance, scheme: "dark" }); current = appearance;
      return <AppearancePanel ap={appearance} onChange={patch => setAppearance(previous => ({ ...previous, ...patch }))} />;
    }
    await act(async () => root.render(<Settings />));
    const input = [...host.querySelectorAll('input[type="range"]')].find(el => el.min === "0.7");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(input, "1.2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(current.uiScale).toBe(1.2); expect(current.scheme).toBe("dark");
    await act(async () => [...host.querySelectorAll("button")].find(el => el.textContent === "Reset size").click());
    expect(current.uiScale).toBe(1);
  });
});
describe("desktop UI size and chat bubbles", () => {
  it("counts 100% from the desktop base and keeps an older pick as it looked", async () => {
    window.novaDesktop = {}; vi.resetModules();
    try {
      const scale = await import("../src/lib/uiScale.js");
      const { normalizeData } = await import("../src/lib/data.js");
      expect(scale.applyUiScale(1)).toBe(1.25);
      expect(normalizeData({ appearance: { uiScale: 1.25 } }).appearance.uiScale).toBe(1);
      expect(normalizeData({ appearance: { uiScale: 1 } }).appearance.uiScale).toBe(1);
      expect(normalizeData({ appearance: { uiScale: 1.1, uiSizeRebased: true } }).appearance.uiScale).toBe(1.1);
      expect(normalizeData({ appearance: { bubbleScale: 9 } }).appearance.bubbleScale).toBe(1.5);
    } finally { delete window.novaDesktop; vi.resetModules(); }
  });
  it("bubbles wear the skin's colours until one is picked", () => {
    expect(chatAppearance({ bubbleAlpha: 1 }).userBubbleBg).toBe("var(--nv-bubble-user)");
    const look = chatAppearance({ bubbleAlpha: 1, userColor: "#e4e4e7", aiColor: "red;x" });
    expect(look.userBubbleBg).toBe("#e4e4e7"); expect(look.userBubbleFg).toBe("#09090b");
    expect(look.aiBubbleBg).toBe("var(--nv-bubble-ai)"); expect(look.aiBubbleFg).toBe("var(--nv-ink)");
  });
});
