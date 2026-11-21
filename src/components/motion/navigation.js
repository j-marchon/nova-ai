import { useLayoutEffect, useRef } from "react";
import { gsap, motionMode, pop, set, stop, tween } from "./runtime.js";

export function useSelectionMarker(ref, value) {
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const marker = host.querySelector('[data-selection-marker]');
    if (!marker) return;
    // The underline slides from the old tab to the new one, its width
    // easing to the new label's as it goes.
    const move = (animate) => {
      const selected = host.querySelector('[aria-pressed="true"],[aria-selected="true"]');
      if (!selected) return;
      const left = selected.offsetLeft, width = selected.offsetWidth;
      if (!animate || !marker.dataset.placed) {
        marker.dataset.placed = "1";
        set(marker, { x: left, width });
        return;
      }
      tween(marker, { x: left, width, duration: .5, ease: "expo.out" });
    };
    move(true);
    /* a resize re-places it, but never mid-slide: the observer also fires
       the moment it starts watching */
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!gsap.isTweening(marker)) move(false); }) : null;
    resize?.observe(host);
    return () => { resize?.disconnect(); stop(marker); };
  }, [value]);
}

/* where each dock's current tab was, so a change knows where it came from */
const lastTab = new WeakMap();
// The standard look's travel between tabs: the pill stretches the way it is
// going and settles, and the beam on the dock's edge leaves a light trail
// from the old tab to the new one, drawn ahead and then gone. Both are laid
// over the marker's own glide (composite "add"); compositor-only, Full
// motion only. A supporter skin brings its own (Aero's droplet), so a
// skinned app gets none of this.
function travel(host, marker, from, to) {
  if (motionMode() !== "full" || document.visibilityState === "hidden" || document.documentElement.dataset.skin || typeof marker?.animate !== "function") return;
  const across = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const span = across ? to.x - from.x : to.y - from.y;
  if (Math.abs(span) < 4) return;
  const stretch = across ? "scale(1.16, .9)" : "scale(.9, 1.12)";
  marker.animate([
    { transform: "scale(1, 1)" },
    { transform: stretch, offset: .28 },
    { transform: across ? "scale(.97, 1.03)" : "scale(1.03, .97)", offset: .62 },
    { transform: "scale(1, 1)" },
  ], { duration: 620, easing: "cubic-bezier(.2, .7, .3, 1)", composite: "add" });
  const trail = host.querySelector(".nv-nav-trail");
  if (!trail) return;
  const forward = span > 0;
  const start = Math.min(across ? from.x : from.y, across ? to.x : to.y);
  const dir = across ? (forward ? "90deg" : "270deg") : (forward ? "180deg" : "0deg");
  Object.assign(trail.style, across
    ? { left: `${start}px`, width: `${Math.abs(span)}px`, transformOrigin: forward ? "0 50%" : "100% 50%" }
    : { top: `${start}px`, height: `${Math.abs(span)}px`, transformOrigin: forward ? "50% 0" : "50% 100%" });
  trail.style.background = `linear-gradient(${dir}, transparent, var(--nv-ink))`;
  const grow = across ? ["scaleX(0)", "scaleX(1)"] : ["scaleY(0)", "scaleY(1)"];
  trail.animate([
    { transform: grow[0], opacity: 1 },
    { transform: grow[1], opacity: .85, offset: .45 },
    { transform: grow[1], opacity: 0 },
  ], { duration: 700, easing: "cubic-bezier(.16, 1, .3, 1)" });
}

export function useNavigationMarker(page) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const marker = host.querySelector(".nv-nav-marker");
    const move = () => {
      const selected = host.querySelector('[aria-current="page"]');
      if (!selected) return;
      set(marker, { width: selected.offsetWidth, height: selected.offsetHeight });
      tween(marker, { x: selected.offsetLeft, y: selected.offsetTop, duration: .7, ease: "expo.out" });
    };
    const from = lastTab.get(host);
    move();
    const to = host.querySelector('[aria-current="page"]');
    if (to) {
      lastTab.set(host, { x: to.offsetLeft + to.offsetWidth / 2, y: to.offsetTop + to.offsetHeight / 2 });
      /* The glide runs on GSAP's clock, which keeps going through a busy
         main thread (a tab mounting for the first time); these effects
         would only start once it frees up, behind a pill that has already
         landed. So they start on the first frame drawn after the switch,
         and only if the pill still has more than half the way to go. */
      const target = lastTab.get(host);
      if (from) requestAnimationFrame(() => {
        const across = Math.abs(target.x - from.x) >= Math.abs(target.y - from.y);
        const at = across ? Number(gsap.getProperty(marker, "x")) + marker.offsetWidth / 2 : Number(gsap.getProperty(marker, "y")) + marker.offsetHeight / 2;
        const span = across ? target.x - from.x : target.y - from.y;
        if (span && (at - (across ? from.x : from.y)) / span < .5) travel(host, marker, from, target);
      });
    }
    // The pill squashes as it sets off and the new icon hops into place.
    const icon = host.querySelector('[aria-current="page"] svg');
    if (icon) pop(icon, { from: .85, y: 3, duration: .6, ease: "expo.out" });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(move) : null;
    resize?.observe(host);
    return () => { resize?.disconnect(); stop(marker); if (icon) stop(icon); };
  }, [page]);
  return ref;
}

// A mouse wheel scrolls a horizontal tab row sideways. Touchpads that already
// scroll sideways keep their own deltas; nothing is smoothed natively.
export function useWheelScroll(ref) {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const wheel = event => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || row.scrollWidth <= row.clientWidth) return;
      const max = row.scrollWidth - row.clientWidth;
      const step = event.deltaY * (event.deltaMode === 1 ? 32 : 1);
      if ((step < 0 && row.scrollLeft <= 0) || (step > 0 && row.scrollLeft >= max)) return;
      event.preventDefault();
      const target = Math.max(0, Math.min(max, Number(row.dataset.wheelTo ?? row.scrollLeft) + step));
      row.dataset.wheelTo = target;
      tween(row, { scrollLeft: target, duration: .32, ease: "power3.out", onComplete: () => { delete row.dataset.wheelTo; } });
    };
    row.addEventListener("wheel", wheel, { passive: false });
    return () => { row.removeEventListener("wheel", wheel); stop(row); };
  }, []);
}
