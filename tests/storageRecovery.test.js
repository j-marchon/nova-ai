// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { StorageReadError, loadData, resetStorageForTests, saveData, storageReadFailed } from "../src/lib/storage.js";
import { emptyData } from "../src/lib/data.js";

const img = (c) => `data:image/jpeg;base64,${c.repeat(2000)}`;
const state = () => ({
  ...structuredClone(emptyData),
  username: "Ana",
  characters: [{ id: "c1", name: "Mira", avatar: img("A") }],
  chats: [{ id: "x", kind: "character", characterId: "c1", messages: [{ id: "m1", role: "assistant", content: "Hi" }] }],
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

/* reads of the chats store fail, as with a damaged database */
const breakReads = () => {
  const getAll = IDBObjectStore.prototype.getAll;
  vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(function (...args) {
    if (this.name === "chats") throw new DOMException("disk I/O error", "UnknownError");
    return getAll.apply(this, args);
  });
};

describe("a failed load never becomes an overwrite", () => {
  it("starts a fresh install with empty data and saves normally", async () => {
    const d = await loadData();
    expect(d).toEqual(JSON.parse(JSON.stringify(emptyData)));
    expect(storageReadFailed()).toBe(false);
    await expect(saveData({ ...d, username: "New" })).resolves.toBeUndefined();
  });

  it("throws on unreadable stored data, refuses saves, and loads it once reads work again", async () => {
    await saveData(state());
    resetStorageForTests();
    breakReads();
    await expect(loadData()).rejects.toBeInstanceOf(StorageReadError);
    expect(storageReadFailed()).toBe(true);
    await expect(saveData(structuredClone(emptyData))).rejects.toThrow(/could not read its saved data/);
    vi.restoreAllMocks();
    const back = await loadData();
    expect(back.username).toBe("Ana");
    expect(back.characters[0].avatar).toBe(img("A"));
    expect(back.chats.map((c) => c.id)).toEqual(["x"]);
    expect(storageReadFailed()).toBe(false);
  });

  it("treats a failed read of the state record as a failed load", async () => {
    await saveData(state());
    resetStorageForTests();
    const get = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (...args) {
      if (this.name === "state") throw new Error("broken");
      return get.apply(this, args);
    });
    await expect(loadData()).rejects.toThrow(StorageReadError);
  });

  it("lets a confirmed restore replace unreadable data, clearing what was there", async () => {
    await saveData(state());
    resetStorageForTests();
    breakReads();
    await expect(loadData()).rejects.toThrow();
    vi.restoreAllMocks();
    const restored = { ...structuredClone(emptyData), username: "Restored", chats: [{ id: "r", kind: "character", messages: [] }] };
    await saveData(restored, { replace: true });
    expect(storageReadFailed()).toBe(false);
    resetStorageForTests();
    const back = await loadData();
    expect(back.username).toBe("Restored");
    /* the old chat does not come back appended after the restored ones */
    expect(back.chats.map((c) => c.id)).toEqual(["r"]);
  });

  it("uses localStorage where there is no IndexedDB, and reports a full one clearly", async () => {
    delete globalThis.indexedDB;
    resetStorageForTests();
    expect((await loadData()).username).toBe("");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(saveData(state())).rejects.toThrow(/local storage is full or unavailable/);
  });
});
