import { gsap } from "gsap";

export const MOTION = Object.freeze({ press: .1, feedback: .32, transition: .44, exit: .22, stagger: .035, staggerCap: .24, spring: "expo.out", bounce: "power4.out", ease: "expo.out", leave: "power2.in" });

// One policy for every animation, including effects created outside React.
let preference = "full";
const active = new Set();
const listeners = new Set();
export const motionMode = () => {
  if (preference === "off" || typeof window === "undefined" || !window.matchMedia) return "off";
  return preference === "calm" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "calm" : "full";
};
export function settleMotion() {
  for (const a of [...running]) a.finish();
  for (const tween of [...active]) {
    if (tween.repeat() === -1) tween.kill();
    else tween.progress(1);
  }
  active.clear();
  for (const notify of listeners) notify();
}
export function setMotionPreference(value) {
  preference = ["full", "calm", "off"].includes(value) ? value : "full";
  settleMotion();
}
export const onMotionChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function track(tween) {
  active.add(tween);
  const done = tween.eventCallback("onComplete");
  tween.eventCallback("onComplete", () => { active.delete(tween); done?.(); });
  const interrupt = tween.eventCallback("onInterrupt");
  tween.eventCallback("onInterrupt", () => { active.delete(tween); interrupt?.(); });
  return tween;
}
export function stop(target) { gsap.killTweensOf(target); cancelEntries(target); }
export function set(target, vars) { if (target) gsap.set(target, vars); }
export function tween(target, vars) {
  if (!target) { vars.onComplete?.(); return null; }
  const mode = motionMode();
  const next = { overwrite: "auto", ease: MOTION.ease, ...vars };
  if (mode === "off" || document.visibilityState === "hidden" || vars.duration === 0) {
    const { onComplete, duration, delay, ease, overwrite, ...values } = next;
    stop(target); gsap.set(target, values); onComplete?.(); return null;
  }
  if (mode === "calm") {
    for (const key of ["x", "y", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "height", "width", "scrollTop"]) {
      if (key in next) { gsap.set(target, { [key]: next[key] }); delete next[key]; }
    }
    next.duration = Math.min(next.duration ?? .1, .1); next.delay = 0;
  }
  return track(gsap.to(target, next));
}
// Arrivals (pages, tiles, rows, sheets) run on the Web Animations API, not
// GSAP. A GSAP tween reads each element's computed style to find where to
// start; a page arriving with dozens of tiles did that once per tile, each
// read forcing the whole page's style to be worked out again after the last
// tile's write. On a weak phone that was over a second of frozen screen per
// tab switch. A WAAPI keyframe animation of transform and opacity reads
// nothing and runs on the compositor, off the main thread, and leaves no
// inline style behind when it ends.
const ENTER = "nv-enter";
const EASES = {
  "expo.out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "power2.out": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  "power3.out": "cubic-bezier(0.215, 0.61, 0.355, 1)",
  "power4.out": "cubic-bezier(0.165, 0.84, 0.44, 1)",
  "power2.in": "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
  "sine.inOut": "cubic-bezier(0.37, 0, 0.63, 1)",
  none: "linear",
};
const easeOf = (name) => EASES[name] || (typeof name === "string" && name.startsWith("cubic-bezier(") ? name : EASES["expo.out"]);
// A skin (src/skins/effects.js) may give arrivals its own character: a function
// from (element, the standard arrival) to the arrival to use. Off and Calm
// still apply on top, in enter().
let skinEntry = null;
export function setSkinEntry(fn) { skinEntry = typeof fn === "function" ? fn : null; }
export const skinEntryOf = (el, base) => (skinEntry ? skinEntry(el, base) || base : base);
const elementsOf = (target) => (target instanceof Element ? [target] : Array.isArray(target) ? target.filter((t) => t instanceof Element) : []);
// Each element's running arrival, looked up without getAnimations(), which
// forces a style recalculation of its own.
const entries = new WeakMap();
const running = new Set();
function cancelEntries(target, how = "cancel") {
  for (const el of elementsOf(target)) {
    const a = entries.get(el);
    if (!a) continue;
    entries.delete(el); running.delete(a);
    a[how]();
  }
}
// The handle a caller gets back: ended settled (progress(1)) or dropped (kill).
const handle = (anim) => ({
  progress(p) { if (p >= 1) anim.finish(); return this; },
  kill() { anim.cancel(); return this; },
  repeat: () => 0,
  then: (fn) => anim.finished.then(fn, () => {}),
});
export function enter(target, { x = 0, y = 14, scale = 1, delay = 0, duration = MOTION.transition, ease = MOTION.ease, origin } = {}) {
  if (!target || motionMode() === "off" || document.visibilityState === "hidden") return;
  const full = motionMode() === "full";
  /* no WAAPI (jsdom, a very old WebView): the GSAP tween it used to be */
  if (typeof target.animate !== "function") {
    gsap.set(target, { opacity: 0, x: full ? x : 0, y: full ? y : 0, scale: full ? scale : 1, ...(full && origin ? { transformOrigin: origin } : {}) });
    return tween(target, { opacity: 1, x: 0, y: 0, scale: 1, duration, delay, ease, clearProps: "opacity,transform,transformOrigin" });
  }
  cancelEntries(target);
  const from = full && (x || y || scale !== 1) ? `translate(${x}px, ${y}px) scale(${scale})` : "none";
  const anim = target.animate(
    [{ opacity: 0, transform: from, ...(full && origin ? { transformOrigin: origin } : {}) }, { opacity: 1, transform: "none", ...(full && origin ? { transformOrigin: origin } : {}) }],
    { duration: (full ? duration : Math.min(duration, .1)) * 1000, delay: (full ? delay : 0) * 1000, easing: easeOf(ease), fill: "backwards" },
  );
  anim.id = ENTER;
  entries.set(target, anim); running.add(anim);
  const done = () => { running.delete(anim); if (entries.get(target) === anim) entries.delete(target); };
  anim.onfinish = done; anim.oncancel = done;
  return handle(anim);
}

// Android's own curve for the keyboard (InsetsController: 285ms on
// PathInterpolator(0.2, 0, 0, 1)). The chat's dock rides it in index.css
// (--nv-kb-ease); content moved for the keyboard glides on it as well, so
// the two travel together, on the compositor.
// Nova hears the keyboard is going a few frames after it starts to drop,
// so whatever rides it down takes a shorter ride and lands with it
// (hideMs; --nv-kb-hide-ms).
export const KEYBOARD = Object.freeze({ ms: 285, hideMs: 220, ease: "cubic-bezier(0.2, 0, 0, 1)" });
const glides = new WeakMap();
// `el` has just been scrolled `dy` layout px (positive: its content went up)
// for the keyboard. It is drawn where it was and glides into its new place.
// A glide still running is folded in, so a second change never jumps. Off
// moves it at once; Calm keeps it, since it only follows the keyboard,
// which moves anyway. `add` lays the glide over a transform the element
// already has (a sheet arriving, or being dragged) instead of replacing it.
export function keyboardGlide(el, dy, { add = false, ms = KEYBOARD.ms } = {}) {
  if (!el || typeof el.animate !== "function" || motionMode() === "off" || document.visibilityState === "hidden") return;
  const prev = glides.get(el);
  let from = dy;
  if (prev && prev.playState === "running") {
    /* where it is drawn now: what is left of the last glide's offset */
    const p = prev.effect?.getComputedTiming?.().progress ?? 1;
    from += (prev.nvFrom || 0) * (1 - p);
    prev.cancel();
  }
  if (Math.abs(from) < .5) return;
  const anim = el.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], { duration: ms, easing: KEYBOARD.ease, composite: add ? "add" : "replace" });
  anim.nvFrom = from;
  glides.set(el, anim); running.add(anim);
  const done = () => { running.delete(anim); if (glides.get(el) === anim) glides.delete(el); };
  anim.onfinish = done; anim.oncancel = done;
}

// A springy scale-in for icons and small marks; Calm keeps only the fade.
export function pop(target, { from = .6, rotation = 0, y = 0, duration = .5, ease = "expo.out" } = {}) {
  if (!target || motionMode() === "off" || document.visibilityState === "hidden") return;
  stop(target);
  if (motionMode() === "full") set(target, { scale: from, rotation, y });
  else set(target, { opacity: .5 });
  return tween(target, { scale: 1, rotation: 0, y: 0, opacity: 1, duration, ease, clearProps: "opacity,transform" });
}

// An icon replacing another comes in out of a blur; Calm keeps a short fade.
// It used to animate a CSS blur too. A blur filter is slow to paint on a
// weak phone, and any tween that stopped it partway (the send button's
// launch does) left the icon blurred for good. A scale and fade reads the
// same at this size, and an interrupted one is cleared.
export function blurSwap(target, { duration = .32 } = {}) {
  if (!target || motionMode() === "off" || document.visibilityState === "hidden") return;
  stop(target);
  set(target, { clearProps: "filter" });
  if (motionMode() === "full") set(target, { opacity: 0, scale: .6, rotation: -20 });
  else set(target, { opacity: .3 });
  const clear = () => set(target, { clearProps: "opacity,transform" });
  return tween(target, { opacity: 1, scale: 1, rotation: 0, duration, ease: "back.out(2)", clearProps: "opacity,transform", onInterrupt: clear });
}

// State feedback never moves readable text or subscribes to streamed content.
export function respond(target, { icon = false } = {}) {
  if (!target || motionMode() === "off" || document.visibilityState === "hidden") return;
  stop(target);
  set(target, { opacity: .5, ...(icon && motionMode() === "full" ? { scale: .6, rotation: -12 } : {}) });
  return tween(target, { opacity: 1, ...(icon ? { scale: 1, rotation: 0 } : {}), duration: icon ? .5 : MOTION.feedback, ease: icon ? "expo.out" : MOTION.ease, clearProps: icon ? "opacity,transform" : "opacity" });
}
export function shake(target, { duration = .35, distance = 6 } = {}) {
  const mode = motionMode();
  if (!target || mode === "off" || document.visibilityState === "hidden") return;
  stop(target);
  if (mode === "calm") {
    set(target, { opacity: .75 });
    return tween(target, { opacity: 1, duration: .1, clearProps: "opacity" });
  }
  const animation = gsap.timeline({ defaults: { duration: duration / 5, ease: "none" } });
  animation.to(target, { x: -distance }).to(target, { x: distance })
    .to(target, { x: -distance }).to(target, { x: distance })
    .to(target, { x: 0, clearProps: "transform" });
  return track(animation);
}
export { gsap };
