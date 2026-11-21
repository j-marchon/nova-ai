import { emptyData, migrateLegacy, normalizeData } from "./data.js";

/* ---------- where everything lives ----------

   IndexedDB, database "nova", these stores:

     state   one record, "data": settings, characters, personas, universes,
             appearance and the ledger, plus the order of the chats.
     chats   one record per chat, keyed by its id, messages included.
     images  one record per picture, keyed by a hash of its bytes.

   It used to be one record holding everything, written whole on every save.
   That was fine while the record was small and stopped being fine once it
   was not: every message sent rewrote every other chat and every avatar and
   background in the app — tens of megabytes on a well-used install, a few
   hundred milliseconds of main-thread serialising on a phone, for a change
   of one line of text.

   Now a save writes the small state record, the chats that actually changed
   (found by reference, which is free because every update replaces the
   objects it touches and keeps the rest), and only pictures it has never
   written before. A picture is content-addressed, so the same avatar used in
   three places is stored once, and one nothing points at any more is deleted.

   In memory nothing changed: the app still holds one object with the images
   inline as data URLs. Splitting and joining happen only here.

   localStorage is still the fallback where IndexedDB is unavailable — a
   private window, mostly — with its old 5MB ceiling, which is why a failed
   write there is surfaced rather than swallowed. A database that opened
   but failed to write is not "unavailable": the save fails and is tried
   again, because a localStorage copy would be ignored on the next start
   in favour of the older one still in IndexedDB.

   Two retired features left stores behind. Version 3 had a phone store for
   the old in-story phone, and version 4 a social store for the social media
   feature (removed in 3.2). The upgrade to 5 deletes both, with everything
   in them, from whatever version is on disk; the fields they left on chat
   records and cards are dropped as they are read (data.js). Pictures only
   they used are no longer referenced, so the first save deletes them. */

export const STORAGE_KEY = "nova-data";
export const LEGACY_KEY = "enredo-data";

export const DB_NAME = "nova";
export const DB_VERSION = 5;
export const STATE = "state";
export const CHATS = "chats";
export const IMAGES = "images";
/* the retired phone's store (version 3) and the retired social media
   feature's store (version 4), both deleted by the upgrade */
export const LEGACY_PHONE = "phone";
export const LEGACY_SOCIAL = "social";
export const CORE_KEY = "data";
/* Written on the state record. A record without it is the old single-record
   layout, read whole and rewritten in the new one on the first save. */
export const FORMAT = 2;

/* A string is stored as a picture when it is an image data URL big enough to
   be worth it. Tiny ones stay inline; a reference would cost about as much.
   Video avatars and backgrounds are data URLs too, and go the same way —
   kept inline they would be rewritten with the state on every save. */
const IMG_MIN = 512;
const REF = "nova-img:";

export const isImage = (v) =>
  typeof v === "string" && v.length >= IMG_MIN && (v.startsWith("data:image/") || v.startsWith("data:video/"));

/* Two 32-bit FNV-1a passes with different seeds and the length: 72 bits of
   address, which is plenty for the few hundred pictures an install holds.
   The id of a string is remembered, so each picture is hashed once per
   session however many times it is saved. Kept to the pictures the last
   save still referenced (see writeIdb), and capped regardless, so pictures
   that were replaced or deleted do not stay in memory for the session. */
const idCache = new Map();
const ID_CACHE_MAX = 4000;
export function imageId(s) {
  const hit = idCache.get(s);
  if (hit) return hit;
  if (idCache.size >= ID_CACHE_MAX) idCache.delete(idCache.keys().next().value);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  const id = `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}${s.length.toString(36)}`;
  idCache.set(s, id);
  return id;
}

/* A copy of `value` with every picture swapped for a reference. The pictures
   go into `found` (id → data URL), and the ids into `ids` when given. */
export function extractImages(value, found, ids) {
  if (isImage(value)) {
    const id = imageId(value);
    found.set(id, value);
    ids?.add(id);
    return REF + id;
  }
  if (Array.isArray(value)) return value.map((v) => extractImages(v, found, ids));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = extractImages(value[k], found, ids);
    return out;
  }
  return value;
}

/* The reverse. A reference whose picture has gone missing becomes an empty
   string, which every image field already treats as "no picture". */
export function restoreImages(value, images) {
  if (typeof value === "string") {
    return value.startsWith(REF) ? images.get(value.slice(REF.length)) || "" : value;
  }
  if (Array.isArray(value)) return value.map((v) => restoreImages(v, images));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = restoreImages(value[k], images);
    return out;
  }
  return value;
}

/* The ids a stored record points at, read straight off its references. */
export function referencedIds(value, ids = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith(REF)) ids.add(value.slice(REF.length));
  } else if (Array.isArray(value)) {
    for (const v of value) referencedIds(v, ids);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) referencedIds(value[k], ids);
  }
  return ids;
}

/* Walking for pictures is the expensive part of a save, so what has not
   changed is not walked again. Every update replaces the objects it touches
   and keeps the rest, so "unchanged" is a reference check: a top-level slice
   of the state (characters, settings, the ledger…) or one message of a chat.
   Each walk is remembered with the pictures it found. */
let sliceCache = new Map();
let messageCache = new WeakMap();

function walked(cache, key, value) {
  let hit = cache.get(key);
  if (!hit || hit.ref !== value) {
    const imgs = new Map();
    const ids = new Set();
    hit = { ref: value, out: extractImages(value, imgs, ids), imgs, ids };
    cache.set(key, hit);
  }
  return hit;
}

function collect(hit, found, ids) {
  for (const [id, img] of hit.imgs) found.set(id, img);
  if (ids) for (const id of hit.ids) ids.add(id);
  return hit.out;
}

/* The state record: everything except the chats, which are kept as an
   ordered list of ids. */
export function coreRecord(state, found, ids) {
  const { chats, ...rest } = state;
  const out = {};
  for (const k of Object.keys(rest)) out[k] = collect(walked(sliceCache, k, rest[k]), found, ids);
  out.format = FORMAT;
  out.chatOrder = (Array.isArray(chats) ? chats : []).map((c) => c?.id);
  return out;
}

/* One chat as stored, its messages walked one by one so a new message in a
   long chat costs one message, not the whole conversation. */
export function chatRecord(chat, found, ids) {
  const out = {};
  for (const k of Object.keys(chat)) {
    if (k === "messages" && Array.isArray(chat.messages)) {
      out.messages = chat.messages.map((m) =>
        m && typeof m === "object" ? collect(walked(messageCache, m, m), found, ids) : extractImages(m, found, ids)
      );
    } else {
      out[k] = extractImages(chat[k], found, ids);
    }
  }
  return out;
}

/* Records back into one state object, chats in their saved order. A chat
   whose id is missing from the order (it should not happen) goes last rather
   than being dropped. */
export function joinState(core, chatRecords, images) {
  const { format, chatOrder, ...rest } = core;
  /* a damaged store or backup can hold a null where a chat was */
  const byId = new Map(chatRecords.filter((c) => c && typeof c === "object").map((c) => [c.id, c]));
  const ordered = [];
  for (const id of chatOrder || []) {
    const c = byId.get(id);
    if (c) { ordered.push(c); byId.delete(id); }
  }
  ordered.push(...byId.values());
  return restoreImages({ ...rest, chats: ordered }, images);
}

/* ---------- IndexedDB plumbing ---------- */

/* Every version up to DB_VERSION in one step, whatever the old one was:
   the stores that should exist (out-of-line keys, no indexes) are made, and
   the retired phone and social stores go with everything in them. */
export function upgradeDb(db) {
  for (const s of [LEGACY_PHONE, LEGACY_SOCIAL]) if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
  for (const s of [STATE, CHATS, IMAGES]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
}

let dbPromise = null;
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgradeDb(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    /* Another tab holding an old version open would leave this hanging
       forever; failing fast drops us to the localStorage path instead. */
    req.onblocked = () => reject(new Error("blocked"));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const result = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/* A browser is free to evict IndexedDB when the disk gets tight, and it does
   that without asking. Granted persistence takes the data off that list.
   Chrome grants it silently to an installed PWA; elsewhere it is declined and
   nothing is lost by having asked. */
export function askForPersistence() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch {}
}

/* What is already on disk, so a save can skip it: each chat object as it was
   last written (compared by reference), the pictures each one points at, and
   every picture in the store. */
const emptySaved = () => ({ chats: new Map(), chatImages: new Map(), images: new Set() });
let saved = emptySaved();

/* Saves run one after another. Two overlapping ones would each diff against
   the same `saved` and could leave a picture behind that neither deletes. */
let queue = Promise.resolve();

async function writeIdb(state, replace = false) {
  const db = await openDb();
  if (replace) saved = emptySaved();
  const found = new Map();
  const coreIds = new Set();
  const core = coreRecord(state, found, coreIds);

  const chats = state.chats || [];
  const live = new Set(chats.map((c) => c.id));
  const puts = [];
  const chatImages = new Map();
  for (const c of chats) {
    const before = saved.chats.get(c.id);
    if (before === c) {
      chatImages.set(c.id, saved.chatImages.get(c.id) || new Set());
      continue;
    }
    const ids = new Set();
    puts.push(chatRecord(c, found, ids));
    chatImages.set(c.id, ids);
  }

  const referenced = new Set(coreIds);
  for (const ids of chatImages.values()) for (const id of ids) referenced.add(id);

  const tx = db.transaction([STATE, CHATS, IMAGES], "readwrite");
  const finished = done(tx);
  /* A replacement over data that could not be read: what is on disk is
     unknown, so it is cleared in the same transaction rather than diffed. */
  if (replace) {
    for (const store of [STATE, CHATS, IMAGES]) tx.objectStore(store).clear();
  }
  tx.objectStore(STATE).put(core, CORE_KEY);
  for (const rec of puts) tx.objectStore(CHATS).put(rec, rec.id);
  for (const id of saved.chats.keys()) if (!live.has(id)) tx.objectStore(CHATS).delete(id);
  for (const [id, img] of found) if (!saved.images.has(id)) tx.objectStore(IMAGES).put(img, id);
  for (const id of saved.images) if (!referenced.has(id)) tx.objectStore(IMAGES).delete(id);
  await finished;

  /* pictures nothing points at any more need not keep their ids */
  for (const [img, id] of idCache) if (!referenced.has(id)) idCache.delete(img);

  /* only now, once it is really on disk */
  saved = {
    chats: new Map(chats.map((c) => [c.id, c])),
    chatImages,
    images: referenced,
  };
}

/* Set when loadData could not read what is stored. Until a load succeeds,
   saves are refused, so whatever is on disk is never overwritten with the
   empty or partial state the app would otherwise start from. A deliberate
   replacement (a backup restored from the recovery screen) passes
   `replace: true`. */
let readFailed = false;
export const storageReadFailed = () => readFailed;

/* Written to IndexedDB, falling back to localStorage only where IndexedDB is
   genuinely unavailable. */
export function saveData(d, { replace = false } = {}) {
  const run = queue.then(async () => {
    if (readFailed && !replace) throw new Error("Nova could not read its saved data, so nothing is saved until it can.");
    let opened = false;
    try {
      await openDb();
      opened = true;
      await writeIdb(d, replace);
      if (replace) readFailed = false;
      /* Once a copy is safely in IndexedDB the old localStorage record is
         dead weight in a scarce 5MB, and clearing it stops a stale snapshot
         being read back if IndexedDB ever fails to open. */
      try {
        if (localStorage.getItem(STORAGE_KEY)) localStorage.removeItem(STORAGE_KEY);
        if (localStorage.getItem(LEGACY_KEY)) localStorage.removeItem(LEGACY_KEY);
      } catch {}
      return;
    } catch (e) {
      /* the database is there and the write failed: stay unsaved, and let
         the caller try again, rather than leave a copy that the next start
         would skip in favour of the older one in IndexedDB */
      if (opened) throw e;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch (e) {
      throw new Error("Could not save: this browser's local storage is full or unavailable. Export a backup to keep your changes.", { cause: e });
    }
    if (replace) readFailed = false;
  });
  queue = run.catch(() => {});
  return run;
}

async function readIdb() {
  const db = await openDb();
  const tx = db.transaction([STATE, CHATS, IMAGES], "readonly");
  /* All asked for at once: a transaction is only guaranteed to stay
     open while requests are pending, not across an await between them. */
  const [core, chatRecords, imgKeys, imgVals] = await Promise.all([
    result(tx.objectStore(STATE).get(CORE_KEY)),
    result(tx.objectStore(CHATS).getAll()),
    result(tx.objectStore(IMAGES).getAllKeys()),
    result(tx.objectStore(IMAGES).getAll()),
  ]);
  if (!core) return null;

  /* The old single-record layout: everything is already in it. Nothing is on
     disk in the new shape yet, so the first save writes all of it. */
  if (core.format !== FORMAT) {
    saved = emptySaved();
    return normalizeData(core);
  }

  const images = new Map(imgKeys.map((k, i) => [k, imgVals[i]]));
  for (const [id, s] of images) idCache.set(s, id);

  /* an older chat record may still name its phone world (phoneWorld) or its
     social world (socialWorldId); normalizeData drops those fields */
  const d = normalizeData(joinState(core, chatRecords, images));
  const chatImages = new Map(chatRecords.map((c) => [c.id, referencedIds(c)]));
  saved = {
    chats: new Map(d.chats.map((c) => [c.id, c])),
    chatImages,
    images: new Set(images.keys()),
  };
  return d;
}

/* Order matters: IndexedDB first, because after the first run it is the only
   current copy. localStorage is read only as a one-time import, and is
   cleared by the first successful save afterwards.

   Nothing stored yet (a fresh install) gives empty data. Stored data that
   cannot be read is different: loadData throws a StorageReadError, and
   saves are refused (see saveData) until a later load succeeds, because the
   app starting empty and saving would write the empty state over it. The one
   exception is a browser without IndexedDB at all, where localStorage is the
   only store there is. */
export class StorageReadError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "StorageReadError";
  }
}

export async function loadData() {
  let idbError = null;
  if (globalThis.indexedDB) {
    try {
      const stored = await readIdb();
      if (stored) { readFailed = false; return stored; }
    } catch (e) {
      idbError = e;
    }
  }

  /* IndexedDB is there but could not be read: a leftover localStorage copy
     may be older than its records, and loading it would save over them. */
  if (idbError) {
    readFailed = true;
    console.error("Could not read saved data", idbError);
    throw new StorageReadError("Nova could not read its saved data.", { cause: idbError });
  }

  /* localStorage itself may be off (a blocked-storage setting): that is
     "nothing there", not a failure. A record there that does not parse is. */
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  let lsError = null;
  try {
    const raw = read(STORAGE_KEY);
    if (raw) {
      const d = normalizeData(JSON.parse(raw));
      readFailed = false;
      saveData(d).catch(() => {});
      return d;
    }
    const legacy = read(LEGACY_KEY);
    if (legacy) {
      const d = migrateLegacy(JSON.parse(legacy));
      readFailed = false;
      saveData(d).catch(() => {});
      return d;
    }
  } catch (e) {
    lsError = e;
  }

  const failure = idbError || lsError;
  if (failure) {
    readFailed = true;
    console.error("Could not read saved data", failure);
    throw new StorageReadError("Nova could not read its saved data.", { cause: failure });
  }
  readFailed = false;
  return JSON.parse(JSON.stringify(emptyData));
}

/* For tests: forget the open database and what was saved. */
export function resetStorageForTests() {
  dbPromise = null;
  saved = emptySaved();
  queue = Promise.resolve();
  readFailed = false;
  idCache.clear();
  sliceCache = new Map();
  messageCache = new WeakMap();
}
