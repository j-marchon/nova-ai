import { toLayout } from "../lib/uiScale.js";
import { gsap, motionMode, set, stop, tween } from "./motion/runtime.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ---------- rearranging a grid by dragging, like a phone home screen ----------

   Hold a card still for a moment and it lifts under your finger; drag it and
   the others slide out of its way; let go and it settles into the gap. A
   quick swipe never lifts anything, so the page still scrolls normally.

   Everything that changes every frame (where the lifted card is) is written
   straight onto the element. Only the order goes through React, and only when
   the card crosses into another slot. The cards that make room are animated
   from where they were to where they are now (FLIP). */

let lifting = false;
/* read by the tab swipe in App.jsx, so dragging a card sideways does not
   also change tabs */
export const isReordering = () => lifting;

const HOLD_MS = 380;
const SLOP = 10; // px a finger may wander before the hold counts as a scroll
const EDGE = 80; // px from the top or bottom of the screen that scrolls the page

const move = (list, from, to) => {
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

export function useReorder({ ids, onReorder, enabled = true }) {
  const [order, setOrder] = useState(null); // the order while a card is lifted
  const els = useRef(new Map());
  const g = useRef(null);
  const before = useRef(null);
  const shown = order || ids;

  const docRect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, w: r.width, h: r.height };
  };

  /* the lifted card, drawn under the finger relative to its current slot */
  const place = () => {
    const s = g.current;
    if (!s?.active) return;
    const el = els.current.get(s.id);
    const slot = s.slots[s.order.indexOf(s.id)];
    if (!el || !slot) return;
    const x = s.x + window.scrollX - s.grab.x - slot.left;
    const y = s.y + window.scrollY - s.grab.y - slot.top;
    set(el, { x: toLayout(x), y: toLayout(y), scale: motionMode() === "full" ? 1.025 : 1 });
  };

  /* FLIP: everything that moved slides from its old place to its new one */
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (prev) {
      els.current.forEach((el, id) => {
        if (id === g.current?.id) return;
        const a = prev.get(id);
        if (!a) return;
        const b = el.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (!dx && !dy) return;
        stop(el);
        set(el, { x: toLayout(dx), y: toLayout(dy) });
        tween(el, { x: 0, y: 0, duration: .24, clearProps: "transform" });
      });
    }
    place();
  });

  const snapshot = () => {
    const m = new Map();
    els.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()));
    before.current = m;
  };

  const retarget = () => {
    const s = g.current;
    const px = s.x + window.scrollX;
    const py = s.y + window.scrollY;
    let to = s.slots.findIndex((r) => px >= r.left && px <= r.left + r.w && py >= r.top && py <= r.top + r.h);
    if (to < 0) return;
    const from = s.order.indexOf(s.id);
    if (to === from) return;
    snapshot();
    s.order = move(s.order, from, to);
    setOrder(s.order);
  };

  const end = (commit) => {
    const s = g.current;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.tick) gsap.ticker.remove(s.tick);
    window.removeEventListener("pointermove", s.onMove);
    window.removeEventListener("pointerup", s.onUp);
    window.removeEventListener("pointercancel", s.onCancel);
    document.removeEventListener("touchmove", s.onTouch);
    g.current = null;
    lifting = false;
    if (!s.active) return;
    const el = els.current.get(s.id);
    if (el) {
      tween(el, { x: 0, y: 0, scale: 1, duration: .22, onComplete: () => {
        set(el, { clearProps: "transform" }); el.style.boxShadow = ""; el.style.zIndex = "";
      } });
    }
    /* the press that lifted the card must not also tap the button under it */
    const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener("click", eat, true);
    setTimeout(() => window.removeEventListener("click", eat, true), 350);
    if (commit && s.order.some((id, i) => id !== s.start[i])) onReorder(s.order);
    setOrder(null);
  };

  useEffect(() => () => { end(false); els.current.forEach(stop); }, []);

  const lift = () => {
    const s = g.current;
    const el = els.current.get(s.id);
    if (!el) return;
    s.active = true;
    lifting = true;
    s.order = ids.slice();
    s.start = ids.slice();
    s.slots = s.order.map((id) => els.current.get(id)).map((e) => (e ? docRect(e) : null));
    const r = el.getBoundingClientRect();
    s.grab = { x: s.x - r.left, y: s.y - r.top };
    stop(el);
    el.style.zIndex = "30";
    el.style.boxShadow = "none";
    navigator.vibrate?.(12);
    setOrder(s.order);
    /* follow the finger, and scroll when it holds near an edge */
    const tick = () => {
      if (!g.current?.active) return;
      const h = window.innerHeight;
      const dy = s.y < EDGE ? -(EDGE - s.y) / 4 : s.y > h - EDGE ? (s.y - (h - EDGE)) / 4 : 0;
      if (dy) {
        window.scrollBy(0, dy);
        retarget();
      }
      place();

    };
    s.tick = tick; gsap.ticker.add(tick);
  };

  const onPointerDown = (id) => (e) => {
    if (!enabled || g.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const s = { id, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, active: false };
    s.onMove = (ev) => {
      s.x = ev.clientX;
      s.y = ev.clientY;
      if (!s.active) {
        if (Math.hypot(s.x - s.x0, s.y - s.y0) > SLOP) end(false);
        return;
      }
      retarget();
      place();
    };
    s.onUp = () => end(true);
    s.onCancel = () => end(false);
    /* once lifted, the finger drags the card instead of the page */
    s.onTouch = (ev) => s.active && ev.cancelable && ev.preventDefault();
    s.timer = setTimeout(lift, HOLD_MS);
    g.current = s;
    window.addEventListener("pointermove", s.onMove);
    window.addEventListener("pointerup", s.onUp);
    window.addEventListener("pointercancel", s.onCancel);
    document.addEventListener("touchmove", s.onTouch, { passive: false });
  };

  /* spread onto each card's wrapper */
  const item = (id) => ({
    ref: (el) => (el ? els.current.set(id, el) : els.current.delete(id)),
    onPointerDown: onPointerDown(id),
    onContextMenu: (e) => enabled && e.preventDefault(),
    className: "nv-reorder relative",
    "data-lifted": order && g.current?.id === id ? "1" : undefined,
  });

  return { order: shown, item, lifted: !!order };
}
