import { beforeEach, describe, expect, it } from "vitest";
import { FORMAT, chatRecord, coreRecord, extractImages, resetStorageForTests } from "../src/lib/storage.js";

const img = (c) => `data:image/jpeg;base64,${c.repeat(2000)}`;

/* what the records were before slices and messages were cached */
const oldCore = (state, found, ids) => {
  const { chats, ...rest } = state;
  return extractImages({ ...rest, format: FORMAT, chatOrder: (chats || []).map((c) => c.id) }, found, ids);
};

describe("cached save walks", () => {
  beforeEach(() => resetStorageForTests());

  const state = () => ({
    settings: { a: 1 },
    characters: [{ id: "c1", avatar: img("A"), theme: { bgs: [{ image: img("B") }] } }],
    ledger: { spent: 0 },
    chats: [{ id: "x", messages: [{ id: "m1", content: "hi", images: [{ url: img("C") }] }, { id: "m2", content: "yo" }], theme: { bg: { image: img("D") } } }],
  });

  it("writes the same state record, pictures and ids as a full walk", () => {
    const s = state();
    const f1 = new Map(), i1 = new Set(), f2 = new Map(), i2 = new Set();
    expect(coreRecord(s, f1, i1)).toEqual(oldCore(s, f2, i2));
    expect([...f1.keys()].sort()).toEqual([...f2.keys()].sort());
    expect([...i1].sort()).toEqual([...i2].sort());
  });

  it("writes the same chat record as a full walk", () => {
    const c = state().chats[0];
    const f1 = new Map(), i1 = new Set(), f2 = new Map(), i2 = new Set();
    expect(chatRecord(c, f1, i1)).toEqual(extractImages(c, f2, i2));
    expect([...i1].sort()).toEqual([...i2].sort());
  });

  it("still reports every picture when a slice comes from the cache", () => {
    const s = state();
    coreRecord(s, new Map(), new Set());
    const found = new Map(), ids = new Set();
    const again = coreRecord({ ...s, ledger: { spent: 1 } }, found, ids);
    expect(found.size).toBe(2);
    expect(ids.size).toBe(2);
    expect(again.ledger).toEqual({ spent: 1 });
  });

  it("picks up a changed message and keeps the cached ones", () => {
    const c = state().chats[0];
    chatRecord(c, new Map(), new Set());
    const edited = { ...c, messages: [c.messages[0], { ...c.messages[1], content: "changed" }] };
    const ids = new Set();
    const out = chatRecord(edited, new Map(), ids);
    expect(out.messages[1].content).toBe("changed");
    expect(ids.size).toBe(2);
  });
});
