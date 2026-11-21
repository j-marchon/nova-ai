import { useState } from "react";
import { fetchAccount, money, short } from "../lib/api.js";

/* ---------- account, credits and spend ----------

   Everything the OpenRouter dashboard shows about money, without the trip to
   the site. Three sources, because no single endpoint has all of it:

     /credits  what has been bought and used account-wide; balance is the
               difference between the two
     /key      whether this key is still on the free tier — the fact that
               decides 50 requests a day versus 1000 — plus its rolling spend
     the app's own ledger, accumulated from the cost OpenRouter reports on
               each reply, which is the only figure that is specific to Nova
               rather than to everything the key is used for

   The ledger is worth keeping separately: the account totals include any
   other tool sharing the key, so they cannot answer "what has this app cost
   me". OpenRouter's own per-response figure is used rather than a price-table
   estimate, so caching and provider choice are already accounted for. */
export function AccountPanel({ settings, ledger, compact = false }) {
  /* with several OpenRouter entries, the one in use; else the first */
  const ors = (settings.providers || []).filter((p) => p.preset === "openrouter");
  const apiKey = (ors.find((p) => p.id === settings.activeProvider) || ors[0])?.key || "";
  const [state, setState] = useState({ status: apiKey ? "idle" : "nokey" });
  const led = ledger || {};

  const check = async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ok", ...(await fetchAccount(apiKey)) });
    } catch (e) {
      setState({ status: "fail", msg: e.message });
    }
  };

  if (state.status === "nokey") {
    return compact ? null : (
      <div className="p-4 rounded-3xl nv-glass">
        <p className="text-[11px] text-zinc-500">No OpenRouter key</p>
      </div>
    );
  }

  const k = state.k || state.key;
  const c = state.credits;

  return (
    <div className={compact ? "rounded-xl border border-zinc-800 bg-[var(--nv-control)] px-3.5 py-3 space-y-2" : "p-4 rounded-3xl nv-glass space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-400">
          {compact ? "Free models are capped by requests, not credit." : "OpenRouter account"}
        </p>
        <button
          onClick={check}
          disabled={state.status === "loading"}
          className="text-[11px] px-2.5 py-1 rounded-md bg-[var(--nv-control)] hover:bg-[var(--nv-control)] text-zinc-200  shrink-0"
        >
          {state.status === "loading" ? "Checking…" : state.status === "ok" ? "Refresh" : "Check now"}
        </button>
      </div>

      {state.status === "fail" && <p className="text-[11px] text-zinc-100">{state.msg}</p>}

      {state.status === "ok" && (
        <div className="space-y-3 pt-1">
          <div>
            {c && <Row label="Credit left" value={money(c.balance)} />}
            {c && <Row label="Bought" value={money(c.bought)} />}
            {c && <Row label="Used, all time" value={money(c.spent)} />}
            {k?.daily != null && <Row label="Spent today" value={money(k.daily)} />}
            {k?.weekly != null && <Row label="This week" value={money(k.weekly)} />}
            {k?.monthly != null && <Row label="This month" value={money(k.monthly)} />}
            {!c && k?.remaining != null && <Row label="Left on this key" value={money(k.remaining)} />}
          </div>

          <Row label="Free model limit" value={k?.freeTier ? "50 / day" : "1000 / day"} />
        </div>
      )}

      {!compact && (
        <div className="pt-2 border-t border-[var(--nv-edge-ink)]">
          <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase pt-1 pb-1">Spent in this app</p>
          {led.replies ? (
            <>
              <Row label="Total" value={money(led.spent)} />
              <Row label="Replies" value={String(led.replies)} />
              <Row label="Average reply" value={money(led.spent / led.replies)} />
              <Row
                label="Tokens"
                value={`${fmtNum(led.tokensIn)} in / ${fmtNum(led.tokensOut)} out`}
              />
              {/* Split so the two halves of "it takes forever to start" can be
                  told apart. Waiting is queue plus prefill and is what the
                  routing settings move; thinking is the model and is what the
                  thinking toggle moves. Tuning one when the other is the
                  problem is the usual way to waste a week. */}
              {led.lastTtfb != null && (
                <Row label="Waiting before it starts" value={`${(led.lastTtfb / 1000).toFixed(1)}s`} />
              )}
              {led.lastTtft != null && led.lastTtfb != null && led.lastTtft > led.lastTtfb + 200 && (
                <Row label="Then thinking for" value={`${((led.lastTtft - led.lastTtfb) / 1000).toFixed(1)}s`} />
              )}
              {led.lastTtft != null && (
                <Row label="Last reply started in" value={`${(led.lastTtft / 1000).toFixed(1)}s`} />
              )}
              {led.ttfbAvg != null && (
                <Row label="Waiting, last ~10 replies" value={`${(led.ttfbAvg / 1000).toFixed(1)}s`} />
              )}
              {Object.keys(led.byModel || {}).length > 1 && (
                <div className="pt-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wide pb-1">By model</p>
                  {Object.entries(led.byModel)
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 8)
                    .map(([m, v]) => <Row key={m} label={short(m)} value={money(v)} />)}
                </div>
              )}
            </>
          ) : (
            <p className="text-[11px] text-zinc-600">Nothing yet</p>
          )}
        </div>
      )}
    </div>
  );
}

/* one label and figure, joined by a rule; outside AccountPanel so it is not
   a new component type, and remounted, on every render */
function Row({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] text-zinc-500 shrink-0">{label}</span>
      <span className="h-px flex-1 bg-[var(--nv-control)]" />
      <span className="text-xs text-zinc-200 shrink-0 tabular-nums">{value}</span>
      {hint && <span className="text-[10px] text-zinc-600 shrink-0">{hint}</span>}
    </div>
  );
}

export const fmtNum = (n) =>
  !n ? "0" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
