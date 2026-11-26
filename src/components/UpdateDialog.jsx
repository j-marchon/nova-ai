import { useState } from "react";
import { activity } from "../lib/activity.js";
import { Button, Modal } from "./ui.jsx";

const busy = () => activity.get().some(job => job.status === "running" || job.status === "queued");
const BUSY = "Finish or cancel active requests before updating.";

/* "A new update is available": Later, or Update. Update saves the library
   (prepare), then runs install(onProgress), which updates and restarts Nova,
   or resolves to a line to show instead (say, "tap Install to finish"). */
export function UpdateDialog({ detail, prepare, install, onLater }) {
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [note, setNote] = useState("");
  const stop = (text) => { setNote(text); setWorking(false); setProgress(null); };

  const update = async () => {
    if (busy()) return stop(BUSY);
    setWorking(true); setNote("");
    try { await prepare(); } catch { return stop("Save failed. Retry or export your data before updating."); }
    if (busy()) return stop(BUSY);
    try {
      const said = await install(setProgress);
      if (said) stop(said);
    } catch (e) { stop(`Could not update: ${e?.message || "try again later."}`); }
  };

  return (
    <Modal title="A new update is available" onClose={working ? () => {} : onLater} scrimCloses={false}>
      <div className="space-y-4">
        {detail && <p className="text-sm text-zinc-200">{detail}</p>}
        {(note || working) && (
          <p role="status" className="text-xs text-zinc-400 leading-snug">
            {note || (progress != null ? `Downloading… ${Math.round(progress)}%` : "Updating…")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onLater} disabled={working}>Later</Button>
          <Button variant="primary" onClick={update} disabled={working}>Update</Button>
        </div>
      </div>
    </Modal>
  );
}
