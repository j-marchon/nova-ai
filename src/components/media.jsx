import { useMotionValue } from "./motion/hooks.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { acquireUrl, isVideo, peekUrl, releaseUrl } from "../lib/video.js";
import { Button } from "./ui.jsx";

/* ============================================================
   moving pictures: playback that costs as little as it can
   ============================================================ */

/* One IntersectionObserver for every video in the app rather than one each:
   a grid of animated cards would otherwise be fifty observers. */
const watchers = new Map();
let io = null;
function watch(el, cb) {
  if (!el) return () => {};
  if (typeof IntersectionObserver === "undefined") {
    cb(true);
    return () => {};
  }
  io ||= new IntersectionObserver(
    (entries) => entries.forEach((e) => watchers.get(e.target)?.(e.isIntersecting)),
    /* a little ahead of the edge, so a card scrolling in is already moving */
    { rootMargin: "150px" }
  );
  watchers.set(el, cb);
  io.observe(el);
  return () => {
    io.unobserve(el);
    watchers.delete(el);
  };
}

const onVis = (cb) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
/* nothing keeps playing behind the lock screen or another app */
export const usePageVisible = () =>
  useSyncExternalStore(onVis, () => !document.hidden, () => true);

const tryPlay = (v) => {
  try { v.play()?.catch?.(() => {}); } catch {}
};

/* Plays only between `start` and `end` (seconds). Used for an original file
   kept whole on a phone that cannot cut it, and by the editor's preview.
   Checked on every decoded frame where the browser says when that is, so the
   jump back lands within a frame instead of on the next quarter-second
   timeupdate. */
export function useSegmentLoop(ref, start, end) {
  useEffect(() => {
    const v = ref.current;
    if (!v || start == null || end == null || end <= start) return;
    let handle = 0;
    const check = () => {
      if (v.currentTime >= end - 0.02 || v.currentTime < start - 0.25) v.currentTime = start;
    };
    const tick = () => {
      check();
      handle = v.requestVideoFrameCallback?.(tick) || 0;
    };
    const restart = () => {
      v.currentTime = start;
      tryPlay(v);
    };
    if (v.requestVideoFrameCallback) handle = v.requestVideoFrameCallback(tick);
    v.addEventListener("timeupdate", check);
    v.addEventListener("loadedmetadata", check);
    v.addEventListener("ended", restart);
    check();
    return () => {
      if (handle) v.cancelVideoFrameCallback?.(handle);
      v.removeEventListener("timeupdate", check);
      v.removeEventListener("loadedmetadata", check);
      v.removeEventListener("ended", restart);
    };
  }, [ref, start, end]);
}

/* A silent looping video that only decodes while it can be seen.

   - Off screen, its source is detached, which frees the decoder; a long
     list of animated avatars costs only the ones in view.
   - With the app in the background, or `active` false (a slideshow
     background waiting its turn), it pauses.
   - It plays from a shared blob URL (see acquireUrl in lib/video.js). */
export function LoopVideo({ src, className = "", style, start, end, active = true, onMeta }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(() => peekUrl(src));
  const [seen, setSeen] = useState(false);
  const page = usePageVisible();
  const was = useRef(false);

  useEffect(() => {
    let alive = true;
    setUrl(peekUrl(src));
    acquireUrl(src).then((u) => alive && setUrl(u)).catch((e) => console.warn("Could not load media", e));
    return () => {
      alive = false;
      releaseUrl(src);
    };
  }, [src]);

  useEffect(() => watch(ref.current, setSeen), []);

  const segment = start != null && end != null && end > start;
  useSegmentLoop(ref, segment ? start : null, segment ? end : null);

  /* Only the one showing holds a decoder. A slideshow's waiting videos used
     to keep theirs attached while paused, and a phone has very few hardware
     decoders: two or three backgrounds could push playback onto software. */
  const attach = !!url && seen && active;
  const play = attach && active && page;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    if (attach) was.current = true;
    else if (was.current) {
      /* React has already dropped the attribute; load() is what lets the
         decoder go */
      was.current = false;
      try { v.load(); } catch {}
    }
    if (play) tryPlay(v);
    else try { v.pause(); } catch {}
  }, [attach, play, url]);

  return (
    <video
      ref={ref}
      src={attach ? url : undefined}
      muted
      playsInline
      loop={!segment}
      preload={attach ? "auto" : "none"}
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      draggable={false}
      onLoadedMetadata={(e) => onMeta?.({ w: e.currentTarget.videoWidth || 1, h: e.currentTarget.videoHeight || 1 })}
      className={className}
      style={style}
    />
  );
}

/* ---------- small copies for small circles ----------

   Pictures are stored at up to 640px, and an avatar beside a name is drawn
   at 16 to 56. Each one shown that way was decoded whole, about 1.6MB of
   pixels for a dot, and a phone's renderer runs out of memory long before
   a desktop's. A small copy, cut square from the middle the way the circle
   shows it, is made once per picture and size and kept as an object URL.
   Still JPEG and PNG only: a GIF or a video would stop moving. Until it is
   ready, and wherever the browser cannot make one, the original is shown.
   What is stored, exported and backed up is never touched. */
const thumbs = new Map(); // src -> Map(px -> { url, wait })
const THUMBS_MAX = 300;
const thumbable = (src) =>
  typeof src === "string" && src.length > 12000 && (src.startsWith("data:image/jpeg") || src.startsWith("data:image/png"));

async function makeThumb(src, px) {
  /* the load event rather than decode(), which waits for a frame to be
     drawn and so never settles while the WebView is not drawing */
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = src;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const s = Math.min(w, h);
  if (!s || s <= px * 1.25) return null; // already small: nothing to gain
  const bmp = await createImageBitmap(img, (w - s) / 2, (h - s) / 2, s, s, { resizeWidth: px, resizeHeight: px, resizeQuality: "high" });
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.86));
  return blob ? URL.createObjectURL(blob) : null;
}

function thumbFor(src, px) {
  let sizes = thumbs.get(src);
  if (!sizes) {
    if (thumbs.size >= THUMBS_MAX) {
      const [oldest, old] = thumbs.entries().next().value;
      for (const t of old.values()) if (t.url) URL.revokeObjectURL(t.url);
      thumbs.delete(oldest);
    }
    sizes = new Map();
    thumbs.set(src, sizes);
  }
  let t = sizes.get(px);
  if (!t) {
    t = { url: null, wait: null };
    t.wait = makeThumb(src, px).then((url) => (t.url = url)).catch(() => null);
    sizes.set(px, t);
  }
  return t;
}

const canThumb = () => typeof createImageBitmap === "function" && typeof document !== "undefined";

export function useThumb(src, px) {
  const on = !!px && thumbable(src) && canThumb();
  const [url, setUrl] = useState(() => (on ? thumbs.get(src)?.get(px)?.url || null : null));
  useEffect(() => {
    if (!on) { setUrl(null); return; }
    let alive = true;
    const t = thumbFor(src, px);
    if (t.url) setUrl(t.url);
    else { setUrl(null); t.wait.then((u) => { if (alive) setUrl(u || null); }); }
    return () => { alive = false; };
  }, [src, px, on]);
  return url;
}

/* A stored picture of either kind: an <img> for images, LoopVideo for
   videos. Images decode off the main thread and wait until they are near
   the screen. `thumb`: the most pixels it is ever drawn at, for a small
   copy (see above). */
export function Media({ src, alt = "", className = "", style, active, lazy = true, thumb }) {
  const small = useThumb(thumb ? src : null, thumb);
  if (isVideo(src)) return <LoopVideo src={src} className={className} style={style} active={active} />;
  return <img src={small || src} alt={alt} loading={lazy ? "lazy" : undefined} decoding="async" draggable={false} className={className} style={style} />;
}

/* ============================================================
   the editors' pieces: a looping preview and the cut bar
   ============================================================ */

const fmtT = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
};

/* The picked file playing the part being kept, round and round. While a
   handle of the cut bar is held it stops on that handle's frame instead, so
   you can see exactly where the cut falls. */
export function ClipPreview({ url, start, end, hold, videoRef, className = "", style }) {
  const own = useRef(null);
  const ref = videoRef || own;
  const holding = hold != null;
  useSegmentLoop(ref, holding ? null : start, holding ? null : end);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    if (holding) {
      try { v.pause(); } catch {}
      if (v.fastSeek && Math.abs(v.currentTime - hold) > 0.5) v.fastSeek(hold);
      else v.currentTime = hold;
    } else {
      v.currentTime = start;
      tryPlay(v);
    }
  }, [holding, hold, start]);

  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      autoPlay
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      draggable={false}
      className={className}
      style={style}
    />
  );
}

/* Choose the part of a video to keep: drag either end, or the kept part
   itself to slide it along. Never longer than `max` seconds — dragging one
   end past that brings the other with it. */
export function TrimBar({ duration, start, end, max, min = 0.5, onChange, onHold, videoRef }) {
  const track = useRef(null);
  const head = useRef(null);
  const drag = useRef(null);
  const d = Math.max(duration, 0.01);

  /* the playhead is moved directly, not through state: it changes every
     frame and nothing else on the sheet needs to know. The frame loop runs
     only while the video plays; paused (a handle held), it moves on seek. */
  useEffect(() => {
    let raf = 0;
    let v = null;
    const draw = () => {
      if (v && head.current) head.current.style.left = `${Math.min(100, (v.currentTime / d) * 100)}%`;
    };
    const tick = () => {
      v = videoRef?.current || null;
      draw();
      raf = v && v.paused ? 0 : requestAnimationFrame(tick);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const el = (v = videoRef?.current || null);
    el?.addEventListener("play", start);
    el?.addEventListener("seeked", draw);
    el?.addEventListener("timeupdate", draw);
    start();
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("play", start);
      el?.removeEventListener("seeked", draw);
      el?.removeEventListener("timeupdate", draw);
    };
  }, [videoRef, d]);

  const timeAt = (e) => {
    const r = track.current.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((e.clientX - r.left) / Math.max(1, r.width)) * d));
  };

  const apply = (g, t) => {
    let s = start, en = end;
    if (g.what === "start") {
      s = Math.min(t, g.end - min);
      en = Math.min(g.end, s + max);
      onHold?.(s);
    } else if (g.what === "end") {
      en = Math.max(t, g.start + min);
      s = Math.max(g.start, en - max);
      onHold?.(en);
    } else {
      const len = g.end - g.start;
      s = Math.min(d - len, Math.max(0, g.start + (t - g.t)));
      en = s + len;
      onHold?.(s);
    }
    onChange(+s.toFixed(3), +Math.min(d, en).toFixed(3));
  };

  const down = (e) => {
    if (!track.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const t = timeAt(e);
    const r = track.current.getBoundingClientRect();
    const px = (x) => (x / d) * r.width;
    const toStart = Math.abs(px(t) - px(start));
    const toEnd = Math.abs(px(t) - px(end));
    let what;
    if (Math.min(toStart, toEnd) < 22) what = toStart <= toEnd ? "start" : "end";
    else if (t > start && t < end) what = "move";
    else what = t < start ? "start" : "end";
    drag.current = { what, t, start, end };
    if (what !== "move") apply(drag.current, t);
    else onHold?.(start);
  };
  const move = (e) => drag.current && apply(drag.current, timeAt(e));
  const up = (e) => {
    if (!drag.current) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    onHold?.(null);
  };

  const a = (start / d) * 100;
  const b = (end / d) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Part to keep</span>
        <span className="text-xs tabular-nums" style={{ color: "var(--acc)" }}>
          {fmtT(start)} – {fmtT(end)} · {(end - start).toFixed(1)}s
        </span>
      </div>
      <div
        ref={track}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="relative h-11 rounded-lg bg-[var(--nv-control)] select-none cursor-pointer"
        style={{ touchAction: "none" }}
        data-noswipe
      >
        {/* the kept part */}
        <div
          className="absolute inset-y-0 rounded-md border-2"
          style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%`, borderColor: "var(--acc)", background: "var(--nv-control)" }}
        />
        {/* handles, wide enough for a thumb */}
        {[a, b].map((p, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-3 -ml-1.5 flex items-center justify-center pointer-events-none"
            style={{ left: `${p}%` }}
          >
            <div className="w-1.5 h-6 rounded-full" style={{ background: "var(--acc)" }} />
          </div>
        ))}
        <div ref={head} className="absolute inset-y-1 w-0.5 -ml-px rounded-full bg-[var(--nv-control)] pointer-events-none" style={{ left: "0%" }} />
      </div>
    </div>
  );
}

/* Shown over the preview while the clip is being prepared. */
export function ClipProgress({ value, onCancel }) {
  const progress = useRef(null);
  useMotionValue(progress, { scaleX: Math.max(0, Math.min(1, value || 0)) }, [value]);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--nv-control)] text-center px-6">
      <p className="text-sm text-zinc-100">Preparing clip… {Math.round((value || 0) * 100)}%</p>
      <div className="w-full max-w-48 h-1.5 rounded-full bg-[var(--nv-control)] overflow-hidden">
        <div ref={progress} className="h-full rounded-full" style={{ background: "var(--acc)", transformOrigin: "left" }} />
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">Cutting and shrinking it. Keep the app open.</p>
      {onCancel && (
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
