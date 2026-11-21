import { useRef, useState } from "react";
import { AccBtn, Button } from "./ui.jsx";
import { plainRootProps } from "./ErrorBoundary.jsx";
import { backupSummary, readBackup } from "../lib/backup.js";
import { saveData } from "../lib/storage.js";
import { importPacks } from "../skins/store.js";

/* Shown instead of the app when the stored data exists but could not be
   read (storage.js, StorageReadError). Nothing saves from here except a
   restore the user confirms, which replaces what is stored. */
export function RecoveryScreen({ error, onRetry, onRestored }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(null);
  const detail = error?.cause?.message || error?.cause?.name || "";

  const pick = async (file) => {
    setNote("");
    setPending(null);
    setBusy("reading");
    try {
      setPending(readBackup(await file.text()));
    } catch (e) {
      setNote(readFailure(e));
    } finally { setBusy(null); }
  };

  const restore = async () => {
    const backup = pending;
    setBusy("restore");
    setNote("");
    try {
      await saveData(backup.state, { replace: true });
      /* its skins, if it carries any; a skin that fails is skipped */
      await importPacks(backup.skins).catch(() => {});
      setPending(null);
      onRestored(backup.state);
    } catch (e) {
      console.error("Restore from the recovery screen failed", e);
      setNote(e?.message || "Could not save the restored backup.");
      setBusy(null);
    }
  };

  return (
    <div {...plainRootProps} role="alert">
      <div className="max-w-sm w-full space-y-3">
        <p className="text-base text-zinc-100">Nova could not read its saved data</p>
        <p className="text-sm text-zinc-400 leading-snug">Nothing was changed or deleted. Nova will not save anything until it can read your data, so it is not overwritten. Try again, or restore a backup file.</p>
        {detail && <p className="text-[11px] text-zinc-500 break-words">{detail}</p>}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }}
        />
        <div className="flex gap-2">
          <AccBtn onClick={onRetry} disabled={!!busy} className="flex-1">Retry</AccBtn>
          <Button onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex-1">
            {busy === "reading" ? "Reading…" : "Restore from a backup file"}
          </Button>
        </div>
        {pending && (
          <div className="px-3.5 py-3 rounded-2xl border border-[var(--nv-edge-ink)] space-y-2.5">
            <p className="text-sm text-zinc-100">Restore this backup{pending.createdAt ? ` from ${new Date(pending.createdAt).toLocaleString()}` : ""}?</p>
            <p className="text-[11px] text-zinc-100">{backupSummary(pending.state, pending.skins)}</p>
            <p className="text-[11px] text-zinc-400">This replaces whatever Nova has stored on this device, including the data it could not read.</p>
            <div className="flex gap-2">
              <AccBtn onClick={restore} disabled={!!busy} className="flex-1">{busy === "restore" ? "Restoring…" : "Restore"}</AccBtn>
              <Button onClick={() => setPending(null)} disabled={!!busy} className="flex-1">Cancel</Button>
            </div>
          </div>
        )}
        {note && <p role="status" className="text-[11px] text-zinc-100">{note}</p>}
      </div>
    </div>
  );
}

/* What to say when a backup file cannot be opened. A file too big for the
   phone's memory fails in file.text() or JSON.parse with a RangeError. */
export function readFailure(e) {
  if (e?.name === "RangeError" || /memory|too large|allocation/i.test(e?.message || "")) {
    return "That backup is too large to open on this device.";
  }
  return e?.message || "Could not read that file.";
}
