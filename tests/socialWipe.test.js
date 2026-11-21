// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  CHATS, CORE_KEY, DB_NAME, DB_VERSION, IMAGES, LEGACY_PHONE, LEGACY_SOCIAL, STATE,
  loadData, openDb, resetStorageForTests, saveData,
} from "../src/lib/storage.js";
import { LEGACY_PHONE_CHAT_KEYS, LEGACY_SOCIAL_CHAT_KEYS, emptyData, normalizeData } from "../src/lib/data.js";
import { BACKUP_APP, makeBackup, readBackup } from "../src/lib/backup.js";

/* The social media feature was removed in 3.2 (and the in-story phone before
   it). Saves, databases and backups from before then still load; everything
   either feature left in them is dropped. */

const img = (c) => `data:image/png;base64,${c.repeat(3000)}`;
const messages = [{ id: "m1", role: "assistant", content: "Hi" }, { id: "m2", role: "user", content: "Hello" }];
const blank = () => JSON.parse(JSON.stringify(emptyData));

const socialSettings = { enabled: true, usage: "high", repliesPerPage: 7, prompts: { turn: { text: "x", baseVersion: 1 } } };
const socialWorld = { id: "w1", origin: { kind: "chat", chatId: "x" }, posts: { p1: { id: "p1", body: "Posted" } } };
const socialChatFields = { socialWorldId: "w1", socialMode: "on", socialUsage: "full", socialContext: false, socialPaused: true };

/* the same library with nothing of either retired feature in it */
function cleanState() {
  return {
    ...blank(),
    ledger: { ...blank().ledger, spent: 1.5 },
    characters: [{ id: "c1", name: "Ivo", description: "A friend" }],
    universes: [{ id: "u1", name: "Town", characters: [] }],
    chats: [{
      id: "x", kind: "character", characterId: "c1", messages,
      bookmarks: [{ id: "b1", messageId: "m1", label: "start", createdAt: 1 }],
    }],
  };
}

/* what a 3.1 save carried, roughly as the social feature wrote it */
function oldState() {
  const s = cleanState();
  return {
    ...s,
    socialWorlds: { w1: socialWorld },
    settings: { ...s.settings, social: socialSettings, phone: { defaultEnabled: true } },
    characters: s.characters.map((c) => ({ ...c, social: { mode: "on" }, phone: { mode: "on" } })),
    universes: s.universes.map((u) => ({ ...u, social: { mode: "off" } })),
    chats: s.chats.map((c) => ({ ...c, ...socialChatFields, phoneWorld: "old", phoneMode: "on" })),
  };
}

function expectNoSocial(d) {
  expect(d).not.toHaveProperty("socialWorlds");
  expect(d.settings).not.toHaveProperty("social");
  expect(d.settings).not.toHaveProperty("phone");
  for (const c of d.characters) { expect(c).not.toHaveProperty("social"); expect(c).not.toHaveProperty("phone"); }
  for (const u of d.universes) { expect(u).not.toHaveProperty("social"); expect(u).not.toHaveProperty("phone"); }
  for (const c of d.chats) for (const k of [...LEGACY_SOCIAL_CHAT_KEYS, ...LEGACY_PHONE_CHAT_KEYS]) expect(c).not.toHaveProperty(k);
}

function openAt(version, upgrade) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, version);
    r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const put = (db, writes) => new Promise((res, rej) => {
  const tx = db.transaction([...new Set(writes.map(([s]) => s))], "readwrite");
  for (const [s, value, key] of writes) tx.objectStore(s).put(value, key);
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
});

async function dump(store) {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  const get = (req) => new Promise((res) => { req.onsuccess = () => res(req.result); });
  const [keys, vals] = await Promise.all([get(tx.objectStore(store).getAllKeys()), get(tx.objectStore(store).getAll())]);
  return new Map(keys.map((k, i) => [k, vals[i]]));
}

/* a version 4 database as 3.1 left it: the chat names its social world, the
   world is in pages in the social store, and one picture is only the world's */
async function seedV4() {
  const db = await openAt(4, (d) => { for (const s of [STATE, CHATS, IMAGES, LEGACY_SOCIAL]) d.createObjectStore(s); });
  const { chats, socialWorlds, ...core } = oldState();
  await put(db, [
    [STATE, { ...core, format: 2, chatOrder: ["x"] }, CORE_KEY],
    [CHATS, chats[0], "x"],
    [LEGACY_SOCIAL, { id: "w1", origin: socialWorld.origin }, "w1|meta"],
    [LEGACY_SOCIAL, { a1: { id: "a1", avatar: "nova-img:socialonly" } }, "w1|accounts|3"],
    [IMAGES, img("S"), "socialonly"],
  ]);
  db.close();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  localStorage.clear();
});

describe("social wipe: loading old state", () => {
  it("drops every social field and leaves everything else as a clean save would load", () => {
    const d = normalizeData(oldState());
    expectNoSocial(d);
    expect(d).toEqual(normalizeData(cleanState()));
    expect(d.chats[0].messages).toEqual(messages);
    expect(d.chats[0].bookmarks).toHaveLength(1);
    expect(d.ledger.spent).toBe(1.5);
  });

  it("gives a fresh install no social data", () => {
    expect(emptyData).not.toHaveProperty("socialWorlds");
    expect(emptyData.settings).not.toHaveProperty("social");
    expectNoSocial(normalizeData(blank()));
  });

  it("drops social fields that are not even readable", () => {
    const s = oldState();
    s.socialWorlds = [null];
    s.settings.social = "garbage";
    s.characters[0].social = 42;
    s.chats[0].socialWorldId = { nope: true };
    expectNoSocial(normalizeData(s));
  });

  it("keeps a valid handset on chats, and drops one that is not", () => {
    const s = cleanState();
    const handset = {
      level: "light",
      tick: { n: 2, lastMsgId: "m1", pending: false },
      people: { "npc:bea": { key: "npc:bea", handle: "bea", name: "Bea" } },
      posts: [{ id: "m2a", app: "murmur", by: "npc:bea", text: "Rain again.", tick: 2, anchor: { id: "m1", swipe: 0 } }],
      threads: { "npc:bea": [{ id: "d2a", from: "npc:bea", text: "you up?", tick: 2, anchor: { id: "m1", swipe: 0 } }] },
      seen: { murmur: 1, glimpse: 0, messages: { "npc:bea": 1 } },
    };
    s.chats[0].handset = handset;
    /* a v1 handset migrates to v2 and keeps what the person saw */
    const kept = normalizeData(s).chats[0].handset;
    expect(kept.v).toBe(2);
    expect(kept.threads["npc:bea"].map((l) => l.id)).toEqual(["d2a"]);
    expect(kept.posts.map((p) => p.id)).toContain("m2a");
    expect(kept.seen.messages["npc:bea"]).toBe(1);
    s.chats[0].handset = { kept: true };
    expect("handset" in normalizeData(s).chats[0]).toBe(false);
  });
});

describe("social wipe: old backups", () => {
  it("imports an old-format backup with a social section and chat social keys", () => {
    const { chats, socialWorlds, ...core } = oldState();
    const file = JSON.stringify({
      app: BACKUP_APP, backup: 1, version: "3.1.0", createdAt: 5,
      core: { ...core, format: 2, chatOrder: ["x"] },
      chats,
      social: { w1: { ...socialWorlds.w1, banner: "nova-img:socialonly" } },
      images: { socialonly: img("S") },
    });
    const { state, createdAt } = readBackup(file);
    expect(createdAt).toBe(5);
    expectNoSocial(state);
    expect(state.chats.map((c) => c.id)).toEqual(["x"]);
    expect(state.chats[0].messages).toEqual(messages);
    expect(state.characters[0].name).toBe("Ivo");
    expect(JSON.stringify(state)).not.toContain(img("S"));
  });

  it("writes no social section or fields into a new backup", () => {
    const parsed = JSON.parse(makeBackup(oldState(), "now"));
    expect(parsed).not.toHaveProperty("social");
    expect(Object.keys(parsed)).toEqual(["app", "backup", "version", "createdAt", "core", "chats", "images"]);
    const clean = JSON.parse(makeBackup(normalizeData(oldState()), "now"));
    expect(clean.core.settings).not.toHaveProperty("social");
    expect(clean.chats[0]).not.toHaveProperty("socialWorldId");
  });
});

describe("social wipe: database upgrade to version 5", () => {
  it("is at version 5 and a fresh install has only the three stores", async () => {
    expect(DB_VERSION).toBe(5);
    const db = await openDb();
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames].sort()).toEqual([CHATS, IMAGES, STATE].sort());
  });

  it("upgrades a version 4 database: social store gone, chats and state kept", async () => {
    await seedV4();
    const d = await loadData();
    const db = await openDb();
    expect(db.version).toBe(5);
    expect(db.objectStoreNames.contains(LEGACY_SOCIAL)).toBe(false);
    expect([...db.objectStoreNames].sort()).toEqual([CHATS, IMAGES, STATE].sort());
    expectNoSocial(d);
    expect(d.chats[0].messages).toEqual(messages);
    expect(d.characters[0].name).toBe("Ivo");
    expect(d.ledger.spent).toBe(1.5);
  });

  it("keeps saving and loading after the upgrade, and lets the social pictures go", async () => {
    await seedV4();
    const d = await loadData();
    expect((await dump(IMAGES)).has("socialonly")).toBe(true);
    await saveData({ ...d, chats: d.chats.map((c) => ({ ...c, messages: [...c.messages, { id: "m3", role: "assistant", content: "Again" }] })) });
    expect((await dump(IMAGES)).has("socialonly")).toBe(false);
    expect((await dump(CHATS)).get("x")).not.toHaveProperty("socialWorldId");
    resetStorageForTests();
    const back = await loadData();
    expectNoSocial(back);
    expect(back.chats[0].messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("upgrades a version 3 database: phone store gone, nothing social created", async () => {
    const db = await openAt(3, (x) => { for (const s of [STATE, CHATS, IMAGES, LEGACY_PHONE]) x.createObjectStore(s); });
    const { chats, socialWorlds, ...core } = oldState();
    await put(db, [
      [STATE, { ...core, format: 2, chatOrder: ["x"] }, CORE_KEY],
      [CHATS, chats[0], "x"],
      [LEGACY_PHONE, { schemaVersion: 1, worldId: "old" }, "x|meta"],
    ]);
    db.close();
    const d = await loadData();
    const now = await openDb();
    expect([...now.objectStoreNames].sort()).toEqual([CHATS, IMAGES, STATE].sort());
    expectNoSocial(d);
    expect(d.chats[0].messages).toEqual(messages);
  });

  it("upgrades a version 2 database, which had neither store", async () => {
    const db = await openAt(2, (x) => { for (const s of [STATE, CHATS, IMAGES]) x.createObjectStore(s); });
    await put(db, [
      [STATE, { ...blank(), chats: undefined, format: 2, chatOrder: ["x"] }, CORE_KEY],
      [CHATS, { id: "x", kind: "character", messages }, "x"],
    ]);
    db.close();
    const d = await loadData();
    expect(d.chats).toHaveLength(1);
    const now = await openDb();
    expect([...now.objectStoreNames].sort()).toEqual([CHATS, IMAGES, STATE].sort());
  });
});
