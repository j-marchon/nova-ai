import { installActionFeedback } from "./actions.js";
import { useEffect, useLayoutEffect, useRef } from "react";
import { enter, gsap, MOTION, pop, respond, motionMode, onMotionChange, set, setMotionPreference, settleMotion, skinEntryOf, stop, track, tween } from "./runtime.js";

export function useMotionValue(ref, vars, deps) {
  useLayoutEffect(() => {
    const target = ref.current;
    tween(target, { duration: MOTION.feedback, ease: MOTION.spring, ...vars });
    return () => { if (target) stop(target); };
  }, deps);
}

export function useStage(value, order = []) {
  const ref = useRef(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    const direction = order.indexOf(value) < order.indexOf(previous.current) ? -1 : 1;
    previous.current = value;
    const target = ref.current;
    stop(target); enter(target, { x: direction * 28, y: 0, scale: .985 });
    return () => stop(target);
  }, [value]);
  return ref;
}

// Each kind of surface arrives in its own way; a skin may restyle it.
function entryOf(el, delay) { return skinEntryOf(el, standardEntryOf(el, delay)); }
function standardEntryOf(el, delay) {
  if (el.matches(".nv-dock")) return { y: 24, scale: 1, delay, duration: .8, ease: "expo.out" };
  if (el.matches(".nv-popup")) return { y: -8, scale: .9, delay, duration: .36, ease: MOTION.spring, origin: "50% 0%" };
  if (el.matches(".nv-chip,.nv-pop")) return { y: 6, scale: .8, delay, duration: .45, ease: MOTION.spring };
  if (el.matches(".nv-tile")) return { y: 16, scale: .97, delay, duration: .7, ease: MOTION.spring };
  if (el.matches(".nv-bubble")) return { y: 14, scale: .985, delay, duration: .6, ease: "expo.out", origin: "50% 100%" };
  if (el.matches(".nv-slide-left")) return { x: -28, y: 0, delay };
  if (el.matches(".nv-slide-right,.nv-screen")) return { x: 32, y: 0, scale: .985, delay };
  if (el.matches(".nv-fade")) return { y: 0, delay, duration: .3 };
  return { y: 14, scale: 1, delay, duration: .7 };
}

// A hairline draws itself across from its start, like the trailer's rules.
function drawLine(el, delay = 0) {
  if (motionMode() === "off" || document.visibilityState === "hidden") return;
  if (motionMode() !== "full") return enter(el, { y: 0, duration: .2 });
  const vertical = el.offsetHeight > el.offsetWidth;
  set(el, vertical ? { scaleY: 0, transformOrigin: "50% 0%" } : { scaleX: 0, transformOrigin: "0% 50%" });
  tween(el, { ...(vertical ? { scaleY: 1 } : { scaleX: 1 }), duration: 1.1, delay: delay + .05, ease: "expo.inOut", clearProps: "transform,transformOrigin" });
}

// A line of type rises out of its own baseline (the parent clips it).
function revealText(el, delay = 0) {
  if (motionMode() === "off" || document.visibilityState === "hidden") return;
  if (motionMode() !== "full") return enter(el, { y: 0, duration: .2 });
  set(el, { yPercent: 105, opacity: 1 });
  tween(el, { yPercent: 0, duration: .9, delay, ease: "expo.out", clearProps: "transform" });
}

// Sheets rise from the bottom on phones and zoom in as dialogs on wide screens;
// their first rows follow in a short cascade.
function arriveSheet(el) {
  const desktop = window.matchMedia?.("(min-width: 640px)")?.matches;
  enter(el, desktop ? { y: 0, scale: .92, duration: .48, ease: "expo.out" } : { y: 80, duration: .52, ease: "expo.out" });
  if (motionMode() !== "full") return;
  const rows = [...(el.querySelector(".nv-sheet-body")?.firstElementChild?.children || [])].slice(0, 8);
  rows.forEach((row, n) => { if (!row.matches(".nv-tile,.nv-rise")) enter(row, { y: 12, delay: .06 + n * .035, duration: .4 }); });
}

// Observes only element insertion and animation markers, never streamed text.
// Ownership remains with each mounted root; no React updates per animation frame.
export function useMotionRoot(ref, preference = "full") {
  useLayoutEffect(() => { setMotionPreference(preference); }, [preference]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const seen = new WeakSet();
    const loops = new Map();
    const owned = new Set();
    const entry = ".nv-draw,.nv-reveal,.nv-page,.nv-rise,.nv-tile,.nv-bubble,.nv-fade,.nv-sheet,.nv-screen,.nv-pop,.nv-slide-left,.nv-slide-right,.nv-dock,.nv-popup,.nv-attachment,.nv-media-entry,.nv-chip,.nv-scope-label";
    const looping = ".nv-spin,.nv-pulse,.nv-breathe,.nv-think,.nv-wait,.nv-caret,.nv-skel";
    const kids = el => el.matches(".nv-think,.nv-wait") ? el.children : el;
    const visible = (el) => el.isConnected && !el.closest('[style*="display: none"],[hidden]');
    const playLoop = (el) => {
      if (!visible(el) || document.visibilityState === "hidden" || motionMode() !== "full") return;
      let t;
      if (el.matches(".nv-spin")) t = gsap.to(el, { rotation: 360, duration: .9, ease: "none", repeat: -1 });
      // Thinking: a travelling wave that lifts and swells each dot in turn.
      else if (el.matches(".nv-think")) t = gsap.fromTo(el.children, { y: 0, scale: .8, opacity: .35 }, { y: -4, scale: 1.15, opacity: 1, duration: .5, stagger: .16, yoyo: true, repeat: -1, ease: "sine.inOut" });
      // Waiting for the first token: dots breathe one after another, no lift.
      else if (el.matches(".nv-wait")) t = gsap.fromTo(el.children, { scale: .7, opacity: .3 }, { scale: 1, opacity: .9, duration: .55, stagger: .18, yoyo: true, repeat: -1, ease: "sine.inOut" });
      // Caret at the tip of the streaming text: a hard blink.
      else if (el.matches(".nv-caret")) t = gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: .01, delay: .5, repeat: -1, repeatDelay: .5, ease: "none" });
      else if (el.matches(".nv-skel")) {
        const bar = el.querySelector(".nv-skel-bar");
        if (bar) t = gsap.fromTo(bar, { xPercent: -100 }, { xPercent: 100, duration: 1.3, repeat: -1, ease: "power1.inOut" });
      } else t = gsap.to(el, { opacity: .45, duration: .65, yoyo: true, repeat: -1 });
      if (t) { loops.set(el, t); track(t); }
    };
    const refreshLoop = (el) => {
      const old = loops.get(el);
      old?.kill(); loops.delete(el);
      if (el.matches(looping)) playLoop(el);
      else if (old) gsap.set(kids(el), { clearProps: "transform,opacity" });
    };
    /* set while a batch of changes swaps the streaming bubble for the saved
       reply: that row is the same words in the same place, so it does not
       enter again (its rise read as the view jumping when a reply ended) */
    let settling = false;
    const scan = (node, initial = false) => {
      if (node.nodeType !== 1 || node.closest("[data-motion-ghost]")) return;
      if (settling && node.matches(".nv-bubble,[data-chat-message]")) { for (const el of [node, ...node.querySelectorAll(entry)]) seen.add(el); return; }
      const mountingChat = node.matches(".nv-chat-root") || !!node.querySelector(".nv-chat-root");
      const elements = [node, ...node.querySelectorAll(`${entry},${looping}`)];
      let i = 0;
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.matches(looping)) { owned.add(el); playLoop(el); }
        // Existing transcript is already visible; only new messages enter.
        if (el.matches(entry) && visible(el) && !((initial || mountingChat) && el.closest("[id^='msg-']"))) {
          if (el.closest("[data-motion-list]")) continue;
          if (el.parentElement?.closest(entry) && !el.matches(".nv-tile,.nv-rise,.nv-draw,.nv-reveal")) continue;
          owned.add(el);
          const delay = Math.min(i++ * MOTION.stagger, MOTION.staggerCap);
          if (el.matches(".nv-sheet")) { arriveSheet(el); continue; }
          if (el.matches(".nv-draw")) { drawLine(el, delay); continue; }
          if (el.matches(".nv-reveal")) { revealText(el, delay); continue; }
          enter(el, entryOf(el, delay));
        }
      }
    };
    scan(root, true);
    const observer = new MutationObserver((records) => {
      const responses = new Set();
      settling = records.some((r) => [...r.removedNodes].some((n) => n.nodeType === 1 && (n.matches(".nv-msg-stream") || n.querySelector?.(".nv-msg-stream"))));
      for (const record of records) {
        if (record.target.nodeType === 1 && !record.target.closest('[data-motion-ghost],.nv-msg,.nv-msg-edit,[contenteditable="true"]')) {
          const control = record.target.closest('button,[data-motion-state],[role="status"],[role="alert"]');
          if (control && ((record.type === "childList" && record.addedNodes.length) || ["aria-pressed", "aria-selected", "aria-busy", "data-motion-state"].includes(record.attributeName))) responses.add(control);
        }
        if (record.type === "childList") {
          for (const node of record.addedNodes) scan(node);
          for (const node of record.removedNodes) {
            if (node.nodeType !== 1) continue;
            for (const el of owned) if (!root.contains(el) && (el === node || node.contains(el))) {
              stop(el); loops.get(el)?.kill(); loops.delete(el); owned.delete(el); removeActionFeedback.forget(el);
            }
          }
        } else if (record.attributeName === "data-open" && record.target.matches(".nv-collapse:not([data-motion-disclosure])")) {
          const el = record.target, child = el.firstElementChild;
          if (!child) continue;
          owned.add(child); stop(child);
          if (el.dataset.open === "1") { el.style.gridTemplateRows = ""; enter(child, { y: 10, duration: .32 }); }
          else {
            el.style.gridTemplateRows = "1fr";
            tween(child, { opacity: 0, y: -6, duration: .12, onComplete: () => { el.style.gridTemplateRows = ""; set(child, { clearProps: "opacity,transform" }); } });
          }
        } else if (record.attributeName === "data-open" && record.target.matches(".nv-chevron")) {
          const el = record.target;
          owned.add(el);
          tween(el, { rotation: el.dataset.open === "1" ? Number(el.dataset.angle || 180) : 0, duration: .45, ease: "expo.out" });
        } else if (record.attributeName === "aria-checked" && record.target.matches('[role="switch"]')) {
          const icon = record.target.querySelector("svg");
          if (icon && motionMode() === "full") { owned.add(icon); pop(icon, { from: .55, rotation: record.target.getAttribute("aria-checked") === "true" ? -20 : 20 }); }
        } else if (record.attributeName === "aria-checked" && record.target.matches('[role="radio"]') && record.target.getAttribute("aria-checked") === "true") {
          const mark = record.target.querySelector("svg") || record.target.querySelector("span");
          if (mark && motionMode() === "full") { owned.add(mark); pop(mark, { from: .75, y: 3, duration: .45 }); }
        } else if (record.attributeName === "class") {
          const el = record.target;
          if (el.matches(looping) || loops.has(el)) { owned.add(el); refreshLoop(el); }
        }
      }
      for (const control of responses) {
        if (control.matches(looping)) continue;
        const icon = control.querySelector('svg:not(.nv-spin)');
        const target = icon || control.querySelector('[data-motion-label]');
        if (target) { owned.add(target); respond(target, { icon: !!icon }); }
        else if (control.matches('button,[data-motion-state],[role="status"],[role="alert"]')) { owned.add(control); respond(control); }
      }
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-open", "aria-checked", "aria-pressed", "aria-selected", "aria-busy", "data-motion-state"] });
    const refresh = () => {
      for (const [el, t] of loops) {
        t.kill();
        gsap.set(kids(el), { clearProps: "opacity,transform" });
      }
      loops.clear();
      for (const el of owned) if (el.matches(looping)) playLoop(el);
    };
    const unsubscribe = onMotionChange(refresh);
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    media?.addEventListener?.("change", settleMotion);
    const visibility = () => { settleMotion(); refresh(); };
    document.addEventListener("visibilitychange", visibility);
    // Activity hides retained pages without removing their DOM.
    const display = new WeakMap();
    const hiddenObserver = new MutationObserver(records => {
      let changed = false;
      for (const { target } of records) {
        const next = target.style.display;
        if (display.get(target) !== next) { display.set(target, next); changed = true; }
      }
      if (changed) refresh();
    });
    root.querySelectorAll(".nv-tab").forEach(el => { display.set(el, el.style.display); hiddenObserver.observe(el, { attributes: true, attributeFilter: ["style"] }); });
    const removeActionFeedback = installActionFeedback(root, el => owned.add(el));
    const focusIn = event => {
      const field = event.target;
      if (!field.matches?.('input:not([type="file"]),textarea,select') || motionMode() === "off") return;
      const indicator = field.parentElement?.querySelector('[data-focus-indicator]');
      if (indicator) { owned.add(indicator); tween(indicator, { opacity: 1, duration: MOTION.feedback }); }
    };
    const focusOut = event => {
      const indicator = event.target.parentElement?.querySelector('[data-focus-indicator]');
      if (indicator) tween(indicator, { opacity: 0, duration: MOTION.feedback });
    };
    root.addEventListener("focusin", focusIn); root.addEventListener("focusout", focusOut);
    return () => {
      observer.disconnect(); hiddenObserver.disconnect(); unsubscribe();
      media?.removeEventListener?.("change", settleMotion);
      document.removeEventListener("visibilitychange", visibility);
      removeActionFeedback();
      root.removeEventListener("focusin", focusIn); root.removeEventListener("focusout", focusOut);
      for (const el of owned) { stop(el); loops.get(el)?.kill(); gsap.set(el, { clearProps: "opacity,transform" }); }
    };
  }, []);
}
