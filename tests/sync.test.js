import { describe, expect, it } from "vitest";
import { applySync, mergeLibrary, replaceLibrary, syncEndpoint, syncSettings } from "../src/lib/sync.js";
import { backupParts, readBackup } from "../src/lib/backup.js";
import { emptyData } from "../src/lib/data.js";
import { newProvider } from "../src/lib/providers.js";

const lib = (over = {}) => ({ characters: [], universes: [], personas: [], lorebooks: [], chats: [], ...over });

describe("syncing a library", () => {
  it("merges: adds what is missing, keeps the newer copy, never deletes", () => {
    const local = lib({
      characters: [{ id: "a", name: "Old Juno", updatedAt: 1 }, { id: "only-here", name: "Silas" }],
      chats: [{ id: "x", messages: [1, 2, 3], updatedAt: 50 }],
    });
    const remote = lib({
      characters: [{ id: "a", name: "New Juno", updatedAt: 5 }, { id: "b", name: "Wren" }],
      chats: [{ id: "x", messages: [1], updatedAt: 10 }],
    });
    const { patch, added, updated } = mergeLibrary(local, remote);
    expect(patch.characters.map((c) => c.name)).toEqual(["New Juno", "Silas", "Wren"]);
    expect(patch.chats).toBeUndefined(); // this device's chat is newer
    expect({ added, updated }).toEqual({ added: 1, updated: 1 });
  });

  it("keeps this device's copy when neither says when it changed", () => {
    const { patch } = mergeLibrary(lib({ personas: [{ id: "p", name: "Mine" }] }), lib({ personas: [{ id: "p", name: "Theirs" }] }));
    expect(patch).toEqual({});
  });

  it("replaceLibrary is the library alone (settings go through syncSettings)", () => {
    const out = replaceLibrary({ ...lib({ chats: [{ id: "c" }] }), settings: { providers: [] } });
    expect(out.chats).toEqual([{ id: "c" }]);
    expect(out).not.toHaveProperty("settings");
  });

  it("uses the saved Bridge even when another provider is in use", () => {
    const or = newProvider("openrouter");
    const br = { ...newProvider("nova-bridge"), key: "k", base: "http://192.168.1.20:5005/v1" };
    const ep = syncEndpoint({ providers: [or, br], activeProvider: or.id });
    expect(ep).toMatchObject({ src: "nova-bridge", key: "k", base: "http://192.168.1.20:5005/v1" });
    expect(syncEndpoint({ providers: [or], activeProvider: or.id })).toBeNull();
  });
});

describe("syncing settings", () => {
  const bridgeHere = { ...newProvider("nova-bridge"), id: "br-phone", key: "phone-device-key", base: "http://192.168.1.20:5005/v1" };
  const bridgeThere = { ...newProvider("nova-bridge"), id: "br-pc", key: "", base: "http://127.0.0.1:5005/v1" };

  it("takes the copy's settings and response styles, keeps this device's Bridge, UI size and switches", () => {
    const here = { ...structuredClone(emptyData), settings: { ...emptyData.settings, providers: [bridgeHere], activeProvider: "br-phone", syncRev: 4, dailyBackup: true, customStyles: [{ id: "s-mine", name: "Mine" }] }, appearance: { ...emptyData.appearance, uiScale: 1.2 } };
    const or = { ...newProvider("openrouter"), id: "or", key: "sk-sent", model: "x/y:free" };
    const there = { ...structuredClone(emptyData), username: "Ana", settings: { ...emptyData.settings, providers: [or, bridgeThere], activeProvider: "br-pc", syncRev: 9, dailyBackup: false, stylePreset: "custom", customStyles: [{ id: "s-theirs", name: "Theirs" }], customStyleId: "s-theirs" }, appearance: { ...emptyData.appearance, skin: "minimal", uiScale: 0.9 } };
    const out = applySync(here, there, "merge");
    expect(out.settings.providers.map((p) => p.id)).toEqual(["or", "br-phone"]);
    expect(out.settings.providers.find((p) => p.id === "br-phone").key).toBe("phone-device-key");
    expect(out.settings.providers.find((p) => p.id === "or").key).toBe("sk-sent");
    expect(out.settings.activeProvider).toBe("br-phone");
    expect(out.settings.syncRev).toBe(4);
    expect(out.settings.dailyBackup).toBe(true);
    expect(out.settings.customStyles.map((x) => x.id)).toEqual(["s-theirs", "s-mine"]);
    expect(out.settings.customStyleId).toBe("s-theirs");
    expect(out.appearance).toMatchObject({ skin: "minimal", uiScale: 1.2 });
    expect(out.username).toBe("Ana");
    expect(applySync(here, there, "replace").settings.customStyles.map((x) => x.id)).toEqual(["s-theirs"]);
  });

  it("never blanks a key the copy was sent without", () => {
    const mine = { providers: [{ ...newProvider("openrouter"), id: "or", key: "sk-local" }], activeProvider: "or", voice: { key: "voice-local", on: true } };
    const theirs = { providers: [{ ...newProvider("openrouter"), id: "or", key: "", model: "new/model" }], activeProvider: "or", voice: { key: "", on: false } };
    const out = syncSettings(mine, theirs);
    expect(out.providers[0]).toMatchObject({ key: "sk-local", model: "new/model" });
    expect(out.voice).toEqual({ key: "voice-local", on: false });
  });

  it("travels as the same file Back up now writes, keys only when asked", () => {
    const state = { ...structuredClone(emptyData), settings: { ...emptyData.settings, providers: [{ ...newProvider("openrouter"), id: "or", key: "sk-1" }], customStyles: [{ id: "s", name: "Style" }] } };
    const without = readBackup([...backupParts(state, "1.0.0")].join("")).state;
    const withKeys = readBackup([...backupParts(state, "1.0.0", { includeCredentials: true })].join("")).state;
    expect(without.settings.customStyles[0].name).toBe("Style");
    expect(without.settings.providers.find((p) => p.id === "or").key).toBe("");
    expect(withKeys.settings.providers.find((p) => p.id === "or").key).toBe("sk-1");
  });
});
