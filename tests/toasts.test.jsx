// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, setMotionPreference, settleMotion } from "../src/components/motion/runtime.js";
import { useMotionRoot } from "../src/components/motion/hooks.js";
import { Toasts } from "../src/components/Toasts.jsx";
import { clearToasts, leaveToasts, showToast, toasts, undoToast } from "../src/lib/toast.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
function Surface({ mode = "full", children }) {
  const ref = useRef(null);
  useMotionRoot(ref, mode);
  return <div className="nv-root" ref={ref}>{children}</div>;
}
const render = async (ui) => { await act(async () => root.render(ui)); };
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  setMotionPreference("full");
  clearToasts();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearToasts(); settleMotion(); gsap.globalTimeline.clear(); vi.unstubAllGlobals();
});

/* the one clock per toast: a GSAP tween whose onComplete dismisses it */
const clocks = () => gsap.globalTimeline.getChildren(false, true, false).filter((t) => t.data === "toast-clock");
const toastEl = () => host.querySelector(".nv-toast-layer:not(.nv-toast-under) [data-noswipe]");
/* let the slide-out finish */
const settle = () => act(() => { gsap.globalTimeline.time(gsap.globalTimeline.time() + 2); });
const arc = () => toastEl().querySelector("circle[stroke-dasharray]");
function gesture(el, points, { up = "pointerup" } = {}) {
  const fire = (type, [x, y]) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, pointerId: 3, button: 0 });
    el.dispatchEvent(e);
  };
  act(() => {
    fire("pointerdown", points[0]);
    for (const p of points.slice(1)) fire("pointermove", p);
    if (up) fire(up, points.at(-1));
  });
}

describe("toast countdown", () => {
  it("dismisses after its ms, from the same clock that drains the ring", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { showToast("Saved", { ms: 4000 }); });
    const [clock] = clocks();
    expect(clock.duration()).toBe(4);
    act(() => { clock.progress(.5); });
    expect(Number(arc().getAttribute("stroke-dashoffset"))).toBeCloseTo(Math.PI * 8, 3);
    expect(toasts.get()).toHaveLength(1);
    expect(toastEl().parentElement.style.opacity).toBe(String(1 - .6 * .5));
    act(() => { clock.progress(1); });
    expect(clocks()).toHaveLength(0);
    settle();
    expect(toasts.get()).toHaveLength(0);
  });

  it("pauses while held and resumes on release", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { showToast("Held"); });
    const [clock] = clocks();
    expect(clock.duration()).toBe(6);
    gesture(toastEl(), [[100, 500]], { up: null });
    expect(clock.paused()).toBe(true);
    act(() => { clock.progress(.4); });
    expect(clock.progress()).toBeCloseTo(.4);
    const e = new Event("pointerup", { bubbles: true }); Object.assign(e, { clientX: 100, clientY: 500, pointerId: 3 });
    act(() => toastEl().dispatchEvent(e));
    expect(clock.paused()).toBe(false);
    expect(toasts.get()).toHaveLength(1);
  });

  it("keeps the ring still in Off and still dismisses on time", async () => {
    setMotionPreference("off");
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { showToast("Quiet"); });
    const [clock] = clocks();
    act(() => { clock.progress(.5); });
    expect(arc().getAttribute("stroke-dashoffset")).toBe("0");
    expect(toastEl().parentElement.style.opacity).toBe("1");
    act(() => { clock.progress(1); });
    expect(toasts.get()).toHaveLength(0);
  });

  it("is not ended early by a change of motion setting", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { showToast("Stay"); });
    act(() => { setMotionPreference("calm"); });
    expect(toasts.get()).toHaveLength(1);
    expect(clocks()[0].progress()).toBeLessThan(1);
  });

  it("runs a clock on an Undo offer too; Undo still works on a tap", async () => {
    const restore = vi.fn();
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { undoToast("Message deleted", restore); });
    expect(clocks()).toHaveLength(1);
    expect(clocks()[0].duration()).toBe(8);
    expect(arc()).not.toBeNull();
    const button = [...toastEl().querySelectorAll("button")].find((b) => b.textContent.includes("Undo"));
    expect(button.className).toContain("nv-btn--ghost");
    gesture(button, [[300, 500], [301, 500]]);
    await act(async () => button.click());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(toasts.get()).toHaveLength(0);
  });

  it("lets an Undo offer expire", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { undoToast("Gone", () => {}); });
    act(() => { clocks()[0].progress(1); });
    settle();
    expect(toasts.get()).toHaveLength(0);
  });
});

describe("the deck", () => {
  const top = () => toastEl().querySelector("p").textContent;
  const under = () => [...host.querySelectorAll(".nv-toast-under")];

  it("piles toasts into one deck, newest on top", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { for (const t of ["a", "b", "c", "d"]) undoToast(t, () => {}); });
    expect(top()).toBe("d");
    expect(under()).toHaveLength(3);
    expect(under().every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(under()[2].style.visibility).toBe("hidden");
    expect([...host.querySelectorAll("button")].some((b) => /more/.test(b.textContent))).toBe(false);
  });

  it("brings the next one forward when the top one goes", async () => {
    setMotionPreference("off");
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { showToast("x"); showToast("y"); });
    gesture(toastEl(), [[200, 500], [200, 490], [202, 440], [204, 360]]);
    expect(top()).toBe("x");
    expect(under()).toHaveLength(0);
  });

  it("draws only the top one while the keyboard is up", async () => {
    document.documentElement.dataset.kb = "1";
    try {
      await render(<Surface><Toasts /></Surface>);
      await act(async () => { showToast("x"); showToast("y"); });
      expect(top()).toBe("y");
      expect(under()[0].style.visibility).toBe("hidden");
    } finally { await act(async () => { delete document.documentElement.dataset.kb; }); }
  });

  it("slides the deck away when the screen changes", async () => {
    await render(<Surface><Toasts scene="create" /></Surface>);
    await act(async () => { showToast("x"); undoToast("y", () => {}); });
    await render(<Surface><Toasts scene="create" /></Surface>);
    expect(toasts.get()).toHaveLength(2);
    await render(<Surface><Toasts scene="history" /></Surface>);
    settle();
    expect(toasts.get()).toHaveLength(0);
  });

  it("leaveToasts marks every toast to go", () => {
    showToast("a"); undoToast("b", () => {});
    leaveToasts();
    expect(toasts.get().every((t) => t.leaving)).toBe(true);
  });
});

describe("swiping a toast away", () => {
  beforeEach(() => setMotionPreference("off"));

  it.each([
    ["left", [[200, 500], [190, 500], [150, 502], [60, 505]]],
    ["right", [[200, 500], [210, 500], [260, 502], [340, 505]]],
    ["up", [[200, 500], [200, 490], [202, 440], [204, 360]]],
  ])("dismisses on a %s swipe", async (_dir, points) => {
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { showToast("Swipe me"); });
    gesture(toastEl(), points);
    expect(toasts.get()).toHaveLength(0);
    expect(clocks()).toHaveLength(0);
  });

  it("sends an Undo offer away on a swipe up", async () => {
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { undoToast("Undo me", () => {}); });
    gesture(toastEl(), [[200, 500], [200, 490], [202, 440], [204, 360]]);
    expect(toasts.get()).toHaveLength(0);
  });

  it("resists a downward drag, springs back, and resumes its clock", async () => {
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { showToast("Stay put"); });
    gesture(toastEl(), [[200, 500], [200, 510], [200, 600], [200, 740]]);
    expect(toasts.get()).toHaveLength(1);
    expect(toastEl().style.transform).toBe("");
    expect(clocks()[0].paused()).toBe(false);
  });

  it("springs back and keeps the toast on a cancelled gesture", async () => {
    await render(<Surface mode="off"><Toasts /></Surface>);
    await act(async () => { showToast("Cancelled"); });
    gesture(toastEl(), [[200, 500], [210, 500], [400, 500]], { up: "pointercancel" });
    expect(toasts.get()).toHaveLength(1);
    expect(clocks()[0].paused()).toBe(false);
  });

  it("keeps data-noswipe and the live region", async () => {
    await render(<Surface><Toasts /></Surface>);
    await act(async () => { showToast("Hello"); });
    expect(toastEl()).not.toBeNull();
    expect(host.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });
});
