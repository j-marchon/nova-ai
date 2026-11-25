import { version } from "../../package.json";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, ToggleRow } from "./ui.jsx";
import { timeAgo } from "../lib/util.js";
import { RELEASES_PAGE, checkForUpdate, isNewer, lastCheck, shortVersion } from "../lib/updates.js";

const ago = (at) => { const t = timeAgo(at); return t === "now" ? "just now" : /\d$/.test(t) ? `on ${t}` : `${t} ago`; };

/* Check for updates (lib/updates.js). Off by default: nothing is asked of
   GitHub until it is turned on or Check now is pressed. */
export function UpdatePanel({ data, update }) {
  const on = data.settings.updateCheck === true;
  const [result, setResult] = useState(() => lastCheck());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = async () => {
    setBusy(true); setError("");
    try { setResult(await checkForUpdate(version)); }
    catch (e) { setError(`Could not check: ${e?.message || "GitHub could not be reached."}`); }
    finally { setBusy(false); }
  };
  const newer = result && isNewer(result.latest, version);

  return (
    <div className="p-4 rounded-3xl nv-glass space-y-3">
      <ToggleRow
        on={on}
        onClick={() => update({ settings: { ...data.settings, updateCheck: !on } })}
        title="Check for updates"
        sub="Asks GitHub at each start. Nothing about you is sent."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={RefreshCw} onClick={check} disabled={busy}>{busy ? "Checking…" : "Check now"}</Button>
        <p role="status" className="text-[11px] text-zinc-500 leading-snug">
          {error || (result
            ? newer
              ? <>Nova {result.latest} is out. <a href={result.url || RELEASES_PAGE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-zinc-200">Get it</a></>
              : `Nova ${shortVersion(version)} is the newest. Checked ${ago(result.at)}.`
            : `This is Nova ${shortVersion(version)}.`)}
        </p>
      </div>
    </div>
  );
}
