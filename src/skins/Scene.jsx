import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { motionMode, onMotionChange } from "../components/motion/runtime.js";
import { startField, startGlyph } from "./shader.js";

/* ---------- drawing a skin's background and startup screen ----------

   A pack describes each as a tree of plain parts (pack.js checks it):
   div, span, p, img (a picture from the pack), canvas (a shader), each
   with classes for the skin's stylesheet, a few styles, and optionally an
   animation as keyframes and timing, which the browser runs on the
   compositor (Element.animate). Nothing in a pack is code; the rules for
   when things move are the app's, here.

   The background (from Aero's water, the first skin):
   - plays only in Full motion, while the app shows and nothing covers it
     (a full screen or a sheet gets a still frame);
   - "scene" animations also hold still while a chat is open, and the
     root gets data-reading then, so the stylesheet can push it back;
   - a part marked phone: false is left out on a phone-sized screen;
   - Calm, Off or reduced motion: one still frame, everything parked.
   Nothing here reads or writes React state per frame. */

const PHONE = 640;
const LOGO = () => `${import.meta.env?.BASE_URL || "/"}logo.png`;

/* the tree as elements; text only on parts without children, so each
   element's children line up with its part's children */
function render(n, key) {
  const props = { key };
  if (n.class) props.className = n.class;
  if (n.style) props.style = n.style;
  if (n.tag === "img") { props.src = n.src; props.alt = ""; props.decoding = "async"; props.draggable = false; }
  if (n.tag === "canvas") { if (n.width) props.width = n.width; if (n.height) props.height = n.height; }
  if (n.hidden || n.tag === "img" || n.tag === "canvas") props["aria-hidden"] = true;
  return createElement(n.tag, props, n.text ?? n.children?.map((c, i) => render(c, i)));
}

/* the parts that need wiring, found by walking the tree beside the DOM */
function bind(el, n, out) {
  if (!el) return;
  if (n.phone === false) out.phoneHide.push(el);
  if (n.animate) out.anims.push({ el, spec: n.animate });
  if (n.shader) out.shaders.push({ el, spec: n.shader });
  n.children?.forEach((c, i) => bind(el.children[i], c, out));
}
const wiring = (el, root) => { const out = { phoneHide: [], anims: [], shaders: [] }; bind(el, root, out); return out; };
/* the root part is the engine's own element, so the stylesheet's rules for
   it (data-reading, data-phase) land where the pack's classes are */
const inner = (root) => root.text ?? root.children?.map((c, i) => render(c, i));

export function SkinBackground({ spec, paused = false }) {
  const root = useRef(null);
  const field = useRef(null);
  const children = useMemo(() => inner(spec.root), [spec]);

  useEffect(() => {
    const { shaders } = wiring(root.current, spec.root);
    const canvas = shaders.find((s) => s.spec.kind === "field");
    if (!canvas) return undefined;
    const el = canvas.el;
    let ctl = null;
    try { ctl = startField(el, canvas.spec); } catch (error) { console.warn("Skin background: the shader failed, showing the still layers.", error?.message || error); ctl = null; }
    if (!ctl) { el.style.display = "none"; return undefined; }
    field.current = ctl;
    const lost = (e) => { e.preventDefault(); el.style.display = "none"; ctl.stop(); field.current = null; };
    el.addEventListener("webglcontextlost", lost);
    const onResize = () => ctl.resize();
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("resize", onResize);
      el.removeEventListener("webglcontextlost", lost);
      ctl.stop();
      field.current = null;
    };
  }, [spec]);

  useEffect(() => {
    /* made once, paused straight away when still, so the still frame is
       the animation's own and the first play never jumps */
    let ambient = null, scene = null;
    const covered = () => !!document.querySelector(".nv-screen, .nv-sheet");
    const apply = () => {
      const moving = !paused && !covered() && motionMode() === "full" && document.visibilityState !== "hidden";
      const reading = !!document.querySelector(".nv-chat-root");
      const el = root.current;
      if (!el) return;
      el.toggleAttribute("data-reading", reading);
      if (moving) field.current?.play(); else field.current?.still();
      if (!ambient && typeof el.animate === "function") {
        const w = wiring(el, spec.root);
        const phone = innerWidth < PHONE;
        for (const p of w.phoneHide) p.style.display = phone ? "none" : "";
        ambient = []; scene = [];
        for (const { el: target, spec: a } of w.anims) {
          if (phone && w.phoneHide.some((p) => p === target || p.contains(target))) continue;
          (a.group === "scene" ? scene : ambient).push(target.animate(a.keyframes, a.timing));
        }
      }
      ambient?.forEach((a) => (moving ? a.play() : a.pause()));
      scene?.forEach((a) => (moving && !reading ? a.play() : a.pause()));
    };
    apply();
    const unsub = onMotionChange(apply);
    document.addEventListener("visibilitychange", apply);
    /* a cheap look twice a second, rather than watching every change to
       the page (a streamed reply changes it every frame) */
    const poll = setInterval(apply, 500);
    return () => {
      clearInterval(poll);
      unsub();
      document.removeEventListener("visibilitychange", apply);
      [...(ambient || []), ...(scene || [])].forEach((a) => a.cancel());
    };
  }, [paused, spec]);

  return <div ref={root} aria-hidden className={spec.root.class} style={spec.root.style}>{children}</div>;
}

/* The startup screen: same contract as components/Splash.jsx. It holds at
   least introMs, waits for `ready`, then leaves and calls onDone. Timers,
   not animation events, so it always ends. The root gets data-phase
   (intro, wait, leave) and data-quiet with reduced motion, for the
   stylesheet; a glyph shader runs only while it is not leaving. */
const prefersQuiet = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SkinSplash({ spec, ready, onDone }) {
  const [quiet] = useState(prefersQuiet);
  const [introDone, setIntroDone] = useState(false);
  const leaving = ready && introDone;
  const root = useRef(null);
  const children = useMemo(() => inner(spec.root), [spec]);

  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), quiet ? spec.quietIntroMs : spec.introMs);
    return () => clearTimeout(t);
  }, [quiet, spec]);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(onDone, quiet ? spec.quietLeaveMs : spec.leaveMs);
    return () => clearTimeout(t);
  }, [leaving, quiet, onDone, spec]);

  const run = !quiet && !leaving;
  useEffect(() => {
    if (!run || !root.current) return undefined;
    const { shaders, phoneHide } = wiring(root.current, spec.root);
    if (innerWidth < PHONE) for (const p of phoneHide) p.style.display = "none";
    const glyph = shaders.find((s) => s.spec.kind === "glyph");
    if (!glyph) return undefined;
    const ctl = startGlyph(glyph.el, glyph.spec, LOGO());
    return () => ctl?.stop();
  }, [run, spec]);

  return (
    <div
      ref={root}
      className={spec.root.class}
      style={spec.root.style}
      data-phase={leaving ? "leave" : introDone ? "wait" : "intro"}
      data-quiet={quiet ? "1" : undefined}
      role="status"
      aria-label={leaving ? undefined : "Loading Nova"}
      aria-hidden={leaving || undefined}
    >
      {children}
    </div>
  );
}
