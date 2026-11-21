import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOTION, enter, gsap, motionMode, stop, track, tween } from "../motion/runtime.js";
import { SkeletonPost } from "./parts.jsx";
import { PreviewCard } from "./PostCard.jsx";

/* ---------- posts on their way in ----------

   What a running batch is writing, in fixed slots: `slots` skeletons in a
   post card's exact geometry stand where the posts will be (keyed slot-0..,
   so nothing below them moves), and each streamed post (tick.preview) takes
   the next slot whole, about DRIP apart, with a short GSAP entrance: no
   typewriter, no half-written text. More posts than slots while the job
   runs: one more skeleton below them. When the job ends (`active` false) the
   saved posts take the cards' places; any skeletons left over fold away
   (height to 0), then `onGone`. Off motion shows everything at once.

   Props: items (the streamed posts so far, in order), slots, active,
   kind ("post" | "reply"), replyingTo (a reply card's "Replying to"
   handle), onGone. Its rows are listitems of the list it sits in (in a
   MotionList it is one item marked data-motion-still: never entered or
   slid, since its slots already hold their place). */
export const DRIP = 0.22;

/* how many of `count` items are shown: one more every DRIP (a tracked GSAP
   delayed call, so Off, Calm switches and hidden tabs settle it at once) */
export function useDrip(count) {
  const instant = () => motionMode() === "off" || (typeof document !== "undefined" && document.visibilityState === "hidden");
  const [shown, setShown] = useState(() => (instant() ? count : 0));
  const last = useRef(-Infinity);
  useEffect(() => {
    if (shown > count) { setShown(count); return undefined; }
    if (shown === count) return undefined;
    if (instant()) { setShown(count); return undefined; }
    const now = gsap.ticker.time;
    const wait = Math.max(0, DRIP - (now - last.current));
    const reveal = () => { last.current = gsap.ticker.time; setShown((s) => Math.min(s + 1, count)); };
    if (!wait) { reveal(); return undefined; }
    const call = track(gsap.delayedCall(wait, reveal));
    return () => call.kill();
  }, [shown, count]); // eslint-disable-line react-hooks/exhaustive-deps
  return Math.min(shown, count);
}

function Slot({ ctx, item, kind, replyingTo }) {
  const card = useRef(null);
  const had = useRef(!!item);
  useLayoutEffect(() => {
    if (item && !had.current) enter(card.current, { y: 6, duration: MOTION.feedback });
    had.current = !!item;
  }, [!!item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <div role="listitem" aria-hidden data-slot="skeleton"><SkeletonPost /></div>;
  return (
    <div ref={card} role="listitem" data-slot="card">
      <PreviewCard ctx={ctx} item={item} reply={kind === "reply"} replyingTo={replyingTo} />
    </div>
  );
}

export function Incoming({ ctx, items = [], slots = 2, active = true, kind = "post", replyingTo, onGone }) {
  const box = useRef(null);
  const tail = useRef(null);
  const shown = useDrip(items.length);
  /* the slot count while running; kept for the fold when it stops */
  const most = useRef(0);
  const n = active ? Math.max(slots, items.length + (items.length >= slots ? 1 : 0)) : Math.max(items.length, most.current);
  if (active) most.current = Math.max(most.current, n);
  const seen = useRef(0);
  seen.current = Math.max(seen.current, items.length);
  /* after the job: what never filled */
  const left = active ? 0 : Math.max(0, most.current - Math.max(seen.current, items.length));

  useLayoutEffect(() => { enter(box.current, { y: 0, duration: MOTION.feedback }); }, []);
  /* the shimmer over whatever skeletons are up (Full only) */
  const bones = active ? n - shown : left;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || motionMode() !== "full" || !bones) return undefined;
    const shine = [...el.querySelectorAll('[data-slot="skeleton"] [data-shine]')];
    if (!shine.length) return undefined;
    const t = track(gsap.fromTo(shine, { xPercent: -100 }, { xPercent: 100, duration: 1.2, ease: "power1.inOut", repeat: -1, stagger: 0.08, data: "phone-shimmer" }));
    return () => t.kill();
  }, [bones, active]);
  /* the job ended: the leftovers fold away, then the whole block goes */
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    if (active) return undefined;
    const el = tail.current;
    if (!el) { gone.current?.(); return undefined; }
    tween(el, { height: 0, opacity: 0, duration: MOTION.exit, ease: MOTION.leave, onComplete: () => gone.current?.() });
    return () => stop(el);
  }, [active]);

  const cards = active ? items.slice(0, shown) : items;
  const rows = [];
  for (let i = 0; i < (active ? n : cards.length); i++) rows.push(<Slot key={`slot-${i}`} ctx={ctx} item={cards[i] || null} kind={kind} replyingTo={replyingTo} />);
  return (
    <div ref={box} className="divide-y divide-[var(--nv-line)]" data-testid="phone-incoming" data-motion-still="" data-kind={kind} aria-busy={active || undefined}>
      {rows}
      {!active && left > 0 && (
        <div ref={tail} className="overflow-hidden divide-y divide-[var(--nv-line)]" aria-hidden data-testid="phone-incoming-tail">
          {Array.from({ length: left }, (_, i) => <div key={i} data-slot="skeleton"><SkeletonPost /></div>)}
        </div>
      )}
    </div>
  );
}

/* Shown while `active`, and after it until the incoming block has folded
   away its leftovers (Incoming's onGone). */
export function useLinger(active) {
  const [linger, setLinger] = useState(active);
  useLayoutEffect(() => { if (active) setLinger(true); }, [active]);
  return [active || linger, () => setLinger(false)];
}

/* Ids that came in while an incoming block was up: the saved rows taking
   the streamed cards' places. They carry data-arrived, so they show at once
   (the card already made its entrance) instead of entering again. */
export function useArrived(ids, incoming) {
  const known = useRef(null);
  const was = useRef(false);
  const arrived = useRef(new Set());
  if (known.current && was.current) for (const id of ids) if (!known.current.has(id)) arrived.current.add(id);
  useLayoutEffect(() => { known.current = new Set(ids); was.current = incoming; });
  return arrived.current;
}
