import { describe, expect, it } from "vitest";
import { DEFAULTS_GEN, emptyData, keepDeviceDefaults, normalizeData } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";

const old = () => {
  const d = structuredClone(emptyData);
  d.settings.updateCheck = false;
  d.settings.defaultsGen = 0;
  d.appearance.skinInChat = true;
  return d;
};

describe("changed defaults", () => {
  it("start on for update checks and off for the skin in chats", () => {
    expect(emptyData.settings.updateCheck).toBe(true);
    expect(emptyData.appearance.skinInChat).toBe(false);
  });
  it("move older data onto them once, then keep whatever is chosen after", () => {
    const moved = normalizeData(old());
    expect(moved.settings.updateCheck).toBe(true);
    expect(moved.appearance.skinInChat).toBe(false);
    expect(moved.settings.defaultsGen).toBe(DEFAULTS_GEN);
    const chosen = { ...moved, settings: { ...moved.settings, updateCheck: false }, appearance: { ...moved.appearance, skinInChat: true } };
    const again = normalizeData(chosen);
    expect(again.settings.updateCheck).toBe(false);
    expect(again.appearance.skinInChat).toBe(true);
  });
  it("a backup from before them does not bring the old values back", () => {
    const text = makeBackup(old(), "3.1");
    const raw = JSON.parse(text);
    delete raw.core.settings.defaultsGen;
    const { state, predates } = readBackup(JSON.stringify(raw));
    expect(predates).toBe(true);
    const device = normalizeData(structuredClone(emptyData));
    device.settings.updateCheck = false;
    const kept = keepDeviceDefaults(device, state, predates);
    expect(kept.settings.updateCheck).toBe(false);
    expect(kept.appearance.skinInChat).toBe(false);
  });
  it("a backup made with them is restored as it is", () => {
    const mine = normalizeData(structuredClone(emptyData));
    mine.settings.updateCheck = false;
    const { state, predates } = readBackup(makeBackup(normalizeData(structuredClone(emptyData)), "3.2"));
    expect(predates).toBe(false);
    expect(keepDeviceDefaults(mine, state, predates).settings.updateCheck).toBe(true);
  });
});
