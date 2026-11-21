// @vitest-environment jsdom
/* 4A/activity: the activity store and ActivityIsland under stress. StrictMode
   double effects, many concurrent jobs, cancel during a repair, failure then
   retry, Calm/Off motion, and unmounting mid-completion. */
import React, { StrictMode, act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, setMotionPreference, settleMotion } from "../src/components/motion/runtime.js";
import { useMotionRoot } from "../src/components/motion/hooks.js";
import { ActivityIsland } from "../src/components/ActivityIsland.jsx";
import {
  LINGER_MS, PERCENT_MS, activity, cancelActivity, cancelWhere, clearActivity, dismissActivity,
  runActivity, startActivity, takeActivityResult, useActivity,
} from "../src/lib/activity.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
function Surface({ mode = "full", children }) {
  const ref = useRef(null);
  useMotionRoot(ref, mode);
  return <div className="nv-root" ref={ref}>{children}</div>;
}
const render = async (ui) => { await act(async () => root.render(ui)); };
const island = () => host.querySelector(".nv-activity");
const card = () => host.querySelector(".nv-activity-card");
const arc = () => host.querySelector("circle[stroke-dasharray]");
const btn = (sel) => host.querySelector(sel);
const meta = (label = "Character Reply", extra = {}) => ({ kind: "Reply", label, model: "Gemini Flash 3.8", owner: { chatId: "c1" }, ...extra });
const all = () => activity.get();
const tick = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

const motion = (mode) => {
  setMotionPreference(mode);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
};

beforeEach(() => {
  motion("full");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  clearActivity();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear();
  setMotionPreference("full");
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("store edges", () => {
  beforeEach(() => vi.useFakeTimers());

  it("clamps, rounds and ignores non-finite percents", () => {
    const h = startActivity(meta());
    h.progress(NaN); h.progress(Infinity); h.progress("50");
    expect(all()[0].percent).toBeNull();
    h.progress(-20);
    expect(all()[0].percent).toBe(0);
    vi.advanceTimersByTime(PERCENT_MS);
    h.progress(140.4);
    vi.advanceTimersByTime(PERCENT_MS);
    expect(all()[0].percent).toBe(100);
    vi.advanceTimersByTime(PERCENT_MS);
    h.progress(33.6);
    expect(all()[0].percent).toBe(34);
  });

  it("throttles each of many concurrent jobs independently", () => {
    const hs = Array.from({ length: 40 }, (_, i) => startActivity(meta(`Job ${i}`)));
    hs.forEach((h, i) => h.progress(i + 1));
    expect(all().map((j) => j.percent)).toEqual(hs.map((_, i) => i + 1));
    hs.forEach((h) => { h.progress(90); h.progress(91); });
    expect(all().every((j, i) => j.percent === i + 1)).toBe(true);
    vi.advanceTimersByTime(PERCENT_MS);
    expect(all().every((j) => j.percent === 91)).toBe(true);
  });

  it("drops a pending percent when the job finishes or is cancelled first", () => {
    const a = startActivity(meta("a"));
    const b = startActivity(meta("b"));
    a.progress(10); b.progress(10);
    a.progress(60); b.progress(60);
    a.done({ ok: 1 });
    b.cancel();
    vi.advanceTimersByTime(PERCENT_MS * 4);
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ status: "done", percent: 100, result: { ok: 1 } });
  });

  it("ignores done after fail and fail after done", () => {
    const a = startActivity(meta("a"));
    a.fail(new Error("first"));
    a.done({ late: true });
    expect(all()[0]).toMatchObject({ status: "error", error: "first", result: undefined });
    const b = startActivity(meta("b"));
    b.done();
    b.fail(new Error("late"));
    expect(all()[1]).toMatchObject({ status: "done", error: null });
  });

  it("gives a readable error for strings and message-less errors", () => {
    startActivity(meta("a")).fail("Plain text");
    startActivity(meta("b")).fail({});
    startActivity(meta("c")).fail(null);
    expect(all().map((j) => j.error)).toEqual(["Plain text", "Something went wrong", "Something went wrong"]);
  });

  it("cancel during a repair stops later phase, progress and done from resurrecting the job", async () => {
    let second;
    const gate = new Promise((r) => { second = r; });
    const seen = [];
    const run = runActivity(meta("Card Studio · persona", { dedupeKey: "card:personas" }), async (h) => {
      h.phase("Writing the card");
      h.phase("Fixing format…");
      seen.push(h.signal);
      await gate;                       /* the repair call is in flight */
      h.phase("Writing");
      h.progress(80);
      return { name: "late" };
    });
    expect(all()[0].phase).toBe("Fixing format…");
    expect(cancelWhere((j) => j.dedupeKey === "card:personas")).toBe(1);
    expect(seen[0].aborted).toBe(true);
    expect(all()).toHaveLength(0);
    second();
    await expect(run).resolves.toEqual({ name: "late" });
    vi.advanceTimersByTime(LINGER_MS * 2);
    expect(all()).toHaveLength(0);
  });

  it("a cancel during repair that surfaces as AbortError is not shown as a failure", async () => {
    const run = runActivity(meta("repair"), (h) => new Promise((_, reject) => {
      h.phase("Fixing format…");
      h.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    cancelActivity(all()[0].id);
    await expect(run).rejects.toThrow("Aborted");
    expect(all()).toHaveLength(0);
  });

  it("failure then retry with the same dedupe key starts a new job and keeps the old error until dismissed", async () => {
    await expect(runActivity(meta("x", { dedupeKey: "k" }), async () => { throw new Error("Rate limited"); })).rejects.toThrow();
    const failed = all()[0];
    expect(failed.status).toBe("error");
    const retry = startActivity(meta("x", { dedupeKey: "k" }));
    expect(retry.id).not.toBe(failed.id);
    expect(startActivity(meta("x", { dedupeKey: "k" })).id).toBe(retry.id);
    expect(all().map((j) => j.status)).toEqual(["error", "running"]);
    retry.done();
    dismissActivity(failed.id);
    vi.advanceTimersByTime(LINGER_MS);
    expect(all()).toHaveLength(0);
  });

  it("cancelWhere leaves finished and failed jobs alone and returns only running hits", () => {
    const done = startActivity(meta("d", { owner: { chatId: "c1" } }));
    done.done({ keep: 1 });
    startActivity(meta("e", { owner: { chatId: "c1" } })).fail(new Error("x"));
    const run = Array.from({ length: 5 }, (_, i) => startActivity(meta(`r${i}`, { owner: { chatId: i % 2 ? "c1" : "c2" } })));
    expect(cancelWhere((j) => j.owner.chatId === "c1")).toBe(2);
    expect(run.map((h) => h.signal.aborted)).toEqual([false, true, false, true, false]);
    expect(all().map((j) => j.label)).toEqual(["d", "e", "r0", "r2", "r4"]);
    expect(cancelActivity(done.id)).toBe(false);
    expect(takeActivityResult("missing")).toBeUndefined();
  });

  it("clearActivity cancels linger and throttle timers", () => {
    const fn = vi.fn();
    const off = activity.subscribe(fn);
    const h = startActivity(meta());
    h.progress(1); h.progress(2);
    startActivity(meta("b")).done();
    clearActivity();
    fn.mockClear();
    vi.advanceTimersByTime(LINGER_MS * 2);
    expect(fn).not.toHaveBeenCalled();
    expect(all()).toEqual([]);
    off();
  });
});

describe("StrictMode", () => {
  it("renders one island and one job row under double effects", async () => {
    await render(<StrictMode><Surface><ActivityIsland /></Surface></StrictMode>);
    let h;
    await act(async () => { h = startActivity(meta()); h.progress(30); });
    expect(host.querySelectorAll(".nv-activity")).toHaveLength(1);
    expect(host.textContent.match(/30%/g)).toHaveLength(1);
    expect(all()).toHaveLength(1);
  });

  it("completion still finishes and hides the pill after StrictMode re-runs the effect", async () => {
    await render(<StrictMode><Surface><ActivityIsland /></Surface></StrictMode>);
    await act(async () => { startActivity(meta()).done(); });
    expect(host.textContent).toContain("Done");
    await act(async () => { settleMotion(); });
    expect(island()).toBeNull();
  });

  it("the error shake runs once and is cleaned up after StrictMode cleanup", async () => {
    await render(<StrictMode><Surface><ActivityIsland /></Surface></StrictMode>);
    await act(async () => { startActivity(meta()).fail(new Error("Failed")); });
    const el = card();
    const timelines = gsap.globalTimeline.getChildren(false, false, true).filter((t) => t.getChildren?.().some((c) => c.targets?.().includes(el)));
    expect(timelines).toHaveLength(1);
    await render(null);
    expect(gsap.getTweensOf(el)).toHaveLength(0);
    expect(el.style.transform).toBe("");
  });

  it("useActivity unsubscribes on StrictMode unmount", async () => {
    const renders = vi.fn();
    function Count() { const n = useActivity((list) => list.length); renders(n); return <span>{n}</span>; }
    await render(<StrictMode><Count /></StrictMode>);
    await act(async () => { startActivity(meta()); });
    expect(host.textContent).toBe("1");
    await render(null);
    renders.mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { startActivity(meta("b")); clearActivity(); });
    expect(renders).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("many concurrent jobs in the island", () => {
  it("shows the newest of fifty with +49, lists all, and cancels the right row", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    let hs;
    await act(async () => { hs = Array.from({ length: 50 }, (_, i) => startActivity(meta(`Job ${i}`))); });
    expect(host.textContent).toContain("+49");
    expect(host.textContent).toContain("Job 49");
    await act(async () => btn("button[aria-expanded]").click());
    const rows = [...host.querySelectorAll("li")];
    expect(rows).toHaveLength(50);
    expect(rows[0].textContent).toContain("Job 49");
    const row = rows.find((r) => r.textContent.includes("Job 17"));
    await act(async () => row.querySelector('[aria-label^="Cancel"]').click());
    expect(hs[17].signal.aborted).toBe(true);
    expect(hs.filter((h) => h.signal.aborted)).toHaveLength(1);
    expect(host.querySelectorAll("li")).toHaveLength(49);
    expect(host.textContent).toContain("+48");
  });

  it("collapses the list when only one job is left", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    let a;
    await act(async () => { a = startActivity(meta("A")); startActivity(meta("B")); });
    await act(async () => btn("button[aria-expanded]").click());
    expect(host.querySelector("ul")).not.toBeNull();
    await act(async () => { cancelActivity(all().at(-1).id); });
    expect(host.querySelector("ul")).toBeNull();
    expect(btn("button[aria-expanded]")).toBeNull();
    expect(host.textContent).toContain("A");
    expect(a.signal.aborted).toBe(false);
  });

  it("an older job finishing does not animate the newest pill and leaves after the linger", async () => {
    vi.useFakeTimers();
    await render(<Surface><ActivityIsland /></Surface>);
    let old;
    await act(async () => { old = startActivity(meta("Old")); startActivity(meta("New")); });
    await act(async () => { old.done(); });
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
    expect(host.textContent).toContain("+1");
    await tick(LINGER_MS + 10);
    expect(host.textContent).not.toContain("+1");
    expect(host.textContent).toContain("New");
  });

  it("failure then retry shows the running retry on top with the error below until dismissed", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta("Card", { dedupeKey: "card:x" })).fail(new Error("Rate limited")); });
    await act(async () => { startActivity(meta("Card", { dedupeKey: "card:x" })).progress(20); });
    expect(host.textContent).toContain("20%");
    expect(host.textContent).toContain("+1");
    await act(async () => btn("button[aria-expanded]").click());
    const errRow = [...host.querySelectorAll("li")].find((r) => r.textContent.includes("Rate limited"));
    await act(async () => errRow.querySelector('[aria-label^="Dismiss"]').click());
    expect(host.textContent).not.toContain("Rate limited");
    expect(host.textContent).not.toContain("+1");
    expect(all().map((j) => j.status)).toEqual(["running"]);
  });
});

describe("Calm and Off motion", () => {
  it.each(["calm", "off"])("%s updates the ring with set, not a tween", async (mode) => {
    vi.useFakeTimers();
    motion(mode);
    await render(<Surface mode={mode}><ActivityIsland /></Surface>);
    let h;
    await act(async () => { h = startActivity(meta()); h.progress(10); });
    await act(async () => { h.progress(75); vi.advanceTimersByTime(PERCENT_MS); });
    expect(host.textContent).toContain("75%");
    expect(gsap.getTweensOf(arc())).toHaveLength(0);
    const r = 10, c = 2 * Math.PI * r;
    expect(Number(gsap.getProperty(arc(), "strokeDashoffset"))).toBeCloseTo(c * 0.25, 1);
  });

  it("Off shows an error without any shake", async () => {
    motion("off");
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).fail(new Error("Nope")); });
    expect(host.textContent).toContain("Nope");
    expect(gsap.getTweensOf(card())).toHaveLength(0);
  });

  it("Calm shakes by opacity only, never moving the pill", async () => {
    motion("calm");
    await render(<Surface mode="calm"><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).fail(new Error("Nope")); });
    expect(gsap.getTweensOf(card()).length).toBeGreaterThan(0);
    act(() => gsap.globalTimeline.getChildren(false, false, true).forEach((t) => t.time(.05)));
    expect(gsap.getProperty(card(), "x")).toBe(0);
  });

  it("Calm completion fades without a slide or scale and still leaves", async () => {
    motion("calm");
    await render(<Surface mode="calm"><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).done(); });
    act(() => gsap.globalTimeline.getChildren(false, false, true).forEach((t) => t.time(1.3)));
    expect(gsap.getProperty(card(), "y")).toBe(0);
    expect(gsap.getProperty(card(), "scaleX")).toBe(1);
    expect(Number(gsap.getProperty(card(), "opacity"))).toBeLessThan(1);
    await act(async () => { settleMotion(); });
    expect(island()).toBeNull();
  });

  it("Full completion slides up and scales down", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).done(); });
    act(() => gsap.globalTimeline.getChildren(false, false, true).forEach((t) => t.time(1.3)));
    expect(Number(gsap.getProperty(card(), "y"))).toBeLessThan(0);
    expect(Number(gsap.getProperty(card(), "scale"))).toBeLessThan(1);
  });

  it("a hidden tab completes on a timer without a timeline", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).done(); });
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
    await tick(950);
    expect(island()).toBeNull();
  });
});

describe("unmount mid-completion", () => {
  it("Off: unmounting before the hide timer fires leaves no pending state update", async () => {
    vi.useFakeTimers();
    motion("off");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(<Surface mode="off"><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).done(); });
    await render(null);
    await tick(2000);
    expect(error).not.toHaveBeenCalled();
  });

  it("remounting during the linger replays the completion and then leaves", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).done(); });
    act(() => gsap.globalTimeline.getChildren(false, false, true).forEach((t) => t.time(.5)));
    await render(null);
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
    await render(<Surface><ActivityIsland /></Surface>);
    expect(host.textContent).toContain("Done");
    expect(card().style.opacity).not.toBe("0");
    expect(gsap.globalTimeline.getChildren(false, false, true).length).toBeGreaterThan(0);
    await act(async () => { settleMotion(); });
    expect(island()).toBeNull();
  });

  it("a held result survives the island hiding it, so its owner can still take it", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    let h;
    await act(async () => { h = startActivity(meta("Card", { owner: { cardKind: "personas" } })); });
    await act(async () => { h.done({ name: "Draft" }); });
    await act(async () => { settleMotion(); });
    expect(island()).toBeNull();
    await render(null);
    expect(takeActivityResult(h.id)).toEqual({ name: "Draft" });
  });

  it("the moving percent stays outside the live region", async () => {
    await render(<Surface><ActivityIsland /></Surface>);
    await act(async () => { startActivity(meta()).progress(55); });
    const pct = [...host.querySelectorAll("span")].find((s) => s.textContent === "55%");
    expect(pct.closest("[aria-live]")).toBeNull();
    expect(pct.closest('[role="status"]')).toBeNull();
    expect(pct.dataset.motionGhost).toBe("1");
  });
});
