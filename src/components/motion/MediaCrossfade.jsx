import { useLayoutEffect, useRef, useState } from "react";
import { MOTION, motionMode, onMotionChange, set, stop, tween } from "./runtime.js";

// Keep the previous media visible until its replacement is decoded. Each layer
// owns opacity independently of user-controlled media opacity and framing.
export function MediaCrossfade({ identity, children, className = "", style, duration = .7, ease = "power2.out" }) {
  const [layers, setLayers] = useState({ identity, current: children, previous: null });
  const host = useRef(null);
  if (identity !== layers.identity) setLayers({ identity, current: children, previous: layers.previous || layers.current });
  useLayoutEffect(() => {
    const incoming = host.current?.lastElementChild;
    const outgoing = layers.previous ? host.current?.firstElementChild : null;
    if (!incoming || !outgoing) return;
    set(outgoing, { opacity: 1 });
    let alive = true;
    const finish = () => { if (alive) setLayers(s => s.identity === identity ? { ...s, previous: null } : s); };
    const reveal = () => {
      if (!alive) return;
      const full = motionMode() === "full";
      if (full) set(incoming, { scale: 1.04 });
      tween(incoming, { opacity: 1, ...(full ? { scale: 1, clearProps: "transform" } : {}), duration: full ? duration : 0, ease });
      tween(outgoing, { opacity: 0, duration: full ? duration : 0, ease, onComplete: finish });
    };
    set(incoming, { opacity: motionMode() === "full" ? 0 : 1 });
    const media = [...incoming.querySelectorAll("img,video")];
    const cleanups = [];
    const ready = media.map(el => new Promise(resolve => {
      if (el.tagName === "IMG" ? el.complete : el.readyState >= 2) { resolve(); return; }
      const done = () => { el.removeEventListener("load", done); el.removeEventListener("loadeddata", done); el.removeEventListener("error", done); resolve(); };
      el.addEventListener("load", done); el.addEventListener("loadeddata", done); el.addEventListener("error", done);
      cleanups.push(done);
    }));
    if (motionMode() !== "full") reveal();
    else Promise.all(ready).then(reveal);
    const unsub = onMotionChange(reveal);
    return () => { alive = false; unsub(); cleanups.forEach(fn => fn()); stop(incoming); stop(outgoing); };
  }, [identity, !!layers.previous]);
  return <div ref={host} className={className} style={style}>
    {layers.previous && <div aria-hidden className="absolute inset-0 pointer-events-none">{layers.previous}</div>}
    <div className="absolute inset-0">{children}</div>
  </div>;
}
