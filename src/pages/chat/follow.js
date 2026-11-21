import { useEffect } from "react";

/* ---------- following a reply as it is written ----------

   The one time the chat scrolls by itself: while a reply is being written,
   and only while you are at the end of the conversation. It glides after
   the text (a fraction of the gap each frame, so it reads as a smooth
   scroll, never a jump). Scroll up and it lets go at once; come back to the
   end and it picks up again. While a finger is on the screen it never
   fights it. When the reply ends or is stopped, it simply stops: nothing
   moves the view after that. */
const NEAR = 48;
const INPUT_WINDOW = 1200;

export function useFollow(ref, active) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const gap = () => el.scrollHeight - el.clientHeight - el.scrollTop;
    let pinned = gap() < NEAR;
    let touching = false;
    let lastInput = 0;
    let raf = 0;
    const input = () => { lastInput = performance.now(); };
    const down = () => { touching = true; input(); };
    const up = () => { touching = false; input(); };
    /* only scrolls you caused (a finger, the wheel, a key) decide whether to
       follow; the glide's own scrolling and content growth do not */
    const onScroll = () => {
      if (!touching && performance.now() - lastInput > INPUT_WINDOW) return;
      pinned = gap() < NEAR;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!pinned || touching) return;
      const g = gap();
      if (g < 0.5) return;
      el.scrollTop += Math.min(g, Math.max(1, g * 0.18));
    };
    raf = requestAnimationFrame(tick);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("wheel", input, { passive: true });
    el.addEventListener("keydown", input);
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("wheel", input);
      el.removeEventListener("keydown", input);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [ref, active]);
}
