import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Heart, Loader2, Repeat2 } from "lucide-react";
import { MotionList } from "../../motion/MotionList.jsx";
import { MOTION, enter } from "../../motion/runtime.js";
import { TEXT_LIMITS, YOU, compactCount, markSeen, mentionsOf, repliesTo } from "../../../lib/phone.js";
import { EmptyLine, FilterMenu, SetupCard, sortPosts, useScrollAnchor } from "../parts.jsx";
import { Embed, PostCard, storyById } from "../PostCard.jsx";
import { Incoming, useArrived, useLinger } from "../Incoming.jsx";
import { Button } from "../../ui.jsx";
import { CountedInput, PhoneComposer } from "./PhoneComposer.jsx";
import { StoriesRow, StoryComposer } from "./Stories.jsx";

/* ---------- Murmur: the one social app ----------

   Feed: stories, the composer, the posts in feed order (array order:
   Refresh prepends, Load more appends), Load more at the bottom and an
   error row with Retry (Refresh and Sync are on the phone's home screen).
   Activity: what names the persona (mentionsOf: comments on their posts and
   stories, quotes, @mentions), and the likes and reposts on their posts;
   opening it marks the mentions seen. A post opens to its detail
   (replies flat, newest first by default, a sticky reply input); a quote opens the
   composer over the quoted post. A post's replies come a page at a time
   (Lively 5, Light 3): Load more replies shows the next stored page at the
   bottom, then asks the job for more (tick.moreReplies) until an ask brings
   none. Feed and replies sort Most recent, Most liked, Oldest or Least liked
   (shown likes), kept for this opening of the phone (ctx.prefs). Every write is the persona's and local
   (ctx.write); the chat's phone job answers later. */
export function Murmur({ ctx, route = {} }) {
  if (ctx.needsSetup) return <SetupCard ctx={ctx} />;
  if (route.compose === "story") return <StoryComposer ctx={ctx} />;
  if (route.quote) return <QuoteScreen ctx={ctx} id={route.quote} focus={!!route.focus} />;
  if (route.post) return <Detail ctx={ctx} id={route.post} focus={!!route.focus} />;
  return <Home ctx={ctx} tab={route.tab === "activity" ? "activity" : "feed"} />;
}

/* the feed's header row: the tabs, and on the feed the filter icon */
function Tabs({ ctx, tab, order, onOrder }) {
  const tabs = [["feed", "Feed"], ["activity", "Activity"]];
  return (
    <div className="flex items-center gap-1 pr-2 border-b border-[var(--nv-line)]" data-testid="murmur-header">
    <div role="tablist" aria-label="Murmur" className="flex flex-1 min-w-0">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => tab !== id && ctx.replace({ app: "murmur", tab: id })}
          className={`relative flex-1 h-11 text-sm ${tab === id ? "font-semibold text-zinc-100" : "text-zinc-500"}`}
        >
          {label}
          {tab === id && <span aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full" style={{ background: "var(--nv-ink)" }} />}
        </button>
      ))}
    </div>
    {tab === "feed" && <FilterMenu value={order} onChange={onOrder} label="Sort feed" />}
    </div>
  );
}

function Home({ ctx, tab }) {
  const [order, setOrder] = useState(() => ctx.prefs?.feedSort || "recent");
  const sortBy = (o) => { setOrder(o); if (ctx.prefs) ctx.prefs.feedSort = o; };
  const unseen = ctx.unread.feed ?? 0;
  useEffect(() => { if (tab === "feed" && unseen > 0) ctx.act((x) => markSeen(x, "feed")); }, [unseen, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const mentions = ctx.unread.mentions || 0;
  useEffect(() => { if (tab === "activity" && mentions > 0) ctx.act((x) => markSeen(x, "mentions")); }, [mentions, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <Tabs ctx={ctx} tab={tab} order={order} onOrder={sortBy} />
      {tab === "activity" ? <Activity ctx={ctx} /> : <Feed ctx={ctx} order={order} />}
    </div>
  );
}

function ErrorRow({ ctx }) {
  const error = ctx.error;
  if (!error) return null;
  const retry = () => {
    if (ctx.tick.retry) ctx.tick.retry();
    else if (error.mode === "more") ctx.tick.more?.();
    else (ctx.tick.refresh || ctx.tick.now)?.();
  };
  return (
    <div role="alert" className="flex items-center gap-3 pl-4 pr-3 py-2 border-b border-[var(--nv-line)] min-w-0" data-testid="phone-error">
      <AlertCircle size={16} className="shrink-0 text-zinc-400" aria-hidden />
      <p className="flex-1 min-w-0 text-[13px] text-zinc-300 truncate">Couldn't update</p>
      <Button type="button" onClick={retry} disabled={ctx.busy} className="shrink-0 border border-[var(--nv-line)]">
        Retry
      </Button>
    </div>
  );
}

/* "Load more" / "Load more replies": the label stays put; while this
   control's own ask runs it is busy, with a spinner beside the label */
function MoreButton({ label, onClick, running, disabled, testid }) {
  return (
    <div className="px-4 py-4">
      <Button type="button" onClick={onClick} disabled={disabled} aria-busy={running || undefined} data-testid={testid} className="w-full border border-[var(--nv-line)] text-zinc-200">
        {running && <Loader2 size={15} className="nv-spin shrink-0" aria-hidden />}
        {label}
      </Button>
    </div>
  );
}

const has = (x) => !!(x && (String(x.text || "").trim() || String(x.photo || "").trim()));
const previewPosts = (ctx) => (Array.isArray(ctx.tick?.preview?.posts) ? ctx.tick.preview.posts : []);
/* the streamed top-level posts (no replies, no reposts) */
export const streamedPosts = (ctx) => previewPosts(ctx).filter((p) => has(p) && !p.replyTo && !p.repost);
/* the streamed replies to one post */
const streamedReplies = (ctx, id) => previewPosts(ctx).filter((p) => has(p) && String(p.replyTo || "").replace(/^#/, "") === id);

/* Where the feed's incoming slots stand and how many: the job's word
   (tick.expect) when it has one for the feed, else what this screen asked
   for (Refresh, Load more) or a first fill coming into an empty phone. */
function feedIncoming(ctx, loadingMore, streamed) {
  const ex = ctx.tick?.expect;
  if (ex && !ex.post && ex.posts > 0) return { slots: Math.max(1, ex.posts), place: ex.place === "bottom" ? "bottom" : "top" };
  if (loadingMore) return { slots: 2, place: "bottom" };
  if (ctx.refreshing) return { slots: 2, place: "top" };
  if (ctx.waiting) return { slots: 3, place: "top" };
  if (streamed.length) return { slots: streamed.length, place: "top" };
  return null;
}

function Feed({ ctx, order = "recent" }) {
  const feed = sortPosts(ctx, ctx.v.posts.filter((p) => p.kind !== "reply"), order);
  const [loadingMore, setLoadingMore] = useState(false);
  const streamed = streamedPosts(ctx);
  const want = feedIncoming(ctx, loadingMore, streamed);
  const [show, gone] = useLinger(!!want);
  const last = useRef(want || { slots: 2, place: "top" });
  if (want) last.current = want;
  const { slots, place } = last.current;
  const arrived = useArrived(feed.map((p) => p.id), show);
  const list = useRef(null);
  useScrollAnchor(list);
  const more = () => {
    if (loadingMore || ctx.busy || !ctx.tick.more) return;
    setLoadingMore(true);
    Promise.resolve().then(() => ctx.tick.more()).catch(() => {}).finally(() => setLoadingMore(false));
  };
  const incoming = show ? <Incoming key="incoming" ctx={ctx} items={want ? streamed : []} slots={slots} active={!!want} onGone={gone} /> : null;
  return (
    <div>
      <StoriesRow ctx={ctx} />
      <PhoneComposer ctx={ctx} onSend={(x) => ctx.write.post(x)} />
      <ErrorRow ctx={ctx} />
      {/* what is on its way stands in fixed slots: at the top for new posts
          (Refresh, a skip, the setup), above Load more for older ones */}
      {feed.length || incoming ? (
        <div ref={list}>
          <MotionList role="list" aria-label="Murmur feed" className="divide-y divide-[var(--nv-line)]">
            {place === "top" && incoming}
            {feed.map((p) => (
              <div key={p.id} role="listitem" data-post={p.id} {...(arrived.has(p.id) ? { "data-arrived": "" } : {})}>
                <PostCard ctx={ctx} post={p} onOpen={() => ctx.open({ app: "murmur", post: p.id })} />
              </div>
            ))}
            {place === "bottom" && incoming}
          </MotionList>
        </div>
      ) : <EmptyLine>{ctx.emptyText}</EmptyLine>}
      {feed.length > 0 && <MoreButton label="Load more" onClick={more} running={loadingMore} disabled={loadingMore || ctx.busy} />}
    </div>
  );
}

/* replies a page shows at a time, by the phone's level */
export const replyPage = (level) => (level === "lively" ? 5 : 3);

function Detail({ ctx, id, focus }) {
  const post = ctx.postById(id);
  if (!post) return <EmptyLine>This post is no longer there.</EmptyLine>;
  const head = post.kind === "repost" ? ctx.postById(post.ref) || post : post;
  return <DetailOf key={head.id} ctx={ctx} head={head} focus={focus} />;
}

/* a short fade for a reply that arrives while the list is up */
const ARRIVE = { y: 6, scale: 1, duration: MOTION.feedback, ease: MOTION.ease };

/* one reply row; a row that arrives after the list is up fades in (GSAP),
   unless it takes a streamed card's place (arrived) */
function ReplyRow({ ctx, post, fresh, arrived }) {
  const el = useRef(null);
  useLayoutEffect(() => { if (fresh && !arrived) enter(el.current, ARRIVE); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={el} role="listitem" data-post={post.id} {...(arrived ? { "data-arrived": "" } : {})}>
      <PostCard ctx={ctx} post={post} />
    </div>
  );
}

function DetailOf({ ctx, head, focus }) {
  const page = replyPage(ctx.h.level);
  const [shown, setShown] = useState(page);
  const [loading, setLoading] = useState(false);
  /* an ask that brought nothing new: there are no more to load */
  const [exhausted, setExhausted] = useState(false);
  const [order, setOrder] = useState(() => ctx.prefs?.replySort || "recent");
  const sortBy = (o) => { setOrder(o); if (ctx.prefs) ctx.prefs.replySort = o; };
  /* every stored reply (gone messages hide theirs), in the chosen order;
     a later page joins at the bottom, rows already shown stay as they are */
  const stored = repliesTo(ctx.h, head.id);
  const storedCount = useRef(stored.length);
  storedCount.current = stored.length;
  const replies = sortPosts(ctx, stored.filter((r) => ctx.postById(r.id)), order);
  const s = ctx.statsOf(head);
  const canAsk = !exhausted && typeof ctx.tick?.moreReplies === "function";
  const more = replies.length > shown || canAsk;
  /* showing a stored page needs nothing; asking waits for the job */
  const waiting = replies.length <= shown && !!ctx.busy;
  const loadMore = () => {
    if (loading || waiting) return;
    if (replies.length > shown) { setShown((n) => n + page); return; }
    if (!canAsk) return;
    const before = stored.length;
    setLoading(true);
    Promise.resolve()
      .then(() => ctx.tick.moreReplies(head.id))
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setShown((n) => n + page);
        if (storedCount.current <= before) setExhausted(true);
      });
  };
  const visible = replies.slice(0, shown);
  const list = useRef(null);
  const ready = useRef(false);
  useLayoutEffect(() => { ready.current = true; }, []);
  useScrollAnchor(list);
  /* replies on their way: our Load more, the job answering this post, or
     the job's word that it writes replies here (tick.expect) */
  const ex = ctx.tick?.expect;
  const forThis = !!ex && ex.post === head.id;
  const fetching = loading || (ctx.tick?.loadingReplies || []).includes(head.id) || forThis;
  const streamed = streamedReplies(ctx, head.id);
  const active = fetching || streamed.length > 0;
  const [show, gone] = useLinger(active);
  const slots = forThis && ex.posts > 0 ? ex.posts : Math.max(2, streamed.length);
  /* newest first: what the job writes is newest, so it stands on top; an
     older page asked for with Load more, or any other order: below */
  const wantTop = order === "recent" && !loading;
  /* the block keeps the place it started in until it has gone */
  const placed = useRef({ up: false, top: wantTop });
  if (!placed.current.up) placed.current.top = wantTop;
  const top = placed.current.top;
  const arrived = useArrived(visible.map((r) => r.id), show);
  useLayoutEffect(() => { placed.current.up = show; });
  const incoming = show ? <Incoming ctx={ctx} items={active ? streamed : []} slots={slots} active={active} kind="reply" replyingTo={ctx.accounts.handleOf(head.by)} onGone={gone} /> : null;
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1">
        <PostCard ctx={ctx} post={head} />
        {s.quotes > 0 && <p className="px-4 pb-2 text-xs text-zinc-500" data-testid="quote-count">{compactCount(s.quotes)} {s.quotes === 1 ? "quote" : "quotes"}</p>}
        <div className="flex items-center gap-2 pl-4 pr-2 h-12 border-t border-[var(--nv-line)] min-w-0">
          <p className="flex-1 min-w-0 text-xs text-zinc-500 truncate">Replies</p>
          <FilterMenu value={order} onChange={sortBy} label="Sort replies" />
        </div>
        <div ref={list} role="list" aria-label="Replies" className="divide-y divide-[var(--nv-line)] border-t border-[var(--nv-line)]">
          {top && incoming}
          {visible.map((r) => <ReplyRow key={r.id} ctx={ctx} post={r} fresh={ready.current} arrived={arrived.has(r.id)} />)}
          {!top && incoming}
        </div>
        {/* a post can count more replies than are stored: the rest come with Load more */}
        {!replies.length && !show && !(s.replies > 0 && more) && <EmptyLine>No replies yet.</EmptyLine>}
        {more && <MoreButton label="Load more replies" testid="more-replies" onClick={loadMore} running={loading} disabled={loading || waiting} />}
      </div>
      <div className="sticky bottom-0 px-4 py-3 border-t border-[var(--nv-line)]" style={{ background: "var(--nv-bg)" }}>
        <CountedInput placeholder="Post your reply" label="Reply" sendLabel="Send reply" max={TEXT_LIMITS.post} autoFocus={focus} onSend={(t) => ctx.write.reply(head, t)} />
      </div>
    </div>
  );
}

/* a quote of a post, or a post about a story (its ref is the story's id) */
function QuoteScreen({ ctx, id, focus }) {
  const post = ctx.postById(id) || (storyById(ctx, id) ? { id } : null);
  if (!post) return <EmptyLine>This post is no longer there.</EmptyLine>;
  return (
    <PhoneComposer ctx={ctx} quote sendLabel="Post" autoFocus={focus} onSend={({ text }) => { ctx.write.quote(post, text); ctx.back(); }}>
      <Embed ctx={ctx} id={post.id} />
    </PhoneComposer>
  );
}

/* What happened around the persona: what names them (mentionsOf), and the
   likes and reposts their posts have. */
function Activity({ ctx }) {
  const list = useRef(null);
  useScrollAnchor(list);
  const posts = ctx.v.posts;
  const mine = posts.filter((p) => p.by === YOU && p.kind !== "repost");
  const aimed = mentionsOf(ctx.h, { messages: ctx.messages, userName: ctx.accounts.nameOf(YOU) })
    .map((m) => ({ m, p: m.post ? ctx.postById(m.post) : null, st: !m.post && m.story ? ctx.v.stories.find((x) => x.id === m.story) : null }))
    .filter(({ p, st }) => p || st);
  const counted = mine.map((p) => ({ p, s: ctx.statsOf(p) })).filter(({ s }) => s.likes > 0 || s.reposts > 0);
  const likes = counted.reduce((n, x) => n + x.s.likes, 0);
  const reposts = counted.reduce((n, x) => n + x.s.reposts, 0);
  if (!aimed.length && !counted.length) return <EmptyLine>Nothing about you yet.</EmptyLine>;
  return (
    <div>
      {counted.length > 0 && (
        <section aria-label="Likes and reposts" className="px-4 py-3 border-b border-[var(--nv-line)]" data-testid="activity-summary">
          <p className="flex items-center gap-3 text-sm text-zinc-200">
            <span className="inline-flex items-center gap-1"><Heart size={14} aria-hidden /> {compactCount(likes)} likes</span>
            <span className="inline-flex items-center gap-1"><Repeat2 size={14} aria-hidden /> {compactCount(reposts)} reposts</span>
            <span className="text-zinc-500">on your posts</span>
          </p>
          <ul className="mt-2 space-y-1">
            {counted.slice(0, 5).map(({ p, s }) => (
              <li key={p.id}>
                <button type="button" onClick={() => ctx.open({ app: "murmur", post: p.id })} className="w-full min-h-10 flex items-center gap-2 text-left text-[13px] min-w-0">
                  <span className="flex-1 min-w-0 truncate text-zinc-400">{p.text || p.photo}</span>
                  <span className="shrink-0 tabular-nums text-zinc-300">{compactCount(s.likes)} · {compactCount(s.reposts)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {aimed.length > 0 && (
        <div ref={list}>
        <MotionList role="list" aria-label="Replies and quotes" className="divide-y divide-[var(--nv-line)]">
          {aimed.map(({ m, p, st }) => (p ? (
            <div key={m.id} role="listitem" data-post={p.id} data-mention={m.kind}>
              <PostCard ctx={ctx} post={p} onOpen={() => ctx.open(m.story && m.kind === "comment" ? { app: "murmur", story: YOU, comments: m.story } : { app: "murmur", post: p.kind === "reply" ? p.ref : p.id })} />
            </div>
          ) : (
            <div key={m.id} role="listitem" data-story-mention={st.id}>
              <button type="button" onClick={() => ctx.open({ app: "murmur", story: st.by })} className="w-full min-h-[56px] px-4 py-3 text-left">
                <span className="block text-[13px] text-zinc-100">{ctx.accounts.nameOf(st.by)} mentioned you in a story</span>
                <span className="block mt-0.5 text-xs text-zinc-500 truncate">{st.text || st.photo}</span>
              </button>
            </div>
          )))}
        </MotionList>
        </div>
      )}
    </div>
  );
}
