import { useCallback, useEffect, useRef } from "react";

/* Long-press for touch, so message actions are reachable without a
   mouse. Called once per component; the returned factory builds the
   handlers for each item. Ignores mouse input (desktop keeps hover)
   and bails the moment the finger moves, so scrolling never fires it. */
/* ---------- counting taps ----------

   Two, three and four taps on the same spot, told apart by waiting.

   There is no way around the wait: a double tap is only a double tap once a
   third has failed to arrive, so every gesture here resolves 260ms after the
   last tap rather than on the tap itself. That is the cost of stacking three
   gestures on one target, and it is why the window is as short as it can be
   while still being reachable — much under 250ms and a triple tap starts
   registering as a double for anyone not drumming their fingers.

   Taps have to land near each other, or a tap at the top of a bubble followed
   by one at the bottom counts as a double when it was two separate reads.

   `max` lets a target opt out of counting higher than it can use, so a double
   tap on the background resolves in 260ms instead of waiting out a triple
   that has nothing to do. */
export function useMultiTap({ onTap, max = 4, window: win = 260, slop = 28 }) {
  const count = useRef(0);
  const timer = useRef(null);
  const last = useRef({ x: 0, y: 0 });
  const handler = useRef(onTap);
  handler.current = onTap;

  useEffect(() => () => clearTimeout(timer.current), []);

  const fire = useCallback(() => {
    const n = count.current;
    count.current = 0;
    timer.current = null;
    if (n >= 2) handler.current?.(n);
  }, []);

  return useCallback(
    (e) => {
      const x = e.clientX ?? 0;
      const y = e.clientY ?? 0;
      if (count.current > 0 && Math.hypot(x - last.current.x, y - last.current.y) > slop) {
        count.current = 0;
      }
      last.current = { x, y };
      count.current += 1;
      clearTimeout(timer.current);
      if (count.current >= max) { fire(); return; }
      timer.current = setTimeout(fire, win);
    },
    [fire, max, win, slop]
  );
}

export function useLongPress(ms = 450) {
  const timer = useRef(null);
  const origin = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useCallback(
    (onLongPress) => ({
      onPointerDown: (e) => {
        if (e.pointerType === "mouse") return;
        origin.current = { x: e.clientX, y: e.clientY };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          navigator.vibrate?.(12);   // a small tick, where supported
          /* Lifting the finger afterwards still produces a click on whatever
             was held, which on a row would open it under the menu. The next
             click, if it comes soon, is swallowed. */
          const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
          window.addEventListener("click", eat, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 600);
          onLongPress();
        }, ms);
      },
      onPointerMove: (e) => {
        if (!timer.current || !origin.current) return;
        const moved = Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y);
        if (moved > 10) clear();     // they are scrolling, not pressing
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e) => e.preventDefault(),
    }),
    [clear, ms]
  );
}
