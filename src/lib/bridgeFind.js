import { providerFetch } from "./providerTransport.js";
import { BRIDGE_LOCAL, bridgeCandidates, bridgeUrl } from "./providers.js";

/* ---------- finding Nova Bridge ----------

   Nobody should have to type the computer's address. In order, fastest
   first:
     1. the addresses it is likely at (saved, the page's host, last seen LAN
        address, localhost), all at once;
     2. in the Android app, a UDP broadcast the bridge answers (NovaLan, a
        small native plugin, since a web page cannot send UDP);
     3. a sweep of this phone's own network, then of the usual home ones,
        for networks that drop broadcasts.
   Resolves to { base, health } for the first bridge that answers, or null.
   With sweep: false it stops after the broadcast: cheap enough to repeat
   every few seconds while the bridge is missing. */

export const healthOf = (base) => `${String(base).replace(/\/+$/, "").replace(/\/v1$/, "")}/health`;

/* the bridge's /health reply, or null when nothing answers in time */
export function probe(base, ms = 1800, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const stop = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  signal?.addEventListener("abort", stop, { once: true });
  return providerFetch(healthOf(base), { signal: ctl.signal })
    .then((r) => (r.ok ? r.json().catch(() => ({})) : null))
    .then((h) => (h && h.ok !== false ? h : null))
    .catch(() => null)
    .finally(() => { clearTimeout(t); signal?.removeEventListener("abort", stop); });
}

const isNative = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();
const novaLan = () => (isNative() ? globalThis.window.Capacitor.Plugins?.NovaLan || null : null);

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const prefix24 = (ip) => (PRIVATE.test(ip) ? ip.split(".").slice(0, 3).join(".") : "");
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

/* the most common home router networks, swept last */
const USUAL = ["192.168.1", "192.168.0", "10.0.0", "192.168.68", "192.168.86", "192.168.178", "192.168.50", "192.168.31", "192.168.2", "10.0.1"];

/* Which /24 networks to sweep: the phone's own first, then the networks of
   addresses already known, then the usual ones. */
export function sweepPlan({ own = [], known = [] } = {}) {
  const nets = [...own.map(prefix24), ...known.map((u) => prefix24(hostOf(u) || u)), ...USUAL].filter(Boolean);
  return [...new Set(nets)];
}

/* Probe every address on the networks, a batch at a time, until one
   answers. Unused addresses never answer, so the timeout is kept short:
   on a home network a real reply takes a few milliseconds. */
async function sweep(nets, { port = 5005, signal, onProgress } = {}) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (const net of nets) {
      if (ctl.signal.aborted) return null;
      onProgress?.(net);
      const hosts = Array.from({ length: 254 }, (_, i) => `${net}.${i + 1}`);
      let hit = null;
      const BATCH = 64;
      for (let i = 0; i < hosts.length && !hit && !ctl.signal.aborted; i += BATCH) {
        const batch = hosts.slice(i, i + BATCH).map((h) => `http://${h}:${port}/v1`);
        const replies = await Promise.all(batch.map((b) => probe(b, 900, ctl.signal)));
        const at = replies.findIndex(Boolean);
        if (at >= 0) hit = { base: batch[at], health: replies[at] };
      }
      if (hit) return hit;
    }
    return null;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/* First answer among several addresses, in their given order of preference. */
async function firstOf(bases, ms, signal) {
  if (!bases.length) return null;
  const replies = await Promise.all(bases.map((b) => probe(b, ms, signal)));
  const at = replies.findIndex(Boolean);
  return at >= 0 ? { base: bases[at], health: replies[at] } : null;
}

export async function findBridge({ saved, lan, pageHost, deep = true, sweep: sweeping = true, signal, onProgress } = {}) {
  const near = await firstOf(bridgeCandidates({ saved, lan, pageHost }), 1800, signal);
  if (near || !deep || signal?.aborted) return near;

  /* In a browser the bridge is at localhost or the page's own host, both
     already tried; only the phone app has a network to search. */
  if (!isNative()) return null;

  const port = Number(new URL(saved || lan || BRIDGE_LOCAL).port) || 5005;
  let own = [];
  const plugin = novaLan();
  if (plugin) {
    onProgress?.("broadcast");
    try {
      const r = await plugin.discover({ port, timeout: 1500 });
      own = (r?.addresses || []).map((a) => a.address).filter((a) => PRIVATE.test(a));
      const heard = (r?.found || []).map((f) => bridgeUrl(`${f.host}:${f.port || port}`));
      const hit = await firstOf(heard, 2500, signal);
      if (hit) return hit;
    } catch { /* an app build without the plugin: sweep instead */ }
  }
  if (signal?.aborted || !sweeping) return null;
  /* Knowing the phone's own network, that is the one to sweep. Not knowing
     it (no plugin), the known ones and the three most common. */
  const known = [saved, lan, pageHost].filter(Boolean);
  const nets = own.length ? sweepPlan({ own }).slice(0, own.length) : sweepPlan({ known }).slice(0, known.length + 3);
  return sweep(nets, { port, signal, onProgress });
}

/* One search at a time, shared: the Providers card, the launch check and a
   failed chat request can all ask at once without three sweeps running. */
let running = null;
export function findBridgeOnce(opts) {
  // A stopped chat must not cancel discovery for other callers.
  if (opts?.signal) return findBridge(opts);
  if (!running) running = findBridge(opts).finally(() => { running = null; });
  return running;
}

/* The page's host, when the app was opened from a computer's address. */
export const pageHost = () => (typeof location !== "undefined" && /^https?:$/.test(location.protocol) ? location.hostname : "");
