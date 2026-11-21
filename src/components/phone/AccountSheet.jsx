import { useState } from "react";
import { BadgeCheck, ChevronRight, MessageCircle } from "lucide-react";
import { Disclosure } from "../motion/Disclosure.jsx";
import { Button } from "../ui.jsx";
import { MotionList } from "../motion/MotionList.jsx";
import { WEALTH_MEANING, YOU, activityOf, compactCount, slug, traitsOf } from "../../lib/phone.js";
import { EmptyLine, PhoneAvatar } from "./parts.jsx";
import { PostCard } from "./PostCard.jsx";
import { TxRow, paymentsWith } from "./apps/Bank.jsx";

/* ---------- an account's profile page ----------

   A full page on the phone's stack (route { app: "profile", account }):
   avatar, name, verified check, @handle, role, bio, followers; Message for
   anyone but the persona; tabs Posts (their own posts and quotes), Replies
   (each with the post it answers) and Activity (everything they did, newest
   first, activityOf); and at the bottom a collapsed "Profile stats (debug)"
   panel listing the account's traits (wealth too, which is hidden
   elsewhere) and where each came from (stated, inferred, manual). */

const FAME_WORDS = ["private", "locally known", "public figure", "star"];


/* Everything the sheet shows about `key`, from the handset and the phone's accounts. */
export function accountView(ctx, key) {
  const { h, accounts } = ctx;
  const name = accounts.nameOf(key);
  if (key === YOU) {
    const me = h.me || {};
    return {
      name, handle: slug(name), you: true, bio: me.bio || "", role: "",
      followers: Number.isFinite(me.followers) ? me.followers : 0,
      traits: traitsOf(me), traitsFrom: me.traitsFrom || {}, raw: me,
    };
  }
  const person = h.people?.[key] || {};
  const entry = accounts.list.find((p) => p.key === key) || {};
  return {
    name,
    handle: accounts.handleOf(key),
    verified: person.verified === true,
    story: !!entry.story,
    role: person.role || entry.role || "",
    bio: person.bio || "",
    followers: Number.isFinite(person.followers) ? person.followers : null,
    traits: traitsOf(person),
    traitsFrom: person.traitsFrom || {},
    raw: person,
  };
}

/* The trait rows the debug panel lists; empty when nothing was ever made. */
export function traitRows(traits, traitsFrom) {
  const word = (k, v) => (k === "fame" ? `${v} (${FAME_WORDS[v] || "?"})` : k === "wealth" && WEALTH_MEANING[Number(v)] ? `${v} (${WEALTH_MEANING[Number(v)]})` : String(v));
  const rows = Object.entries(traits || {}).map(([k, v]) => ({ key: k, value: word(k, v), from: traitsFrom?.[k] || "unknown" }));
  /* fame and wealth are always there (0 by default); they count once something set them */
  const made = rows.some((r) => r.key !== "fame" && r.key !== "wealth") || !!traitsFrom?.fame || !!traitsFrom?.wealth;
  return made ? rows : [];
}

const TABS = [["posts", "Posts"], ["replies", "Replies"], ["activity", "Activity"]];

/* the rows each tab lists, newest first, only what the phone shows */
export function profileRows(ctx, key, tab) {
  const all = activityOf(ctx.h, key).filter((p) => ctx.postById(p.id));
  if (tab === "posts") return all.filter((p) => p.kind === "post" || p.kind === "quote" || !p.kind);
  if (tab === "replies") return all.filter((p) => p.kind === "reply");
  return all;
}

function DebugStats({ a }) {
  const [stats, setStats] = useState(false);
  const rows = traitRows(a.traits, a.traitsFrom);
  return (
    <div className="mx-4 my-5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
      <button
        type="button"
        onClick={() => setStats((x) => !x)}
        aria-expanded={stats}
        aria-controls="account-stats"
        className="w-full flex items-center gap-2 px-3.5 min-h-[44px] text-left text-sm text-zinc-200"
      >
        <span className="flex-1 min-w-0 truncate">Profile stats (debug)</span>
        <ChevronRight size={16} aria-hidden className="text-zinc-500 shrink-0 nv-chevron" data-angle="90" data-open={stats ? "1" : "0"} />
      </button>
      <Disclosure open={stats}>
        <div id="account-stats">
          {stats && (
            <div className="px-3.5 pb-3" data-testid="account-traits">
              {rows.length ? (
                <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-xs">
                  {rows.map((r) => (
                    <div key={r.key} className="contents" data-trait={r.key}>
                      <dt className="text-zinc-400 font-mono truncate">{r.key}</dt>
                      <dd className="text-zinc-100 break-words min-w-0">{r.value}</dd>
                      <dd className="text-zinc-500" data-source={r.from}>{r.from}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-zinc-500">No traits yet.</p>
              )}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

export function ProfilePage({ ctx, accountKey }) {
  const a = accountView(ctx, accountKey);
  const [tab, setTab] = useState("posts");
  const rows = profileRows(ctx, accountKey, tab);
  const payments = a.story ? paymentsWith(ctx.h, accountKey).slice(0, 3) : [];
  const empty = { posts: "No posts yet.", replies: "No replies yet.", activity: "Nothing yet." }[tab];
  return (
    <div data-testid="profile-page" data-account={accountKey}>
      <header className="px-4 pt-4 pb-3 border-b border-[var(--nv-line)]">
        <div className="flex items-end justify-between gap-3 min-w-0">
          <PhoneAvatar src={ctx.avatarOf?.(accountKey)} name={a.name} size={72} />
          {!a.you && (
            <Button
              type="button"
              variant="primary"
              icon={MessageCircle}
              onClick={() => ctx.open({ app: "messages", thread: accountKey, focus: true })}
              className="shrink-0"
              aria-label={`Message ${a.name}`}
            >
              Message
            </Button>
          )}
        </div>
        <div className="mt-3 min-w-0 leading-tight">
          <p className="flex items-center gap-1 min-w-0">
            <span className="text-lg font-bold text-zinc-100 truncate">{a.name}</span>
            {a.verified && <BadgeCheck size={17} className="shrink-0" style={{ color: "var(--acc, var(--nv-ink))" }} aria-label="Verified" role="img" />}
          </p>
          <p className="text-sm text-zinc-500 truncate">@{a.handle}</p>
          {a.role && <p className="mt-1 text-xs text-zinc-400 truncate" data-testid="account-role">{a.role}</p>}
        </div>
        {a.bio && <p className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap break-words">{a.bio}</p>}
        {a.followers !== null && (
          <p className="mt-2 text-sm text-zinc-400"><span className="font-semibold text-zinc-100 tabular-nums">{compactCount(a.followers)}</span> followers</p>
        )}
      </header>
      {payments.length > 0 && (
        <section aria-label="Money between you" className="border-b border-[var(--nv-line)]" data-testid="profile-payments">
          <p className="px-4 pt-2.5 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Money between you</p>
          <div role="list">{payments.map((t) => <TxRow key={t.id} ctx={ctx} tx={t} />)}</div>
        </section>
      )}
      <div role="tablist" aria-label="Profile" className="flex border-b border-[var(--nv-line)]">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-tab={id}
            className={`relative flex-1 h-11 text-sm ${tab === id ? "font-semibold text-zinc-100" : "text-zinc-500"}`}
          >
            {label}
            {tab === id && <span aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full" style={{ background: "var(--nv-ink)" }} />}
          </button>
        ))}
      </div>
      {rows.length ? (
        <MotionList key={tab} role="list" aria-label={`${a.name}'s ${tab}`} className="divide-y divide-[var(--nv-line)]" data-testid={`profile-${tab}`}>
          {rows.map((p) => (
            <div key={p.id} role="listitem" data-post={p.id}>
              <PostCard
                ctx={ctx}
                post={p}
                showParent={tab !== "posts"}
                onOpen={() => ctx.open({ app: "murmur", post: p.kind === "reply" ? p.ref : p.id })}
              />
            </div>
          ))}
        </MotionList>
      ) : (
        <div data-testid={`profile-${tab}`}><EmptyLine>{empty}</EmptyLine></div>
      )}
      <DebugStats a={a} />
    </div>
  );
}

/* the old name, kept for imports */
export const AccountSheet = ProfilePage;
