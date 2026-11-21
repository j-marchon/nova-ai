// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  CHATS, CORE_KEY, DB_NAME, IMAGES, STATE,
  extractImages, joinState, loadData, resetStorageForTests, restoreImages, saveData,
} from "../src/lib/storage.js";
import { emptyData } from "../src/lib/data.js";

const img = (c) => `data:image/jpeg;base64,${c.repeat(2000)}`;

const state = () => ({
  ...JSON.parse(JSON.stringify(emptyData)),
  characters: [{ id: "c1", name: "Mira", avatar: img("A"), theme: { bgs: [{ image: img("B"), opacity: 1 }] } }],
  personas: [{ id: "p1", name: "Ana", avatar: img("A") }],
  chats: [
    { id: "x", kind: "character", characterId: "c1", messages: [{ id: "m1", role: "assistant", content: "Hi" }], updatedAt: 1 },
    { id: "y", kind: "character", characterId: "c1", messages: [], updatedAt: 2 },
  ],
});

/* every record in a store, for looking at what is actually on disk */
async function dump(store) {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(store, "readonly");
  const get = (req) => new Promise((res) => { req.onsuccess = () => res(req.result); });
  const [keys, vals] = await Promise.all([get(tx.objectStore(store).getAllKeys()), get(tx.objectStore(store).getAll())]);
  db.close();
  return new Map(keys.map((k, i) => [k, vals[i]]));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  localStorage.clear();
});

describe("image references", () => {
  it("round-trips and stores each picture once", () => {
    const found = new Map();
    const s = state();
    const out = extractImages(s, found);
    expect(found.size).toBe(2);
    expect(JSON.stringify(out)).not.toContain("base64");
    expect(restoreImages(out, found)).toEqual(s);
  });

  it("stores video avatars and backgrounds as pictures too", () => {
    const vid = `data:video/mp4;base64,${"V".repeat(4000)}`;
    const found = new Map();
    const s = { ...state(), personas: [{ id: "p2", name: "Clip", avatar: vid }] };
    const out = extractImages(s, found);
    expect([...found.values()]).toContain(vid);
    expect(JSON.stringify(out)).not.toContain("data:video");
    expect(restoreImages(out, found)).toEqual(s);
  });
});

describe("saving and loading", () => {
  it("splits state, chats and pictures into their own stores and reads them back", async () => {
    const s = state();
    await saveData(s);
    const core = (await dump(STATE)).get(CORE_KEY);
    expect(core.format).toBe(2);
    expect(core.chats).toBeUndefined();
    expect(core.chatOrder).toEqual(["x", "y"]);
    expect((await dump(CHATS)).size).toBe(2);
    expect((await dump(IMAGES)).size).toBe(2);

    resetStorageForTests();
    const back = await loadData();
    expect(back.characters[0].avatar).toBe(img("A"));
    expect(back.characters[0].theme.bgs[0].image).toBe(img("B"));
    expect(back.chats.map((c) => c.id)).toEqual(["x", "y"]);
    expect(back.chats[0].messages[0].content).toBe("Hi");
  });

  it("writes only the chats that changed", async () => {
    const s = state();
    await saveData(s);
    const chats = await dump(CHATS);
    /* tamper with the stored copy of the untouched chat to prove it is not rewritten */
    const db = await new Promise((res) => { const r = indexedDB.open(DB_NAME); r.onsuccess = () => res(r.result); });
    await new Promise((res) => {
      const tx = db.transaction(CHATS, "readwrite");
      tx.objectStore(CHATS).put({ ...chats.get("y"), marker: true }, "y");
      tx.oncomplete = res;
    });
    db.close();

    const next = { ...s, chats: [{ ...s.chats[0], messages: [...s.chats[0].messages, { id: "m2", role: "user", content: "Yo" }] }, s.chats[1]] };
    await saveData(next);
    const after = await dump(CHATS);
    expect(after.get("x").messages).toHaveLength(2);
    expect(after.get("y").marker).toBe(true);
  });

  it("deletes chats and pictures nothing points at any more", async () => {
    const s = state();
    await saveData(s);
    const next = { ...s, characters: [{ ...s.characters[0], theme: {} }], chats: [s.chats[0]] };
    await saveData(next);
    expect([...(await dump(CHATS)).keys()]).toEqual(["x"]);
    expect((await dump(IMAGES)).size).toBe(1);
  });

  it("reads the old single-record layout and rewrites it in the new one", async () => {
    const old = state();
    await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STATE);
      r.onsuccess = () => {
        const tx = r.result.transaction(STATE, "readwrite");
        tx.objectStore(STATE).put(old, CORE_KEY);
        tx.oncomplete = () => { r.result.close(); res(); };
      };
      r.onerror = () => rej(r.error);
    });
    const d = await loadData();
    expect(d.chats).toHaveLength(2);
    expect(d.characters[0].avatar).toBe(img("A"));
    await saveData(d);
    expect((await dump(STATE)).get(CORE_KEY).format).toBe(2);
    expect((await dump(CHATS)).size).toBe(2);
  });

  it("joins chats missing from the saved order rather than dropping them", () => {
    const d = joinState({ chatOrder: ["b"] }, [{ id: "a" }, { id: "b" }], new Map());
    expect(d.chats.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
