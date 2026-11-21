import { activeProvider } from "./providers.js";
import { endpointFor, sendTo, unreachable, unwrapError } from "./api.js";
import { backupParts, backupSummary, readBackup } from "./backup.js";

/* ---------- syncing devices through Nova Bridge ----------

   The Bridge keeps one shared copy of the library (bridge.mjs, "Sync between
   devices"): the last backup any device sent it. A device sends its library
   there, or gets the copy and either merges it into its own or replaces its
   own with it.

   What travels is the library: characters, universes, personas, lorebooks
   and chats, and the skins added on the device that sends (their zips, in
   the backup's "skins" section; the getting device adds any it lacks or
   has an older version of, and never removes its own). Settings,
   appearance and the spend ledger stay on each device:
   they hold this device's provider keys and Bridge address, which another
   device's copy (credentials stripped, like any backup) must not wipe.

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
export async function syncSend(settings, data, { baseRev = null, version = "", device = "", onProgress, signal, skins = null } = {}) {
  const parts = [...backupParts(data, version, { onProgress, skins })];
  const headers = {
    "Content-Type": "application/json",
    "X-Nova-Device": encodeURIComponent(device || deviceName()),
    "X-Nova-Summary": encodeURIComponent(backupSummary(data, skins)),
    "X-Nova-Version": encodeURIComponent(version || ""),
  };
  if (baseRev != null) headers["X-Nova-Base-Rev"] = String(baseRev);
  const res = await call(settings, "/sync", { method: "PUT", headers, body: new Blob(parts, { type: "application/json" }), signal });
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

/* Replacing: this device's library becomes the copy; its settings stay. */
export function replaceLibrary(remote) {
  return Object.fromEntries(SYNCED.map((k) => [k, Array.isArray(remote[k]) ? remote[k] : []]));
}
