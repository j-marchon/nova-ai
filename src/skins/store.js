import { officialSkinOf } from "./official.js";
import { SkinError, compareVersions, isPackId, packMeta, readPack } from "./pack.js";

/* ---------- the skins on this device ----------

   Each added skin is kept as the zip it came in, in its own IndexedDB
   database (nova-skins), apart from the library: the library is saved on
   every change, and a skin's few hundred KB should not ride along. The zip
   is checked again (readPack) whenever it is worn, so what is stored is
   never trusted more than a fresh file.

   A small list of what is installed (name, version, swatch) is mirrored in
   localStorage, so the startup screen and the skin list know what exists
   before the database has opened. */

const DB = "nova-skins";
const STORE = "packs";
const INDEX = "nova-skin-packs";

const listeners = new Set();
let index = null;
let rev = 0;
const tell = () => { rev++; for (const fn of listeners) fn(); };

function readIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX) || "[]");
    return Array.isArray(list) ? list.filter((m) => isPackId(m?.id) && typeof m.name === "string") : [];
  } catch { return []; }
}
function writeIndex(list) {
  index = list;
  try { localStorage.setItem(INDEX, JSON.stringify(list)); } catch { /* private mode: this session only */ }
  tell();
}

/* What is installed, for the skin list. Same array until something changes. */
export function installedSkins() {
  if (!index) index = readIndex();
  return index;
}
export const skinsRevision = () => rev;
export function onSkinsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- IndexedDB, with a memory fallback (tests, a locked-down browser) ---------- */
const memory = new Map();
let dbPromise = null;
function openDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}
async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function putBytes(id, bytes) {
  await tx("readwrite", (s) => (s ? req(s.put(bytes, id)) : memory.set(id, bytes)));
}
async function deleteBytes(id) {
  await tx("readwrite", (s) => (s ? req(s.delete(id)) : memory.delete(id)));
}

/* The zip of an installed skin, or null. */
export async function packBytes(id) {
  if (!isPackId(id)) return null;
  const v = await tx("readonly", (s) => (s ? req(s.get(id)) : memory.get(id)));
  return v ? new Uint8Array(v) : null;
}

/* Adds a skin from its zip. Throws a SkinError the person can read.
   `onlyNewer` (backups, sync) leaves a skin alone unless this copy is a
   newer version; adding a file by hand always replaces it.
   Returns { meta, status: "added" | "updated" | "same" | "older" }. */
export async function installPack(input, { onlyNewer = false, expect = null } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  /* only the published files (official.js); `expect` names the skin the
     person asked to unlock */
  const official = await officialSkinOf(bytes);
  if (!official || (expect && official !== "*" && official !== expect)) {
    throw new SkinError(expect ? "That file is not this skin. Pick the .zip you got as a supporter, as it is, without unzipping it." : "That is not a published Nova skin.");
  }
  const pack = readPack(bytes);
  const meta = packMeta(pack);
  const had = installedSkins().find((m) => m.id === meta.id);
  if (had && onlyNewer) {
    const c = compareVersions(meta.version, had.version);
    if (c <= 0) return { meta: had, status: c === 0 ? "same" : "older" };
  }
  await putBytes(meta.id, bytes.slice());
  writeIndex([...installedSkins().filter((m) => m.id !== meta.id), { ...meta, addedAt: Date.now() }]);
  return { meta, status: had ? "updated" : "added" };
}

export async function removePack(id) {
  await deleteBytes(id);
  writeIndex(installedSkins().filter((m) => m.id !== id));
}

/* The list and the database can only disagree if site data was half
   cleared; at startup, drop what the database no longer has. */
export async function reconcileSkins() {
  const list = installedSkins();
  if (!list.length) return;
  const keep = [];
  for (const m of list) {
    try { if (await packBytes(m.id)) keep.push(m); } catch { keep.push(m); }
  }
  if (keep.length !== list.length) writeIndex(keep);
}

/* ---------- carrying skins in a backup or through Sync ---------- */

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Every installed skin as { id, name, version, zip } (zip in base64). */
export async function exportPacks() {
  const out = [];
  for (const m of installedSkins()) {
    const bytes = await packBytes(m.id).catch(() => null);
    if (bytes) out.push({ id: m.id, name: m.name, version: m.version, zip: toBase64(bytes) });
  }
  return out;
}

/* Skins from a backup or the Bridge. Each goes through readPack like a
   file added by hand; one that fails is skipped, never the whole restore.
   Only a skin this device lacks, or a newer version, is written. */
export async function importPacks(list) {
  const result = { added: 0, updated: 0, failed: 0 };
  if (!Array.isArray(list)) return result;
  for (const item of list.slice(0, 50)) {
    try {
      if (typeof item?.zip !== "string") throw new SkinError("no zip");
      const { status } = await installPack(fromBase64(item.zip), { onlyNewer: true });
      if (status === "added") result.added++;
      else if (status === "updated") result.updated++;
    } catch (e) {
      result.failed++;
      console.warn("A skin in the backup could not be added:", e?.message || e);
    }
  }
  return result;
}

/* "2 skins" for a backup's summary line */
export const skinsSummary = (list) => {
  const n = Array.isArray(list) ? list.length : 0;
  return n ? `${n} skin${n === 1 ? "" : "s"}` : "";
};

/* " 2 skins added." after a restore or sync, or nothing */
export function skinNote({ added = 0, updated = 0, failed = 0 } = {}) {
  const bits = [];
  if (added) bits.push(`${added} skin${added === 1 ? "" : "s"} added`);
  if (updated) bits.push(`${updated} skin${updated === 1 ? "" : "s"} updated`);
  if (failed) bits.push(`${failed} skin${failed === 1 ? "" : "s"} could not be added`);
  return bits.length ? ` ${bits.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "";
}

/* for tests */
export function resetSkinsForTests() {
  memory.clear();
  index = null;
  dbPromise = null;
  rev = 0;
}
