import { describe, expect, it } from "vitest";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";

const damaged = () => ({
  ...structuredClone(emptyData),
  characters: [null, 7, "x", { id: "c1", name: "Mira" }, []],
  universes: [null, { id: "u1", name: "World" }],
  personas: [undefined, { id: "p1", name: "Ana" }],
  lorebooks: [null, { id: "l1", name: "Lore", entries: [null, { keys: ["a"], content: "A" }] }],
  chats: [null, { id: "x", kind: "character", messages: [null, "junk", { id: "m1", role: "user", content: "Hi" }] }, 3],
  settings: { ...structuredClone(emptyData.settings), providers: [null, ...structuredClone(emptyData.settings.providers)], voice: "loud", imageGen: 4 },
  ledger: "nope",
  appearance: null,
});

describe("normalizeData with damaged entries", () => {
  it("drops non-object entries instead of throwing", () => {
    const d = normalizeData(damaged());
    expect(d.characters.map((c) => c.id)).toEqual(["c1"]);
    expect(d.universes.map((u) => u.id)).toEqual(["u1"]);
    expect(d.personas.map((p) => p.id)).toEqual(["p1"]);
    expect(d.lorebooks[0].entries).toHaveLength(1);
    expect(d.chats.map((c) => c.id)).toEqual(["x"]);
    expect(d.chats[0].messages.map((m) => m.id)).toEqual(["m1"]);
    expect(d.settings.providers.every((p) => p && typeof p === "object")).toBe(true);
    /* plus Nova Bridge, always added first */
    expect(d.settings.providers.length).toBe(emptyData.settings.providers.length + 1);
    expect(d.settings.voice).toMatchObject({ rate: 1, pitch: 1 });
    expect(d.ledger).toEqual(emptyData.ledger);
    expect(d.appearance.scheme).toBe("dark");
  });

  it("survives a store or backup that is not an object at all", () => {
    expect(normalizeData(null).characters).toEqual([]);
    expect(normalizeData("garbage").chats).toEqual([]);
  });

  it("loads a damaged backup", () => {
    const text = makeBackup(damaged());
    const { state } = readBackup(text);
    expect(state.characters.map((c) => c.id)).toEqual(["c1"]);
    /* and one damaged by hand: null chat records and core lists */
    const raw = JSON.parse(text);
    raw.chats = [null, ...raw.chats, 5];
    raw.core.personas = [null];
    const again = readBackup(JSON.stringify(raw)).state;
    expect(again.chats.map((c) => c.id)).toEqual(["x"]);
    expect(again.personas).toEqual([]);
  });

  it("leaves healthy data as it was", () => {
    const ok = normalizeData({ ...structuredClone(emptyData), characters: [{ id: "c1", name: "Mira" }] });
    expect(normalizeData(ok)).toEqual(ok);
  });
});
