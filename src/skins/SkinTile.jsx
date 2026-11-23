import { useEffect, useRef, useState } from "react";
import { motionMode, onMotionChange } from "../components/motion/runtime.js";

/* ---------- a skin's picture in Look → Skin ----------

   Its first scene, moving: a short loop of animated WebP made from the
   scene's layers, with a still of its first
   frame. The loop plays only while the tile is on screen and motion is
   Full; otherwise, under Calm, Off, reduced motion or off screen, the still
   shows. Only the picture's source changes, so no scene engine, timer or
   animation frame runs per tile, and the browser decodes the loop only
   while it is shown. */

const canWatch = () => typeof IntersectionObserver === "function";

export function SkinTile({ still, loop, className = "", style }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  const [full, setFull] = useState(() => motionMode() === "full");

  useEffect(() => {
    const check = () => setFull(motionMode() === "full");
    const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    reduce?.addEventListener?.("change", check);
    const unsub = onMotionChange(check);
    return () => { unsub(); reduce?.removeEventListener?.("change", check); };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!loop || !el || !canWatch()) return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [loop]);

  return (
    <img
      ref={ref}
      src={loop && seen && full ? loop : still}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
    />
  );
}
