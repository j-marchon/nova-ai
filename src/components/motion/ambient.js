import { useEffect } from "react";
import { motionMode, onMotionChange } from "./runtime.js";

/* The standard look's living field: a lamp passing over the measuring grid.

   Behind the tabs (never the chat) a soft light drifts slowly across the
   upper screen and lights the grid's lines where it passes, the way a lamp
   moved over drafting paper picks out the ruling. Now and then one of the
   grid's registration marks near the light flares into Nova's four-point
   star and goes out. The same flare marks a message being sent.

   Built for a weak phone:
   - the lamp is two composited layers moved by transform alone, in
     opposite directions (the window moves, the lines inside it stay put),
     so nothing is repainted per frame;
   - it runs on the Web Animations API, off the main thread, and is kept
     out of runtime.js's `running` set on purpose: settleMotion() finishes
     what is there, and an endless animation cannot be finished;
   - Calm, Off and the system's reduced motion leave the lamp parked where
     it is and fire no flares; a hidden app, an open sheet or full screen
     pauses it; nothing reads or writes React state per frame;
   - the light carries on from where it was when a tab comes back from the
     chat, rather than starting over.
   Supporter skins draw their own surface and never wear it. */

const LOOP_MS = 96000;
const FLARE_MS = 1500;
/* the light's path, as fractions of the screen: a slow figure-of-eight
   over the upper half, where the grid shows. It starts where the startup
   screen's mark was, so the mark's light seems to stay behind. */
const PATH = Array.from({ length: 33 }, (_, n) => {
  const a = (n / 32) * Math.PI * 2;
  return [.5 + .3 * Math.sin(a), .3 + .14 * Math.sin(2 * a + .785)];
});
/* the field's own clock, kept across mounts so the light resumes */
let clock0 = 0;

const canAnimate = (el) => !!el && typeof el.animate === "function";
const skinned = () => !!document.documentElement.dataset.skin;

/* Where the light is at `ms` into its loop, in fractions of the screen. */
function lampAt(ms) {
  const f = (((ms % LOOP_MS) + LOOP_MS) % LOOP_MS) / LOOP_MS * (PATH.length - 1);
  const i = Math.floor(f), t = f - i;
  const [ax, ay] = PATH[i], [bx, by] = PATH[Math.min(i + 1, PATH.length - 1)];
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

/* A four-point star with a hairline cross, flaring at (x, y) in `host`'s
   own px, then gone. Off and Calm show nothing: it carries no meaning a
   still screen lacks. */
export function flare(host, x, y, { size = 18, reach = 56, delay = 0, fixed = false } = {}) {
  if (!host || !canAnimate(host) || motionMode() !== "full" || document.visibilityState === "hidden") return;
  const el = document.createElement("span");
  el.className = "nv-flare";
  el.setAttribute("aria-hidden", "true");
  el.dataset.motionGhost = "1";
  if (fixed) el.dataset.fixed = "1";
  el.style.cssText = `left:${x}px;top:${y}px;--nv-flare-size:${size}px;--nv-flare-reach:${reach}px`;
  el.innerHTML = '<i class="nv-flare-h"></i><i class="nv-flare-v"></i><svg class="nv-flare-star" viewBox="0 0 24 24"><path d="M12 0C12.9 8.1 15.9 11.1 24 12 15.9 12.9 12.9 15.9 12 24 11.1 15.9 8.1 12.9 0 12 8.1 11.1 11.1 8.1 12 0Z"/></svg>';
  host.appendChild(el);
  const ease = "cubic-bezier(.16, 1, .3, 1)";
  const timing = { duration: FLARE_MS, delay, easing: "linear", fill: "both" };
  const star = el.querySelector(".nv-flare-star");
  const done = Promise.all([
    star.animate([
      { transform: "scale(0) rotate(-45deg)", opacity: 0, easing: ease },
      { transform: "scale(1) rotate(0deg)", opacity: 1, offset: .22, easing: "cubic-bezier(.5, 0, .75, 0)" },
      { transform: "scale(0) rotate(30deg)", opacity: 0 },
    ], timing).finished,
    ...[".nv-flare-h", ".nv-flare-v"].map((s, n) => el.querySelector(s).animate([
      { transform: n ? "scaleY(0)" : "scaleX(0)", opacity: 0, easing: ease },
      { transform: "none", opacity: .9, offset: .25, easing: "cubic-bezier(.5, 0, .75, 0)" },
      { transform: n ? "scaleY(.2)" : "scaleX(1.6)", opacity: 0 },
    ], timing).finished),
  ]);
  done.catch(() => {}).finally(() => el.remove());
  return el;
}

/* Wires the field into a mounted Texture. `root` holds the lamp
   (.nv-texture-lamp > .nv-texture-lamp-grid) and takes the flares. */
export function useAmbientField(ref, on) {
  useEffect(() => {
    const root = ref.current;
    const lamp = root?.querySelector(".nv-texture-lamp");
    const grid = lamp?.firstElementChild;
    if (!on || !canAnimate(lamp) || !grid) return;
    if (!clock0) clock0 = performance.now();

    let size = { w: 0, h: 0, l: 0, t: 0 };
    let move = null, hold = null, fade = null, timer = 0, frame = 0;
    /* the lines inside the window sit exactly over the page's own grid */
    const measure = () => {
      size = { w: root.clientWidth, h: root.clientHeight, l: lamp.offsetLeft + lamp.offsetWidth / 2, t: lamp.offsetTop + lamp.offsetHeight / 2 };
      Object.assign(grid.style, { left: `${-lamp.offsetLeft}px`, top: `${-lamp.offsetTop}px`, width: `${size.w}px`, height: `${size.h}px` });
    };
    const offset = ([fx, fy]) => [fx * size.w - size.l, fy * size.h - size.t];
    const frames = (sign) => PATH.map((p) => {
      const [dx, dy] = offset(p);
      return { transform: `translate3d(${sign * dx}px, ${sign * dy}px, 0)` };
    });
    const now = () => performance.now() - clock0;

    const covered = () => !!document.querySelector(".nv-sheet, .nv-screen");
    const live = () => motionMode() === "full" && document.visibilityState !== "hidden" && !skinned();

    const stopAll = () => {
      move?.cancel(); hold?.cancel(); move = hold = null;
      clearTimeout(timer); timer = 0;
    };
    /* parked: the light stays where it is now, drawn once */
    const park = () => {
      const [dx, dy] = offset(lampAt(now()));
      lamp.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      grid.style.transform = `translate3d(${-dx}px, ${-dy}px, 0)`;
    };
    const scheduleFlare = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (live() && !covered()) {
          /* the registration mark nearest the light: the lamp lights it */
          const [fx, fy] = lampAt(now());
          const lx = fx * size.w, ly = fy * size.h;
          const x0 = (((size.w - 256) / 2) % 256 + 256) % 256 + 32;
          let best = null;
          for (let x = x0; x < size.w - 16; x += 256) for (let y = 64; y < size.h * .62; y += 256) {
            const d = Math.hypot(x - lx, y - ly);
            if (!best || d < best.d) best = { x, y, d };
          }
          if (best && best.d < Math.max(size.w, size.h) * .45) flare(root, best.x, best.y);
        }
        scheduleFlare();
      }, 11000 + Math.random() * 13000);
    };
    const start = () => {
      stopAll();
      measure();
      if (!live()) { park(); return; }
      lamp.style.transform = grid.style.transform = "";
      const timing = { duration: LOOP_MS, iterations: Infinity, easing: "linear" };
      move = lamp.animate(frames(1), timing);
      hold = grid.animate(frames(-1), timing);
      move.currentTime = hold.currentTime = now() % LOOP_MS;
      if (covered()) { move.pause(); hold.pause(); }
      scheduleFlare();
    };
    /* the light comes up softly, whatever the motion setting */
    fade = lamp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMode() === "off" ? 0 : 1600, delay: 250, easing: "ease-out", fill: "backwards" });
    start();

    /* a sheet or full screen over the tabs: hold still under it */
    const cover = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!move) return;
        if (covered()) { move.pause(); hold.pause(); }
        else if (move.playState === "paused") { move.play(); hold.play(); }
      });
    };
    const app = root.closest(".nv-root") || document.body;
    const watcher = typeof MutationObserver === "function" ? new MutationObserver(cover) : null;
    watcher?.observe(app, { childList: true, subtree: true });
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(start); };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", start);
    const unsub = onMotionChange(start);
    return () => {
      stopAll(); fade?.cancel();
      cancelAnimationFrame(frame);
      watcher?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
      unsub();
      for (const f of root.querySelectorAll(".nv-flare")) f.remove();
    };
  }, [ref, on]);
}
