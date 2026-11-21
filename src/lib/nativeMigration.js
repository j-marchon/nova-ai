import { emptyData, migrateLegacy, normalizeData } from "./data.js";
import { CHATS, CORE_KEY, DB_NAME, FORMAT, IMAGES, LEGACY_KEY, STATE, STORAGE_KEY, joinState, referencedIds } from "./storage.js";

const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Legacy storage could not be read."));
});

const legacyRecord = value => {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("settings" in value || "characters" in value || "chats" in value)) {
    throw new Error("Unrecognized legacy state. Restore a complete Nova backup before migrating.");
  }
  return value;
};

export function* legacyBackupChunks(text, size = 65536) {
  if (!Number.isInteger(size) || size < 2) throw new Error("Invalid migration chunk size.");
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + size, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    yield text.slice(offset, end);
    offset = end;
  }
}

/* Migration must neither upgrade the legacy database nor mistake a read failure for a fresh install. */
async function readDatabase() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let absent = false, blocked = false;
    request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
    request.onerror = () => absent ? resolve(null) : reject(request.error || new Error("Legacy storage could not be opened."));
    request.onblocked = () => { blocked = true; reject(new Error("Close the old Nova window and retry migration.")); };
    request.onsuccess = () => blocked ? request.result.close() : resolve(request.result);
  });
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(STATE)) throw new Error("Unrecognized legacy database. Import a Nova backup instead.");
    const names = [STATE, CHATS, IMAGES].filter(name => db.objectStoreNames.contains(name));
    const tx = db.transaction(names, "readonly");
    const complete = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("Legacy read was interrupted."));
    });
    const get = (store, keys = false) => names.includes(store) ? result(keys ? tx.objectStore(store).getAllKeys() : tx.objectStore(store).getAll()) : Promise.resolve([]);
    const [core, chats, imageKeys, imageValues] = await Promise.all([
      result(tx.objectStore(STATE).get(CORE_KEY)), get(CHATS), get(IMAGES, true), get(IMAGES), complete,
    ]);
    if (!core) {
      if (chats.length || imageKeys.length) throw new Error("Legacy records have no state record. Import a backup instead.");
      return null;
    }
    legacyRecord(core);
    if (core.format !== FORMAT) return normalizeData(core);
    const ids = new Set(chats.map(chat => chat?.id));
    if (ids.has(undefined) || ids.has(null) || ids.has("") || ids.size !== chats.length || (core.chatOrder || []).some(id => !ids.has(id))) {
      throw new Error("Legacy chat records are inconsistent. Restore a complete backup before migrating.");
    }
    const images = new Map(imageKeys.map((key, i) => [key, imageValues[i]]));
    for (const record of [core, ...chats]) {
      for (const id of referencedIds(record)) if (!images.has(id)) throw new Error(`Legacy media ${id} is missing. Restore a complete backup before migrating.`);
    }
    return normalizeData(joinState(core, chats, images));
  } finally { db.close(); }
}

export async function readLegacyState() {
  const stored = await readDatabase();
  if (stored) return { found: true, data: stored };
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) return { found: true, data: normalizeData(legacyRecord(JSON.parse(current))) };
  const old = localStorage.getItem(LEGACY_KEY);
  if (old) return { found: true, data: migrateLegacy(legacyRecord(JSON.parse(old))) };
  return { found: false, data: structuredClone(emptyData) };
}
