import { layoutRect, toLayout } from "../../lib/uiScale.js";
import { MOTION, motionMode, onMotionChange, pop, set, stop, tween } from "./runtime.js";
import { flare } from "./ambient.js";

const big = '.nv-hold,[data-chat-card],.nv-tile';
const rippling = 'button,a[href],[role="button"],[role="switch"],[role="radio"],[data-chat-card],.nv-hold';

// An ink wash spreading from the touch point. It lives in an inert overlay
// matched to the control's box, so the control's own layout never changes.
function ripple(el, clientX, clientY) {
  if (motionMode() !== "full" || document.visibilityState === "hidden" || !el.matches(rippling)) return;
  const host = el.closest(".nv-root") || document.body;
  const box = layoutRect(el.getBoundingClientRect());
  if (!box.width || !box.height || box.width * box.height > 200000) return;
  const style = getComputedStyle(el);
  const layer = document.createElement("span");
  layer.dataset.motionGhost = "1"; layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: style.borderRadius, overflow: "hidden", pointerEvents: "none", zIndex: "80" });
  const x = clientX == null ? box.width / 2 : toLayout(clientX) - box.left;
  const y = clientY == null ? box.height / 2 : toLayout(clientY) - box.top;
  const size = 2 * Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
  const dot = document.createElement("span");
  Object.assign(dot.style, { position: "absolute", left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px`, borderRadius: "50%", background: style.color || "currentColor", opacity: ".1" });
  layer.append(dot); host.append(layer);
  set(dot, { scale: 0 });
  tween(dot, { scale: 1, duration: .45, ease: "power2.out" });
  tween(dot, { opacity: 0, duration: .4, delay: .2, ease: "power1.out", onComplete: () => layer.remove(), onInterrupt: () => layer.remove() });
}

// Icons react to what their control does: a launch for send, a turn for
// refresh-like actions, a springy pop for everything else.
function iconReact(el) {
  if (motionMode() !== "full" || !el.matches("button,[role=\"button\"],a[href]")) return;
  const icon = el.querySelector(":scope svg:not(.nv-spin)");
  if (!icon || el.closest("[data-motion-ghost]")) return;
  const kind = el.dataset.motion;
  if (kind === "launch") {
    /* the standard look: the message leaves as a spark, the field's own
       star flaring where the arrow flies off (Aero lets bubbles go instead) */
    if (!document.documentElement.dataset.skin) {
      const box = layoutRect(icon.getBoundingClientRect());
      flare(el.closest(".nv-root"), box.left + box.width / 2 + 13, box.top + box.height / 2 - 13, { size: 13, reach: 22, delay: 90, fixed: true });
    }
    stop(icon);
    tween(icon, { x: 14, y: -14, opacity: 0, duration: .16, ease: MOTION.leave, onComplete: () => {
      set(icon, { x: -12, y: 12 });
      tween(icon, { x: 0, y: 0, opacity: 1, duration: .38, ease: "expo.out", clearProps: "opacity,transform" });
    } });
  } else if (kind === "spin") {
    stop(icon); set(icon, { rotation: 0 });
    tween(icon, { rotation: -360, duration: .6, ease: "expo.out", clearProps: "transform" });
  } else if (kind === "nudge") {
    stop(icon); set(icon, { x: -5 });
    tween(icon, { x: 0, duration: .5, ease: MOTION.bounce, clearProps: "transform" });
  } else if (!el.textContent.trim()) pop(icon, { from: .7, rotation: -8 });
}

// Delegation covers lazy screens, nested/portaled sheets, and new controls.
// Feedback starts before handlers run; actions never wait for an animation.
export function installActionFeedback(root, own) {
  const selector = 'button,a[href],summary,[role="button"],[role="switch"],[role="radio"],.nv-hold,[data-chat-card],.cursor-pointer,.nv-msg,input[type="range"]';
  const touched = new Set();
  const remember = el => { own(el); touched.add(el); };
  let pressed = null;
  let touchPress = false;
  let pointerAction = null;
  let origin = null;
  const targetOf = event => {
    const el = event.target.closest?.(selector);
    if (!el || !root.contains(el) || el.matches(':disabled,[aria-disabled="true"]') || el.closest('[data-motion-ghost],[data-lifted="1"]')) return null;
    // Message text must remain fixed for selection and double-tap editing.
    if (el.closest('.nv-msg-edit,[contenteditable="true"]') && !el.matches('button,a[href]')) return null;
    return el;
  };
  /* A card's picture, when the pointer is over the card itself: the picture
     zooms inside its own frame and the card, its name and its border stay
     still (scaling the whole card pushed its text past the clipped edge). */
  const cardPicture = el => (el.closest(".nv-card") && !el.matches(".nv-card-corner,.nv-btn--sm") ? el.querySelector("img,video") : null);
  const release = el => {
    if (!el?.isConnected) return;
    if (el.matches('input[type="range"]')) { tween(el, { "--nv-thumb-scale": 1, duration: .5, ease: MOTION.bounce }); return; }
    if (motionMode() === "full" && !el.matches(".nv-msg")) tween(el, { scale: 1, duration: .55, ease: el.matches(big) ? MOTION.spring : "expo.out", clearProps: "transform" });
    else if (motionMode() !== "off") tween(el, { opacity: 1, duration: .08, clearProps: "opacity" });
    else set(el, { clearProps: "transform,opacity" });
  };
  const press = el => {
    const mode = motionMode();
    if (mode === "off") return;
    remember(el);
    if (el.matches('input[type="range"]')) { if (mode === "full") tween(el, { "--nv-thumb-scale": 1.3, duration: .2, ease: MOTION.spring }); return; }
    if (mode === "full" && !el.matches(".nv-msg")) tween(el, { scale: el.matches(big) ? .985 : .97, duration: MOTION.press, ease: "power2.out" });
    else tween(el, { opacity: .75, duration: .06 });
  };
  const pulse = el => {
    if (motionMode() === "off") return;
    remember(el);
    if (el.matches('input[type="range"]')) return;
    // GSAP completion handles keyboard/programmatic activation with no pointerup.
    tween(el, motionMode() === "full" && !el.matches(".nv-msg")
      ? { scale: el.matches(big) ? .985 : .97, duration: MOTION.press, ease: "power2.out", onComplete: () => release(el) }
      : { opacity: .75, duration: .05, onComplete: () => release(el) });
  };
  const down = event => {
    if (event.button > 0) return;
    const el = targetOf(event);
    if (!el) return;
    if (pressed && pressed !== el) release(pressed);
    touchPress = event.pointerType === "touch";
    pressed = el; pointerAction = el; origin = { x: event.clientX, y: event.clientY };
    if (event.pointerType !== "touch") {
      press(el);
      ripple(el, event.clientX, event.clientY);
    } else pointerAction = null;
  };
  const up = () => { if (pressed && !touchPress) release(pressed); pressed = null; touchPress = false; };
  const cancel = () => { up(); pointerAction = null; origin = null; };
  const move = event => {
    if (pressed && !pressed.matches('input[type="range"]') && origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  };
  const click = event => {
    const el = targetOf(event);
    if (!el) return;
    if (el !== pointerAction) { pulse(el); ripple(el); }
    pointerAction = null;
    iconReact(el);
  };
  const change = event => {
    const el = event.target;
    if (!el.matches?.('select,input[type="range"],input[type="checkbox"],input[type="radio"]') || el.disabled || motionMode() === "off") return;
    remember(el);
    // Changes keep geometry stable, including range dragging and keyboard arrows.
    const check = el.matches('input[type="checkbox"],input[type="radio"]') && motionMode() === "full";
    set(el, { opacity: .72, ...(check ? { scale: .7 } : {}) });
    tween(el, { opacity: 1, ...(check ? { scale: 1 } : {}), duration: check ? .55 : MOTION.feedback, ease: check ? MOTION.bounce : MOTION.ease, clearProps: check ? "opacity,transform" : "opacity" });
  };
  const over = event => {
    const el = targetOf(event);
    if (!el || el.matches('.nv-msg,input[type="range"]') || event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || el.contains(event.relatedTarget) || el === pressed || motionMode() !== "full") return;
    const pic = cardPicture(el);
    if (pic) { remember(pic); tween(pic, { scale: 1.04, duration: .45, ease: MOTION.spring }); return; }
    remember(el);
    tween(el, { scale: el.matches(big) ? 1.012 : 1.04, duration: .3, ease: MOTION.spring });
  };
  const out = event => {
    const el = targetOf(event);
    if (el && !el.contains(event.relatedTarget)) {
      const pic = cardPicture(el);
      if (pic && motionMode() !== "off") tween(pic, { scale: 1, duration: .55, ease: MOTION.spring, clearProps: "transform" });
      if (el === pressed) cancel(); else if (event.pointerType === "mouse") release(el);
    }
  };
  const unsubscribe = onMotionChange(() => {
    for (const el of touched) { stop(el); set(el, { clearProps: "transform,opacity,--nv-thumb-scale" }); }
    touched.clear(); pressed = null; pointerAction = null;
  });
  root.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("scroll", cancel, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  root.addEventListener("click", click, true);
  root.addEventListener("change", change, true);
  root.addEventListener("input", change, true);
  root.addEventListener("pointerover", over, true);
  root.addEventListener("pointerout", out, true);
  const cleanup = () => {
    pressed = null; pointerAction = null; unsubscribe();
    for (const el of touched) { stop(el); set(el, { clearProps: "transform,opacity,--nv-thumb-scale" }); }
    root.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("scroll", cancel, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("blur", cancel);
    root.removeEventListener("click", click, true);
    root.removeEventListener("change", change, true);
    root.removeEventListener("input", change, true);
    root.removeEventListener("pointerover", over, true);
    root.removeEventListener("pointerout", out, true);
  };
  cleanup.forget = el => { touched.delete(el); if (pressed === el) pressed = null; if (pointerAction === el) pointerAction = null; };
  return cleanup;
}
