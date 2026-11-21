import { AtSign, Banknote, MessageCircle, Quote, UserPlus } from "lucide-react";
import { MotionList } from "../motion/MotionList.jsx";
import { Button } from "../ui.jsx";
import { YOU, bankOf, markSeen, notificationsOf as phoneNotifications } from "../../lib/phone.js";
import { EmptyLine, PhoneAvatar } from "./parts.jsx";
import { moneyIn, txAge } from "./apps/Bank.jsx";

/* ---------- the notification centre ----------

   iOS-style on the home screen: the five most recent notifications, only
   what is for the persona (the engine's notificationsOf): messages and
   message requests, money received, and what names the persona on Murmur
   (comments on their posts and stories, quotes of their posts, @mentions in
   posts and stories; mentionsOf). Likes, reposts and new posts never
   notify. Each opens its place; See all opens the full list (route { app:
   "notifications" }); Mark all read marks every kind seen (markSeen). */

export const CENTRE_COUNT = 5;
const cut = (t, n = 80) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const MENTION_KINDS = new Set(["comment", "quote", "mention"]);

/* Every notification, newest first: { id, kind, by, title, text, tick, unread, to, age }. */
export function notificationsOf(ctx) {
  return fromEngine(ctx, phoneNotifications(ctx.h, { messages: ctx.messages, userName: ctx.accounts.nameOf(YOU) }) || []);
}

/* the engine's items as rows: words, the text they are about, where they open */
function fromEngine(ctx, list) {
  const { h, accounts } = ctx;
  const post = (id) => (id ? ctx.postById?.(id) || (h.posts || []).find((p) => p.id === id) || null : null);
  const story = (id) => (id ? (h.stories || []).find((x) => x.id === id) || null : null);
  const cash = moneyIn(ctx);
  return list.map((x) => {
    const who = x.by ? accounts.nameOf(x.by) : "Someone";
    const p = post(x.post);
    const st = story(x.story);
    const line = x.thread ? [...(h.threads?.[x.thread] || [])].reverse().find((m) => m.from !== YOU) : null;
    const tx = x.tx ? bankOf(h).tx.find((t) => t.id === x.tx) : null;
    const n = Number(x.count) || 0;
    let title = who;
    let to = { app: "murmur" };
    let text = p?.text || p?.photo || "";
    let age = p && ctx.ageLabel ? ctx.ageLabel(p) : "";
    switch (x.kind) {
      case "comment": {
        /* a comment on the persona's story opens that story's comments */
        const on = st || story(p?.ref);
        title = `${who} commented on your ${on ? "story" : "post"}`;
        to = on ? { app: "murmur", story: YOU, comments: on.id } : { app: "murmur", post: p?.ref || x.post, focus: true };
        break;
      }
      case "quote": title = `${who} quoted you`; to = { app: "murmur", post: x.post }; break;
      case "mention":
        if (!p && st) {
          /* someone's story with the persona's handle: opens on their stories */
          title = `${who} mentioned you in a story`;
          to = { app: "murmur", story: x.by };
          text = st.text || st.photo || "";
          age = ctx.ageLabel ? ctx.ageLabel(st) : "";
        } else {
          title = `${who} mentioned you`;
          to = { app: "murmur", post: x.post };
        }
        break;
      case "dm": title = `${who} messaged you`; to = { app: "messages", thread: x.thread, focus: true }; text = line?.text || ""; age = line && ctx.ageLabel ? ctx.ageLabel(line) : ""; break;
      case "request": title = `${who} wants to message you`; to = { app: "messages", thread: x.thread, focus: true }; text = line?.text || ""; age = line && ctx.ageLabel ? ctx.ageLabel(line) : ""; break;
      case "transfer": {
        const from = tx?.fromName || (x.by ? who : "Someone");
        title = `${from} sent you ${cash(tx?.amount ?? n)}`;
        to = { app: "bank" };
        text = [tx?.category, tx?.note].filter(Boolean).join(" · ");
        age = tx ? txAge(ctx, tx) : "";
        return { ...x, kind: "money", engineKind: x.kind, byName: from, title, text: cut(text), to, age, unread: !!x.unread, tick: x.tick || 0 };
      }
      default: break;
    }
    return { ...x, title, text: cut(text), to, age, unread: !!x.unread, tick: x.tick || 0 };
  });
}

/* every kind seen: mentions, money, each thread, each mentioning story */
export function markAllRead(ctx, list) {
  ctx.act((x) => {
    let y = markSeen(markSeen(x, "mentions"), "bank");
    for (const k of Object.keys(x.threads || {})) y = markSeen(y, { thread: k });
    for (const n of list) if (n.story && n.kind === "mention") y = markSeen(y, { story: n.story });
    return y;
  });
}

const ICONS = { request: UserPlus, dm: MessageCircle, comment: MessageCircle, quote: Quote, money: Banknote, mention: AtSign };

function Row({ ctx, n }) {
  const Icon = ICONS[n.kind] || MessageCircle;
  const who = n.byName || (n.by ? ctx.accounts.nameOf(n.by) : "");
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={() => {
          /* reading one of the persona's mentions marks it (and older ones) seen */
          if (MENTION_KINDS.has(n.kind) && n.unread) ctx.act((x) => markSeen(x, { mentions: n.tick }));
          ctx.open(n.to);
        }}
        className="w-full flex items-start gap-3 px-3.5 py-2.5 min-h-[56px] text-left"
        data-notification={n.kind}
        data-unread={n.unread ? "1" : "0"}
      >
        <span className="relative shrink-0">
          <PhoneAvatar src={n.by ? ctx.avatarOf?.(n.by) : null} name={who || "?"} size={36} />
          <span aria-hidden className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white" style={{ background: "#7c3aed", boxShadow: "0 0 0 2px var(--nv-bg)" }}>
            <Icon size={10} strokeWidth={2.5} />
          </span>
        </span>
        <span className="flex-1 min-w-0 leading-tight">
          <span className="flex items-center gap-2 min-w-0">
            <span className={`flex-1 min-w-0 truncate text-[13px] ${n.unread ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>{n.title}</span>
            {n.age && <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{n.age}</span>}
          </span>
          {n.text && <span className="block mt-0.5 text-xs text-zinc-500 truncate">{n.text}</span>}
        </span>
        {n.unread && <span aria-label="Unread" className="mt-1.5 w-2 h-2 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />}
      </button>
    </div>
  );
}

function List({ ctx, list, label }) {
  return (
    <MotionList role="list" aria-label={label} className="divide-y divide-[var(--nv-line)]">
      {list.map((n) => <Row key={n.id} ctx={ctx} n={n} />)}
    </MotionList>
  );
}

function MarkAll({ ctx, all }) {
  if (!all.some((n) => n.unread)) return null;
  return (
    <Button type="button" size="sm" onClick={() => markAllRead(ctx, all)} className="shrink-0 text-zinc-200 border border-[var(--nv-line)]">
      Mark all read
    </Button>
  );
}

/* the home screen's group: the five newest, See all when there are more */
export function NotificationCentre({ ctx }) {
  const all = notificationsOf(ctx);
  return (
    <section aria-label="Notifications" className="mt-6" data-testid="notification-centre">
      <div className="nv-phone-pane-head flex items-center gap-2 px-1 mb-1.5 min-h-8">
        <p className="flex-1 min-w-0 text-[11px] font-medium tracking-wide text-zinc-400 uppercase truncate">Notifications</p>
        <MarkAll ctx={ctx} all={all} />
      </div>
      <div className="nv-phone-pane rounded-2xl overflow-hidden bg-[var(--nv-control)] border border-[var(--nv-line)]">
        {all.length ? <List ctx={ctx} list={all.slice(0, CENTRE_COUNT)} label="Recent notifications" /> : <p className="px-4 py-4 text-center text-sm text-zinc-500">No notifications yet.</p>}
        {all.length > CENTRE_COUNT && (
          <button type="button" onClick={() => ctx.open({ app: "notifications" })} className="w-full h-11 border-t border-[var(--nv-line)] text-sm font-medium text-zinc-200">
            See all ({all.length})
          </button>
        )}
      </div>
    </section>
  );
}

/* See all: every notification */
export function NotificationsPage({ ctx }) {
  const all = notificationsOf(ctx);
  return (
    <div data-testid="notifications-page">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 min-w-0">
        <h3 className="flex-1 min-w-0 text-lg font-bold text-zinc-100 truncate">Notifications</h3>
        <MarkAll ctx={ctx} all={all} />
      </div>
      {all.length ? <List ctx={ctx} list={all} label="All notifications" /> : <EmptyLine>No notifications yet.</EmptyLine>}
    </div>
  );
}
