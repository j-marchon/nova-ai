import { expect, it } from "vitest";
import { readAppearancePreset } from "../src/lib/appearancePreset.js";

const appearance = { scheme: "dark", motion: "calm", uiScale: 1, cardSize: "xl", cardDesc: true };
const preset = { format: "nova-appearance-1", appearance };
it("imports only supported look controls", () => {
  expect(readAppearancePreset(JSON.stringify(preset))).toEqual(appearance);
  for (const patch of [{ chats: [] }, { settings: {} }, { appearance: { ...appearance, key: "fixture" } },
    { appearance: { ...appearance, uiScale: 5 } }, { appearance: { ...appearance, scheme: "unknown" } }]) {
    expect(() => readAppearancePreset(JSON.stringify({ ...preset, ...patch }))).toThrow();
  }
});
