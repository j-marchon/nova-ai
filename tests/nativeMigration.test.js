// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { emptyData } from "../src/lib/data.js";
import { legacyBackupChunks, readLegacyState } from "../src/lib/nativeMigration.js";
import { CORE_KEY, DB_NAME, STATE, STORAGE_KEY, openDb, resetStorageForTests, saveData } from "../src/lib/storage.js";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); localStorage.clear(); resetStorageForTests(); });
afterEach(async () => { resetStorageForTests(); vi.unstubAllGlobals(); localStorage.clear(); });

const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});

describe("read-only native migration", () => {
  it("never splits an emoji across independently UTF-8 encoded chunks", () => {
    const text = "a".repeat(65535) + "🌌" + "b".repeat(65535) + "🌟";
    const chunks = [...legacyBackupChunks(text)];
    expect(chunks.every(chunk => chunk.length <= 65536)).toBe(true);
    expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk, "utf8"))).toString("utf8")).toBe(text);
  });
  it("recognizes a fresh install without creating the old database", async () => {
    expect((await readLegacyState()).found).toBe(false);
    expect(await indexedDB.databases()).toEqual([]);
  });

  it("reads the current split database without modifying it", async () => {
    const data = structuredClone(emptyData);
    data.characters = [{ id: "c", name: "Ada" }];
    data.chats = [{ id: "chat", kind: "character", characterId: "c", messages: [{ id: "m", role: "user", content: "Hello" }] }];
    await saveData(data);
    const db = await openDb();
    const before = await request(db.transaction(STATE).objectStore(STATE).get(CORE_KEY));
    const migrated = await readLegacyState();
    expect(migrated.found).toBe(true);
    expect(migrated.data.characters[0].name).toBe("Ada");
    expect(migrated.data.chats[0].messages[0].content).toBe("Hello");
    expect(await request(db.transaction(STATE).objectStore(STATE).get(CORE_KEY))).toEqual(before);
  });

  it("keeps an older database version and all legacy stores intact", async () => {
    const opening = indexedDB.open(DB_NAME, 3);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore(STATE).put(structuredClone(emptyData), CORE_KEY);
      db.createObjectStore("phone").put({ kept: true }, "legacy");
    };
    const db = await request(opening);
    expect((await readLegacyState()).found).toBe(true);
    expect(db.version).toBe(3);
    expect(await request(db.transaction("phone").objectStore("phone").get("legacy"))).toEqual({ kept: true });
    db.close();
  });

  it("reads localStorage without saving or removing the legacy copy", async () => {
    const raw = JSON.stringify({ ...structuredClone(emptyData), username: "Jo" });
    localStorage.setItem(STORAGE_KEY, raw);
    expect((await readLegacyState()).data.username).toBe("Jo");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(await indexedDB.databases()).toEqual([]);
  });

  it("rejects malformed legacy JSON rather than returning defaults", async () => {
    localStorage.setItem(STORAGE_KEY, "{broken");
    await expect(readLegacyState()).rejects.toThrow();
  });

  it("rejects a valid JSON value that is not recognizable Nova state", async () => {
    localStorage.setItem(STORAGE_KEY, "{}");
    await expect(readLegacyState()).rejects.toThrow("Unrecognized legacy state");
  });

  it("rejects missing chat records rather than silently removing them from the order", async () => {
    const db = await openDb();
    await request(db.transaction(STATE, "readwrite").objectStore(STATE).put({ ...structuredClone(emptyData), format: 2, chatOrder: ["missing"] }, CORE_KEY));
    await expect(readLegacyState()).rejects.toThrow("Legacy chat records are inconsistent");
  });

  it("does not fall back to stale data when IndexedDB cannot be opened", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyData));
    vi.stubGlobal("indexedDB", { open() { throw new Error("Disk unavailable"); } });
    await expect(readLegacyState()).rejects.toThrow("Disk unavailable");
  });

  it("rejects a missing image before normalization can erase its reference", async () => {
    const db = await openDb();
    const tx = db.transaction(STATE, "readwrite");
    await request(tx.objectStore(STATE).put({ ...structuredClone(emptyData), format: 2, chatOrder: [], avatar: "nova-img:missing" }, CORE_KEY));
    await expect(readLegacyState()).rejects.toThrow("Legacy media missing is missing");
  });
});
