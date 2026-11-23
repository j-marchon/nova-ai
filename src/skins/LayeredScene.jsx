import { useEffect, useMemo, useRef, useState } from "react";
import { motionMode, onMotionChange } from "../components/motion/runtime.js";

/* ---------- layered scenes: a skin's living background ----------

   A scene is a picture taken apart into layers:
   a still plate and the elements over it, each with its place on the canvas
   (rect), the point it turns around (pivot) and its motion over one loop
   (frames: offset, x and y in % of itself, rotate, scale, opacity). Every
   scene comes drawn twice, for a wide screen and a tall one; the one nearer
   the window's shape covers it, centred, like a wallpaper.

   Over the layers, a few effects drawn by the app: star glints, a slow
   sweep of light, rising bubbles, drifting motes. All of it is pictures
   and plain elements moved by transform and opacity on the compositor
   (Element.animate), so the page does no work per frame. Pointing on a
   desktop shifts the layers a little by their depth.

   The rules for when it moves are the app's (the same as SkinBackground):
   Full motion only, while the app is in front and no sheet or full screen
   covers it; Calm, Off and reduced motion hold one still frame. With a
   chat open (data-reading) it slows and sits back behind the text. */

const COVER = ".nv-screen, .nv-sheet";

/* the same layout every time a scene opens: a small seeded random */
function seeded(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const orientation = () => (typeof window === "undefined" || window.innerWidth >= window.innerHeight ? "desktop" : "phone");

/* one layer's frames as keyframes for Element.animate */
const keyframes = (frames) => frames.map(([offset, x, y, r, s, a]) => ({
  offset, opacity: a, transform: `translate(${x}%, ${y}%) rotate(${r}deg) scale(${s})`,
}));

/* the effects' parts and their motion, laid out once per scene */
function effectParts(fx, seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (const [n, f] of (fx || []).entries()) {
    const [ax, ay, aw, ah] = f.area || [0, 0, 1, 1];
    const period = (f.period || 10) * 1000;
    if (f.kind === "glints") {
      for (let i = 0; i < (f.count || 10); i++) {
        const size = (f.size || 12) * (.6 + rnd() * .8);
        const peak = .3 + rnd() * .4;
        parts.push({
          key: `g${n}-${i}`, cls: "nv-scene-glint",
          style: { left: `${(ax + rnd() * aw) * 100}%`, top: `${(ay + rnd() * ah) * 100}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 },
          frames: [
            { offset: 0, opacity: 0, transform: "scale(.3) rotate(0deg)" },
            { offset: Math.max(.01, peak - .08), opacity: 0, transform: "scale(.3) rotate(0deg)" },
            { offset: peak, opacity: 1, transform: "scale(1) rotate(45deg)" },
            { offset: Math.min(.99, peak + .1), opacity: 0, transform: "scale(.4) rotate(90deg)" },
            { offset: 1, opacity: 0, transform: "scale(.3) rotate(90deg)" },
          ],
          timing: { duration: period * (.7 + rnd() * .8), delay: -rnd() * period * 2, iterations: Infinity, easing: "linear" },
        });
      }
    } else if (f.kind === "sweep") {
      /* a soft band of light crossing now and then, at an angle */
      parts.push({
        key: `s${n}`, cls: "nv-scene-sweep",
        style: { "--nv-sweep-angle": `${f.angle || 20}deg`, "--nv-sweep": f.strength ?? .1 },
        frames: [
          { offset: 0, transform: "translateX(-120%)", opacity: 0 },
          { offset: .05, opacity: 1 },
          { offset: .45, transform: "translateX(120%)", opacity: 1 },
          { offset: .5, transform: "translateX(120%)", opacity: 0 },
          { offset: 1, transform: "translateX(120%)", opacity: 0 },
        ],
        timing: { duration: period, delay: -rnd() * period, iterations: Infinity, easing: "cubic-bezier(.45, 0, .55, 1)" },
      });
    } else if (f.kind === "bubbles") {
      for (let i = 0; i < (f.count || 8); i++) {
        const size = 8 + rnd() * 30;
        const sway = 6 + rnd() * 16;
        const secs = period * (.6 + rnd() * .8);
        parts.push({
          key: `b${n}-${i}`, cls: "nv-scene-bubble",
          style: { left: `${(ax + rnd() * aw) * 100}%`, width: size, height: size },
          frames: [
            { transform: "translate3d(0, 0, 0)", opacity: 0 },
            { offset: .08, opacity: .9 },
            { transform: `translate3d(${sway}px, -40cqh, 0)`, offset: .4 },
            { transform: `translate3d(${-sway}px, -80cqh, 0)`, offset: .8, opacity: .9 },
            { transform: "translate3d(0, -115cqh, 0)", opacity: 0 },
          ],
          timing: { duration: secs, delay: -rnd() * secs, iterations: Infinity, easing: "linear" },
        });
      }
    } else if (f.kind === "motes") {
      for (let i = 0; i < (f.count || 12); i++) {
        const dx = (rnd() - .5) * 80, dy = -20 - rnd() * 60;
        const secs = period * (.6 + rnd() * .8);
        parts.push({
          key: `m${n}-${i}`, cls: "nv-scene-mote",
          style: { left: `${(ax + rnd() * aw) * 100}%`, top: `${(ay + rnd() * ah) * 100}%`, width: 4 + rnd() * 5, height: 4 + rnd() * 5 },
          frames: [
            { transform: "translate3d(0, 0, 0)", opacity: 0 },
            { offset: .25, opacity: .8 },
            { offset: .75, opacity: .6 },
            { transform: `translate3d(${dx}px, ${dy}px, 0)`, opacity: 0 },
          ],
          timing: { duration: secs, delay: -rnd() * secs, iterations: Infinity, easing: "ease-in-out" },
        });
      }
    }
  }
  return parts;
}

export function LayeredScene({ scenes, sceneId, base = "", invert = false, className = "" }) {
  const [orient, setOrient] = useState(orientation);
  useEffect(() => {
    const on = () => setOrient(orientation());
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  const scene = (scenes || []).find((s) => s.id === sceneId) || scenes?.[0];
  const comp = scene?.[orient] || scene?.desktop || scene?.phone;
  const parts = useMemo(() => (comp ? effectParts(comp.fx, `${scene.id}:${orient}`) : []), [comp, scene, orient]);
  const root = useRef(null);
  const [ready, setReady] = useState(false);

  /* shown once the plate has decoded, so it never flashes in half-drawn */
  useEffect(() => {
    setReady(false);
    const plate = comp?.layers?.[0];
    if (!plate) return undefined;
    let alive = true;
    const img = new Image();
    img.src = base + plate.src;
    (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => alive && setReady(true));
    return () => { alive = false; };
  }, [comp, base]);

  /* the motion: made once per scene, played and paused by the rules above */
  useEffect(() => {
    const el = root.current;
    if (!el || !comp || typeof el.animate !== "function") return undefined;
    const anims = [];
    el.querySelectorAll("[data-layer]").forEach((node) => {
      const layer = comp.layers[Number(node.dataset.layer)];
      if (layer?.frames?.length > 1) anims.push(node.animate(keyframes(layer.frames), { duration: comp.period * 1000, iterations: Infinity, easing: "linear" }));
    });
    el.querySelectorAll("[data-fx]").forEach((node) => {
      const p = parts.find((x) => x.key === node.dataset.fx);
      if (p) anims.push(node.animate(p.frames, p.timing));
    });
    let reading = null;
    const apply = () => {
      const moving = motionMode() === "full" && document.visibilityState !== "hidden" && !document.querySelector(COVER);
      const nowReading = !!document.querySelector(".nv-chat-root");
      el.toggleAttribute("data-reading", nowReading);
      for (const a of anims) {
        if (moving) a.play(); else a.pause();
        if (reading !== nowReading) a.updatePlaybackRate?.(nowReading ? .45 : 1);
      }
      reading = nowReading;
    };
    apply();
    const unsub = onMotionChange(apply);
    document.addEventListener("visibilitychange", apply);
    /* a cheap look twice a second rather than watching every change to the page */
    const poll = setInterval(apply, 500);
    return () => { clearInterval(poll); unsub(); document.removeEventListener("visibilitychange", apply); anims.forEach((a) => a.cancel()); };
  }, [comp, parts]);

  /* depth: on a desktop, the layers shift a little with the pointer */
  useEffect(() => {
    const el = root.current;
    if (!el || typeof matchMedia !== "function" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    let frame = 0, x = 0, y = 0;
    const move = (e) => {
      x = e.clientX / innerWidth - .5; y = e.clientY / innerHeight - .5;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (motionMode() !== "full") { el.style.removeProperty("--px"); el.style.removeProperty("--py"); return; }
        el.style.setProperty("--px", x.toFixed(3));
        el.style.setProperty("--py", y.toFixed(3));
      });
    };
    addEventListener("pointermove", move, { passive: true });
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(frame); };
  }, []);

  if (!comp) return null;
  const aspect = comp.width / comp.height;
  return (
    <div
      ref={root}
      aria-hidden
      className={`nv-scene ${invert ? "nv-scene--invert" : ""} ${className}`}
      data-ready={ready ? "1" : undefined}
      /* the stage covers this box, not the viewport: under the app's
         UI scale (zoom on the root) vw and vh would make it larger than
         the window, cut more of the picture away and blow it up */
      style={{ containerType: "size" }}
    >
      <div className="nv-scene-stage" style={{ width: `max(100cqw, calc(100cqh * ${aspect}))`, height: `max(100cqh, calc(100cqw / ${aspect}))` }}>
        {comp.layers.map((l, i) => {
          const [x, y, w, h] = l.rect;
          const [px, py] = l.pivot || [x + w / 2, y + h / 2];
          return (
            <img
              key={`${scene.id}-${orient}-${i}`}
              data-layer={i}
              src={base + l.src}
              alt=""
              draggable={false}
              decoding="async"
              className="nv-scene-layer"
              style={{
                left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`,
                transformOrigin: `${((px - x) / w) * 100}% ${((py - y) / h) * 100}%`,
                ...(l.frames ? { willChange: "transform, opacity" } : null),
                ...(l.depth ? { "--d": l.depth } : null),
              }}
            />
          );
        })}
        {parts.map((p) => <span key={p.key} data-fx={p.key} className={p.cls} style={p.style} />)}
      </div>
    </div>
  );
}
