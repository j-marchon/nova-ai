/* The Bridge window's motion: its living field (Nova's lamp over the grid
   and the odd star, Aero's drifting clouds and rising bubbles, or Holo's
   swaying prism strips and crossing spectrum), cards
   arriving, rows coming and going, presses. Web Animations only, transform
   and opacity only; reduced motion keeps the field still and arrivals to a
   fade. Nothing here reads or changes what the Bridge does. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const full = () => !reduced.matches && !document.hidden;
  const EASE = "cubic-bezier(.16, 1, .3, 1)";
  let field = [];
  let flareTimer = 0;
  const frame = document.querySelector(".frame");
  const skin = () => document.documentElement.dataset.skin || "nova";

  /* Nova: the lamp drifts on a slow figure-of-eight; the lines inside it
     move the other way, so they stay over the grid while the light passes */
  const PATH = Array.from({ length: 33 }, (_, n) => {
    const a = (n / 32) * Math.PI * 2;
    return [.5 + .3 * Math.sin(a), .3 + .16 * Math.sin(2 * a + .785)];
  });
  const LOOP = 70000;
  const t0 = performance.now();
  const lampAt = (ms) => {
    const f = ((ms % LOOP) / LOOP) * (PATH.length - 1), i = Math.floor(f), t = f - i;
    const [ax, ay] = PATH[i], [bx, by] = PATH[Math.min(i + 1, PATH.length - 1)];
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  function novaField() {
    const lamp = document.querySelector(".lamp"), grid = lamp.firstElementChild;
    const w = frame.clientWidth, h = frame.clientHeight;
    const cx = lamp.offsetLeft + lamp.offsetWidth / 2, cy = lamp.offsetTop + lamp.offsetHeight / 2;
    Object.assign(grid.style, { left: `${-lamp.offsetLeft}px`, top: `${-lamp.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    const at = ([fx, fy]) => [fx * w - cx, fy * h - cy];
    if (!full()) {
      const [dx, dy] = at(lampAt(performance.now() - t0));
      lamp.style.transform = `translate(${dx}px, ${dy}px)`;
      grid.style.transform = `translate(${-dx}px, ${-dy}px)`;
      return;
    }
    lamp.style.transform = grid.style.transform = "";
    const frames = (sign) => PATH.map((p) => { const [dx, dy] = at(p); return { transform: `translate(${sign * dx}px, ${sign * dy}px)` }; });
    const timing = { duration: LOOP, iterations: Infinity };
    const a = lamp.animate(frames(1), timing), b = grid.animate(frames(-1), timing);
    a.currentTime = b.currentTime = (performance.now() - t0) % LOOP;
    field.push(a, b);
    const flare = () => {
      flareTimer = setTimeout(() => {
        if (full() && skin() === "nova") {
          /* the registration mark nearest the light flares */
          const [fx, fy] = lampAt(performance.now() - t0);
          let best = null;
          for (let x = 32; x < w; x += 192) for (let y = 64; y < h * .7; y += 192) {
            const d = Math.hypot(x - fx * w, y - fy * h);
            if (!best || d < best.d) best = { x, y, d };
          }
          if (best) star(best.x, best.y);
        }
        flare();
      }, 9000 + Math.random() * 12000);
    };
    flare();
  }
  function star(x, y) {
    const el = document.createElement("span");
    el.className = "flare";
    el.style.cssText = `left:${x}px;top:${y}px`;
    el.innerHTML = '<i class="h"></i><i class="v"></i><svg viewBox="0 0 24 24"><path d="M12 0C12.9 8.1 15.9 11.1 24 12 15.9 12.9 12.9 15.9 12 24 11.1 15.9 8.1 12.9 0 12 8.1 11.1 11.1 8.1 12 0Z"/></svg>';
    document.querySelector(".field").append(el);
    const t = { duration: 1500, fill: "both" };
    Promise.all([
      el.querySelector("svg").animate([
        { transform: "scale(0) rotate(-45deg)", opacity: 0, easing: EASE },
        { transform: "scale(1) rotate(0)", opacity: 1, offset: .22, easing: "cubic-bezier(.5, 0, .75, 0)" },
        { transform: "scale(0) rotate(30deg)", opacity: 0 },
      ], t).finished,
      ...[...el.querySelectorAll("i")].map((line, n) => line.animate([
        { transform: n ? "scaleY(0)" : "scaleX(0)", opacity: 0, easing: EASE },
        { transform: "none", opacity: .9, offset: .25, easing: "cubic-bezier(.5, 0, .75, 0)" },
        { transform: n ? "scaleY(.2)" : "scaleX(1.6)", opacity: 0 },
      ], t).finished),
    ]).catch(() => {}).finally(() => el.remove());
  }

  /* Aero: two clouds drift across the sky, bubbles rise through the lake */
  function aeroField() {
    const host = document.querySelector(".bubbles");
    if (!host.childElementCount) {
      for (let n = 0; n < 9; n++) {
        const b = document.createElement("span");
        const size = 6 + ((n * 7) % 14);
        b.className = "bubble";
        b.style.cssText = `left:${6 + ((n * 37) % 88)}%;width:${size}px;height:${size}px`;
        host.append(b);
      }
    }
    if (!full()) return;
    const h = frame.clientHeight;
    for (const [n, b] of [...host.children].entries()) {
      const drift = ((n % 2) * 2 - 1) * (8 + (n * 5) % 16);
      const a = b.animate([
        { transform: "translate(0, 0) scale(.6)", opacity: 0 },
        { transform: `translate(${drift * .4}px, ${-h * .25}px) scale(1)`, opacity: .95, offset: .2 },
        { transform: `translate(${drift}px, ${-h * .75}px) scale(1.1)`, opacity: 0 },
      ], { duration: 9000 + n * 1700, delay: -n * 1900, iterations: Infinity, easing: "cubic-bezier(.3, .1, .6, 1)" });
      field.push(a);
    }
    for (const [n, c] of [...document.querySelectorAll(".cloud")].entries()) {
      field.push(c.animate([{ transform: "translateX(-40px)" }, { transform: "translateX(60px)" }], { duration: 60000 + n * 25000, iterations: Infinity, direction: "alternate", easing: "ease-in-out" }));
    }
  }

  /* Holo: the prism strips sway and breathe over the chrome; now and then a
     band of spectrum crosses the window */
  function holoField() {
    if (!full()) return;
    field.push(document.querySelector(".fold").animate([
      { transform: "translate(-12px, 8px) rotate(-1.5deg) scale(1.02)" },
      { transform: "translate(6px, -4px) rotate(.5deg) scale(1.06)", offset: .55 },
      { transform: "translate(14px, -10px) rotate(1.5deg) scale(1.04)" },
    ], { duration: 38000, iterations: Infinity, direction: "alternate", easing: "ease-in-out" }));
    field.push(document.querySelector(".sweep").animate([
      { transform: "translateX(-100%)", opacity: 0 },
      { opacity: 1, offset: .08 },
      { transform: "translateX(100%)", opacity: 0, offset: .2 },
      { transform: "translateX(100%)", opacity: 0 },
    ], { duration: 16000, delay: 2500, iterations: Infinity, easing: "cubic-bezier(.45, 0, .55, 1)" }));
  }

  function startField() {
    for (const a of field) a.cancel();
    field = [];
    clearTimeout(flareTimer);
    document.querySelectorAll(".flare").forEach((f) => f.remove());
    /* Minimal is still: no field at all */
    if (skin() === "aero") aeroField(); else if (skin() === "holo") holoField(); else if (skin() !== "minimal") novaField();
  }

  function enter(el, delay = 0) {
    if (!el?.animate) return;
    el.animate(full() ? [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: full() ? 420 : 120, delay: full() ? delay : 0, easing: EASE, fill: "backwards" });
  }

  /* presses: a small give under the pointer, back with a spring */
  let pressed = null;
  const release = () => {
    if (!pressed) return;
    pressed.animate([{ transform: "scale(.965)" }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
    pressed = null;
  };
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("button:not(:disabled)");
    if (!el || e.button > 0 || !full()) return;
    pressed = el;
    el.animate([{ transform: "none" }, { transform: "scale(.965)" }], { duration: 90, easing: "ease-out", fill: "forwards" });
  });
  ["pointerup", "pointercancel", "blur"].forEach((n) => window.addEventListener(n, () => {
    if (pressed) { pressed.getAnimations().forEach((a) => a.cancel()); release(); }
  }, true));

  window.BridgeMotion = {
    enter,
    startField,
    /* a status change: the light comes up, the words settle */
    status(el) { enter(el); },
    count(el, value) {
      if (el.dataset.value === String(value)) return;
      const first = el.dataset.value === undefined;
      el.dataset.value = String(value);
      el.textContent = value;
      if (!first) el.animate([{ opacity: .3, transform: full() ? "translateY(4px)" : "none" }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE });
    },
    /* new rows in a list arrive; the rest stay put */
    rows(host, before) {
      let i = 0;
      for (const el of host.querySelectorAll("[data-key]")) if (!before.has(el.dataset.key)) enter(el, Math.min(i++ * 40, 200));
    },
    open(dialog) {
      dialog.showModal();
      dialog.animate(full() ? [{ opacity: 0, transform: "scale(.94) translateY(8px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE });
    },
    close(dialog) {
      const a = dialog.animate([{ opacity: 1 }, { opacity: 0, transform: full() ? "scale(.97)" : "none" }], { duration: 160, easing: "ease-in", fill: "forwards" });
      /* closed when the fade ends, or shortly after in any case: a hidden or
         busy window can hold an animation back, and the dialog must still go */
      const done = () => { clearTimeout(late); if (dialog.open) dialog.close(); a.cancel(); };
      const late = setTimeout(done, 400);
      a.finished.then(done, done);
    },
  };

  reduced.addEventListener("change", startField);
  document.addEventListener("visibilitychange", startField);
  let resize = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(startField); });
  document.querySelectorAll(".bar, main > section.card, .stat").forEach((el, n) => enter(el, Math.min(n * 45, 300)));
})();
