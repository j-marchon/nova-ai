import { version } from "../../package.json";
import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, RefreshCw } from "lucide-react";
import { AccBtn, Button } from "./ui.jsx";
import { backupSummary } from "../lib/backup.js";
import { cancelWhere } from "../lib/activity.js";
import { timeAgo } from "../lib/util.js";
import { SyncBehind, mergeLibrary, replaceLibrary, syncEndpoint, syncGet, syncSend, syncStatus } from "../lib/sync.js";
import { exportPacks, importPacks, skinNote } from "../skins/store.js";

/* ---------- Sync through Nova Bridge (lib/sync.js) ----------

   Send puts this device's library on the Bridge; Get brings the Bridge's
   copy here to merge or replace. The revision this device last saw is kept
   in its own settings, which never travel. */
export function SyncPanel({ data, update }) {
  const s = data.settings;
  const hasBridge = !!syncEndpoint(s);
  const [meta, setMeta] = useState(null); // the Bridge's note, null until asked
  const [busy, setBusy] = useState(null); // "status" | "send" | "get" | "merge" | "replace"
  const [note, setNote] = useState(null); // { ok, text }
  const [behind, setBehind] = useState(false);
  const [pending, setPending] = useState(null); // { state, rev } from Get
  const [progress, setProgress] = useState(null);

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
    setBusy("send"); setNote(null); setBehind(false); setProgress(0);
    try {
      /* the skins added on this device go too */
      const skins = await exportPacks();
      const next = await syncSend(s, data, { baseRev: force ? null : (s.syncRev ?? 0), version, skins, onProgress: (f) => setProgress(Math.floor(f * 100)) });
      setMeta(next);
      update((d) => ({ ...d, settings: { ...d.settings, syncRev: next.rev, syncAt: Date.now() } }));
      setNote({ ok: true, text: "Sent. Your other devices can get it from the Bridge now." });
    } catch (e) {
      if (e instanceof SyncBehind) { setBehind(true); setNote({ ok: false, text: e.message }); }
      else setNote({ ok: false, text: e.message || "Could not send to the Bridge." });
    } finally { setBusy(null); setProgress(null); }
  };

  const get = async () => {
    setBusy("get"); setNote(null); setPending(null);
    try { setPending(await syncGet(s)); }
    catch (e) { setNote({ ok: false, text: e.message || "Could not get the Bridge's copy." }); }
    finally { setBusy(null); }
  };

  const apply = async (how) => {
    setBusy(how); setNote(null);
    try {
      const { state, rev } = pending;
      let text;
      if (how === "merge") {
        const { added, updated } = mergeLibrary(data, state);
        /* what this device has that the Bridge's copy lacks */
        const back = mergeLibrary(state, data);
        await update((d) => ({ ...d, ...mergeLibrary(d, state).patch, settings: { ...d.settings, syncRev: rev, syncAt: Date.now() } }), { durable: true });
        text = `${added || updated ? `Merged: ${added} added, ${updated} updated.` : "Nothing new on the Bridge."}${back.added || back.updated ? " Send to share this device's changes back." : ""}`;
      } else {
        cancelWhere(() => true);
        await update((d) => ({ ...d, ...replaceLibrary(state), settings: { ...d.settings, syncRev: rev, syncAt: Date.now() } }), { durable: true });
        text = "This device now matches the Bridge's copy.";
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
            Share characters, universes, personas, lorebooks, chats and added skins between your computer and phone through the Bridge. Settings and keys stay on each device.
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
          {busy === "send" ? (progress ? `Sending... ${progress}%` : "Sending...") : "Send"}
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
          <p className="text-[11px] text-zinc-100">{backupSummary(pending.state, pending.skins)}</p>
          <p className="text-[11px] text-zinc-400">Merge keeps everything on both, and the newer copy of anything changed on both. It never deletes. Replace makes this device's library match the Bridge exactly; its settings and keys stay. Either way, skins from the Bridge are added and this device keeps its own.</p>
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
