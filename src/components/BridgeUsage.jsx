import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { fetchBridgeUsage, providerOf } from "../lib/api.js";
import { timeLeft } from "../lib/timeLeft.js";
import { Button, Skeleton } from "./ui.jsx";
import { fmtNum } from "./AccountPanel.jsx";

/* ---------- what the Nova Bridge's subscriptions have left ----------

   Asked of the Bridge's /usage when the Usage tab opens and once a minute
   while it stays open. Antigravity reports a fraction left per model, which
   the Bridge sorts into the 5-hour and weekly windows; the Gemini app
   reports nothing, so the Bridge counts what it sent today. Claude and
   ChatGPT report nothing at all. */

const REFRESH_MS = 60 * 1000;
const NAMES = { antigravity: "Google Antigravity", "gemini-web": "Gemini app", claude: "Claude", openai: "ChatGPT" };
const ORDER = ["antigravity", "gemini-web", "claude", "openai"];

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
};
const pct = (r) => (typeof r === "number" && Number.isFinite(r) ? Math.round(Math.max(0, Math.min(1, r)) * 100) : null);

/* "resets in 3h 20m", with the local clock time on hover */
function Resets({ at, now, lead = "resets" }) {
  if (!at) return null;
  const left = timeLeft(at, now);
  return <span title={clock(at)}>{left ? `${lead} in ${left}` : `${lead} now`}</span>;
}

function Bar({ label, value, thin = false }) {
  const p = pct(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p ?? undefined}
      aria-valuetext={p == null ? "Not reported" : `${p}% left`}
      className={`w-full ${thin ? "h-1" : "h-1.5"} rounded-full bg-[var(--nv-control)] overflow-hidden`}
    >
      <div className="h-full rounded-full" style={{ width: `${p ?? 0}%`, background: "var(--acc)" }} />
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="p-4 rounded-3xl nv-glass space-y-3">
      <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{title}</p>
      {children}
    </div>
  );
}

const Note = ({ children }) => <p className="text-[11px] text-zinc-500 leading-relaxed">{children}</p>;

function Antigravity({ name, u, now }) {
  const [open, setOpen] = useState(false);
  const windows = Array.isArray(u.windows) ? u.windows : [];
  const models = Array.isArray(u.models) ? u.models : [];
  return (
    <Card title={name}>
      {u.error && <p className="text-[11px] text-zinc-100">{u.error}</p>}
      {windows.length ? windows.map((w) => (
        <div key={w.id || w.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-zinc-200">{w.label || w.id}</span>
            <span className="text-zinc-400 tabular-nums">{pct(w.remaining) ?? "–"}% left</span>
          </div>
          <Bar label={`${w.label || w.id} allowance left`} value={w.remaining} />
          <p className="text-[11px] text-zinc-500">
            <Resets at={w.resetsAt} now={now} lead="Resets" />
            {w.models ? `${w.resetsAt ? " · " : ""}lowest of ${w.models} model${w.models === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      )) : <Note>Google did not report a quota for this account.</Note>}

      {models.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" iconRight={ChevronDown} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="-ml-2">
            Per model
          </Button>
          {open && (
            <ul className="pt-2 space-y-2.5">
              {models.map((m) => {
                const p = pct(m.remaining);
                return (
                  <li key={m.id} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="text-zinc-200 truncate">{m.name || m.id}</span>
                      <span className="text-zinc-500 shrink-0 tabular-nums">
                        {p == null ? "Not reported" : `${p}%`}
                        {m.resetsAt && <> · <Resets at={m.resetsAt} now={now} /></>}
                      </span>
                    </div>
                    <Bar label={`${m.name || m.id} allowance left`} value={m.remaining} thin />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Note>A 5-hour allowance plus a weekly cap, reported per model. The window is judged by when a figure resets, so Weekly shows only when Google reports one.</Note>
    </Card>
  );
}

function GeminiApp({ name, u, now }) {
  const n = Number(u.requests) || 0;
  const byModel = Object.entries(u.byModel || {}).sort((a, b) => b[1] - a[1]);
  const left = timeLeft(u.resetsAt, now);
  const hit = u.limitHitAt ? new Date(u.limitHitAt).getTime() : NaN;
  const reset = u.resetsAt ? new Date(u.resetsAt).getTime() : NaN;
  /* the counted day is the 24 hours before the next reset */
  const hitToday = Number.isFinite(hit) && (Number.isFinite(reset) ? hit > reset - 864e5 && hit <= reset : new Date(hit).toDateString() === new Date(now).toDateString());
  return (
    <Card title={name}>
      <div>
        <p className="text-sm text-zinc-100 tabular-nums">{n} prompt{n === 1 ? "" : "s"} today</p>
        <p className="text-[11px] text-zinc-500 tabular-nums">~{fmtNum(u.tokensIn)} tokens in · ~{fmtNum(u.tokensOut)} out (estimated)</p>
      </div>
      {byModel.length > 0 && (
        <ul className="space-y-1">
          {byModel.map(([id, count]) => (
            <li key={id} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-zinc-400 truncate">{id === "default" ? "Default" : id}</span>
              <span className="text-zinc-200 tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      )}
      {hitToday && <p className="text-xs text-zinc-100">Limit reached at {new Date(hit).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
      <p className="text-[11px] text-zinc-500" title={u.resetsAt ? clock(u.resetsAt) : undefined}>
        Resets at midnight Pacific time{left ? ` (in ${left})` : ""}
      </p>
      <Note>Google does not report the Gemini app's remaining allowance; its daily limits vary by model and change often. This counts what passed through the Bridge.</Note>
    </Card>
  );
}

export function BridgeUsage({ settings }) {
  /* { status: "loading" | "ok" | "fail", providers?, msg? }; a refresh keeps
     the last figures on screen */
  const [state, setState] = useState({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const p = providerOf(settings);
  const live = useRef(settings);
  live.current = settings;
  const ask = useRef(null);

  const load = () => {
    ask.current?.abort();
    const ctl = new AbortController();
    ask.current = ctl;
    setBusy(true);
    fetchBridgeUsage(live.current, { signal: ctl.signal })
      .then((r) => { if (!ctl.signal.aborted) setState({ status: "ok", providers: r.providers }); })
      .catch((e) => { if (!ctl.signal.aborted) setState({ status: "fail", msg: e.message }); })
      .finally(() => { if (!ctl.signal.aborted) { setBusy(false); setNow(Date.now()); } });
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { clearInterval(timer); ask.current?.abort(); };
  }, [p.id, p.base, p.key, p.pairedBase]);

  const providers = state.providers || {};
  const ids = Object.keys(providers).filter((id) => providers[id]?.connected !== false)
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  return (
    <section aria-label="Bridge limits" aria-busy={busy} className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Bridge limits</p>
        <Button size="sm" icon={RefreshCw} onClick={load} disabled={busy}>{busy ? "Checking…" : "Refresh"}</Button>
      </div>

      {state.status === "loading" && (
        <div className="p-4 rounded-3xl nv-glass space-y-3">
          <p className="text-[11px] text-zinc-500">Checking the Bridge…</p>
          <Skeleton className="h-1.5 rounded-full" />
          <Skeleton className="h-1.5 rounded-full w-2/3" />
        </div>
      )}

      {state.status === "fail" && (
        <div className="p-4 rounded-3xl nv-glass" role="alert">
          <p className="text-xs text-zinc-100">{state.msg}</p>
        </div>
      )}

      {state.status === "ok" && !ids.length && (
        <div className="p-4 rounded-3xl nv-glass">
          <Note>Connect a subscription in Settings → Providers → Nova Bridge.</Note>
        </div>
      )}

      {state.status === "ok" && ids.map((id) => {
        const u = providers[id];
        const name = NAMES[id] || id;
        if (u.kind === "quota") return <Antigravity key={id} name={name} u={u} now={now} />;
        if (u.kind === "counted") return <GeminiApp key={id} name={name} u={u} now={now} />;
        return <p key={id} className="px-1 text-[11px] text-zinc-500">{name} does not report usage.</p>;
      })}
    </section>
  );
}
