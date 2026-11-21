import { version } from "../../package.json";
import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, RefreshCw } from "lucide-react";
import { AccBtn, Button } from "./ui.jsx";
import { backupSummary } from "../lib/backup.js";
import { cancelWhere } from "../lib/activity.js";
import { timeAgo } from "../lib/util.js";
import { SyncBehind, applySync, mergeLibrary, syncEndpoint, syncGet, syncSend, syncStatus } from "../lib/sync.js";
import { exportPacks, importPacks, skinNote } from "../skins/store.js";

/* ---------- Sync through Nova Bridge (lib/sync.js) ----------

   Send puts this device's backup on the Bridge: the same file Back up now
   writes, with the Backup switches above (API keys, skins). Get brings the
   Bridge's copy here to merge or replace, settings included (lib/sync.js
   says what stays on each device). The revision this device last saw is
   kept in this device's own settings. */
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
export function SyncPanel({ data, update }) {
  const s = data.settings;
  const hasBridge = !!syncEndpoint(s);
  const [meta, setMeta] = useState(null); // the Bridge's note, null until asked
  const [busy, setBusy] = useState(null); // "status" | "send" | "get" | "merge" | "replace"
  const [note, setNote] = useState(null); // { ok, text }
  const [behind, setBehind] = useState(false);
  const [pending, setPending] = useState(null); // { state, rev } from Get
  const [progress, setProgress] = useState(null); // { f, phase }

  const check = async (signal) => {
    setBusy("status");
    try { setMeta(await syncStatus(s, { signal })); }
    catch (e) { if (e.name !== "AbortError") setNote({ ok: false, text: e.message }); }
    finally { setBusy((b) => (b === "status" ? null : b)); }
  };
  useEffect(() => {
    if (!hasBridge) return;
    const ctl = new AbortController();
    check(ctl.signal);
    return () => ctl.abort();
  }, [hasBridge]);

  const send = async (force = false) => {
    setBusy("send"); setNote(null); setBehind(false); setProgress({ f: 0, phase: "build" });
    const t0 = performance.now();
    try {
      /* the same file as Back up now, with its switches */
      const skins = s.backupSkins ? await exportPacks() : null;
      let shown = -1;
      const next = await syncSend(s, data, {
        baseRev: force ? null : (s.syncRev ?? 0), version, skins, includeCredentials: !!s.backupCredentials,
        onProgress: (f, phase) => { const pc = Math.floor(f * 100); if (pc !== shown || phase === "upload") { shown = pc; setProgress({ f: pc, phase }); } },
      });
      setMeta(next);
      update((d) => ({ ...d, settings: { ...d.settings, syncRev: next.rev, syncAt: Date.now() } }));
      const what = [s.backupCredentials && "API keys", skins?.length && "skins"].filter(Boolean).join(" and ");
      setNote({ ok: true, text: `Sent ${next.bytes ? mb(next.bytes) : "the backup"} in ${secs(performance.now() - t0)}${what ? `, with ${what}` : ""}. Your other devices can get it from the Bridge now.` });
    } catch (e) {
      if (e instanceof SyncBehind) { setBehind(true); setNote({ ok: false, text: e.message }); }
      else setNote({ ok: false, text: e.message || "Could not send to the Bridge." });
    } finally { setBusy(null); setProgress(null); }
  };

  const get = async () => {
    setBusy("get"); setNote(null); setPending(null);
    const t0 = performance.now();
    try { setPending({ ...(await syncGet(s)), took: performance.now() - t0 }); }
    catch (e) { setNote({ ok: false, text: e.message || "Could not get the Bridge's copy." }); }
    finally { setBusy(null); }
  };

  const apply = async (how) => {
    setBusy(how); setNote(null);
    try {
      const { state, rev } = pending;
      let text;
      /* the library merged or replaced; settings, response styles and
         appearance from the copy, keeping what is this device's own */
      const applied = (d) => { const next = applySync(d, state, how); return { ...d, ...next, settings: { ...next.settings, syncRev: rev, syncAt: Date.now() } }; };
      if (how === "merge") {
        const { added, updated } = mergeLibrary(data, state);
        /* what this device has that the Bridge's copy lacks */
        const back = mergeLibrary(state, data);
        await update(applied, { durable: true });
        text = `${added || updated ? `Merged: ${added} added, ${updated} updated` : "No new characters or chats"}; settings and response styles updated.${back.added || back.updated ? " Send to share this device's changes back." : ""}`;
      } else {
        cancelWhere(() => true);
        await update(applied, { durable: true });
        text = "This device now matches the Bridge's copy, settings included.";
      }
      /* either way, skins are only added or updated, never removed */
      text += skinNote(await importPacks(pending.skins));
      setPending(null); setBehind(false);
      setNote({ ok: true, text });
    } catch (e) {
      setNote({ ok: false, text: e?.message || "Could not save. Try again before closing Nova." });
    } finally { setBusy(null); }
  };

  const upToDate = meta?.rev > 0 && s.syncRev === meta.rev;
  return (
    <div className="p-4 rounded-3xl nv-glass space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-100">Sync with Nova Bridge</p>
          <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">
            Send puts this device's backup on the Bridge, the same file Back up now makes: characters, chats, personas, lorebooks, settings, response styles and appearance, plus API keys and skins when those switches above are on. Get brings it to another device. Each device keeps its own Bridge connection and UI size.
          </p>
        </div>
        {hasBridge && <Button size="sm" icon={RefreshCw} aria-label="Check the Bridge again" onClick={() => check()} disabled={!!busy} />}
      </div>

      {!hasBridge ? (
        <p className="text-[11px] text-zinc-400">Add Nova Bridge in Settings → Providers on each device, and approve each one in the Bridge window.</p>
      ) : (
        <div className="text-[11px] text-zinc-400 space-y-0.5" aria-live="polite">
          {busy === "status" && !meta ? <p>Asking the Bridge…</p>
            : !meta ? null
            : meta.rev ? <>
              <p className="text-zinc-200">On the Bridge: {meta.summary || "a library"}</p>
              <p>From {meta.device || "a device"}{meta.at ? `, ${timeAgo(meta.at)}` : ""}{upToDate ? " · this device is up to date" : ""}</p>
            </> : <p>Nothing on the Bridge yet. Send from the device with your library first.</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="lg" icon={CloudUpload} onClick={() => send(false)} disabled={!hasBridge || !!busy} className="flex-1">
          {busy === "send" ? (progress?.phase === "upload" ? `Sending... ${progress.f}%` : progress?.f ? `Preparing... ${progress.f}%` : "Preparing...") : "Send"}
        </Button>
        <Button size="lg" icon={CloudDownload} onClick={get} disabled={!hasBridge || !!busy || meta?.rev === 0} className="flex-1">
          {busy === "get" ? "Getting..." : "Get"}
        </Button>
      </div>

      {behind && !pending && (
        <div className="flex gap-2">
          <AccBtn onClick={get} disabled={!!busy} className="flex-1">Get and merge first</AccBtn>
          <Button onClick={() => send(true)} disabled={!!busy} className="flex-1">Send anyway</Button>
        </div>
      )}

      {pending && (
        <div className="px-3.5 py-3 rounded-2xl border border-[var(--nv-edge-ink)] bg-zinc-900 space-y-2.5">
          <p className="text-sm text-zinc-100">The Bridge's copy{meta?.device ? ` from ${meta.device}` : ""}</p>
          <p className="text-[11px] text-zinc-100">{backupSummary(pending.state, pending.skins)}{pending.took ? ` · got in ${secs(pending.took)}` : ""}</p>
          <p className="text-[11px] text-zinc-400">Merge keeps everything on both, and the newer copy of anything changed on both; it never deletes characters or chats. Replace makes this device's library match the Bridge exactly. Either way this device takes the copy's settings, response styles and appearance, and keeps its own Bridge connection, UI size, and any key the copy does not carry. Skins from the Bridge are added and this device keeps its own.</p>
          <div className="flex gap-2">
            <AccBtn onClick={() => apply("merge")} disabled={!!busy} className="flex-1">{busy === "merge" ? "Merging..." : "Merge"}</AccBtn>
            <Button onClick={() => apply("replace")} disabled={!!busy} className="flex-1">{busy === "replace" ? "Replacing..." : "Replace"}</Button>
            <Button onClick={() => setPending(null)} disabled={!!busy}>Cancel</Button>
          </div>
        </div>
      )}

      {note && <p role="status" data-motion-state={note.text} className={`text-[11px] ${note.ok ? "text-zinc-500" : "text-zinc-100"}`}>{note.text}</p>}
    </div>
  );
}
