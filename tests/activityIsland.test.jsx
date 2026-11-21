// @vitest-environment jsdom
import React, { StrictMode, act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, setMotionPreference, settleMotion } from "../src/components/motion/runtime.js";
import { useMotionRoot } from "../src/components/motion/hooks.js";
import { ActivityIsland } from "../src/components/ActivityIsland.jsx";
import { LINGER_MS, activity, clearActivity, startActivity, useActivityFocus } from "../src/lib/activity.js";

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
  clearActivity();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const meta = { kind: "Reply", label: "Character Reply", model: "Gemini Flash 3.8", owner: { chatId: "c1" } };
const canOpen = (job) => !!(job.owner?.chatId || job.owner?.worldId);
function Focus({ id, enabled = true }) {
  useActivityFocus(id, enabled);
  return null;
}

describe("generation focus", () => {
  it("hides the focused job, restores it on leave, and hides it on return", async () => {
    let job;
    await act(async () => { job = startActivity(meta); });
    const ui = enabled => <Surface><Focus id={job.id} enabled={enabled}/><ActivityIsland/></Surface>;
    await render(ui(true));
    expect(host.querySelector(".nv-activity")).toBeNull();
    expect(activity.get()).toHaveLength(1);
    expect(job.signal.aborted).toBe(false);
    await render(ui(false));
    expect(host.textContent).toContain(meta.label);
    await render(ui(true));
    expect(host.querySelector(".nv-activity")).toBeNull();
  });

  it("counts only background jobs, including work sharing the focused owner", async () => {
    let job;
    await act(async () => {
      job = startActivity(meta);
      startActivity({ ...meta, kind: "memory", label: "Memory Summary", quiet: true });
      startActivity({ kind: "Card Studio · Character", label: "Card Draft", owner: { cardKind: "characters", itemId: null } });
      startActivity({ ...meta, label: "Other chat", owner: { chatId: "c2" } });
    });
    await render(<Surface><Focus id={job.id}/><ActivityIsland/></Surface>);
    expect(host.textContent).toContain("+1");
    await act(async () => host.querySelector('[aria-expanded]').click());
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(host.textContent).toContain("Card Draft");
    expect(host.textContent).not.toContain("Memory Summary");
    expect(host.textContent).not.toContain(meta.label);
  });

  it("keeps focus until the last consumer leaves, including StrictMode", async () => {
    let job;
    await act(async () => { job = startActivity(meta); });
    const ui = second => <StrictMode><Surface><Focus id={job.id}/>{second && <Focus id={job.id}/>}<ActivityIsland/></Surface></StrictMode>;
    await render(ui(true));
    await render(ui(false));
    expect(host.querySelector(".nv-activity")).toBeNull();
    await render(<Surface><ActivityIsland/></Surface>);
    expect(host.textContent).toContain(meta.label);
  });

  it("retargets focus when switching generations", async () => {
    let a, b;
    await act(async () => { a = startActivity({ ...meta, label: "A" }); b = startActivity({ ...meta, label: "B" }); });
    const ui = id => <Surface><Focus id={id}/><ActivityIsland/></Surface>;
    await render(ui(a.id));
    expect(host.textContent).toContain("· B");
    await render(ui(b.id));
    expect(host.textContent).toContain("· A");
    expect(host.textContent).not.toContain("· B");
  });

  it("shows failures even while focused and preserves dismissal", async () => {
    let job;
    await act(async () => { job = startActivity(meta); });
    await render(<Surface><Focus id={job.id}/><ActivityIsland/></Surface>);
    await act(async () => job.fail(new Error("Rate limited")));
    expect(host.textContent).toContain("Rate limited");
    await act(async () => host.querySelector('[aria-label^="Dismiss"]').click());
    expect(activity.get()).toHaveLength(0);
  });

  it("suppresses completion without consuming held results or extending their linger", async () => {
    vi.useFakeTimers();
    try {
      let job;
      await act(async () => { job = startActivity(meta); });
      await render(<Surface><Focus id={job.id}/><ActivityIsland/></Surface>);
      await act(async () => job.done({ draft: "Keep me" }));
      expect(host.querySelector(".nv-activity")).toBeNull();
      await act(async () => vi.advanceTimersByTime(LINGER_MS + 1));
      await render(<Surface><ActivityIsland/></Surface>);
      expect(host.querySelector(".nv-activity")).toBeNull();
      expect(activity.get()[0].result).toEqual({ draft: "Keep me" });
    } finally { vi.useRealTimers(); }
  });

  it("keeps normal completion expiry and cancellation for focused jobs", async () => {
    vi.useFakeTimers();
    try {
      let job;
      await act(async () => { job = startActivity(meta); });
      await render(<Surface><Focus id={job.id}/><ActivityIsland/></Surface>);
      await act(async () => job.done());
      await act(async () => vi.advanceTimersByTime(LINGER_MS));
      expect(activity.get()).toHaveLength(0);
      await act(async () => { job = startActivity(meta); });
      await render(<Surface><Focus id={job.id}/><ActivityIsland/></Surface>);
      await act(async () => job.cancel());
      expect(job.signal.aborted).toBe(true);
      expect(activity.get()).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("activity island", () => {
  it("renders nothing without jobs, then the label and percent", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    expect(host.querySelector(".nv-activity")).toBeNull();
    let h;
    await act(async () => { h = startActivity(meta); });
    await act(async () => h.progress(42));
    expect(host.textContent).toContain("Gemini Flash 3.8 · Character Reply");
    expect(host.textContent).toContain("42%");
    expect(host.querySelector("span.tabular-nums").dataset.motionGhost).toBe("1");
    expect(host.querySelector("[aria-live]")).not.toBeNull();
    expect(host.querySelector(".nv-activity").className).toContain("z-[70]");
  });

  it("shows a spinner arc while the percent is unknown", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta); });
    expect(host.querySelector("svg.nv-spin")).not.toBeNull();
    expect(host.textContent).not.toContain("%");
  });

  it("collapses several jobs into +N and lists them on tap", async () => {
    const onOpen = vi.fn();
    await render(<Surface><ActivityIsland onOpen={onOpen} canOpen={canOpen} /></Surface>);
    await act(async () => { startActivity({ ...meta, label: "One" }); startActivity({ ...meta, label: "Two", owner: { chatId: "c2" } }); startActivity({ ...meta, label: "Three", owner: {} }); });
    expect(host.textContent).toContain("+2");
    expect(host.textContent).toContain("Three");
    expect(host.querySelector("ul")).toBeNull();
    await act(async () => host.querySelector("button[aria-expanded]").click());
    expect(host.querySelectorAll("li")).toHaveLength(3);
    await act(async () => host.querySelector('li button[aria-label="Open Gemini Flash 3.8 · Two"]').click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ label: "Two" }));
  });

  it("opens the owner of a single job", async () => {
    const onOpen = vi.fn();
    await render(<Surface><ActivityIsland onOpen={onOpen} canOpen={canOpen} /></Surface>);
    await act(async () => { startActivity(meta); });
    await act(async () => host.querySelector(".nv-activity-main").click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ owner: { chatId: "c1" } }));
  });

  it("has no Open action for card jobs in either view, while Cancel still works", async () => {
    const onOpen = vi.fn();
    await render(<Surface><ActivityIsland onOpen={onOpen} canOpen={canOpen} /></Surface>);
    let cardJob;
    await act(async () => { cardJob = startActivity({ ...meta, owner: { cardKind: "character" } }); });
    expect(host.querySelector('[aria-label^="Open "]')).toBeNull();
    expect(host.querySelector('.nv-activity-main').disabled).toBe(true);
    await act(async () => host.querySelector('.nv-activity-main').click());
    await act(async () => { startActivity({ ...meta, label: "World", owner: { worldId: "w1" } }); });
    await act(async () => host.querySelector('button[aria-expanded]').click());
    const cardRow = [...host.querySelectorAll('li')].find(row => row.textContent.includes(meta.label));
    expect(cardRow.querySelector('[aria-label^="Open "]')).toBeNull();
    expect(cardRow.querySelector('.nv-activity-main').disabled).toBe(true);
    await act(async () => host.querySelector('li [aria-label^="Open "]').click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ owner: { worldId: "w1" } }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await act(async () => cardRow.querySelector('[aria-label^="Cancel"]').click());
    expect(cardJob.signal.aborted).toBe(true);
    expect(host.querySelector('ul')).toBeNull();
  });

  it("has no Open action without a navigation callback", async () => {
    await render(<Surface><ActivityIsland canOpen={canOpen} /></Surface>);
    await act(async () => { startActivity(meta); });
    expect(host.querySelector('[aria-label^="Open "]')).toBeNull();
    expect(host.querySelector('.nv-activity-main').disabled).toBe(true);
  });

  it("Cancel aborts the job and removes it", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    let h;
    await act(async () => { h = startActivity(meta); });
    await act(async () => host.querySelector('button[aria-label^="Cancel"]').click());
    expect(h.signal.aborted).toBe(true);
    expect(host.querySelector(".nv-activity")).toBeNull();
  });

  it("keeps an error until dismissed", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta).fail(new Error("Rate limited")); });
    expect(host.textContent).toContain("Rate limited");
    await act(async () => host.querySelector('button[aria-label^="Dismiss"]').click());
    expect(host.querySelector(".nv-activity")).toBeNull();
  });

  it("kills the error shake on unmount", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta).fail(new Error("Failed")); });
    const card = host.querySelector(".nv-activity-card");
    const animations = gsap.getTweensOf(card);
    expect(animations.length).toBeGreaterThan(0);
    act(() => gsap.globalTimeline.getChildren(false, false, true).forEach(animation => animation.time(.04)));
    expect(Math.abs(gsap.getProperty(card, "x"))).toBeGreaterThan(0);
    await render(null);
    expect(gsap.getTweensOf(card)).toHaveLength(0);
    expect(card.style.transform).toBe("");
  });

  it("kills the completion timeline on unmount", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta).done(); });
    const before = gsap.globalTimeline.getChildren(false, false, true).length;
    expect(before).toBeGreaterThan(0);
    const card = host.querySelector(".nv-activity-card");
    const icon = host.querySelector(".nv-activity-ring > span");
    act(() => {
      gsap.globalTimeline.getChildren(false, false, true).forEach(tl => tl.time(.1));
    });
    expect(gsap.getTweensOf(icon).length).toBeGreaterThan(0);
    await render(null);
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
    expect(gsap.getTweensOf([card, icon])).toHaveLength(0);
  });

  it("kills progress ring tweens on unmount", async () => {
    vi.useFakeTimers();
    try {
      await render(<Surface><ActivityIsland /></Surface>);
      let h;
      await act(async () => { h = startActivity(meta); h.progress(10); });
      const arc = host.querySelector("circle[stroke-dasharray]");
      await act(async () => { h.progress(60); vi.advanceTimersByTime(250); });
      expect(gsap.getTweensOf(arc).length).toBeGreaterThan(0);
      await render(null);
      expect(gsap.getTweensOf(arc)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves after completing with motion Off", async () => {
    vi.useFakeTimers();
    setMotionPreference("off");
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta).done(); });
    expect(host.textContent).toContain("Done");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(host.querySelector(".nv-activity")).toBeNull();
    vi.useRealTimers();
  });
});

/* a pointer gesture: down at the first point, moves through the rest, up at the last */
function gesture(el, points, { up = "pointerup" } = {}) {
  const fire = (type, [x, y], target = el) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, pointerId: 7, button: 0 });
    target.dispatchEvent(e);
  };
  act(() => {
    fire("pointerdown", points[0]);
    for (const p of points.slice(1)) fire("pointermove", p);
    fire(up, points.at(-1));
  });
}

describe("which jobs the island shows", () => {
  it("lists chat replies and Card Studio jobs, and leaves quiet jobs out, even failed ones", async () => {
    vi.useFakeTimers();
    try {
      let memory, model, image, other;
      await act(async () => {
        memory = startActivity({ ...meta, kind: "memory", label: "Memory Summary", quiet: true });
        model = startActivity({ label: "Some request" });
        image = startActivity({ kind: "image", label: "Image generation" });
        other = startActivity({ kind: "Profile", label: "Profile" });
      });
      await render(<Surface><ActivityIsland /></Surface>);
      expect(host.querySelector(".nv-activity")).toBeNull();
      expect([memory, model, image, other].map(h => activity.get().find(j => j.id === h.id).quiet)).toEqual([true, true, true, true]);
      await act(async () => memory.fail(new Error("Memory broke")));
      expect(host.querySelector(".nv-activity")).toBeNull();
      expect(activity.get().find(j => j.id === memory.id).status).toBe("error");
      await act(async () => { vi.advanceTimersByTime(LINGER_MS + 10); });
      expect(activity.get().find(j => j.id === memory.id)).toBeUndefined();
      expect(model.signal.aborted).toBe(false);

      await act(async () => {
        startActivity({ ...meta, kind: "reply" });
        startActivity({ kind: "Card Studio · Character", label: "Card Draft", owner: { cardKind: "characters", itemId: null } });
      });
      expect(host.textContent).toContain("+1");
      await act(async () => host.querySelector("[aria-expanded]").click());
      expect([...host.querySelectorAll("li")].map(li => li.textContent).join("|")).toMatch(/Card Draft.*\|.*Character Reply/);
      expect(host.textContent).not.toContain("Memory");
      expect(host.textContent).not.toContain("Some request");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a caller opt a job in with quiet: false", async () => {
    await act(async () => { startActivity({ kind: "image", label: "Shown image", quiet: false }); });
    await render(<Surface><ActivityIsland /></Surface>);
    expect(host.textContent).toContain("Shown image");
  });
});

describe("swiping the island away", () => {
  beforeEach(() => setMotionPreference("off"));
  const card = () => host.querySelector(".nv-activity-card");

  it("hides the pill on a sideways swipe without cancelling, and a new job shows again", async () => {
    let h;
    await act(async () => { h = startActivity(meta); });
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    expect(card().hasAttribute("data-noswipe")).toBe(true);
    gesture(card(), [[100, 20], [104, 20], [140, 22], [260, 24]]);
    expect(host.querySelector(".nv-activity")).toBeNull();
    expect(h.signal.aborted).toBe(false);
    expect(activity.get().find(j => j.id === h.id).status).toBe("running");
    await act(async () => { startActivity({ ...meta, label: "Group Reply", owner: { chatId: "c2" } }); });
    expect(host.textContent).toContain("Group Reply");
    expect(host.textContent).not.toContain("+1");
    expect(card().style.opacity).toBe("");
  });

  it("puts every listed job away on an upward swipe of the collapsed pill", async () => {
    const hs = [];
    await act(async () => { for (const id of ["a", "b", "c"]) hs.push(startActivity({ ...meta, owner: { chatId: id } })); });
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    expect(host.textContent).toContain("+2");
    gesture(card(), [[100, 40], [100, 35], [101, 0], [102, -80]]);
    expect(host.querySelector(".nv-activity")).toBeNull();
    expect(hs.every(h => !h.signal.aborted)).toBe(true);
    expect(activity.get()).toHaveLength(3);
  });

  it("resists a downward drag, springs back, and swallows the click that follows it", async () => {
    const onOpen = vi.fn();
    await act(async () => { startActivity(meta); });
    await render(<Surface mode="off"><ActivityIsland onOpen={onOpen} canOpen={canOpen} /></Surface>);
    const main = host.querySelector(".nv-activity-main");
    gesture(main, [[100, 20], [100, 30], [100, 200]]);
    expect(host.querySelector(".nv-activity")).not.toBeNull();
    expect(card().style.transform).toBe("");
    act(() => main.click());
    expect(onOpen).not.toHaveBeenCalled();
    /* a plain tap still opens */
    gesture(main, [[100, 20], [101, 21]]);
    act(() => main.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the X: a press on it is not a drag, and it still cancels", async () => {
    let h;
    await act(async () => { h = startActivity(meta); });
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    const x = host.querySelector('[aria-label^="Cancel"]');
    gesture(x, [[300, 20], [420, 20]]);
    expect(host.querySelector(".nv-activity")).not.toBeNull();
    expect(h.signal.aborted).toBe(false);
    await act(async () => x.click());
    expect(h.signal.aborted).toBe(true);
    expect(activity.get()).toHaveLength(0);
  });

  it("hides a failed job on a swipe and keeps it in the store", async () => {
    let h;
    await act(async () => { h = startActivity(meta); });
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    await act(async () => h.fail(new Error("Rate limited")));
    gesture(card(), [[100, 20], [90, 20], [-40, 20]]);
    expect(host.querySelector(".nv-activity")).toBeNull();
    expect(activity.get().find(j => j.id === h.id).status).toBe("error");
  });
});

describe("the top stack", () => {
  it("puts the island first and the toasts after it, in App's .nv-top", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(`${process.cwd()}/src/App.jsx`, "utf8");
    const top = app.indexOf('className="nv-top"');
    const island = app.indexOf("<ActivityIsland", top);
    const stack = app.indexOf("<Toasts", island);
    expect(top).toBeGreaterThan(-1);
    expect(island).toBeGreaterThan(top);
    expect(stack).toBeGreaterThan(island);
    const { Toasts } = await import("../src/components/Toasts.jsx");
    const { showToast, clearToasts } = await import("../src/lib/toast.js");
    await render(<Surface><div className="nv-top"><ActivityIsland /><Toasts /></div></Surface>);
    await act(async () => { startActivity(meta); showToast("Saved"); });
    const kids = [...host.querySelector(".nv-top").children].map((el) => el.className.split(" ")[0]);
    expect(kids).toEqual(["nv-activity", "nv-toasts"]);
    act(() => clearToasts());
  });
});
