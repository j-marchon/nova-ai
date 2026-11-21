import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye, Heart, MessageCircle, Plus, Quote, Send, X } from "lucide-react";
import { enter, MOTION } from "../../motion/runtime.js";
import { Button, TextArea, useBackLayer } from "../../ui.jsx";
import * as phoneLib from "../../../lib/phone.js";
import { YOU, TEXT_LIMITS, compactCount, markSeen, repliesTo } from "../../../lib/phone.js";
import { PostCard } from "../PostCard.jsx";
import { EmptyLine, PhoneAvatar, PhoneInput, openAccount } from "../parts.jsx";
import { Incoming, useLinger } from "../Incoming.jsx";
import { readPhoto } from "../media.js";

/* ---------- stories ----------

   A row of circles over the feed: "Your story" first (with a plus), then
   whoever has stories, each placed by their newest story. Viewing never
   reorders the row; it only turns a ring grey. A
   story is gone after STORY_LIFE story replies (visiblePhone drops it). Tap
   opens the full-height viewer (a route, so back and Escape close it); tap
   the right or left side to go on or back, across profiles in the row's
   order (Instagram's way): past someone's last story comes the next
   person's first unseen one, and the viewer closes after the last. Rings: the gradient while a
   story is unviewed (seen.stories), grey once viewed; the persona's own
   shows its viewer count, grey while nobody has looked. Under a story:
   comments, Like, Post about it, and Message (a DM the job answers). */

const cut = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

/* Stories by owner, each owner's oldest first; owners in the order their
   newest story appears (v.stories is newest first), so seeing a story never
   moves anyone. `unseen` only colours the ring. The persona's are under YOU. */
export function storyGroups(v) {
  const seen = new Set(v.seen?.stories || []);
  const groups = new Map();
  for (const s of v.stories) {
    if (!groups.has(s.by)) groups.set(s.by, []);
    groups.get(s.by).push(s);
  }
  const out = [...groups.entries()].map(([by, list], order) => ({ by, list: list.slice().reverse(), unseen: by !== YOU && list.some((s) => !seen.has(s.id)), order }));
  return {
    mine: out.find((g) => g.by === YOU) || null,
    others: out.filter((g) => g.by !== YOU),
  };
}

/* Instagram's ring: the gradient for something unviewed, grey once viewed */
const RING = "linear-gradient(45deg, #f9ce34, #ee2a7b 55%, #6228d7)";
const GREY = "color-mix(in srgb, var(--nv-ink) 28%, var(--nv-bg))";

function Circle({ label, ring = "none", children, onClick, testid, plus, views }) {
  const bg = ring === "new" ? RING : ring === "seen" ? GREY : "transparent";
  return (
    <div role="listitem" className="shrink-0 w-[68px]" data-story={testid} data-ring={ring} {...(ring === "new" && views === undefined ? { "data-unseen": "" } : {})}>
      <button type="button" onClick={onClick} aria-label={label} className="w-full flex flex-col items-center gap-1">
        <span className="relative w-[64px] h-[64px] rounded-full p-[2.5px]" style={{ backgroundImage: ring === "new" ? bg : undefined, backgroundColor: ring === "new" ? undefined : bg }} data-ring-el="">
          <span className="w-full h-full rounded-full p-[2px] flex items-center justify-center" style={{ background: "var(--nv-bg)" }}>
            {children}
          </span>
          {plus && (
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-[var(--nv-bg)]" style={{ background: "var(--nv-ink)", color: "var(--nv-bg)" }}>
              <Plus size={12} strokeWidth={3} />
            </span>
          )}
          {views !== undefined && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 h-4 px-1.5 rounded-full text-[10px] font-semibold tabular-nums ring-2 ring-[var(--nv-bg)]" style={{ background: views > 0 ? "#ee2a7b" : GREY, color: "#fff" }} data-views={views}>
              <Eye size={9} strokeWidth={3} aria-hidden />{compactCount(views)}
            </span>
          )}
        </span>
        <span className="w-full text-center text-[11px] text-zinc-300 truncate">{label.split(",")[0]}</span>
      </button>
    </div>
  );
}

/* a story's viewers and likes, as the engine keeps them */
/* viewers: the engine's count when it keeps one, never fewer than the likers */
export const storyViews = (st) => Math.max(Number(st?.views ?? st?.viewers ?? st?.stats?.views) || 0, (st?.likedBy || []).length, Number(st?.stats?.likes) || 0);
export const storyLikes = (st) => Number(st?.likes ?? st?.stats?.likes) || 0;

export function StoriesRow({ ctx }) {
  const { mine, others } = storyGroups(ctx.v);
  const meName = ctx.accounts.nameOf(YOU);
  const myViews = mine ? mine.list.reduce((n, x) => Math.max(n, storyViews(x)), 0) : 0;
  return (
    <div role="list" aria-label="Stories" className="flex gap-3 px-4 py-3 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-[var(--nv-line)]" style={{ scrollbarWidth: "none" }}>
      <Circle
        label={mine ? `Your story, ${myViews} ${myViews === 1 ? "viewer" : "viewers"}` : "Your story"}
        plus={!mine}
        ring={mine ? (myViews > 0 ? "new" : "seen") : "none"}
        views={mine ? myViews : undefined}
        testid={YOU}
        onClick={() => ctx.open(mine ? { app: "murmur", story: YOU } : { app: "murmur", compose: "story" })}
      >
        <PhoneAvatar src={ctx.avatarOf(YOU)} name={meName} size={56} />
      </Circle>
      {others.map((g) => {
        const name = ctx.accounts.nameOf(g.by);
        return (
          <Circle key={g.by} label={g.unseen ? `${name}, new story` : name} ring={g.unseen ? "new" : "seen"} testid={g.by} onClick={() => ctx.open({ app: "murmur", story: g.by })}>
            <PhoneAvatar src={ctx.avatarOf(g.by)} name={name} size={56} />
          </Circle>
        );
      })}
    </div>
  );
}

/* The full-height viewer over the phone's screen. It starts on `owner`'s
   stories and walks the row as it was when it opened (the persona's own
   only when opened on them); each step to another owner swaps the route
   (ctx.replace), so back still closes the viewer. */
const groupOf = (v, by) => (by === YOU ? storyGroups(v).mine : storyGroups(v).others.find((g) => g.by === by)) || null;
const firstUnseen = (list, seen, by) => (by === YOU ? 0 : Math.max(0, list.findIndex((s) => !seen.includes(s.id))));

export function StoryViewer({ ctx, owner: asked, comments: openComments = null }) {
  const seen = ctx.h.seen?.stories || [];
  const [order] = useState(() => {
    const others = storyGroups(ctx.v).others.map((g) => g.by);
    return asked === YOU ? [YOU, ...others] : others.includes(asked) ? others : [asked, ...others];
  });
  const startAt = (by, commentsId) => {
    const list = groupOf(ctx.v, by)?.list || [];
    const at = commentsId ? list.findIndex((s) => s.id === commentsId) : -1;
    return at >= 0 ? at : firstUnseen(list, seen, by);
  };
  const [pos, setPos] = useState(() => ({ owner: asked, i: startAt(asked, openComments) }));
  /* opened again on someone else (a new route from outside): start there */
  const [prop, setProp] = useState(asked);
  if (asked !== prop) {
    setProp(asked);
    if (asked !== pos.owner) setPos({ owner: asked, i: startAt(asked, null) });
  }
  const owner = pos.owner;
  const list = groupOf(ctx.v, owner)?.list || [];
  const i = pos.i;
  const [sent, setSent] = useState(false);
  const box = useRef(null);
  const body = useRef(null);
  const turn = useRef(0);
  const story = list[Math.min(i, list.length - 1)];

  useLayoutEffect(() => { enter(box.current, { y: 24, scale: 0.98 }); }, []);
  useLayoutEffect(() => {
    if (!turn.current) return;
    enter(box.current, { x: turn.current * 40, y: 0, duration: MOTION.feedback });
    turn.current = 0;
  }, [owner]);
  useLayoutEffect(() => { enter(body.current, { x: 0, y: 8, duration: MOTION.feedback }); setSent(false); }, [story?.id]);
  useEffect(() => { if (story && owner !== YOU && !seen.includes(story.id)) ctx.act((x) => markSeen(x, { story: story.id })); }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!story) ctx.back(); }, [!story]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the next (dir 1) or previous (dir -1) owner in the row who still has stories */
  const neighbour = (dir) => {
    for (let k = order.indexOf(owner) + dir; k >= 0 && k < order.length; k += dir) {
      const g = groupOf(ctx.v, order[k]);
      if (g?.list.length) return g;
    }
    return null;
  };
  const goTo = (g, at, dir) => {
    turn.current = dir;
    setPos({ owner: g.by, i: at });
    ctx.replace({ app: "murmur", story: g.by });
  };
  const next = () => {
    if (i + 1 < list.length) { setPos({ owner, i: i + 1 }); return; }
    const g = neighbour(1);
    if (g) goTo(g, firstUnseen(g.list, seen, g.by), 1);
    else ctx.back();
  };
  const prev = () => {
    if (i > 0) { setPos({ owner, i: i - 1 }); return; }
    const g = neighbour(-1);
    if (g) goTo(g, g.list.length - 1, -1);
  };
  useEffect(() => {
    const key = (e) => {
      if (e.target?.closest?.("input,textarea,[data-testid=\"story-comments\"]")) return;
      if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!story) return null;

  const name = ctx.accounts.nameOf(owner);
  const reply = (text) => {
    ctx.write.dm(owner, `Replying to your story${story.text || story.photo ? ` ("${cut(story.text || story.photo, 60)}")` : ""}: ${text}`);
    setSent(true);
  };
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${name}'s story`}
      data-testid="story-viewer"
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: "var(--nv-bg)", paddingTop: "var(--sa-t)", paddingBottom: "var(--sa-b)" }}
    >
      <div className="shrink-0 flex gap-1 px-3 pt-3" aria-hidden>
        {list.map((s, k) => (
          <span key={s.id} className="flex-1 h-[3px] rounded-full" style={{ background: k <= i ? "var(--nv-ink)" : "var(--nv-line)" }} />
        ))}
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 min-w-0">
        <button type="button" onClick={() => openAccount(ctx, owner)} aria-label={`${name}'s profile`} data-profile={owner} className="flex-1 min-w-0 min-h-10 flex items-center gap-2 text-left">
          <PhoneAvatar src={ctx.avatarOf(owner)} name={name} size={32} />
          <span className="flex-1 min-w-0 text-sm font-medium text-zinc-100 truncate">{name} <span className="text-zinc-500 font-normal">{ctx.ageLabel(story)}</span></span>
        </button>
        <span className="text-xs text-zinc-500 tabular-nums" aria-live="polite">{i + 1}/{list.length}</span>
        <Button type="button" variant="icon" icon={X} onClick={() => ctx.back()} aria-label="Close story" className="text-zinc-300 [--nv-btn-icon:18px]" />
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-6 overflow-hidden">
        <div ref={body} className="w-full max-w-full text-center" data-story-id={story.id}>
          {story.image ? (
            <img src={story.image} alt={story.photo || "Story"} className="mx-auto max-w-full max-h-[55vh] rounded-2xl object-contain" />
          ) : story.photo ? (
            <p className="mx-auto px-4 py-4 rounded-2xl text-sm italic leading-relaxed text-zinc-300 border border-[var(--nv-line)] break-words" style={{ background: "color-mix(in srgb, var(--nv-ink) 7%, var(--nv-bg))" }} data-described-photo="">
              <span className="sr-only">Photo: </span>{story.photo}
            </p>
          ) : null}
          {story.text && <p className="mt-4 text-lg leading-snug text-zinc-100 whitespace-pre-wrap break-words">{story.text}</p>}
        </div>
        <button type="button" onClick={prev} aria-label="Previous story" className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" onClick={next} aria-label="Next story" className="absolute inset-y-0 right-0 w-2/3" />
      </div>
      <StoryReactions key={story.id} ctx={ctx} story={story} owner={owner} name={name} sent={sent} onDm={reply} startOpen={openComments === story.id} />
    </div>
  );
}

/* Under a story: Comments (with their count; opens the comments panel),
   Like, Post about it and Message (a DM, which the job answers) or, on the
   persona's own, Add to your story; and one box, a public comment by
   default. Message turns the same box into a reply to the story and
   focuses it inside the tap (no second field mounts, so Android keeps the
   keyboard). The writes are the engine's: toggleStoryLike, and addPost
   with a story's id as `ref` (a comment is a reply to it, Post about it a
   quote of it). */
const storyComments = (ctx, story) => repliesTo(ctx.h, story.id).filter((r) => ctx.postById(r.id)).slice().reverse();

function StoryReactions({ ctx, story, owner, name, sent, onDm, startOpen = false }) {
  const [dm, setDm] = useState(false);
  const [panel, setPanel] = useState(() => (startOpen ? { focus: false } : null));
  const field = useRef(null);
  const comments = storyComments(ctx, story);
  const count = Math.max(Number(story.stats?.replies) || 0, comments.length);
  const likes = storyLikes(story);
  const like = () => ctx.act((x) => (typeof phoneLib.toggleStoryLike === "function" ? phoneLib.toggleStoryLike(x, story.id) : x));
  const comment = (text) => ctx.write.comment(story, text);
  const mine = owner === YOU;
  /* the same field, now for the other kind of answer, focused in this tap */
  const toggleDm = () => { setDm((x) => !x); field.current?.focus({ preventScroll: true }); };
  const pill = "shrink-0 px-3.5 text-xs text-zinc-200 border border-[var(--nv-line)] [--nv-btn-icon:15px]";
  return (
    <div className="shrink-0 border-t border-[var(--nv-line)]" data-testid="story-reactions">
      <div className="flex items-center gap-2 px-4 pt-2.5 min-w-0 flex-nowrap overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <Button type="button" icon={MessageCircle} onClick={() => setPanel({ focus: true })} aria-label={`Comments, ${count}`} className={pill} data-action="story-comments">
          <span className="tabular-nums" data-count="">{compactCount(count)}</span>
        </Button>
        <Button type="button" onClick={like} aria-pressed={!!story.liked} aria-label={story.liked ? `Unlike story, ${likes} likes` : `Like story, ${likes} likes`} className={pill} style={story.liked ? { color: "#ee2a7b" } : undefined} data-action="story-like">
          <Heart size={15} fill={story.liked ? "currentColor" : "none"} aria-hidden />
          <span className="tabular-nums" data-count="">{compactCount(likes)}</span>
        </Button>
        <Button type="button" icon={Quote} onClick={() => ctx.replace({ app: "murmur", quote: story.id, focus: true })} className={`${pill} [--nv-btn-icon:14px]`}>
          Post about it
        </Button>
        <span className="flex-1" />
        {mine ? (
          <Button type="button" icon={Plus} onClick={() => ctx.replace({ app: "murmur", compose: "story" })} className={`${pill} [--nv-btn-icon:14px]`} aria-label="Add to your story">
            Add
          </Button>
        ) : (
          <Button type="button" icon={Send} onClick={toggleDm} aria-pressed={dm} selected={dm} className={`${pill} [--nv-btn-icon:13px]`}>
            Message
          </Button>
        )}
      </div>
      <div className="px-4 py-2.5">
        {dm && sent && <p className="pb-1.5 text-center text-[11px] text-zinc-400" role="status" data-testid="story-dm-sent">Sent to {name}</p>}
        <PhoneInput
          inputRef={field}
          placeholder={dm ? `Message ${name}…` : "Add a comment…"}
          label={dm ? "Reply to story" : "Comment"}
          sendLabel={dm ? "Send reply" : "Send comment"}
          onSend={dm ? onDm : comment}
        />
      </div>
      {panel && <StoryComments ctx={ctx} story={story} comments={comments} count={count} focus={panel.focus} onSend={comment} onClose={() => setPanel(null)} />}
    </div>
  );
}

/* A story's comments: a panel over the lower two thirds of the viewer,
   oldest first and scrolled to the newest, each with its age; the
   persona's newest still unanswered comment says "Sent"; while the job
   answers it, a reply slot stands under it (Incoming). Back, Escape and
   the close button close the panel, not the story. */
function StoryComments({ ctx, story, comments, count, focus, onSend, onClose }) {
  const box = useRef(null);
  const list = useRef(null);
  useBackLayer(() => onClose(), () => box.current);
  useLayoutEffect(() => { enter(box.current, { y: 40, duration: MOTION.feedback }); }, []);
  const last = comments.at(-1);
  const fresh = !!last && last.by === YOU && (last.tick || 0) > (ctx.h.tick?.n || 0);
  const ex = ctx.tick?.expect;
  const streamed = (Array.isArray(ctx.tick?.preview?.posts) ? ctx.tick.preview.posts : []).filter((p) => String(p.text || "").trim() && String(p.replyTo || "").replace(/^#/, "") === story.id);
  const active = (!!ex && ex.post === story.id) || (fresh && !!ctx.busy) || streamed.length > 0;
  const [show, gone] = useLinger(active);
  const newest = last?.id || "";
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [newest, comments.length, show, streamed.length]);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Story comments"
      data-testid="story-comments"
      className="absolute inset-x-0 bottom-0 z-30 h-[65%] flex flex-col rounded-t-3xl border-t border-[var(--nv-line)] shadow-lg"
      style={{ background: "var(--nv-bg)", paddingBottom: "var(--sa-b)" }}
    >
      <div className="shrink-0 flex items-center gap-2 pl-5 pr-2 h-12">
        <p className="flex-1 min-w-0 text-sm font-semibold text-zinc-100 truncate">Comments <span className="font-normal text-zinc-500 tabular-nums">{compactCount(count)}</span></p>
        <Button type="button" variant="icon" icon={X} onClick={onClose} aria-label="Close comments" className="text-zinc-300 [--nv-btn-icon:18px]" />
      </div>
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-[var(--nv-line)]">
        {comments.length || show ? (
          <div role="list" aria-label="Comments" className="divide-y divide-[var(--nv-line)]">
            {comments.map((r) => (
              <div key={r.id} role="listitem" data-post={r.id}>
                <PostCard ctx={ctx} post={r} actions={false} />
                {fresh && r.id === last.id && !show && <p className="-mt-2 pb-2 pr-4 text-right text-[11px] text-zinc-500" data-testid="story-comment-sent">Sent</p>}
              </div>
            ))}
            {show && <Incoming ctx={ctx} items={active ? streamed : []} slots={1} active={active} kind="reply" onGone={gone} />}
          </div>
        ) : <EmptyLine>No comments yet.</EmptyLine>}
      </div>
      <div className="shrink-0 px-4 py-2.5 border-t border-[var(--nv-line)]">
        <PhoneInput placeholder="Add a comment…" label="Comment on story" sendLabel="Send comment" autoFocus={focus} onSend={onSend} />
      </div>
    </div>
  );
}

/* A new story of the persona's: words, a described photo, or a picture. */
export function StoryComposer({ ctx }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const [image, setImage] = useState(null);
  const [error, setError] = useState("");
  const file = useRef(null);
  const pick = async (e) => {
    const f = [...(e.target.files || [])][0];
    e.target.value = "";
    if (!f) return;
    try { setImage(await readPhoto(f)); setError(""); } catch (err) { setError(err.message); }
  };
  const can = (!!text.trim() || !!photo.trim() || !!image);
  const share = () => {
    if (!can) return;
    ctx.write.story({ text: text.trim(), photo: photo.trim(), image });
    ctx.back();
  };
  return (
    <div className="px-4 py-4 space-y-3">
      {image ? (
        <div className="relative rounded-2xl overflow-hidden border border-[var(--nv-line)]">
          <img src={image} alt="Attached" className="block w-full max-h-72 object-cover" />
          <button type="button" onClick={() => setImage(null)} aria-label="Remove photo" className="absolute top-1.5 right-1.5 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--nv-bg)", color: "var(--nv-ink)" }}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => file.current?.click()} className="w-full h-20 rounded-2xl flex items-center justify-center gap-2 text-sm text-zinc-400 bg-[var(--nv-control)] border border-dashed border-[var(--nv-line-strong)]">
          <Plus size={16} /> Photo from device
        </button>
      )}
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={pick} data-testid="story-photo-input" />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <TextArea rows={2} value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="Or describe a photo" aria-label="What the photo shows" maxLength={TEXT_LIMITS.photo} />
      <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label="Story text" maxLength={TEXT_LIMITS.post} />
      <Button type="button" variant="primary" onClick={share} disabled={!can} className="w-full">
        Share to story
      </Button>
    </div>
  );
}
