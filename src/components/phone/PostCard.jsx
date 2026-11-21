import { useLayoutEffect, useRef, useState } from "react";
import { BadgeCheck, Heart, Image as ImageIcon, MessageCircle, Quote, Repeat2, Sparkles } from "lucide-react";
import { ActionMenu, Button, Skeleton } from "../ui.jsx";
import { pop } from "../motion/runtime.js";
import { compactCount } from "../../lib/phone.js";
import { PhoneAvatar, openAccount } from "./parts.jsx";
import { canDevelop, develop, useDeveloping } from "./media.js";
import { isVerified as verifiedIn } from "./social.js";

/* ---------- one post on the feed ----------

   Avatar, name, verified check, @handle and age; what it replies to; text;
   its photo (a picture, or the description in a tinted panel with Develop,
   the only way a picture is ever made); the quoted post; and the action row
   of Reply, Repost (Repost or Quote) and Like with compact counts;
   `showParent` also shows the post a reply answers (the profile's Replies). A repost
   shows "X reposted" over the post it repeats; the actions act on that post. */

const isVerified = (ctx, key) => verifiedIn(ctx.h, key);

function Verified() {
  return <BadgeCheck size={14} className="shrink-0" style={{ color: "var(--nv-ink)" }} aria-label="Verified" role="img" data-verified="" />;
}

/* The author row: avatar and name open the account's profile page. */
function Byline({ ctx, post, small = false }) {
  const name = ctx.accounts.nameOf(post.by);
  const handle = ctx.accounts.handleOf(post.by);
  const profile = () => openAccount(ctx, post.by);
  return (
    <div className="flex items-center gap-1 min-w-0 leading-tight">
      <button type="button" onClick={profile} className={`min-w-0 inline-flex items-center gap-1 ${small ? "" : "min-h-10"} text-left`} aria-label={`${name}, @${handle}`} data-profile={post.by}>
        <span className={`truncate font-semibold text-zinc-100 ${small ? "text-[13px]" : "text-sm"}`}>{name}</span>
        {isVerified(ctx, post.by) && <Verified />}
        <span className={`truncate text-zinc-500 ${small ? "text-xs" : "text-[13px]"}`}>@{handle}</span>
      </button>
      <span className={`shrink-0 text-zinc-500 ${small ? "text-xs" : "text-[13px]"}`} aria-hidden>·</span>
      <span className={`shrink-0 text-zinc-500 tabular-nums ${small ? "text-xs" : "text-[13px]"}`} data-age="">{ctx.ageLabel(post)}</span>
    </div>
  );
}

/* A photo: the picture, a skeleton while it develops, or the description. */
export function Photo({ ctx, post, compact = false }) {
  const developing = useDeveloping(post.id);
  if (post.image) {
    return (
      <button type="button" onClick={() => ctx.onPreview?.(post.image)} className="block w-full max-w-full mt-2 rounded-2xl overflow-hidden border border-[var(--nv-line)]" aria-label="View photo">
        <img src={post.image} alt={post.photo || "Photo"} className={`block w-full object-cover ${compact ? "max-h-40" : "max-h-[420px]"}`} loading="lazy" />
      </button>
    );
  }
  if (!post.photo) return null;
  if (developing) return <Skeleton className="mt-2 w-full aspect-[4/3] rounded-2xl" />;
  const can = !compact && canDevelop(ctx.settings);
  return (
    <div
      className="mt-2 w-full max-w-full rounded-2xl px-4 py-3 border border-[var(--nv-line)]"
      style={{ background: "color-mix(in srgb, var(--nv-ink) 7%, var(--nv-bg))" }}
      data-described-photo=""
    >
      <div className="flex items-start gap-2">
        <ImageIcon size={15} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden />
        <p className={`flex-1 min-w-0 italic leading-relaxed text-zinc-300 break-words ${compact ? "text-xs line-clamp-3" : "text-sm"}`}>
          <span className="sr-only">Photo: </span>{post.photo}
        </p>
      </div>
      {can && (
        <div className="mt-2 flex justify-end">
          <Button type="button" icon={Sparkles} onClick={() => develop(post, ctx)} className="px-3.5 text-xs [--nv-btn-icon:14px] border border-[var(--nv-line)]" data-develop="">
            Develop
          </Button>
        </div>
      )}
    </div>
  );
}

/* The quoted post, small, inside the card; tapping it opens it. */
/* a story by id, while it is on the phone */
export const storyById = (ctx, id) => (ctx.v?.stories || []).find((st) => st.id === id) || null;

/* A quoted story ("Post about it"): small, with its owner; tapping opens it. */
function StoryEmbed({ ctx, story }) {
  const name = ctx.accounts.nameOf(story.by);
  return (
    <button
      type="button"
      onClick={() => ctx.open({ app: "murmur", story: story.by })}
      className="mt-2 w-full max-w-full text-left rounded-2xl border border-[var(--nv-line)] overflow-hidden"
      aria-label={`${name}'s story`}
      data-embed-story={story.id}
    >
      <span className="flex items-center gap-2 px-3 pt-2.5 min-w-0">
        <span className="shrink-0 rounded-full p-[1.5px]" style={{ backgroundImage: "linear-gradient(45deg, #f9ce34, #ee2a7b 55%, #6228d7)" }}>
          <PhoneAvatar src={ctx.avatarOf(story.by)} name={name} size={20} />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold text-zinc-100">{name}</span>
        <span className="shrink-0 text-xs text-zinc-500">· Story</span>
      </span>
      {story.image
        ? <img src={story.image} alt={story.photo || "Story"} className="block mt-2 w-full max-h-40 object-cover" loading="lazy" />
        : <span className="block px-3 pb-3 pt-1 text-[13px] leading-snug text-zinc-200 whitespace-pre-wrap break-words line-clamp-4">{story.text || story.photo}</span>}
    </button>
  );
}

export function Embed({ ctx, id }) {
  const post = ctx.postById(id);
  const story = post ? null : storyById(ctx, id);
  if (story) return <StoryEmbed ctx={ctx} story={story} />;
  if (!post) {
    return <p className="mt-2 px-3 py-3 rounded-2xl border border-[var(--nv-line)] text-[13px] text-zinc-500">This post is unavailable.</p>;
  }
  const name = ctx.accounts.nameOf(post.by);
  return (
    <div className="mt-2 rounded-2xl border border-[var(--nv-line)] overflow-hidden max-w-full" data-embed={post.id}>
      <div className="flex items-center gap-2 px-3 pt-2.5 min-w-0">
        <PhoneAvatar src={ctx.avatarOf(post.by)} name={name} size={20} />
        <div className="min-w-0 flex-1"><Byline ctx={ctx} post={post} small /></div>
      </div>
      <button type="button" onClick={() => ctx.open({ app: "murmur", post: post.id })} className="block w-full text-left px-3 pb-3 pt-1" aria-label={`Quoted post by ${name}`}>
        {post.text && <p className="text-[13px] leading-snug text-zinc-200 whitespace-pre-wrap break-words line-clamp-4">{post.text}</p>}
      </button>
      {(post.photo || post.image) && <div className="px-3 pb-3 -mt-2"><Photo ctx={ctx} post={post} compact /></div>}
    </div>
  );
}

function ActionButton({ icon: Icon, count, label, on, onClick, filled, testid }) {
  const icon = useRef(null);
  const was = useRef(on);
  useLayoutEffect(() => {
    if (on && !was.current) pop(icon.current);
    was.current = on;
  }, [on]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      {...(on === undefined ? {} : { "aria-pressed": !!on })}
      data-action={testid}
      className="inline-flex items-center gap-1 h-10 min-w-10 px-2 rounded-full text-xs text-zinc-400 hover:text-zinc-100"
      style={on ? { color: "var(--nv-ink)" } : undefined}
    >
      <span ref={icon} className="inline-flex"><Icon size={16} fill={filled && on ? "currentColor" : "none"} /></span>
      <span className="tabular-nums" data-count="">{compactCount(count)}</span>
    </button>
  );
}

/* Reply, Repost (a menu: Repost or Quote; a second tap undoes a repost), Like. */
export function ActionRow({ ctx, post, onReply }) {
  const [menu, setMenu] = useState(false);
  const s = ctx.statsOf(post);
  const plural = (n, one, many) => `${compactCount(n)} ${n === 1 ? one : many}`;
  return (
    <div className="mt-1 -ml-2 flex items-center justify-between max-w-[300px] flex-nowrap" role="group" aria-label="Post actions">
      <ActionButton icon={MessageCircle} count={s.replies} label={`Reply, ${plural(s.replies, "reply", "replies")}`} onClick={onReply} testid="reply" />
      <ActionButton
        icon={Repeat2}
        count={s.reposts}
        on={!!post.reposted}
        label={post.reposted ? `Undo repost, ${plural(s.reposts, "repost", "reposts")}` : `Repost, ${plural(s.reposts, "repost", "reposts")}`}
        onClick={() => (post.reposted ? ctx.write.repost(post) : setMenu(true))}
        testid="repost"
      />
      <ActionButton
        icon={Heart}
        count={s.likes}
        on={!!post.liked}
        filled
        label={post.liked ? `Unlike, ${plural(s.likes, "like", "likes")}` : `Like, ${plural(s.likes, "like", "likes")}`}
        onClick={() => ctx.write.like(post)}
        testid="like"
      />
      {menu && (
        <ActionMenu
          title="Repost"
          onClose={() => setMenu(false)}
          actions={[
            { icon: Repeat2, label: "Repost", run: () => ctx.write.repost(post) },
            { icon: Quote, label: "Quote", run: () => ctx.open({ app: "murmur", quote: post.id, focus: true }) },
          ]}
        />
      )}
    </div>
  );
}

/* One post. `onOpen` makes the text open the post's detail; without it the
   post is shown as the head of its own detail. */
export function PostCard({ ctx, post, onOpen, actions = true, showParent = false }) {
  if (post.kind === "repost") {
    const target = ctx.postById(post.ref);
    if (!target) return null;
    return (
      <div data-repost-by={post.by}>
        <p className="flex items-center gap-1.5 px-4 pt-2.5 -mb-1.5 pl-[52px] text-xs text-zinc-500 min-w-0">
          <Repeat2 size={13} className="shrink-0" aria-hidden />
          <span className="truncate">{ctx.accounts.nameOf(post.by)} reposted</span>
        </p>
        <PostCard ctx={ctx} post={target} onOpen={onOpen && (() => ctx.open({ app: "murmur", post: target.id }))} actions={actions} showParent={showParent} />
      </div>
    );
  }
  const name = ctx.accounts.nameOf(post.by);
  const parent = post.kind === "reply" ? ctx.postById(post.ref) : null;
  const text = post.text ? <p className="text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">{post.text}</p> : null;
  return (
    <article className="flex gap-3 px-4 py-3 min-w-0" aria-label={`${name}: ${post.text || post.photo || ""}`.slice(0, 120)}>
      <button type="button" onClick={() => openAccount(ctx, post.by)} aria-label={`${name}'s profile`} className="shrink-0 self-start w-10 h-10 rounded-full">
        <PhoneAvatar src={ctx.avatarOf(post.by)} name={name} size={40} />
      </button>
      <div className="flex-1 min-w-0">
        <Byline ctx={ctx} post={post} />
        {parent && (
          <p className="text-[13px] text-zinc-500 truncate" data-reply-to={parent.by}>
            Replying to <span className="text-zinc-300">@{ctx.accounts.handleOf(parent.by)}</span>
          </p>
        )}
        {text && (onOpen ? <button type="button" onClick={onOpen} className="block w-full text-left mt-0.5">{text}</button> : <div className="mt-0.5">{text}</div>)}
        {!text && onOpen && <button type="button" onClick={onOpen} className="sr-only">Open post</button>}
        <Photo ctx={ctx} post={post} />
        {post.kind === "quote" && <Embed ctx={ctx} id={post.ref} />}
        {showParent && post.kind === "reply" && <div data-replied-to={post.ref}><Embed ctx={ctx} id={post.ref} /></div>}
        {actions && <ActionRow ctx={ctx} post={post} onReply={() => ctx.open({ app: "murmur", post: post.id, focus: true })} />}
      </div>
    </article>
  );
}

/* A card of a streaming batch (tick.preview): a post, story or reply the
   job has written but not saved yet, at full strength and in a saved
   post's exact geometry (the action row stands there, inert, without
   counts), so the saved post takes its place without anything moving. Its
   author is the raw handle the model wrote, matched to a known account when
   there is one. Nothing on it is interactive. */
export function PreviewCard({ ctx, item, story = false, reply = false, replyingTo = "" }) {
  const raw = String(item.by || "").replace(/^@+/, "").trim();
  const key = raw ? ctx.accounts.keyOf?.(raw) || null : null;
  const name = key ? ctx.accounts.nameOf(key) : raw || "Someone";
  const handle = key ? ctx.accounts.handleOf(key) : raw;
  const verified = key ? isVerified(ctx, key) : false;
  return (
    <article className="flex gap-3 px-4 py-3 min-w-0" aria-label={`${name}: ${item.text || item.photo || ""}`.slice(0, 120)} data-preview={story ? "story" : reply ? "reply" : "post"}>
      <div className="shrink-0 self-start w-10 h-10 rounded-full">
        <PhoneAvatar src={key ? ctx.avatarOf(key) : null} name={name} size={40} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0 min-h-10 leading-tight">
          <span className="truncate text-sm font-semibold text-zinc-100">{name}</span>
          {verified && <Verified />}
          {handle && <span className="truncate text-[13px] text-zinc-500">@{handle}</span>}
          {story && <span className="shrink-0 text-[13px] text-zinc-500">· Story</span>}
        </div>
        {reply && replyingTo && (
          <p className="text-[13px] text-zinc-500 truncate">Replying to <span className="text-zinc-300">@{replyingTo}</span></p>
        )}
        {item.text && <p className="mt-0.5 text-[15px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">{item.text}</p>}
        {item.photo && (
          <div className="mt-2 w-full max-w-full rounded-2xl px-4 py-3 border border-[var(--nv-line)]" style={{ background: "color-mix(in srgb, var(--nv-ink) 7%, var(--nv-bg))" }} data-described-photo="">
            <p className="flex items-start gap-2 text-sm italic leading-relaxed text-zinc-300 break-words">
              <ImageIcon size={15} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden />
              <span className="flex-1 min-w-0"><span className="sr-only">Photo: </span>{item.photo}</span>
            </p>
          </div>
        )}
        {!story && (
          <div aria-hidden className="mt-1 -ml-2 flex items-center justify-between max-w-[300px] text-zinc-600" data-preview-actions="">
            {[MessageCircle, Repeat2, Heart].map((Icon, i) => <span key={i} className="inline-flex items-center h-10 min-w-10 px-2"><Icon size={16} /></span>)}
          </div>
        )}
      </div>
    </article>
  );
}
