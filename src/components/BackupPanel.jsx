import { version } from "../../package.json";
import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { AccBtn, Button, ToggleRow } from "./ui.jsx";
import { keepDeviceDefaults } from "../lib/data.js";
import { backupName, backupParts, backupSummary, readBackup } from "../lib/backup.js";
import { saveFile } from "../lib/cards.js";
import { cancelWhere } from "../lib/activity.js";
import { readFailure } from "./RecoveryScreen.jsx";
import { exportPacks, importPacks, skinNote } from "../skins/store.js";
import { useInstalledSkins } from "./useSkin.js";

/* Resolves once the browser has had a chance to paint, so "Saving…" is on
   screen before the work that follows holds the main thread. A hidden page
   gets no frames, hence the timeout. */
const painted = () => new Promise((resolve) => {
  const done = () => setTimeout(resolve, 0);
  const t = setTimeout(resolve, 100);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { clearTimeout(t); done(); });
});

/* Restoring replaces app data only after the user reviews the file. */
export function BackupPanel({ data, update }) {
  const native = !!window.Capacitor?.isNativePlatform?.();
  /* the desktop app: Nova asks where to save (in Documents/Nova by default),
     and its library lives in the app's own folder, not a browser profile */
  const desktop = !native && !!window.novaDesktop;
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [persistence, setPersistence] = useState("checking");
  const [note, setNote] = useState(null); // { ok, text }
  const [pending, setPending] = useState(null); // { state, createdAt }
  const [progress, setProgress] = useState(null); // whole percent while saving
  /* skins added in Look go in the file too; kept, so the daily backup follows */
  const includeSkins = !!data.settings.backupSkins;
  /* kept too, so Sync's Send follows it; the daily backup never carries keys */
  const includeCredentials = !!data.settings.backupCredentials;
  const skinCount = useInstalledSkins().length;

  useEffect(() => {
    if (native) return;
    let active = true;
    const check = async () => {
      try {
        let status = "unsupported";
        if (navigator.storage?.persisted) status = await navigator.storage.persisted() ? "persistent" : "temporary";
        if (active) setPersistence(status);
      } catch { if (active) setPersistence("unavailable"); }
    };
    check();
    return () => { active = false; };
  }, [native]);

  const protectStorage = async () => {
    setPersistence("requesting");
    try { setPersistence(await navigator.storage.persist() ? "persistent" : "denied"); }
    catch { setPersistence("unavailable"); }
  };

  const backUp = async () => {
    setBusy("backup");
    setNote(null);
    setProgress(0);
    try {
      await painted();
      const skins = includeSkins ? await exportPacks() : null;
      /* in pieces, never the whole library as one string (backupParts) */
      const parts = backupParts(data, version, { includeCredentials, skins, onProgress: (f) => setProgress(Math.floor(f * 100)) });
      const where = await saveFile(backupName(), parts, "application/json");
      setNote({ ok: true, text: native ? `Saved to ${where}` : desktop ? "Choose where to save the backup (Documents/Nova is suggested), and keep the file somewhere safe." : "Download requested. Check your browser’s downloads and keep the file somewhere safe." });
    } catch (e) {
      console.error("Backup failed", e);
      setNote({ ok: false, text: "Could not save the backup." });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const diagnostics = async () => {
    setBusy("diagnostics");
    setNote(null);
    try {
      let localStorageSupported = false;
      try { localStorageSupported = !!window.localStorage; } catch {}
      const report = {
        version,
        platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
        storage: {
          indexedDB: !!window.indexedDB,
          localStorage: localStorageSupported,
          persistenceApi: typeof navigator.storage?.persist === "function",
          persistenceStatus: native ? "native" : persistence,
        },
      };
      const where = await saveFile("nova-diagnostics.json", JSON.stringify(report, null, 2), "application/json");
      setNote({ ok: true, text: native ? `Saved to ${where}` : desktop ? "Choose where to save the diagnostics file." : "Diagnostic download requested. Check your browser’s downloads." });
    } catch {
      setNote({ ok: false, text: "Could not export diagnostics." });
    } finally { setBusy(null); }
  };

  const pick = async (file) => {
    setNote(null);
    setPending(null);
    setBusy("reading");
    try {
      await painted();
      setPending(readBackup(await file.text()));
    } catch (e) {
      console.error("Could not read backup", e);
      setNote({ ok: false, text: readFailure(e) });
    } finally { setBusy(null); }
  };

  const restore = async () => {
    setBusy("restore");
    setNote(null);
    try {
      cancelWhere(() => true);
      await update((cur) => keepDeviceDefaults(cur, pending.state, pending.predates), { durable: true });
      /* skins first checked like any file added by hand; this device keeps
         its own, and a newer version of one replaces it */
      const s = await importPacks(pending.skins);
      /* the parsed backup can be the size of the whole library; it is the
         app's state now, so this copy goes (Cancel drops it too). After a
         failed save it stays, so Restore can be tried again. */
      setPending(null);
      setNote({ ok: true, text: `Backup restored and saved on this device.${skinNote(s)}` });
    } catch (e) {
      setNote({ ok: false, text: e?.message || "Could not save the restored backup. Try again before closing Nova." });
    } finally { setBusy(null); }
  };


  return (
    <div className="p-4 rounded-3xl nv-glass space-y-3">
      <div>
        <p className="text-sm text-zinc-100">Backup</p>
        {!desktop && <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">
          {native ? "Saved in Documents/Nova." : "Browser storage can be cleared; keep a copy outside it."}
        </p>}
      </div>
      {!data.characters?.length && !data.universes?.length && !data.chats?.length && (
        <div className="text-[11px] text-zinc-400 space-y-1">
          <p className="text-zinc-200">Start here</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Add a provider and pick a model in Model.</li>
            <li>Create or import a character.</li>
          </ol>
        </div>
      )}
      {!native && !desktop && (
        <div className="text-[11px] text-zinc-400 space-y-1">
          <p role="status">{({
            checking: "Checking browser storage…",
            requesting: "Requesting persistent storage…",
            persistent: "Persistent browser storage granted. Clearing site data still deletes Nova’s local data.",
            temporary: "Browser storage is not persistent. The browser may remove it under storage pressure.",
            denied: "Persistent storage was not granted. Keep downloaded backups; your browser may remove local data.",
            unsupported: "This browser cannot report persistent storage. Keep downloaded backups.",
            unavailable: "Browser storage protection could not be checked. Keep downloaded backups.",
          })[persistence]}</p>
          {(persistence === "temporary" || persistence === "denied" || persistence === "unavailable") && navigator.storage?.persist && <button onClick={protectStorage} className="underline text-zinc-200">Request persistent storage</button>}
          <p>Persistent storage is not a backup.</p>
        </div>
      )}
      <a href="./privacy.html" target="_blank" rel="noopener noreferrer" className="inline-block text-[11px] underline text-zinc-400">Privacy and local data</a>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }}
      />
      <ToggleRow
        on={includeCredentials}
        onClick={() => { if (!busy) update({ settings: { ...data.settings, backupCredentials: !includeCredentials } }); }}
        title="Include API keys and credentials"
        sub="Anyone with the file can use them. Sync follows this."
      />
      <ToggleRow
        on={includeSkins}
        onClick={() => { if (!busy) update({ settings: { ...data.settings, backupSkins: !includeSkins } }); }}
        title="Include skins"
        sub={skinCount ? "A few hundred KB each" : null}
      />
      <div className="flex gap-2">
        <Button size="lg" icon={Download} onClick={backUp} disabled={!!busy} className="flex-1">
          {busy === "backup" ? (progress ? `Saving... ${progress}%` : "Saving...") : "Back up now"}
        </Button>
        <Button size="lg" icon={Upload} onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex-1">
          {busy === "reading" ? "Reading..." : "Restore"}
        </Button>
      </div>

      {native && <ToggleRow
        on={data.settings.dailyBackup !== false}
        onClick={() => update({ settings: { ...data.settings, dailyBackup: data.settings.dailyBackup === false } })}
        title="Daily backup"
        sub="Documents/Nova/Daily · last 7 kept"
      />}

      <div className="text-[11px] text-zinc-400 space-y-1">
        <Button onClick={diagnostics} disabled={!!busy}>{busy === "diagnostics" ? "Exporting..." : "Export diagnostics"}</Button>
        <p>No addresses, keys or chats.</p>
      </div>

      {pending && (
        <div className="px-3.5 py-3 rounded-2xl border border-[var(--nv-edge-ink)] bg-zinc-900 space-y-2.5">
          <p className="text-sm text-zinc-100">
            Replace everything in the app with this backup{pending.createdAt ? ` from ${new Date(pending.createdAt).toLocaleString()}` : ""}?
          </p>
          <p className="text-[11px] text-zinc-100">{backupSummary(pending.state, pending.skins)}</p>
          <p className="text-[11px] text-zinc-400">Replaces everything on this device, keys included.</p>
          <div className="flex gap-2">
            <AccBtn onClick={restore} disabled={!!busy} className="flex-1">{busy === "restore" ? "Restoring..." : "Restore"}</AccBtn>
            <Button onClick={() => setPending(null)} disabled={!!busy} className="flex-1">Cancel</Button>
          </div>
        </div>
      )}

      {note && <p role="status" data-motion-state={note.text} className={`text-[11px] ${note.ok ? "text-zinc-500" : "text-zinc-100"}`}>{note.text}</p>}
    </div>
  );
}
