import { MediaCrossfade } from "./motion/MediaCrossfade.jsx";
import { motionMode, onMotionChange, stop, tween } from "./motion/runtime.js";
import { useEffect, useRef, useState } from "react";
import { bgFor, bgSize, useScreen } from "./theme.jsx";
import { LoopVideo, Media } from "./media.jsx";
import { isVideo } from "../lib/video.js";
import { useAmbientField } from "./motion/ambient.js";
import { skinOf, skinPlain, skinSurface } from "../skins/skins.js";

/* An animated background, laid out live the way the editor framed it.

   A still background is baked to the screen's shape when it is saved, so
   the chat only has to stretch it. A GIF cannot be baked without freezing
   it, so it keeps its own size and the framing travels as numbers: zoom, and
   the offset as a fraction of the screen. Here those become the same cover
   size and translation the editor's preview used, recomputed if the screen
   changes. Until the file has loaded its size is unknown, so it starts as a
   plain centred cover. */
export function FramedImage({ src, scale = 1, nx = 0, ny = 0, start, end, active = true, style, className = "" }) {
  const vp = useScreen();
  const [nat, setNat] = useState(null);
  useEffect(() => setNat(null), [src]);
  const size = nat ? bgSize(nat, vp, scale || 1) : null;
  const cls = `absolute max-w-none pointer-events-none ${size ? "left-1/2 top-1/2" : "inset-0 w-full h-full object-cover"} ${className}`;
  const st = {
    ...(size
      ? { width: size.w, height: size.h, transform: `translate(-50%, -50%) translate(${(nx || 0) * vp.w}px, ${(ny || 0) * vp.h}px)` }
      : {}),
    ...style,
  };
  /* a video kept whole on a phone that could not cut it: same framing, and
     it loops over the part that was chosen */
  if (isVideo(src)) {
    return <LoopVideo src={src} start={start} end={end} active={active} onMeta={setNat} className={cls} style={st} />;
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
      className={cls}
      style={st}
    />
  );
}

/* Crossfades between backgrounds the way a wallpaper slideshow does.
   One image renders when there is only one — no timer, no repaint. A video
   plays only while it is the one showing (and, in a crossfade, the one
   fading out); the rest wait paused. */
/* How far a crop's shape may be from the screen's before it is fitted in
   whole rather than covered: a phone's 9:19 crop on a 16:9 window would
   otherwise show a thin, blown-up strip of it. */
const FIT_BEYOND = 1.5;

export function ChatBackdrop({ list, seconds }) {
  const vp = useScreen();
  /* the one showing, and the one fading out under it (-1 when none) */
  const [{ i, prev }, setShow] = useState({ i: 0, prev: -1 });
  const layers = useRef(null);
  useEffect(() => {
    if (list.length < 2) return;
    setShow({ i: 0, prev: -1 });
    const ms = Math.max(5, Number(seconds) || 20) * 1000;
    const t = setInterval(() => setShow((s) => ({ i: (s.i + 1) % list.length, prev: s.i })), ms);
    return () => clearInterval(t);
  }, [list.length, seconds]);

  useEffect(() => {
    const nodes = [...(layers.current?.children || [])];
    const animate = () => nodes.forEach((node, n) => {
      tween(node, { opacity: n === i ? list[n]?.opacity ?? 1 : 0, duration: motionMode() === "full" ? 1.2 : 0,
        onComplete: n === prev ? () => setShow(s => s.i === i && s.prev === prev ? { ...s, prev: -1 } : s) : undefined });
    });
    animate();
    const unsub = onMotionChange(animate);
    return () => { unsub(); nodes.forEach(stop); };
  }, [i, prev, list]);

  if (!list.length) return null;
  return (
    <div ref={layers} className="absolute inset-0 -z-10 pointer-events-none">
      {list.map((b0, n) => {
        const on = list.length === 1 || n === i;
        const active = on || n === prev;
        /* this screen's own crop when one was made for it (theme.jsx) */
        const b = bgFor(b0, vp);
        const ratio = (Number(b.aspect) || 0.64) / (vp.w / vp.h);
        const fit = !b.animated && Math.max(ratio, 1 / ratio) > FIT_BEYOND;
        return <div key={n} data-backdrop-layer="" className="absolute inset-0" style={{ opacity: n === 0 ? b.opacity : 0 }}>
          <MediaCrossfade identity={b.image} className="absolute inset-0">
          {b.animated
            ? <FramedImage src={b.image} scale={b.scale} nx={b.nx} ny={b.ny} start={b.t0} end={b.t1} active={active} />
            : fit
              ? <>
                  {/* the crop whole, over a soft wash of itself */}
                  {!b.video && <Media src={b.image} active={false} lazy={false} className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50" />}
                  <Media src={b.image} active={active} lazy={false} className="absolute inset-0 w-full h-full object-contain" />
                </>
              : <Media src={b.image} active={active} lazy={false} className="absolute inset-0 w-full h-full object-cover" />}
          </MediaCrossfade>
        </div>;
      })}
    </div>
  );
}

/* ============================================================
   app
   ============================================================ */

/* ---------- page backdrops ----------

   Plain black, which an OLED screen shows for free, or your own picture
   ("custom"). Nothing else ships with the app. */


/* The measuring grid, its registration marks and a film grain: the
   trailer's surface. Static, so it costs one paint. `ambient` adds the
   living field behind the tabs (motion/ambient.js): a lamp drifting over
   the grid, lighting its lines, and the odd mark flaring into a star. The
   chat keeps the still surface; nothing moves behind a story. */
export function Texture({ grid = true, ambient = false }) {
  const ref = useRef(null);
  const live = ambient && grid;
  useAmbientField(ref, live);
  return (
    <div ref={ref} aria-hidden className="nv-texture">
      {grid && <div className="nv-texture-grid" />}
      {live && <div className="nv-texture-lamp"><div className="nv-texture-lamp-grid" /></div>}
      <div className="nv-texture-grain" />
    </div>
  );
}

/* Backdrop behind every tab: the page colour, and in the standard look its
   grid and grain with the drifting light (a skin with a surface of its own
   draws over it; Minimal keeps the page plain). */
export function PageBackdrop({ appearance }) {
  const skin = skinOf(appearance || {});
  return (
    <div aria-hidden className="nv-page-backdrop fixed inset-0 -z-10 pointer-events-none" style={{ background: "var(--nv-bg)" }}>
      {!skinPlain(skin) && <Texture ambient={!skinSurface(skin)} />}
    </div>
  );
}

/* ---------- ambient light ----------

   Slow pools of the accent drifting over black, and an optional film grain.
   Gradients moved by transform only, so they cost next to nothing; Motion:
   calm, a moving backdrop or the system's reduced-motion setting stills them. */
export function FxLayer() { return null; }
