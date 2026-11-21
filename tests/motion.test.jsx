// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, motionMode, setMotionPreference, settleMotion, shake, tween } from "../src/components/motion/runtime.js";
import { useMotionRoot } from "../src/components/motion/hooks.js";
import { Modal, Toggle } from "../src/components/ui.jsx";
import { MotionList } from "../src/components/motion/MotionList.jsx";
import { MediaCrossfade } from "../src/components/motion/MediaCrossfade.jsx";
import { Disclosure } from "../src/components/motion/Disclosure.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, media, listeners;
function Surface({ mode = "full", children }) {
  const ref = useRef(null);
  useMotionRoot(ref, mode);
  return <div className="nv-root" ref={ref}>{children}</div>;
}
const render = async (ui) => { await act(async () => root.render(ui)); };
beforeEach(() => {
  listeners = new Set();
  media = { matches: false, addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  setMotionPreference("full");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); settleMotion(); gsap.globalTimeline.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("motion policy and lifecycle", () => {
  it("shakes horizontally in Full and settles at its original position", () => {
    const box = document.createElement("div"); host.append(box);
    const animation = shake(box);
    animation.time(.04);
    expect(Math.abs(gsap.getProperty(box, "x"))).toBeGreaterThan(0);
    animation.progress(1);
    expect(box.style.transform).toBe("");
  });
  it("uses only opacity in Calm", () => {
    const box = document.createElement("div"); host.append(box);
    setMotionPreference("calm");
    const animation = shake(box);
    animation.progress(.5);
    expect(gsap.getProperty(box, "x")).toBe(0);
    expect(Number(gsap.getProperty(box, "opacity"))).toBeLessThan(1);
    animation.progress(1);
    expect(box.style.opacity).toBe("");
  });
  it("does nothing in Off or while hidden, and tracks active shakes", () => {
    const box = document.createElement("div"); host.append(box);
    setMotionPreference("off");
    expect(shake(box)).toBeUndefined();
    expect(box.style.transform).toBe("");
    setMotionPreference("full");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    expect(shake(box)).toBeUndefined();
    expect(gsap.getTweensOf(box)).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const animation = shake(box);
    settleMotion();
    expect(animation.progress()).toBe(1);
    expect(gsap.getTweensOf(box)).toHaveLength(0);
  });
  it("rapid disclosure changes leave the final content interactive without exit remnants", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:100,height:40,right:100,bottom:40});
    const section = open => <Surface><Disclosure open={open}><div><input aria-label="Detail" /></div></Disclosure></Surface>;
    await render(section(true)); await render(section(false)); await render(section(true));
    act(() => setMotionPreference("off"));
    expect(host.querySelector('[data-motion-ghost]')).toBeNull();
    expect(host.querySelector('.nv-collapse').dataset.open).toBe("1");
    expect(host.querySelector('input').closest('[inert]')).toBeNull();
  });
  it("scrolling cancels press feedback without activating a control", async () => {
    const run = vi.fn(); await render(<Surface><button onClick={run}>Open</button></Surface>);
    const button = host.querySelector("button");
    act(() => button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 })));
    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 40 })));
    gsap.getTweensOf(button).forEach(t => t.progress(1));
    expect(button.style.transform).toBe(""); expect(run).not.toHaveBeenCalled();
  });
  it("list removal commits immediately, leaves only an inert visual, and settles on Off", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const index = [...(this.parentElement?.children || [])].indexOf(this);
      return { left: 0, top: index * 50, width: 100, height: 40, right: 100, bottom: index * 50 + 40 };
    });
    const items = ids => <Surface><MotionList>{ids.map(id => <button id={`item-${id}`} key={id}>{id}</button>)}</MotionList></Surface>;
    await render(items(["a", "b"])); settleMotion();
    await render(items(["b"]));
    expect(host.querySelector("#item-a")).toBeNull();
    const ghost = host.querySelector('[data-motion-ghost]');
    expect(ghost).not.toBeNull(); expect(ghost.inert).toBe(true); expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.querySelector("[id]")).toBeNull();
    act(() => setMotionPreference("off"));
    expect(host.querySelector('[data-motion-ghost]')).toBeNull();
    expect(host.querySelector("#item-b").parentElement.style.transform).toBe("");
  });
  it("Calm list updates never spatially tween and Off skips exit remnants", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:100,height:40,right:100,bottom:40});
    const items = (mode, ids) => <Surface mode={mode}><MotionList>{ids.map(id => <button key={id}>{id}</button>)}</MotionList></Surface>;
    await render(items("calm", ["a"]));
    for (const t of gsap.getTweensOf(host.querySelector('[data-motion-key]'))) {
      expect(t.duration()).toBeLessThanOrEqual(.1); expect(t.vars.y).toBeUndefined();
    }
    await render(items("off", []));
    expect(host.querySelector('[data-motion-ghost]')).toBeNull();
  });
  it("replacement media waits for load and settles immediately when motion is disabled", async () => {
    const media = src => <Surface><MediaCrossfade identity={src}><img src={src} /></MediaCrossfade></Surface>;
    await render(media("first.png")); await render(media("second.png"));
    expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(host.querySelector('img[src="second.png"]').parentElement.style.opacity).toBe("0");
    await act(async () => host.querySelector('img[src="second.png"]').dispatchEvent(new Event("load")));
    await act(async () => setMotionPreference("off"));
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.querySelector("img").getAttribute("src")).toBe("second.png");
  });
  it("Off applies final state and completes actions immediately", () => {
    const box = document.createElement("div"); host.append(box);
    const done = vi.fn(); setMotionPreference("off");
    const result = tween(box, { opacity: 0, x: 20, duration: 10, onComplete: done });
    expect(result).toBeNull(); expect(done).toHaveBeenCalledTimes(1); expect(box.style.opacity).toBe("0");
    expect(gsap.getTweensOf(box)).toHaveLength(0);
  });
  it("switching to Off completes a pending exit once", () => {
    const box = document.createElement("div"); host.append(box); const done = vi.fn();
    tween(box, { opacity: 0, duration: 10, onComplete: done });
    setMotionPreference("off"); setMotionPreference("off");
    expect(done).toHaveBeenCalledTimes(1); expect(box.style.opacity).toBe("0");
  });
  it("Calm applies spatial changes immediately and caps the fade", () => {
    const box = document.createElement("div"); host.append(box); setMotionPreference("calm");
    const animation = tween(box, { x: 40, opacity: .5, duration: 2, delay: 1 });
    expect(gsap.getProperty(box, "x")).toBe(40); expect(animation.duration()).toBeLessThanOrEqual(.1); expect(animation.delay()).toBe(0);
  });
  it("OS reduced motion caps Full at Calm and never overrides Off", () => {
    media.matches = true; expect(motionMode()).toBe("calm");
    setMotionPreference("off"); expect(motionMode()).toBe("off");
  });
  it("hidden documents finish actions without waiting for a frame", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const done = vi.fn(); const box = document.createElement("div"); host.append(box);
    expect(tween(box, { opacity: 0, duration: 2, onComplete: done })).toBeNull(); expect(done).toHaveBeenCalledTimes(1);
  });
  it("loaders stop on live reduced-motion changes and restart on Full", async () => {
    await render(<Surface><span className="nv-spin" /></Surface>);
    expect(motionMode()).toBe("full"); expect(document.visibilityState).toBe("visible");
    const spinner = host.querySelector(".nv-spin"); expect(gsap.getTweensOf(spinner)).toHaveLength(1);
    media.matches = true; act(() => listeners.forEach(f => f()));
    expect(gsap.getTweensOf(spinner)).toHaveLength(0);
    media.matches = false; act(() => listeners.forEach(f => f()));
    expect(gsap.getTweensOf(spinner)).toHaveLength(1);
    await render(<Surface mode="off"><span className="nv-spin" /></Surface>);
    expect(gsap.getTweensOf(spinner)).toHaveLength(0); expect(spinner.style.opacity).toBe("");
  });
  it("unmount kills repeating effects and document listeners", async () => {
    await render(<Surface><span className="nv-spin" /></Surface>); const spinner = host.querySelector(".nv-spin");
    await render(null); expect(gsap.getTweensOf(spinner)).toHaveLength(0); expect(listeners.size).toBe(0);
  });
  it("mounting a transcript does not animate existing messages", async () => {
    await render(<Surface />);
    await render(<Surface><div className="nv-chat-root"><div id="msg-old" className="nv-bubble">Existing reply</div></div></Surface>);
    expect(gsap.getTweensOf(host.querySelector("#msg-old"))).toHaveLength(0);
  });
  it("nested dialogs close only the top sheet with motion Off", async () => {
    const outer = vi.fn(), inner = vi.fn();
    function Sheets() { return <Surface mode="off"><Modal title="Outer" onClose={outer}><Modal title="Inner" onClose={inner}><button>Inside</button></Modal></Modal></Surface>; }
    await render(<Sheets />);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(inner).toHaveBeenCalledTimes(1); expect(outer).not.toHaveBeenCalled();
  });
  it("keyboard activation animates before a handler stops propagation, without delaying the action", async () => {
    const run = vi.fn();
    await render(<Surface><button onClick={event => { event.stopPropagation(); run(); }}>Save</button></Surface>);
    const button = host.querySelector("button");
    await act(async () => button.click());
    expect(run).toHaveBeenCalledTimes(1); expect(gsap.getTweensOf(button).length).toBeGreaterThan(0);
    act(() => setMotionPreference("off"));
    expect(button.style.transform).toBe(""); expect(gsap.getTweensOf(button)).toHaveLength(0);
  });
  it("cancelled touch presses restore the control and never trigger an action", async () => {
    const run = vi.fn(); await render(<Surface><button onClick={run}>Cancel</button></Surface>);
    const button = host.querySelector("button");
    act(() => button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    gsap.getTweensOf(button).forEach(animation => animation.progress(1));
    expect(gsap.getProperty(button, "scaleX")).toBeLessThan(1);
    act(() => window.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true })));
    gsap.getTweensOf(button).forEach(animation => animation.progress(1));
    expect(button.style.transform).toBe(""); expect(run).not.toHaveBeenCalled();
  });
  it("range changes give subtle feedback while text input creates no per-keystroke animation", async () => {
    await render(<Surface><input type="range" /><textarea /></Surface>);
    const range = host.querySelector("input"), text = host.querySelector("textarea");
    act(() => range.dispatchEvent(new Event("input", { bubbles: true })));
    expect(gsap.getTweensOf(range).length).toBeGreaterThan(0);
    act(() => text.dispatchEvent(new Event("input", { bubbles: true })));
    expect(gsap.getTweensOf(text)).toHaveLength(0);
  });
  it("Calm uses a short fade for actions and Off runs actions without any animation", async () => {
    const run = vi.fn(); await render(<Surface mode="calm"><button onClick={run}>Apply</button></Surface>);
    const button = host.querySelector("button"); await act(async () => button.click());
    expect(button.style.transform).toBe(""); expect(gsap.getTweensOf(button)[0].duration()).toBeLessThanOrEqual(.1);
    await render(<Surface mode="off"><button onClick={run}>Apply</button></Surface>);
    await act(async () => button.click());
    expect(run).toHaveBeenCalledTimes(2); expect(gsap.getTweensOf(button)).toHaveLength(0);
  });

  it("toggles travel and stretch together, and Off leaves only the final position", async () => {
    await render(<Surface><Toggle on={false} /></Surface>);
    await render(<Surface><Toggle on /></Surface>);
    const thumb = host.querySelector(".nv-toggle > span:nth-child(2)");
    const tweens = gsap.getTweensOf(thumb);
    expect(tweens.some(t => "x" in t.vars)).toBe(true); expect(tweens.some(t => "scaleX" in t.vars)).toBe(true);
    act(() => setMotionPreference("off"));
    expect(gsap.getProperty(thumb, "x")).toBe(20); expect(gsap.getProperty(thumb, "scaleX")).toBe(1);
  });

  it("does not animate a touch swipe across a tab, but animates a tap", async () => {
    await render(<Surface><button>Tab</button></Surface>);
    const button = host.querySelector("button");
    const pointer = (type, x) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerType: "touch", clientX: x, clientY: 0, button: 0 }); button.dispatchEvent(event); };
    act(() => { pointer("pointerdown", 0); pointer("pointermove", 50); pointer("pointerup", 50); });
    expect(gsap.getTweensOf(button)).toHaveLength(0);
    expect(document.querySelector('[data-motion-ghost]')).toBeNull();
    act(() => button.click());
    expect(gsap.getTweensOf(button).length).toBeGreaterThan(0);
  });


  it("a list change during a row's entry leaves that row fully shown, not frozen half-faded", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const index = [...(this.parentElement?.children || [])].indexOf(this);
      return { left: 0, top: index * 50, width: 100, height: 40, right: 100, bottom: index * 50 + 40 };
    });
    const items = ids => <Surface><MotionList>{ids.map(id => <button key={id}>{id}</button>)}</MotionList></Surface>;
    await render(items(["a"])); settleMotion();
    await render(items(["a", "b"]));
    const b = host.querySelector('[data-motion-key=".$b"]');
    gsap.getTweensOf(b).forEach(t => t.progress(.3));
    expect(Number(gsap.getProperty(b, "opacity"))).toBeLessThan(1);
    await render(items(["z", "a", "b"]));
    gsap.getTweensOf(b).forEach(t => t.progress(1));
    expect(b.style.opacity).toBe("");
  });
  it("a same-rows re-render neither measures nor tweens", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:100,height:40,right:100,bottom:40});
    const items = ids => <Surface><MotionList>{ids.map(id => <button key={id}>{id}</button>)}</MotionList></Surface>;
    await render(items(["a", "b"]));
    const b = host.querySelector('[data-motion-key=".$b"]');
    const entering = gsap.getTweensOf(b).length;
    rect.mockClear();
    await render(items(["a", "b"]));
    expect(rect).not.toHaveBeenCalled();
    expect(gsap.getTweensOf(b)).toHaveLength(entering);
  });
  it("a row whose child is marked data-arrived is not entered", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:100,height:40,right:100,bottom:40});
    const items = ids => <Surface><MotionList>{ids.map(id => <div key={id} data-arrived={id === "b" ? "" : undefined}>{id}</div>)}</MotionList></Surface>;
    await render(items(["a"])); settleMotion();
    await render(items(["a", "b"]));
    expect(gsap.getTweensOf(host.querySelector('[data-motion-key=".$b"]'))).toHaveLength(0);
  });

});
