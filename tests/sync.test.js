import { describe, expect, it } from "vitest";
import { mergeLibrary, replaceLibrary, syncEndpoint } from "../src/lib/sync.js";
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

  it("replaces only the library, never settings", () => {
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
