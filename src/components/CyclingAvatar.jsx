import { useEffect, useRef, useState } from "react";
import { MediaCrossfade } from "./motion/MediaCrossfade.jsx";
import { motionMode, onMotionChange } from "./motion/runtime.js";
import { Media } from "./media.jsx";

/* One round picture for several people (a Nova Scope reply with several
   voices, a chat with several characters): each in turn, every 3 seconds,
   faded in the way chat backgrounds change, looping. Only one picture is in
   the page at a time (and the one fading out), and it moves only while it
   is on screen, the app is in front and Motion is not Off; Off shows the
   first. One person, or one picture, is a still avatar. */
export const CYCLE_MS = 3000;

export function CyclingAvatar({ people, size = "w-9 h-9", interval = CYCLE_MS, className = "" }) {
  const pics = (people || []).filter((p) => p?.src);
  const host = useRef(null);
  const [i, setI] = useState(0);
  const [live, setLive] = useState(false);
  const many = pics.length > 1;

  /* on screen, with the page visible and motion allowed */
  useEffect(() => {
    if (!many) return undefined;
    let seen = false;
    const update = () => setLive(seen && document.visibilityState === "visible" && motionMode() !== "off");
    const io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; update(); })
      : null;
    if (io && host.current) io.observe(host.current); else { seen = true; update(); }
    document.addEventListener("visibilitychange", update);
    const unsub = onMotionChange(update);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", update); unsub(); };
  }, [many]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setI((n) => n + 1), interval);
    return () => clearInterval(t);
  }, [live, interval]);

  if (!pics.length) return null;
  const pic = pics[i % pics.length];
  return (
    <div
      ref={host}
      className={`${size} relative rounded-full overflow-hidden shrink-0 select-none nv-hair ${className}`}
      style={{ background: "var(--nv-control-base)" }}
      role="img"
      aria-label={pics.map((p) => p.name).filter(Boolean).join(", ")}
    >
      <MediaCrossfade identity={many ? `${i % pics.length}:${pic.src.length}` : "one"} className="absolute inset-0">
        <Media src={pic.src} alt="" thumb={160} className="absolute inset-0 w-full h-full object-cover" />
      </MediaCrossfade>
    </div>
  );
}
