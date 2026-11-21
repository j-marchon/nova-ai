import { normalizeData } from "./data.js";
import { coreRecord, extractImages, imageId, isImage, joinState } from "./storage.js";
import { writeChunked } from "./cards.js";

/* ---------- full backups ----------

   One JSON file holding everything the app keeps: characters, universes,
   personas, lorebooks, chats, settings (credentials opt-in), appearance
   and the ledger. It is written to the phone, never anywhere else, because
   the app's own storage goes with the app when it is uninstalled.

   The file uses the same split the database does: the state record, one
   record per chat, and every picture once, keyed by its hash. An avatar used
   by a character, its persona and a hundred messages is in the file once.

   Skins added on this device can ride along in "skins": each as the zip it
   came in ({ id, name, version, zip } with the zip in base64, from
   exportPacks in skins/store.js). Backups opt in (Include skins); Sync
   always carries them. They are not part of the app's state: restoring
   hands them to importPacks, which checks each like a file added by hand.
   Older versions of Nova ignore the section. */

export const BACKUP_APP = "nova";
export const BACKUP_FORMAT = 1;

/* The backup file in pieces whose concatenation is the file: the header and
   the state record, then one chat and one picture at a time. A library with every picture in it can be hundreds of MB, more than
   a phone can hold as one string, so the writer (writeChunked in cards.js)
   takes the pieces as they come and nothing ever builds the whole file.
   `onProgress(fraction)` is called as records are taken. */
export function* backupParts(state, version = "", { includeCredentials = false, createdAt = Date.now(), onProgress, skins = null } = {}) {
  if (!includeCredentials) state = { ...state, settings: redactCredentials(state.settings) };
  const found = new Map();
  const core = coreRecord(state, found);
  const chats = Array.isArray(state.chats) ? state.chats : [];
  /* progress counts records, so the pictures are counted first (ids are
     cached, so this is a walk, not a second round of hashing) */
  let done = 0;
  let total = 1;
  if (onProgress) {
    const ids = new Set(found.keys());
    const count = (v) => {
      if (isImage(v)) ids.add(imageId(v));
      else if (Array.isArray(v)) for (const x of v) count(x);
      else if (v && typeof v === "object") for (const k of Object.keys(v)) count(v[k]);
    };
    count(chats);
    total = 1 + chats.length + ids.size;
  }
  const tick = () => { done++; onProgress?.(Math.min(1, done / total)); };
  const json = (v) => JSON.stringify(v) ?? "null";
  yield `{"app":${json(BACKUP_APP)},"backup":${BACKUP_FORMAT},"version":${json(version ?? "")},"createdAt":${json(createdAt)},"core":${json(core)},"chats":[`;
  tick();
  for (let i = 0; i < chats.length; i++) {
    yield (i ? "," : "") + json(extractImages(chats[i], found));
    tick();
  }
  yield `],"images":{`;
  let i = 0;
  for (const [id, img] of found) {
    yield `${i++ ? "," : ""}${json(id)}:${json(img)}`;
    tick();
  }
  yield "}";
  if (Array.isArray(skins) && skins.length) {
    yield `,"skins":[`;
    for (let k = 0; k < skins.length; k++) yield (k ? "," : "") + json(skins[k]);
    yield "]";
  }
  yield "}";
  onProgress?.(1);
}

/* The whole backup as one string, for small libraries and tests. The native
   writers use backupParts. */
export function makeBackup(state, version = "", opts = {}) {
  return [...backupParts(state, version, opts)].join("");
}

/* The file name carries the date and time, so backups never overwrite each
   other and sort in the order they were made. */
export function backupName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `nova-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

/* A backup's text back into app state, plus when it was made and the
   skins it carries (still to be checked and added by importPacks). Throws with a
   readable message when the file is not a Nova backup. A backup made while
   the old in-story phone or the social media feature (removed in 3.2)
   existed still imports: its `social` section is ignored, normalizeData
   drops the phone and social fields left on chats, cards and settings, and
   pictures only they used are never restored. */
export function readBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    /* a file bigger than this device can hold as one value */
    if (e instanceof RangeError) throw new RangeError("That backup is too large to open on this device.");
    throw new Error("That file is not a Nova backup.");
  }
  if (!raw || raw.app !== BACKUP_APP || typeof raw.backup !== "number" || !raw.core) {
    throw new Error("That file is not a Nova backup.");
  }
  if (raw.backup > BACKUP_FORMAT) throw new Error("That backup is from a newer version of Nova. Update the app first.");
  const images = new Map(Object.entries(raw.images || {}));
  const state = normalizeData(joinState(raw.core, Array.isArray(raw.chats) ? raw.chats : [], images));
  const skins = Array.isArray(raw.skins) ? raw.skins.filter((s) => s && typeof s.zip === "string") : [];
  return { state, createdAt: raw.createdAt || null, skins };
}

/* What a backup holds, for the line that asks before restoring it. */
export function backupSummary(state, skins = null) {
  const n = (list, one) => {
    const k = (list || []).length;
    return `${k} ${one}${k === 1 ? "" : "s"}`;
  };
  const parts = [n(state.characters, "character"), n(state.universes, "universe"), n(state.personas, "persona"), n(state.chats, "chat")];
  if (Array.isArray(skins) && skins.length) parts.push(n(skins, "skin"));
  return parts.join(" · ");
}

/* ---------- the daily backup ----------

   Once a day, the first time the app opens, a backup goes to
   Documents/Nova/Daily, named by the date, so whether today's exists is the
   only state there is. The newest KEEP_DAILY are kept and older ones are
   deleted. Only in the Android app: in a browser this would be a download
   nobody asked for. */

export const DAILY_FOLDER = "Nova/Daily";
export const KEEP_DAILY = 7;
const DAILY = /^nova-daily-\d{4}-\d{2}-\d{2}\.json$/;

export function dailyName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `nova-daily-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

/* Of the daily backups in a folder listing, the ones to delete: everything
   past the newest `keep`. The names sort by date. Other files are left be. */
export function staleDaily(names, keep = KEEP_DAILY) {
  return names.filter((n) => DAILY.test(n)).sort().reverse().slice(keep);
}

/* Returns the path written, or null when there was nothing to do. `skins`
   is the list for the file, or a function that gets it. The file
   is written through a .part and renamed when complete, so a daily backup
   under its final name is always whole; a .part left by a write that was
   cut off (the app killed mid-way) is removed first and never counts. */
const names = (listing) => (listing?.files || []).map((f) => (typeof f === "string" ? f : f.name));
export async function dailyBackup(state, version = "", fs = nativeFs(), { skins = null } = {}) {
  if (!fs) return null;
  /* An empty app, as right after a reinstall, is not worth a backup and
     would push a real one out of the seven. */
  if (!state.characters?.length && !state.universes?.length && !state.chats?.length) return null;
  const name = dailyName();
  const path = `${DAILY_FOLDER}/${name}`;
  try {
    const listing = await fs.readdir({ path: DAILY_FOLDER, directory: "DOCUMENTS" });
    for (const n of names(listing)) {
      if (n.endsWith(".part")) await Promise.resolve().then(() => fs.deleteFile({ path: `${DAILY_FOLDER}/${n}`, directory: "DOCUMENTS" })).catch(() => {});
    }
  } catch {}
  try {
    await fs.stat({ path, directory: "DOCUMENTS" });
    return null;
  } catch {}
  /* the skins only when today's file is actually written */
  const list = typeof skins === "function" ? await skins() : skins;
  await writeChunked(fs, path, backupParts(state, version, { skins: list }), { directory: "DOCUMENTS" });
  try {
    const listing = await fs.readdir({ path: DAILY_FOLDER, directory: "DOCUMENTS" });
    for (const n of staleDaily(names(listing))) await Promise.resolve().then(() => fs.deleteFile({ path: `${DAILY_FOLDER}/${n}`, directory: "DOCUMENTS" })).catch(() => {});
  } catch {}
  return `Documents/${path}`;
}

function nativeFs() {
  return globalThis.window?.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.Filesystem || null : null;
}

/* the names credentials go by anywhere in settings */
export const CREDENTIAL_KEY = /^(key|api_?key|googleKey|bridgeKey|access_?token|refresh_?token|token|password|secret|authorization)$/i;

// Backups may contain nested voice/image provider settings as well as chat keys.
export function redactCredentials(value) {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    CREDENTIAL_KEY.test(key) ? "" : redactCredentials(item),
  ]));
}
