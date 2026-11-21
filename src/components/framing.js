import { uiScale } from "../lib/uiScale.js";
import { useEffect, useRef, useState } from "react";

/* ---------- framing a picture inside a frame ----------

   Shared by the chat background editor and the video avatar editor, so a
   clip is moved and zoomed exactly the way a background always has been.
   Everything is in "stage" pixels: the frame at its real size (the screen,
   for a background), drawn shrunk by `k` in the editor. */

export const BG_MIN_ZOOM = 1;

export const BG_MAX_ZOOM = 4;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Both the preview and the saved render use this, so they agree to the
   pixel. */
export function bgSize(img, vp, scale) {
  const cover = Math.max(vp.w / img.w, vp.h / img.h);
  return { w: img.w * cover * scale, h: img.h * cover * scale };
}

/* Never let the image leave a gap at an edge — a gap in the editor
   would become a black band in the chat. */
export function clampBgPos(p, img, vp, scale) {
  if (!img) return p;
  const { w, h } = bgSize(img, vp, scale);
  const mx = Math.max(0, (w - vp.w) / 2);
  const my = Math.max(0, (h - vp.h) / 2);
  return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) };
}

/* Drag with one finger, pinch with two. Returns the framing and the pointer
   handlers for the frame element. */
export function useFraming({ stage, k, imgSize, frameRef, initialPos, initialScale = 1 }) {
  const [scale, setScale] = useState(initialScale);
  const [pos, setPos] = useState(initialPos || { x: 0, y: 0 });
  const posRef = useRef(pos);
  const scaleRef = useRef(scale);
  posRef.current = pos;
  scaleRef.current = scale;

  /* a picture never fits the frame the same way after a rotation */
  useEffect(() => {
    if (imgSize) setPos((p) => clampBgPos(p, imgSize, stage, scaleRef.current));
  }, [imgSize, stage.w, stage.h]);

  const ptrs = useRef(new Map());
  const gesture = useRef(null);

  const stagePoint = (e) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: (e.clientX - r.left) / (k * uiScale()) - stage.w / 2,
      y: (e.clientY - r.top) / (k * uiScale()) - stage.h / 2,
    };
  };

  /* (re)base the gesture on whichever fingers are down right now, so
     lifting one finger out of a pinch keeps panning without a jump */
  const rebase = () => {
    const pts = [...ptrs.current.values()];
    if (!pts.length) { gesture.current = null; return; }
    const base = { pos: { ...posRef.current }, scale: scaleRef.current };
    if (pts.length === 1) {
      gesture.current = { ...base, mode: "pan", mid: pts[0], dist: 1 };
    } else {
      const [a, b] = pts;
      gesture.current = {
        ...base,
        mode: "pinch",
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      };
    }
  };

  const onPointerDown = (e) => {
    if (!imgSize) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    ptrs.current.set(e.pointerId, stagePoint(e));
    rebase();
  };

  const onPointerMove = (e) => {
    if (!ptrs.current.has(e.pointerId) || !imgSize) return;
    ptrs.current.set(e.pointerId, stagePoint(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...ptrs.current.values()];

    if (g.mode === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = clamp(g.scale * (dist / g.dist), BG_MIN_ZOOM, BG_MAX_ZOOM);
      /* keep whatever is between the fingers under the fingers */
      const r = next / g.scale;
      const p = { x: mid.x - (g.mid.x - g.pos.x) * r, y: mid.y - (g.mid.y - g.pos.y) * r };
      setScale(next);
      setPos(clampBgPos(p, imgSize, stage, next));
    } else if (pts.length === 1) {
      const d = pts[0];
      const p = { x: g.pos.x + (d.x - g.mid.x), y: g.pos.y + (d.y - g.mid.y) };
      setPos(clampBgPos(p, imgSize, stage, scaleRef.current));
    }
  };

  const onPointerUp = (e) => {
    ptrs.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    rebase();
  };

  /* the slider zooms around the middle of the frame, where the eye is */
  const setZoom = (v) => {
    const next = clamp(v, BG_MIN_ZOOM, BG_MAX_ZOOM);
    const r = next / (scaleRef.current || 1);
    setScale(next);
    setPos(clampBgPos({ x: posRef.current.x * r, y: posRef.current.y * r }, imgSize, stage, next));
  };

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  return {
    pos, setPos, scale, setScale, setZoom, reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
