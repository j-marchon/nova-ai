// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDelete, Slider } from "../src/components/ui.jsx";
import { Swatches } from "../src/components/color.jsx";
import { QuickRepliesManager, SendAsModal } from "../src/components/QuickReplies.jsx";
import { ProvidersPanel } from "../src/components/ProvidersPanel.jsx";
import { StyleChips, StyleTuner } from "../src/components/StylePicker.jsx";
import { ModelList } from "../src/components/models.jsx";
import { Composer } from "../src/pages/chat/Composer.jsx";
import { ImageGenModal } from "../src/components/ImageGenModal.jsx";
import { withTuning, samplerPreset } from "../src/lib/styles.js";
import { LorebookForm } from "../src/components/LorebookForm.jsx";
import { AppearancePanel } from "../src/pages/SettingsPage.jsx";
import { newBook, newEntry } from "../src/lib/lore.js";
import { clearToasts, toasts } from "../src/lib/toast.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/lib/api.js", async (importOriginal) => ({
  ...await importOriginal(), fetchProviderModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/lib/bridgeFind.js", async (importOriginal) => ({
  ...await importOriginal(), findBridgeOnce: vi.fn().mockResolvedValue(null),
}));
vi.mock("../src/lib/imageGen.js", async (importOriginal) => ({
  ...await importOriginal(), generateImage: vi.fn().mockResolvedValue("data:image/png;base64,AQID"),
}));

let root, host;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete window.Capacitor;
});
const mount = async (el) => { await act(async () => root.render(el)); };
const q = (sel) => document.body.querySelector(sel);

describe("selected state is exposed and styled", () => {
  it("Swatches: the chosen colour is pressed, ticked and labelled with its hex", async () => {
    await mount(<Swatches options={["#ff0000", "#00ff00"]} value="#00ff00" onChange={() => {}} allowCustom={false} />);
    const on = q('button[aria-label="Colour #00ff00"]');
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(on.getAttribute("data-on")).toBe("1");
    expect(on.querySelector("svg")).not.toBeNull();
    const off = q('button[aria-label="Colour #ff0000"]');
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.hasAttribute("data-on")).toBe(false);
    expect(host.textContent).toContain("#00ff00");
  });

  it("ConfirmDelete: arming sets aria-pressed and data-on", async () => {
    const onConfirm = vi.fn();
    await mount(<ConfirmDelete label="Thing" onConfirm={onConfirm} />);
    const b = q("button");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    act(() => b.click());
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("data-on")).toBe("1");
    act(() => b.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Slider is labelled for assistive tech", async () => {
    await mount(<Slider label="Opacity" value={1} min={0} max={2} step={1} onChange={() => {}} />);
    expect(q('input[type="range"]').getAttribute("aria-label")).toBe("Opacity");
  });

  it("Send-as rows: only the current author is pressed", async () => {
    await mount(
      <SendAsModal current={{ type: "character", id: "c1", name: "Mira" }} userName="Player"
        characters={[{ id: "c1", name: "Mira" }]} cast={[]} onSelect={() => {}} onClose={() => {}} />
    );
    const rows = [...document.body.querySelectorAll("button[aria-pressed]")];
    const mira = rows.find((b) => b.textContent.includes("Mira"));
    const you = rows.find((b) => b.textContent.includes("Player"));
    expect(mira.getAttribute("aria-pressed")).toBe("true");
    expect(mira.getAttribute("data-on")).toBe("1");
    expect(you.getAttribute("aria-pressed")).toBe("false");
    expect(you.hasAttribute("data-on")).toBe(false);
  });

  it("Lorebook entry switches report role=switch, aria-checked and data-on", async () => {
    const book = { ...newBook(), entries: [{ ...newEntry(), id: "e1", comment: "Entry", constant: true }] };
    await mount(<LorebookForm initial={book} title="Book" onSave={() => {}} onClose={() => {}} />);
    act(() => { [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Entry")).click(); });
    const sw = (label) => [...document.body.querySelectorAll('[role="switch"]')].find((b) => b.textContent.includes(label));
    expect(sw("Always on").getAttribute("aria-checked")).toBe("true");
    expect(sw("Always on").getAttribute("data-on")).toBe("1");
    expect(sw("Match case").getAttribute("aria-checked")).toBe("false");
    expect(sw("Match case").hasAttribute("data-on")).toBe(false);
  });

  it("Background tiles: the chosen preset is pressed and marked", async () => {
    await mount(<AppearancePanel ap={{ bgPreset: "none" }} onChange={() => {}} />);
    const tile = [...document.body.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent.includes("None"));
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.getAttribute("data-on")).toBe("1");
    expect(tile.querySelector("svg")).not.toBeNull();
  });

  it("Providers: rows only open their editor; the provider is picked in the Model tab", async () => {
    const onChange = vi.fn();
    const provider = { id: "p1", preset: "openai", name: "My provider", key: "test", model: "" };
    const other = { id: "p2", preset: "openai", name: "Other", key: "test", model: "" };
    await mount(<ProvidersPanel settings={{ providers: [provider, other], activeProvider: "p1" }} onChange={onChange} />);
    expect(host.querySelector("button[aria-pressed]")).toBeNull();
    expect(host.textContent).toContain("In use");
    act(() => q('button[aria-label="Edit Other"]').click());
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(q('button[aria-label="Close Other"]').getAttribute("aria-expanded")).toBe("true");
  });

  it("Quick reply mode: the selected radio is checked and marked after switching", async () => {
    await mount(<QuickRepliesManager onChange={() => {}} onClose={() => {}} />);
    const insert = q('[role="radio"][aria-label="Insert in the message box"]');
    act(() => insert.click());
    expect(insert.getAttribute("aria-checked")).toBe("true");
    expect(insert.getAttribute("data-on")).toBe("1");
    expect(q('[aria-label="Send straight away"]').getAttribute("aria-checked")).toBe("false");
  });

  it("Model list tabs: the selected tab is checked and marked", async () => {
    const provider = { id: "p1", preset: "openai", name: "Provider", key: "test", favorites: [] };
    await mount(<ModelList settings={{ providers: [provider], activeProvider: "p1" }} onChange={() => {}} />);
    const favorites = [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Favorites");
    act(() => favorites.click());
    expect(favorites.getAttribute("aria-checked")).toBe("true");
    expect(favorites.getAttribute("data-on")).toBe("1");
  });

  it("Style thinking: enabled state is checked and marked", async () => {
    await mount(<StyleChips settings={{ thinking: true }} onChange={() => {}} />);
    const thinking = [...host.querySelectorAll('[role="switch"]')].find((b) => b.textContent.includes("Model thinking"));
    expect(thinking.getAttribute("aria-checked")).toBe("true");
    expect(thinking.getAttribute("data-on")).toBe("1");
  });

  it("Style tuning switches and ranges expose their state and labels", async () => {
    const provider = { id: "p1", preset: "openrouter", model: "test" };
    const settings = { providers: [provider], activeProvider: "p1" };
    const preset = samplerPreset(settings);
    await mount(<StyleTuner settings={withTuning(settings, preset.id, { on: true, strict: true })} preset={preset} onChange={() => {}} />);
    for (const toggle of host.querySelectorAll('[role="switch"]')) {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(toggle.getAttribute("data-on")).toBe("1");
    }
    expect(host.querySelectorAll('[role="switch"]').length).toBe(2);
    expect(host.querySelector('input[type="range"]').classList.contains("nv-range")).toBe(true);
  });

  it("Composer: the active author menu is pressed and the textarea is labelled", async () => {
    const props = { actions: {}, scope: { mode: "off", cast: [] }, look: {}, sendAs: { type: "system" } };
    await mount(<Composer {...props} />);
    const more = q('[aria-label="More options"]');
    expect(more.getAttribute("aria-pressed")).toBe("true");
    expect(more.getAttribute("data-on")).toBe("1");
    expect(q('textarea').getAttribute("aria-label")).toBe("Write a message");
    await mount(<Composer {...props} sendAs={{ type: "user" }} />);
    expect(more.getAttribute("aria-pressed")).toBe("false");
    expect(more.hasAttribute("data-on")).toBe(false);
  });

  it("Image generation: labels, selected provider, aspect select and native image bytes", async () => {
    const writeFile = vi.fn().mockResolvedValue({});
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => ({ type: "image/png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) }));
    await mount(<ImageGenModal open initialPrompt="A scene" settings={{}} onClose={() => {}} />);
    const [source, aspect] = host.querySelectorAll("select");
    expect(source.closest("label").textContent).toContain("Provider");
    expect(source.value).toBe("ai_horde");
    expect(aspect.closest('label').textContent).toContain("Aspect Ratio");
    expect(q('textarea').closest('label').textContent).toContain("Scene Visual Prompt");
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === "Generate Art").click());
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === "Save image").click());
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: "AQID", directory: "DOCUMENTS" }));
  });

  it("never saves a 404 image response and shows the error", async () => {
    clearToasts();
    const writeFile = vi.fn();
    const blob = vi.fn();
    window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, blob }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mount(<ImageGenModal open initialPrompt="A scene" settings={{}} onClose={() => {}} />);
      await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === "Generate Art").click());
      await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === "Save image").click());
      expect(blob).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(toasts.get()).toContainEqual(expect.objectContaining({ text: "Could not save the image.", tone: "warn" }));
    } finally { error.mockRestore(); clearToasts(); }
  });
});
