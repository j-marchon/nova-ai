import { useEffect, useRef } from "react";
import { toLayout } from "../../lib/uiScale.js";
import { MOTION, set, stop, tween } from "./runtime.js";

/* ---------- swipe a surface off the screen ----------

   One gesture for the toasts and the activity island. The first few pixels
   of movement pick the axis, so a swipe is clearly sideways or vertical.
   Each direction is either allowed (the surface follows the finger and,
   past AWAY or on a quick flick, flies out that way) or resisted (it gives
   a little and springs back). Offsets go through toLayout, so they track
   the finger at any UI scale.

   A tap is never a drag: until the axis is picked nothing moves and the
   pointer is not captured, so buttons inside get their click. After a
   drag, the click that may follow is swallowed (onClickCapture).

   ref: the element that moves. Options: left, right, up, down (allowed
   directions), ignore (a selector; presses that start there are left
   alone), enabled, onHold(held) (a finger is on it, or it was let go and
   stays), onDismiss(direction) (after the fly-out). Returns the props to
   spread on the element. */

const LOCK = 8;      /* px before the axis is chosen */
const AWAY = 80;     /* px past which a release sends it away */
const FLICK = .5;    /* px per ms: a quick flick sends it away sooner */
const resist = (d) => d / (1 + Math.abs(d) / 60);

export function useSwipeAway(ref, { left = true, right = true, up = false, down = false, ignore, enabled = true, onHold, onDismiss } = {}) {
  const drag = useRef(null);
  const swallow = useRef(false);

  useEffect(() => () => { drag.current?.detach(); }, []);

  const allows = (axis, d) => (axis === "x" ? (d < 0 ? left : right) : (d < 0 ? up : down));

  const paint = (el, g) => {
    const v = g.shown;
    if (g.axis === "x") set(el, { x: v, rotation: v / 40, opacity: Math.max(.2, 1 - Math.abs(v) / 220) });
    else set(el, { y: v, opacity: g.allowed ? Math.max(.2, 1 - Math.abs(v) / 160) : 1 });
  };

  const onPointerDown = (e) => {
    swallow.current = false;
    if (!enabled || drag.current || (e.button != null && e.button > 0)) return;
    if (ignore && e.target?.closest?.(ignore)) return;
    const el = ref.current;
    if (!el) return;
    const g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, d: 0, shown: 0, allowed: false, t: e.timeStamp || 0, v: 0 };

    const move = (ev) => {
      if (ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
      if (!g.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK) return;
        g.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        try { el.setPointerCapture?.(ev.pointerId); } catch { /* not a live pointer */ }
        stop(el);
        el.dataset.lifted = "1";
      }
      const d = toLayout(g.axis === "x" ? dx : dy);
      const t = ev.timeStamp || 0;
      if (t > g.t) g.v = (d - g.d) / (t - g.t);
      g.t = t; g.d = d;
      g.allowed = allows(g.axis, d);
      g.shown = g.allowed ? d : resist(d);
      paint(el, g);
    };

    const end = (ev) => {
      if (ev.pointerId !== g.id) return;
      g.detach();
      if (!g.axis) { onHold?.(false); return; }
      delete el.dataset.lifted;
      swallow.current = true;
      setTimeout(() => { swallow.current = false; }, 400);
      const sign = Math.sign(g.d);
      const fast = Math.abs(g.d) > 24 && Math.sign(g.v) === sign && Math.abs(g.v) > FLICK;
      if (ev.type !== "pointercancel" && g.allowed && sign && (Math.abs(g.d) > AWAY || fast)) {
        const direction = g.axis === "x" ? (sign < 0 ? "left" : "right") : (sign < 0 ? "up" : "down");
        const out = g.axis === "x" ? { x: sign * 360, rotation: sign * 12 } : { y: sign * 140 };
        tween(el, { ...out, opacity: 0, duration: .24, ease: MOTION.leave, onComplete: () => onDismiss?.(direction) });
      } else {
        tween(el, { x: 0, y: 0, rotation: 0, opacity: 1, duration: .55, ease: "expo.out", clearProps: "transform,opacity" });
        onHold?.(false);
      }
    };

    g.detach = () => {
      if (drag.current === g) drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    drag.current = g;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    onHold?.(true);
  };

  const onClickCapture = (e) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}
