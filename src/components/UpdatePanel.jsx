import { version } from "../../package.json";
import { useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import CHANGELOG from "../../CHANGELOG.md?raw";
import { Disclosure } from "./motion/Disclosure.jsx";
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

/* CHANGELOG.md as [{ version, date, lines }], newest first: each release is
   a "## [x.y.z] — date" heading over "### group" and "- item" lines. */
export function parseChangelog(text) {
  return String(text).split(/^## /m).slice(1).map((block) => {
    const [head, ...rest] = block.split("\n");
    const m = head.match(/\[?([^\]\s]+)\]?\s*(?:—|-)?\s*(.*)/);
    return { version: m?.[1] || head.trim(), date: m?.[2]?.trim() || "", lines: rest.map((l) => l.trim()).filter(Boolean) };
  });
}

/* **bold** and `code` inside a line */
const inline = (t) => t.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
  part.startsWith("**") ? <b key={i} className="text-zinc-100 font-medium">{part.slice(2, -2)}</b>
  : part.startsWith("`") ? <code key={i} className="text-[0.92em]">{part.slice(1, -1)}</code>
  : part);

function Release({ release, open, onToggle }) {
  return (
    <div className="nv-hair rounded-2xl">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <ChevronRight size={15} aria-hidden className="shrink-0 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
        <span className="text-sm text-zinc-100 font-medium">Nova {shortVersion(release.version)}</span>
        <span className="ml-auto text-[11px] text-zinc-500">{release.date}</span>
      </button>
      <Disclosure open={open}>
        {open ? (
          <div className="px-4 pb-4 space-y-1.5 text-sm text-zinc-300 leading-snug">
            {release.lines.map((l, i) => l.startsWith("#")
              ? <p key={i} className="nv-label pt-2">{l.replace(/^#+\s*/, "")}</p>
              : <p key={i} className="flex gap-2"><span aria-hidden className="text-zinc-500">·</span><span>{inline(l.replace(/^[-*]\s*/, ""))}</span></p>)}
          </div>
        ) : <div />}
      </Disclosure>
    </div>
  );
}

const RELEASES = parseChangelog(CHANGELOG);

/* Every release's notes, the newest open. */
export function ChangelogList() {
  const [open, setOpen] = useState(() => new Set(RELEASES.slice(0, 1).map((r) => r.version)));
  const toggle = (v) => setOpen((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  return (
    <div className="nv-block p-4 sm:p-5 space-y-3">
      <p className="nv-label nv-label--ink">What's new</p>
      <div className="space-y-2">
        {RELEASES.map((r) => <Release key={r.version} release={r} open={open.has(r.version)} onToggle={() => toggle(r.version)} />)}
      </div>
    </div>
  );
}
