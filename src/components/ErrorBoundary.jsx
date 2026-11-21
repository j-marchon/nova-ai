import { Component, useState } from "react";
import { version } from "../../package.json";
import { AccBtn, Button } from "./ui.jsx";
import { backupName, backupParts } from "../lib/backup.js";
import { saveFile } from "../lib/cards.js";

/* ---------- when rendering breaks ----------

   Without a boundary any exception while rendering leaves a blank page. This
   one shows a plain screen instead, with a reload and a way to save a backup
   of the data as it last was in memory (App reports it through
   rememberData), credentials excluded, through the same streaming writer as
   the Backup panel. */

let lastData = null;
export const rememberData = (data) => { if (data) lastData = data; };
export const lastKnownData = () => lastData;

/* The dark app root, as the app itself sets it up, for screens shown
   instead of the app. */
export const plainRootProps = {
  "data-theme": "dark",
  className: "nv-root min-h-screen text-zinc-100 antialiased flex items-center justify-center p-6",
  style: { "--acc": "#fff", "--on-acc": "#000" },
};

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Nova stopped rendering", error, info?.componentStack);
  }

  render() {
    if (this.state.error) return <CrashScreen getData={this.props.getData || lastKnownData} />;
    return this.props.children;
  }
}

function CrashScreen({ getData }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const data = getData();
  const save = async () => {
    setBusy(true);
    setNote("Saving…");
    try {
      const where = await saveFile(backupName(), backupParts(data, version, {
        onProgress: (f) => setNote(`Saving… ${Math.floor(f * 100)}%`),
      }), "application/json");
      setNote(`Backup saved to ${where}.`);
    } catch (e) {
      console.error("Backup from the error screen failed", e);
      setNote("Could not save the backup.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div {...plainRootProps} role="alert">
      <div className="max-w-sm w-full space-y-3">
        <p className="text-base text-zinc-100">Something went wrong</p>
        <p className="text-sm text-zinc-400 leading-snug">Nova hit an error and could not show this screen. Your saved data has not been changed. Reloading usually fixes it.</p>
        <div className="flex gap-2">
          <AccBtn onClick={() => location.reload()} className="flex-1">Reload</AccBtn>
          {data && <Button onClick={save} disabled={busy} className="flex-1">Save a backup</Button>}
        </div>
        {note && <p role="status" className="text-[11px] text-zinc-400">{note}</p>}
      </div>
    </div>
  );
}
