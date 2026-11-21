import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Search, Send } from "lucide-react";
import { MotionList } from "../../motion/MotionList.jsx";
import { Button } from "../../ui.jsx";
import { enter, MOTION } from "../../motion/runtime.js";
import * as phoneLib from "../../../lib/phone.js";
import { YOU, bankOf, markSeen, phoneAct, transfer } from "../../../lib/phone.js";
import { EmptyLine, PhoneAvatar, openAccount } from "../parts.jsx";

/* ---------- Bank: the persona's money ----------

   The balance (never the hidden wealth tier), Send money, and the
   statement, newest first, filtered All / Money in / Money out (sent and
   received in their own colours; source and category when the engine gives
   them; a story character's row opens their profile, and a transfer they are
   still to react to says so: reactingTo).
   Send money: choose a contact (route { app: "bank", pick: true }, a search
   over the persona's accounts, the most recent contact first), then the
   amount and an optional note ({ app: "bank", to }). Send is one
   `ctx.act(h => transfer(h, ...))` and a `tick.later` for the respond batch;
   the engine refuses a transfer over the balance. */

export const NOTE_MAX = 80;
/* the one money format on the phone, in the currency the settings choose
   (settings.bankCurrency): US dollars "$1,200" (en-US) or euros "1.200 €"
   (de-DE); whole units */
export const CURRENCIES = [{ id: "USD", label: "USD", locale: "en-US" }, { id: "EUR", label: "EUR", locale: "de-DE" }];
const formats = new Map();
const formatOf = (cur) => {
  const c = CURRENCIES.find((x) => x.id === cur) || CURRENCIES[0];
  if (!formats.has(c.id)) formats.set(c.id, new Intl.NumberFormat(c.locale, { style: "currency", currency: c.id, maximumFractionDigits: 0 }));
  return formats.get(c.id);
};
export const currencyOf = (ctx) => (ctx?.settings?.bankCurrency === "EUR" ? "EUR" : "USD");
export const money = (n, cur = "USD") => formatOf(cur).format(Math.round(Number(n) || 0));
/* money in the ctx's currency */
export const moneyIn = (ctx) => (n) => money(n, currencyOf(ctx));

/* colours mixed toward the ink, so they read on light and dark */
const SENT = "color-mix(in srgb, #f43f5e 72%, var(--nv-ink))";
const RECEIVED = "color-mix(in srgb, #10b981 72%, var(--nv-ink))";

export function Bank({ ctx, route = {} }) {
  if (route.to) return <SendTo key={route.to} ctx={ctx} to={route.to} />;
  if (route.pick) return <PickContact ctx={ctx} />;
  return <BankHome ctx={ctx} />;
}

/* a transaction's age: on the story clock when it has an anchor, else from its time */
export function txAge(ctx, tx) {
  if (tx.anchor && ctx.ageLabel) return ctx.ageLabel(tx);
  const t = Number(tx.t);
  if (!Number.isFinite(t) || t <= 0) return "";
  if (t < 1e11) { /* a story tick */
    const n = Math.max(0, (ctx.h.tick?.n || 0) - t);
    return n ? `${n}t` : "now";
  }
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / (60 * 24))}d`;
}

/* who is on the other side of a transaction; a world payment by its name only */
function otherOf(ctx, tx) {
  if (tx.kind === "received") {
    const key = tx.from || (tx.source && tx.source !== YOU ? tx.source : null) || null;
    return { key, name: tx.fromName || (key ? ctx.accounts.nameOf(key) : "") || "Someone" };
  }
  return { key: tx.to || null, name: tx.toName || (tx.to ? ctx.accounts.nameOf(tx.to) : "Someone") };
}

const isStory = (ctx, key) => !!key && !!(ctx.accounts.list || []).find((p) => p.key === key && p.story);

/* `reactingTo(h, key)`: the transfer a payee is still to answer, or null */
const reactingId = (h, key) => (key && typeof phoneLib.reactingTo === "function" ? phoneLib.reactingTo(h, key)?.id || null : null);

export function TxRow({ ctx, tx }) {
  const cash = moneyIn(ctx);
  const sent = tx.kind !== "received";
  const other = otherOf(ctx, tx);
  const age = txAge(ctx, tx);
  const story = isStory(ctx, other.key);
  const reacting = sent && story && reactingId(ctx.h, other.key) === tx.id;
  const source = tx.world || !other.key ? (tx.source && tx.source !== YOU && !String(tx.source).includes(":") ? tx.source : "") : "";
  const sub = [tx.category, source, tx.note].filter(Boolean).join(" · ") || (sent ? "Sent" : "Received");
  const body = (
    <>
      <PhoneAvatar src={other.key ? ctx.avatarOf?.(other.key) : null} name={other.name} size={40} />
      <span className="flex-1 min-w-0 leading-tight">
        <span className="block text-sm font-medium text-zinc-100 truncate">{other.name}</span>
        <span className="block text-xs text-zinc-500 truncate" data-tx-sub="">
          {tx.category && <span className="mr-1 px-1.5 rounded-full text-[10px] font-medium uppercase tracking-wide text-zinc-200 bg-[var(--nv-control)] border border-[var(--nv-line)]" data-category={tx.category}>{tx.category}</span>}
          {[source, tx.note].filter(Boolean).join(" · ") || (tx.category ? "" : sub)}
        </span>
        {reacting && <span className="block mt-0.5 text-xs italic text-zinc-400 truncate" data-testid="tx-reacting">{other.name} is reacting…</span>}
      </span>
      <span className="shrink-0 text-right leading-tight">
        <span className="block text-sm font-semibold tabular-nums" style={{ color: sent ? SENT : RECEIVED }} data-amount="">
          {sent ? "−" : "+"}{cash(tx.amount)}
        </span>
        {age && <span className="block text-xs text-zinc-500 tabular-nums">{age}</span>}
      </span>
    </>
  );
  const cls = "w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px] min-w-0 text-left";
  return (
    <div role="listitem" data-tx={tx.id} data-kind={sent ? "sent" : "received"}>
      {story ? (
        <button type="button" onClick={() => openAccount(ctx, other.key)} aria-label={`${other.name}, ${sent ? "sent" : "received"} ${cash(tx.amount)}`} className={`${cls} hover:bg-[var(--nv-control)]`}>{body}</button>
      ) : <div className={cls}>{body}</div>}
    </div>
  );
}

const FILTERS = [["all", "All"], ["in", "Money in"], ["out", "Money out"]];

function BankHome({ ctx }) {
  const { balance, tx } = bankOf(ctx.h);
  const [filter, setFilter] = useState("all");
  const unseen = ctx.unread?.bank || 0;
  useEffect(() => { if (unseen > 0) ctx.act((x) => markSeen(x, "bank")); }, [unseen]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = filter === "in" ? tx.filter((t) => t.kind === "received") : filter === "out" ? tx.filter((t) => t.kind !== "received") : tx;
  return (
    <div>
      <section className="px-5 pt-6 pb-5 text-center" aria-label="Balance">
        <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Balance</p>
        <p className="mt-1 text-4xl font-bold text-zinc-100 tabular-nums truncate" data-testid="bank-balance">{moneyIn(ctx)(balance)}</p>
        <button
          type="button"
          onClick={() => ctx.open({ app: "bank", pick: true })}
          className="mt-4 h-11 px-6 rounded-full inline-flex items-center justify-center gap-2 text-sm font-medium text-white"
          style={{ backgroundImage: "linear-gradient(140deg, #c084fc, #7c3aed)", backgroundColor: "#7c3aed" }}
        >
          <Send size={15} aria-hidden /> Send money
        </button>
        <div role="radiogroup" aria-label="Currency" className="mt-3 inline-flex p-0.5 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)]">
          {CURRENCIES.map((c) => {
            const on = currencyOf(ctx) === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && ctx.onSettings?.({ bankCurrency: c.id })}
                className={`h-8 px-3.5 rounded-full text-xs font-medium ${on ? "text-white" : "text-zinc-400"}`}
                style={on ? { background: "#7c3aed" } : undefined}
                data-currency={c.id}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </section>
      <div role="tablist" aria-label="Statement" className="flex border-y border-[var(--nv-line)]">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            data-filter={id}
            className={`relative flex-1 min-w-0 h-11 text-sm truncate ${filter === id ? "font-semibold text-zinc-100" : "text-zinc-500"}`}
          >
            {label}
            {filter === id && <span aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full" style={{ background: "#7c3aed" }} />}
          </button>
        ))}
      </div>
      {list.length ? (
        <MotionList key={filter} role="list" aria-label="Transactions" className="divide-y divide-[var(--nv-line)]">
          {list.map((t, i) => <TxRow key={t.id || i} ctx={ctx} tx={t} />)}
        </MotionList>
      ) : <EmptyLine>{tx.length ? "Nothing here." : "No transactions yet."}</EmptyLine>}
    </div>
  );
}

/* The transactions with one account, newest first: paymentsOf when the engine has it. */
export function paymentsWith(h, key) {
  if (typeof phoneLib.paymentsOf === "function") return phoneLib.paymentsOf(h, { character: key }) || [];
  return bankOf(h).tx.filter((t) => t.to === key || t.from === key || t.source === key);
}

/* Everyone the persona can pay: story characters, Murmur accounts and message
   contacts, the most recent contact (a message, a post, a payment) first. */
export function bankContacts(ctx) {
  const { h, accounts } = ctx;
  const seen = new Map();
  for (const p of accounts.list || []) if (p.key !== YOU) seen.set(p.key, { key: p.key, name: p.name, handle: p.handle, story: !!p.story });
  for (const k of Object.keys(h.threads || {})) {
    if (k !== YOU && !seen.has(k)) seen.set(k, { key: k, name: accounts.nameOf(k), handle: accounts.handleOf(k), story: false });
  }
  const last = new Map();
  const touch = (k, n) => { if (seen.has(k) && Number.isFinite(n)) last.set(k, Math.max(last.get(k) ?? -1, n)); };
  for (const [k, lines] of Object.entries(h.threads || {})) touch(k, lines?.at(-1)?.tick);
  for (const p of h.posts || []) touch(p.by, p.tick);
  return [...seen.values()]
    .map((p, i) => ({ ...p, i, at: last.get(p.key) ?? -1 }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map(({ i, at, ...p }) => p);
}

function PickContact({ ctx }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => bankContacts(ctx), [ctx.h, ctx.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const qn = query.trim().toLowerCase().replace(/^@/, "");
  const list = qn ? all.filter((p) => p.name.toLowerCase().includes(qn) || String(p.handle || "").toLowerCase().includes(qn)) : all;
  return (
    <div>
      <div className="px-4 pt-3 pb-2">
        <label className="flex items-center gap-2 h-10 px-4 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] focus-within:border-[var(--nv-ink)]">
          <Search size={15} className="shrink-0 text-zinc-500" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search contacts"
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </label>
      </div>
      {list.length ? (
        <div role="list" aria-label="Contacts">
          {list.map((p) => (
            <div key={p.key} role="listitem">
              <button
                type="button"
                onClick={() => ctx.replace({ app: "bank", to: p.key })}
                className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px] text-left hover:bg-[var(--nv-control)]"
                data-contact={p.key}
              >
                <PhoneAvatar src={ctx.avatarOf?.(p.key)} name={p.name} size={40} />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-sm font-medium text-zinc-100 truncate">{p.name}</p>
                  {p.handle && <p className="text-xs text-zinc-500 truncate">@{p.handle}</p>}
                </div>
              </button>
            </div>
          ))}
        </div>
      ) : <EmptyLine>{all.length ? "No one by that name." : "No one to pay yet."}</EmptyLine>}
    </div>
  );
}

function SendTo({ ctx, to }) {
  const cash = moneyIn(ctx);
  const { balance } = bankOf(ctx.h);
  const name = ctx.accounts.nameOf(to);
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const amount = raw ? Number(raw) : 0;
  const over = amount > balance;
  const can = amount > 0 && !over;
  const send = () => {
    if (!can) { if (over) setError("That's more than your balance."); return; }
    const payment = { to, toName: name, amount, note: note.trim().slice(0, NOTE_MAX), t: Date.now() };
    /* the engine refuses what the balance cannot cover: check on the handset as it is */
    if (transfer(ctx.h, payment) === ctx.h) { setError("That's more than your balance."); return; }
    ctx.act((x, c) => phoneAct(x, c?.messages, "transfer", (h, o) => transfer(h, { ...payment, anchor: o.anchor, ...(Number.isFinite(o.at) ? { at: o.at } : {}) })));
    ctx.tick?.later?.({ action: { kind: "transfer", to, amount, note: payment.note } });
    setError("");
    setDone({ amount, name });
  };
  if (done) return <Sent ctx={ctx} done={done} />;
  const shownError = error || (over ? "That's more than your balance." : "");
  return (
    <div className="px-4 pt-4 pb-6 space-y-4">
      <div className="flex items-center gap-3 min-w-0">
        <PhoneAvatar src={ctx.avatarOf?.(to)} name={name} size={44} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-xs text-zinc-500">Send to</p>
          <p className="text-sm font-semibold text-zinc-100 truncate">{name}</p>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 min-w-0 flex-nowrap">
          <input
            value={raw ? cash(raw) : ""}
            onChange={(e) => { setRaw(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12)); setError(""); }}
            inputMode="numeric"
            placeholder={cash(0)}
            aria-label="Amount"
            enterKeyHint="send"
            aria-invalid={over}
            className="flex-1 min-w-0 h-12 px-4 rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)] text-2xl font-semibold tabular-nums text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
          />
          <button
            type="button"
            onClick={send}
            disabled={!can}
            className="h-12 px-5 shrink-0 rounded-2xl inline-flex items-center gap-1.5 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundImage: "linear-gradient(140deg, #c084fc, #7c3aed)", backgroundColor: "#7c3aed" }}
          >
            <Send size={15} aria-hidden /> Send
          </button>
        </div>
        <p className="mt-1.5 px-1 text-xs text-zinc-400 truncate" aria-live="polite" data-testid="bank-remaining">
          Balance after: <span className="tabular-nums text-zinc-200">{cash(balance - amount)}</span>
        </p>
      </div>
      <label className="block">
        <span className="sr-only">Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          placeholder="Note (optional)"
          aria-label="Note"
          className="w-full h-10 px-4 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
        />
      </label>
      {shownError && (
        <div role="alert" className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-[var(--nv-line)] min-w-0" data-testid="bank-error">
          <AlertCircle size={16} className="shrink-0" style={{ color: SENT }} aria-hidden />
          <p className="flex-1 min-w-0 text-[13px] text-zinc-200 truncate">{shownError}</p>
        </div>
      )}
    </div>
  );
}

/* the confirmation: the only part of the Bank that animates on entry */
function Sent({ ctx, done }) {
  const box = useRef(null);
  useLayoutEffect(() => { enter(box.current, { y: 12, scale: 0.96, duration: MOTION.feedback }); }, []);
  return (
    <div ref={box} role="status" className="px-6 pt-10 pb-8 flex flex-col items-center text-center" data-testid="bank-sent">
      <span className="w-14 h-14 rounded-full flex items-center justify-center text-white" style={{ backgroundImage: "linear-gradient(140deg, #4ade80, #059669)", backgroundColor: "#059669" }}>
        <Check size={26} aria-hidden />
      </span>
      <p className="mt-4 text-base font-semibold text-zinc-100">Sent {moneyIn(ctx)(done.amount)}</p>
      <p className="mt-1 text-sm text-zinc-400 truncate max-w-full">to {done.name}</p>
      <Button type="button" onClick={() => ctx.back()} className="mt-6 px-6 text-zinc-200 border border-[var(--nv-line)]">
        Done
      </Button>
    </div>
  );
}
