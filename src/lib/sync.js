import { activeProvider } from "./providers.js";
import { endpointFor, sendTo, unreachable, unwrapError } from "./api.js";
import { CREDENTIAL_KEY, backupParts, backupSummary, readBackup } from "./backup.js";

/* ---------- syncing devices through Nova Bridge ----------

   The Bridge keeps one shared copy (bridge.mjs, "Sync between devices"):
   the last backup any device sent it. Send puts this device's backup there,
   exactly the file Back up now writes, with the same switches (Settings →
   You → Backup): the library, settings, response styles and appearance,
   plus API keys and credentials when Include API keys is on, and the skins
   added on this device when Include skins is on. Get brings the copy here
   to merge into this device or replace it.

   Getting also takes the copy's settings, response styles, appearance and
   name, but never what belongs to this device alone (syncSettings): its
   own Nova Bridge connection (the address and the key it was approved
   with), its UI size, its sync and daily-backup switches. A key the copy
   does not carry (sent without Include API keys) never blanks this
   device's own; providers and response styles only this device has are
   kept. The spend ledger stays per device.

   Sending says which copy this device last got or sent (its revision). If
   another device has synced since, the Bridge refuses, so nobody overwrites
   changes they have not seen; getting and merging first clears it. */

export const SYNCED = ["characters", "universes", "personas", "lorebooks", "chats"];

/* The saved Nova Bridge, whether or not it is the provider in use. */
export function syncEndpoint(settings) {
  const list = settings?.providers || [];
  const active = activeProvider(settings);
  const p = active?.preset === "nova-bridge" ? active : list.find((x) => x.preset === "nova-bridge");
  return p ? endpointFor({ ...settings, activeProvider: p.id }) : null;
}

export class SyncBehind extends Error {
  constructor(rev) { super("Another device synced since this one last did. Get its changes first."); this.rev = rev; }
}

async function call(settings, path, init = {}) {
  const ep = syncEndpoint(settings);
  if (!ep) throw new Error("Add Nova Bridge in Settings → Providers to sync this device.");
  const headers = { ...(init.headers || {}), ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}) };
  let res;
  try {
    res = await sendTo(ep, settings, path, { ...init, headers });
  } catch (e) {
    if (e.name === "AbortError" || !(e instanceof TypeError)) throw e;
    throw new Error(unreachable(ep));
  }
  if (res.ok) return res;
  const data = await res.json().catch(() => null);
  if (res.status === 409) throw new SyncBehind(Number(data?.rev) || 0);
  if (res.status === 401 || res.status === 403) throw new Error(unwrapError(data)?.error?.message || "The Bridge did not accept this device. Request access again in Settings → Providers → Nova Bridge.");
  if (res.status === 404 && path === "/sync") throw new Error("This Bridge cannot sync. Update Nova Bridge.");
  throw new Error(unwrapError(data)?.error?.message || `The Bridge answered with error ${res.status}.`);
}

/* What the Bridge holds: { rev, at, device, summary, bytes }, rev 0 when empty. */
export async function syncStatus(settings, { signal } = {}) {
  const meta = await (await call(settings, "/sync", { signal })).json().catch(() => null);
  return meta && typeof meta === "object" ? { ...meta, rev: Number(meta.rev) || 0 } : { rev: 0 };
}

/* Sends this device's library. `baseRev` is the revision it last got or
   sent; null skips the check, for "send anyway". Returns the new note. */
/* onProgress(fraction, phase): "build" while the file is put together,
   then "upload" as it goes to the Bridge. */
export async function syncSend(settings, data, { baseRev = null, version = "", device = "", onProgress, signal, skins = null, includeCredentials = false } = {}) {
  const parts = [...backupParts(data, version, { onProgress: onProgress && ((f) => onProgress(f, "build")), skins, includeCredentials })];
  const headers = {
    "Content-Type": "application/json",
    "X-Nova-Device": encodeURIComponent(device || deviceName()),
    "X-Nova-Summary": encodeURIComponent(backupSummary(data, skins)),
    "X-Nova-Version": encodeURIComponent(version || ""),
  };
  if (baseRev != null) headers["X-Nova-Base-Rev"] = String(baseRev);
  const res = await call(settings, "/sync", { method: "PUT", headers, body: new Blob(parts, { type: "application/json" }), signal, onUploadProgress: onProgress && ((f) => onProgress(f, "upload")) });
  return res.json();
}

/* The Bridge's copy, read like a backup file: { state, rev, skins }. */
export async function syncGet(settings, { signal } = {}) {
  const res = await call(settings, "/sync/data", { signal });
  const rev = Number(res.headers.get("X-Nova-Rev")) || 0;
  const { state, skins } = readBackup(await res.text());
  return { state, rev, skins };
}

export const deviceName = () => {
  const ua = globalThis.navigator?.userAgent || "";
  if (/Electron/i.test(ua)) return "Nova desktop";
  if (/Android/i.test(ua)) return "Nova on Android";
  if (/iPhone|iPad/i.test(ua)) return "Nova on iPhone";
  return "Nova in a browser";
};

const stamp = (x) => Number(x?.updatedAt) || 0;

/* Merging: everything on either device is kept. Something on both keeps the
   copy changed more recently (chats, and anything saved in an editor from
   now on, carry updatedAt); with no way to tell, this device's own copy.
   Nothing is deleted, so something deleted on one device comes back from
   the other's copy; Replace is for making a device match exactly.
   Returns the patch for update() and what changed, for the note. */
export function mergeLibrary(local, remote) {
  const patch = {};
  let added = 0, updated = 0;
  for (const key of SYNCED) {
    const mine = Array.isArray(local[key]) ? local[key] : [];
    const theirs = Array.isArray(remote[key]) ? remote[key] : [];
    const at = new Map(mine.map((x, i) => [x?.id, i]));
    const out = [...mine];
    let changed = false;
    for (const item of theirs) {
      if (!item?.id) continue;
      const i = at.get(item.id);
      if (i == null) { out.push(item); at.set(item.id, out.length - 1); added++; changed = true; }
      else if (stamp(item) > stamp(out[i])) { out[i] = item; updated++; changed = true; }
    }
    if (changed) patch[key] = out;
  }
  return { patch, added, updated };
}

/* Replacing: this device's library becomes the copy. */
export function replaceLibrary(remote) {
  return Object.fromEntries(SYNCED.map((k) => [k, Array.isArray(remote[k]) ? remote[k] : []]));
}

/* settings that belong to this device, whatever the copy says */
export const DEVICE_SETTINGS = ["syncRev", "syncAt", "bridgeLan", "bridgeCardOpen", "dailyBackup", "updateCheck", "defaultsGen"];
const isBridge = (p) => p?.preset === "nova-bridge";
const filled = (v) => v != null && v !== "";

/* The copy's value, with every credential it left blank (a backup sent
   without Include API keys) filled from this device's own. */
function keepSecrets(theirs, mine) {
  if (Array.isArray(theirs)) return theirs.map((v, i) => keepSecrets(v, Array.isArray(mine) ? mine[i] : undefined));
  if (!theirs || typeof theirs !== "object") return theirs;
  const out = {};
  for (const [k, v] of Object.entries(theirs)) {
    const own = mine && typeof mine === "object" ? mine[k] : undefined;
    out[k] = CREDENTIAL_KEY.test(k) && typeof v === "string" ? (filled(v) ? v : (own ?? v)) : keepSecrets(v, own);
  }
  return out;
}

/* Union by id: the copy's version of each, this device's keys where the
   copy has none, then what only this device has. */
function unionById(mine, theirs) {
  const own = new Map((mine || []).filter((x) => x?.id).map((x) => [x.id, x]));
  const out = (theirs || []).filter((x) => x?.id).map((x) => (own.has(x.id) ? keepSecrets(x, own.get(x.id)) : x));
  const seen = new Set(out.map((x) => x.id));
  for (const x of mine || []) if (x?.id && !seen.has(x.id)) out.push(x);
  return out;
}

/* The settings a device ends up with after getting the copy. `how` is
   "merge" or "replace"; both take the copy's settings, and differ only in
   response styles: merging keeps the ones only this device has. */
export function syncSettings(mine = {}, theirs = {}, how = "merge") {
  const out = keepSecrets({ ...mine, ...theirs }, mine);
  /* providers: the copy's, this device's keys where it has none, and this
     device's own Nova Bridge (its address and the key it was approved
     with; another device's is no use here) */
  const ownBridges = (mine.providers || []).filter(isBridge);
  out.providers = [...unionById((mine.providers || []).filter((p) => !isBridge(p)), (theirs.providers || []).filter((p) => !isBridge(p))), ...ownBridges];
  if (!out.providers.some((p) => p.id === out.activeProvider)) {
    const was = (theirs.providers || []).find((p) => p.id === theirs.activeProvider);
    out.activeProvider = (isBridge(was) && ownBridges[0]?.id) || mine.activeProvider || out.providers[0]?.id;
  }
  if (Array.isArray(theirs.customStyles)) out.customStyles = how === "merge" ? unionById(mine.customStyles, theirs.customStyles) : theirs.customStyles;
  if (out.customStyleId && !(out.customStyles || []).some((x) => x.id === out.customStyleId)) out.customStyleId = "";
  for (const k of DEVICE_SETTINGS) {
    if (k in mine) out[k] = mine[k];
    else delete out[k];
  }
  return out;
}

/* Everything getting the copy changes on this device: the library (merged
   or replaced), settings, appearance (but its UI size) and name. */
export function applySync(local, remote, how = "merge") {
  const library = how === "merge" ? mergeLibrary(local, remote).patch : replaceLibrary(remote);
  const appearance = remote.appearance ? { ...local.appearance, ...remote.appearance, uiScale: local.appearance?.uiScale, skinInChat: local.appearance?.skinInChat } : local.appearance;
  return {
    ...library,
    settings: syncSettings(local.settings, remote.settings, how),
    appearance,
    username: remote.username || local.username,
  };
}
