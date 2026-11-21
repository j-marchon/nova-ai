import { MOTION, gsap, motionMode, set, stop, tween } from "./motion/runtime.js";
import { useSwipeAway } from "./motion/useSwipeAway.js";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { dismissToast, leaveToasts, toasts } from "../lib/toast.js";
import { Button } from "./ui.jsx";
import "./activity.css";

/* ---------- the toast deck ----------

   At the top, under the activity island (both sit in App's .nv-top). The
   toasts never spread out: they pile up as one deck, the newest on top and
   the older ones peeking out underneath, smaller and dimmer. Every toast
   goes by itself, Undo offers included (only the activity island stays):
   a small ring shows the time left, and the toast fades as the ring drains,
   then slides up out of the screen. A finger on the top toast holds it; a
   swipe sideways or up sends it away, a pull down springs back.

   `scene` is the page App shows. When it changes (another tab, or into or
   out of a chat) the deck slides away, so it never covers another screen. */
export const DEPTH = 3; /* cards drawn in the deck; the rest wait unseen */

function useKeyboardUp() {
  const [up, setUp] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.kb === "1");
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setUp(html.dataset.kb === "1");
    read();
    if (typeof MutationObserver === "undefined") return undefined;
    const watch = new MutationObserver(read);
    watch.observe(html, { attributes: true, attributeFilter: ["data-kb"] });
    return () => watch.disconnect();
  }, []);
  return up;
}

export function Toasts({ scene }) {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.get);
  const kb = useKeyboardUp();
  const seen = useRef(scene);
  useEffect(() => {
    if (seen.current === scene) return;
    seen.current = scene;
    leaveToasts();
  }, [scene]);
  const newest = [...list].reverse();
  const drawn = kb ? 1 : DEPTH;

  return (
    <div className="nv-toasts" role="status" aria-live="polite">
      <div className="nv-toast-deck">
        {newest.map((t, i) => (
          <Layer key={t.id} depth={i} hidden={i >= drawn}>
            <Toast t={t} top={i === 0} />
          </Layer>
        ))}
      </div>
    </div>
  );
}

/* One card's place in the deck. The top one sits in the flow and gives the
   deck its height; the ones under it fill that same box, pushed down a
   little and shrunk, so only their lower edge shows. A change of place
   (the top one went) moves it forward. */
const place = (d) => ({ y: d * 7, scale: 1 - d * .05, opacity: d === 0 ? 1 : d === 1 ? .7 : .4 });

function Layer({ depth, hidden, children }) {
  const el = useRef(null);
  const was = useRef(null);
  useLayoutEffect(() => {
    const node = el.current;
    const to = place(Math.min(depth, DEPTH - 1));
    if (was.current == null) {
      was.current = depth;
      if (depth === 0 && motionMode() === "full") {
        set(node, { y: -24, scale: .92, opacity: 0 });
        tween(node, { ...to, duration: .55, ease: "expo.out" });
      } else if (depth === 0) {
        set(node, { opacity: 0 });
        tween(node, { ...to, duration: MOTION.feedback });
      } else set(node, to);
      return;
    }
    if (was.current === depth) return;
    was.current = depth;
    tween(node, { ...to, duration: .4, ease: "expo.out" });
  }, [depth]);
  useEffect(() => () => stop(el.current), []);

  const top = depth === 0;
  return (
    <div
      ref={el}
      className={`nv-toast-layer ${top ? "" : "nv-toast-under"}`}
      style={{ zIndex: 40 - depth, visibility: hidden ? "hidden" : undefined, transformOrigin: "50% 100%" }}
      aria-hidden={top ? undefined : "true"}
      inert={top ? undefined : true}
    >
      {children}
    </div>
  );
}

/* The countdown ring: one GSAP tween over t.ms is both the clock and the
   picture. It drains the ring and fades the toast; when it ends the toast
   slides up and away. Holding pauses it. Only Full motion drains and
   fades; Calm, Off and reduced motion keep it still, and the clock runs
   all the same. The tween is not tracked, so a change of motion setting
   (which completes tracked tweens) does not end the toast. */
const R = 8;
const C = 2 * Math.PI * R;
const FADE = .6; /* how much of the toast fades out over its time */

function Countdown({ arc, size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r={R} stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
      <circle ref={arc} cx="10" cy="10" r={R} stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset="0" transform="rotate(-90 10 10)" />
    </svg>
  );
}

function Toast({ t, top }) {
  const el = useRef(null);
  const fade = useRef(null);
  const arc = useRef(null);
  const clock = useRef(null);
  const gone = useRef(false);

  /* slide up out of the screen, then leave the store */
  const leave = () => {
    if (gone.current) return;
    gone.current = true;
    clock.current?.kill(); clock.current = null;
    tween(el.current, { y: -110, opacity: 0, duration: .34, ease: MOTION.leave, onComplete: () => dismissToast(t.id) });
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    const left = { p: 0 };
    const draw = () => {
      const full = motionMode() === "full";
      arc.current?.setAttribute("stroke-dashoffset", String(full ? C * left.p : 0));
      if (fade.current) fade.current.style.opacity = String(full ? 1 - FADE * left.p : 1);
    };
    clock.current = gsap.to(left, { p: 1, duration: t.ms / 1000, ease: "none", data: "toast-clock", onUpdate: draw, onComplete: () => leaveRef.current() });
    const target = el.current;
    return () => { clock.current?.kill(); clock.current = null; stop(target); };
  }, [t.id, t.ms]);

  useEffect(() => { if (t.leaving) leaveRef.current(); }, [t.leaving]);

  const swipe = useSwipeAway(el, {
    left: true, right: true, up: true, down: false,
    ignore: "button",
    enabled: top,
    onHold: (held) => { if (held) clock.current?.pause(); else clock.current?.resume(); },
    onDismiss: () => { gone.current = true; clock.current?.kill(); clock.current = null; dismissToast(t.id); },
  });

  return (
    <div ref={fade} className="nv-toast-fade">
      <div
        ref={el}
        {...swipe}
        className={`nv-frost nv-rise nv-toast pointer-events-auto flex items-center gap-1 rounded-2xl pl-4 pr-1.5 py-1.5 min-h-[48px] touch-none select-none ${t.tone === "warn" ? "border-l-2" : ""}`}
        style={t.tone === "warn" ? { borderLeftColor: "var(--nv-ink)" } : undefined}
        data-noswipe
      >
        <p className="flex-1 min-w-0 text-xs text-zinc-200 leading-relaxed py-1">{t.text}</p>
        {t.undo && (
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            onClick={() => { t.undo(); gone.current = true; clock.current?.kill(); dismissToast(t.id); }}
            data-motion="spin"
            className="shrink-0"
            style={{ color: "var(--acc)" }}
          >
            Undo
          </Button>
        )}
        <span className="shrink-0 grid place-items-center w-6 h-6 mr-1 text-zinc-400"><Countdown arc={arc} size={18} /></span>
      </div>
    </div>
  );
}
