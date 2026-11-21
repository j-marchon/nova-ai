import { motionMode, setSkinEntry } from "../components/motion/runtime.js";

/* ---------- a skin's effects ----------

   The moves a skin can switch on and tune from its manifest (effects in
   pack.js). The moves themselves are the app's: the pack names them,
   gives numbers, and names the classes its stylesheet draws them with.
   All of them are short and compositor-only (transform and opacity on a
   handful of elements), never touch the app's own elements beyond an
   added animation, and run in Full motion only: Calm and Off get none.

   - entry: arrivals with their own character, per selector
     ({ match, y, x, scale, duration, ease })
   - ripple: a press on an action, a tab or an option sends out a ring
   - sendBubbles: Send lets go of a few bubbles, and one glint
   - glint: a four-point sparkle (Send, and a new tab with tabDroplet)
   - tabDroplet: the dock's marker stretches toward a newly picked tab
   - dockShine: a highlight glides along the dock's top edge (::before) */

const RIPPLES = ".nv-btn--primary, .nv-nav button, [role='radio'], [role='switch'], .nv-island-btn";
const full = () => motionMode() === "full" && document.visibilityState !== "hidden";

export function installEffects(fx = {}) {
  let layer = null;
  const fxLayer = () => {
    if (layer?.isConnected) return layer;
    layer = document.createElement("div");
    layer.className = fx.layer || "nv-skin-fx";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  };
  const spawn = (className, x, y, size) => {
    const el = document.createElement("span");
    el.className = className;
    el.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px`;
    fxLayer().appendChild(el);
    return el;
  };

  const glint = (x, y, size, delay = 0) => {
    if (!fx.glint) return;
    const g = spawn(fx.glint.class, x, y, size);
    g.animate([
      { transform: "scale(0) rotate(0deg)", opacity: 0 },
      { transform: "scale(1) rotate(45deg)", opacity: 1, offset: .4 },
      { transform: "scale(.2) rotate(90deg)", opacity: 0 },
    ], { duration: 620, delay, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "both" }).finished.finally(() => g.remove());
  };

  const ripple = (x, y) => {
    const r = spawn(fx.ripple.class, x, y, fx.ripple.size);
    r.animate([
      { transform: "scale(.15)", opacity: .7 },
      { transform: "scale(1)", opacity: 0 },
    ], { duration: fx.ripple.duration, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" }).finished.finally(() => r.remove());
  };

  /* rects are in screen pixels; the layer sits outside the UI zoom */
  const sendBubbles = (button) => {
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let n = 0; n < fx.sendBubbles.count; n++) {
      const size = 5 + ((n * 7) % 9);
      const b = spawn(fx.sendBubbles.class, cx + ((n * 11) % 23) - 11, cy, size);
      const drift = ((n % 2) * 2 - 1) * (6 + (n * 5) % 14);
      const rise = 70 + (n * 23) % 70;
      b.animate([
        { transform: "translate3d(0, 0, 0) scale(.4)", opacity: 0 },
        { transform: `translate3d(${drift * .4}px, ${-rise * .3}px, 0) scale(1)`, opacity: 1, offset: .25 },
        { transform: `translate3d(${drift}px, ${-rise}px, 0) scale(1.1)`, opacity: 0 },
      ], { duration: 650 + n * 70, delay: n * 35, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "both" }).finished.finally(() => b.remove());
    }
    glint(cx - 14, cy - 34, 16, 140);
  };

  /* the droplet: laid over the marker's own glide (navigation.js moves it;
     this only adds a squash and stretch on top, composite "add") */
  const stretchDroplet = (marker) => marker.animate([
    { transform: "scale(1, 1)" },
    { transform: "scale(1.22, .86)", offset: .3 },
    { transform: "scale(.95, 1.05)", offset: .65 },
    { transform: "scale(1, 1)" },
  ], { duration: 640, easing: "cubic-bezier(.2, .7, .3, 1)", composite: "add" });

  /* the dock's top edge catches the light, and the light slides along it;
     still whenever the background is (covered by a sheet or full screen) */
  let shine = null;
  const shineDock = () => {
    const dock = document.querySelector(".nv-nav-dock");
    if (!full() || !dock?.animate || document.querySelector(".nv-screen, .nv-sheet")) { shine?.cancel(); shine = null; return; }
    if (shine && shine.effect?.target === dock) return;
    shine?.cancel();
    shine = dock.animate(
      [{ transform: "translateX(-60%)" }, { transform: "translateX(260%)" }],
      { duration: fx.dockShine.duration, iterations: Infinity, easing: "cubic-bezier(.45, 0, .55, 1)", pseudoElement: "::before" },
    );
  };

  if (fx.entry?.length) {
    setSkinEntry((el, base) => {
      for (const r of fx.entry) {
        let hit = false;
        try { hit = el.matches(r.match); } catch { /* a selector this browser cannot read */ }
        if (hit) {
          const { match: _m, ...move } = r;
          return { ...base, ...move };
        }
      }
      return base;
    });
  }
  const onDown = (e) => {
    if (!fx.ripple || !full() || e.button > 0) return;
    const hit = e.target.closest?.(RIPPLES);
    if (hit && !hit.disabled) ripple(e.clientX, e.clientY);
  };
  const onClick = (e) => {
    if (!full()) return;
    /* another tab chosen: the droplet sets off toward it */
    const tab = fx.tabDroplet && e.target.closest?.(".nv-nav-inner > button");
    if (tab && tab.getAttribute("aria-current") !== "page") {
      const marker = document.querySelector(".nv-nav-marker");
      if (marker?.animate) stretchDroplet(marker);
      const r = tab.getBoundingClientRect();
      glint(r.left + r.width / 2 + 12, r.top + 10, 16, 280);
    }
    const send = fx.sendBubbles && e.target.closest?.('[aria-label="Send"]');
    if (send && !send.disabled) sendBubbles(send);
  };
  document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
  document.addEventListener("click", onClick, { capture: true });
  /* the dock comes and goes (it is not in a chat), and Motion can change:
     look for it now and then */
  const dockTimer = fx.dockShine ? setInterval(shineDock, 1000) : null;
  if (fx.dockShine) shineDock();
  return () => {
    if (dockTimer) clearInterval(dockTimer);
    shine?.cancel();
    shine = null;
    if (fx.entry?.length) setSkinEntry(null);
    document.removeEventListener("pointerdown", onDown, { capture: true });
    document.removeEventListener("click", onClick, { capture: true });
    layer?.remove();
    layer = null;
  };
}
