import { useMemo } from "react";
import { useState } from "react";
import { Segmented, TextInput, ToggleRow } from "../ui.jsx";
import { formatTokens } from "../../lib/tokens.js";
import { setLevel, setMe, traitsOf, usageOf } from "../../lib/phone.js";

/* ---------- the phone's settings page (Settings on the home screen) ----------

   How lively the phone is (through the chat: setLevel), whether new chats
   start with it (the app settings: phoneDefault), and how known the persona
   is and how much money they have (manual fame and wealth overrides:
   setMe, source "manual"; the bank balance stays as it is). Turning the
   phone on never starts anything: until it is set up, its home screen and
   apps offer "Set up phone" (SetupCard). Off closes the phone and keeps
   everything (ctx.turnOff); the chat's phone button turns it on again.
   Nothing refreshes by itself: Refresh and Sync are on the home screen.
   At the bottom, read only: what this chat's phone has used so far
   (handset.usage; counted from the text where the provider reports no
   tokens) and about what each kind of request would take (tick.estimate,
   phoneEstimates: built from the real prompts, no request). */
const LEVEL_OPTIONS = [{ id: "off", label: "Off" }, { id: "light", label: "Light" }, { id: "lively", label: "Lively" }];
const FAME_OPTIONS = [
  { id: 0, label: "Private", aria: "Private person" },
  { id: 1, label: "Local", aria: "Locally known" },
  { id: 2, label: "Public", aria: "Public figure" },
  { id: 3, label: "Star", aria: "Star" },
];
const WEALTH_OPTIONS = [
  { id: 0, label: "Modest" },
  { id: 1, label: "Comfortable" },
  { id: 2, label: "Wealthy" },
  { id: 3, label: "Very rich" },
];

export function PhoneSettings({ ctx }) {
  const level = ctx.h.level;
  const off = level === "off";
  const isDefault = !off && (ctx.settings?.phoneDefault || "off") === level;
  const me = ctx.h.me || {};
  const wealth = traitsOf(me).wealth ?? 0;
  const changeLevel = (id) => (id === "off" && ctx.turnOff ? ctx.turnOff() : ctx.act((x) => setLevel(x, id)));
  return (
    <div className="px-5 pt-4 pb-8 space-y-4" data-testid="phone-settings-page">
      <h3 className="px-1 text-lg font-bold text-zinc-100">Settings</h3>
      <div>
        <p id="phone-level" className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Phone activity</p>
        <div aria-labelledby="phone-level" role="group">
          <Segmented options={LEVEL_OPTIONS} value={level} onChange={changeLevel} />
        </div>
      </div>
      {!off && (
        <ToggleRow
          on={isDefault}
          title="Default for new chats"
          onClick={() => ctx.onSettings({ phoneDefault: isDefault ? "off" : level })}
        />
      )}
      <div>
        <p id="phone-fame" className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">How known you are</p>
        <div aria-labelledby="phone-fame" role="group">
          <Segmented options={FAME_OPTIONS} value={me.fame ?? 0} onChange={(fame) => ctx.act((x) => setMe(x, { fame }))} />
        </div>
      </div>
      <div>
        <p id="phone-wealth" className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">How much money you have</p>
        <div aria-labelledby="phone-wealth" role="group" data-testid="phone-wealth">
          <Segmented options={WEALTH_OPTIONS} value={wealth} onChange={(w) => ctx.act((x) => setMe(x, { traits: { wealth: w }, from: "manual" }))} />
        </div>
      </div>
      <About ctx={ctx} traits={traitsOf(me)} />
      <Usage ctx={ctx} />
    </div>
  );
}

/* What the phone knows about the persona, beyond fame and money. Each one
   is a short line the posts, replies and messages are written from; empty
   removes it. */
const ABOUT = [
  ["looks", "Looks"], ["body", "Body"], ["age", "Age"], ["job", "Job"], ["hobby", "Hobby"],
  ["style", "Style"], ["personality", "Personality"], ["home", "Home"],
  ["relationship", "Relationship"], ["pets", "Pets"], ["languages", "Languages"], ["quirk", "Quirk"],
];

function AboutField({ field, label, value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { if (draft != null && draft.trim() !== (value || "")) onCommit(field, draft.trim()); setDraft(null); };
  return (
    <label className="block min-w-0">
      <span className="mb-1 block px-1 text-[11px] text-zinc-500">{label}</span>
      <TextInput
        value={draft ?? value ?? ""}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        aria-label={label}
      />
    </label>
  );
}

function About({ ctx, traits }) {
  const set = (k, v) => ctx.act((x) => setMe(x, { traits: { [k]: v }, from: "manual" }));
  return (
    <section aria-labelledby="phone-about" data-testid="phone-about">
      <p id="phone-about" className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">About you</p>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        {ABOUT.map(([k, label]) => <AboutField key={k} field={k} label={label} value={traits[k]} onCommit={set} />)}
      </div>
    </section>
  );
}

const ESTIMATE_ROWS = [
  ["setup", "Set up"],
  ["sync", "Sync to chat"],
  ["refresh", "Refresh"],
  ["more", "Load more"],
  ["respond", "DM answer"],
  ["replies", "More replies"],
];
const n0 = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);

function Usage({ ctx }) {
  const u = usageOf(ctx.h);
  const calls = n0(u.calls);
  /* phoneEstimates builds the real prompts: once per change of the phone or the chat */
  const estimates = useMemo(() => {
    try { return ctx.tick?.estimate?.() || null; } catch { return null; }
  }, [ctx.h, ctx.messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = estimates ? ESTIMATE_ROWS.filter(([k]) => estimates[k]) : [];
  const total = n0(u.tokensIn) + n0(u.tokensOut);
  return (
    <section aria-labelledby="phone-usage-title" data-testid="phone-usage" className="pt-2">
      <p id="phone-usage-title" className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Tokens</p>
      <div className="px-3.5 py-3 rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)] space-y-3">
        <div data-testid="phone-usage-total">
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">{formatTokens(total)}<span className="ml-1.5 text-xs font-normal text-zinc-500">used</span></p>
          <p className="mt-0.5 text-xs text-zinc-400 tabular-nums">
            {formatTokens(n0(u.tokensIn))} in · {formatTokens(n0(u.tokensOut))} out · {calls} {calls === 1 ? "request" : "requests"}
            {n0(u.est) > 0 ? " · some counted from the text" : ""}
          </p>
        </div>
        {rows.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] text-zinc-500">Next request</p>
            <dl className="space-y-1 text-xs" data-testid="phone-usage-estimates">
              {rows.map(([k, label]) => {
                const e = estimates[k];
                return (
                  <div key={k} className="flex items-baseline gap-3 min-w-0" data-estimate={k}>
                    <dt className="flex-1 min-w-0 truncate text-zinc-400">{label}</dt>
                    <dd className="shrink-0 tabular-nums text-zinc-300">
                      ~{formatTokens(n0(e.in))} in · ≤{formatTokens(n0(e.out))} out
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
