import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activity, activityModelLabel, cancelActivity, cancelWhere, clearActivity, dismissActivity, runActivity, startActivity, takeActivityResult } from "../src/lib/activity.js";
import { modelLabel } from "../src/components/models.jsx";

beforeEach(() => { vi.useFakeTimers(); clearActivity(); });
afterEach(() => { clearActivity(); vi.useRealTimers(); });
const first = () => activity.get()[0];

describe("activity store", () => {
  it("runs start, progress, done", () => {
    const h = startActivity({ kind: "Reply", label: "Character Reply", model: "Gemini Flash", owner: { chatId: "c1" } });
    expect(first()).toMatchObject({ status: "running", percent: null, kind: "Reply", owner: { chatId: "c1" } });
    h.phase("Thinking"); h.progress(40);
    expect(first()).toMatchObject({ phase: "Thinking", percent: 40 });
    h.done();
    expect(first()).toMatchObject({ status: "done", percent: 100 });
    vi.advanceTimersByTime(2600);
    expect(activity.get()).toHaveLength(0);
  });

  it("keeps a failure until dismissed", () => {
    const h = startActivity({ kind: "reply", label: "x" });
    h.fail(new Error("boom"));
    vi.advanceTimersByTime(10000);
    expect(first()).toMatchObject({ status: "error", error: "boom" });
    dismissActivity(first().id);
    expect(activity.get()).toHaveLength(0);
  });

  it("marks jobs quiet unless they are chat replies or Card Studio, and keeps quiet jobs usable", () => {
    const quietOf = (meta) => { const { id } = startActivity(meta); return activity.get().find(j => j.id === id).quiet; };
    expect(quietOf({ kind: "reply", label: "Character Reply" })).toBe(false);
    expect(quietOf({ kind: "Card Studio · Character" })).toBe(false);
    expect(quietOf({ kind: "Card Studio" })).toBe(false);
    expect(quietOf({})).toBe(true);
    expect(quietOf({ kind: "Model request" })).toBe(true);
    expect(quietOf({ kind: "memory" })).toBe(true);
    expect(quietOf({ kind: "image" })).toBe(true);
    expect(quietOf({ kind: "Reply to post" })).toBe(true);
    expect(quietOf({ kind: "reply", quiet: true })).toBe(true);
    expect(quietOf({ kind: "image", quiet: false })).toBe(false);
    clearActivity();
    const h = startActivity({ kind: "memory", dedupeKey: "memory:c1", quiet: true });
    expect(startActivity({ kind: "memory", dedupeKey: "memory:c1", quiet: true }).id).toBe(h.id);
    expect(cancelWhere(j => j.dedupeKey === "memory:c1")).toBe(1);
    expect(h.signal.aborted).toBe(true);
  });

  it("drops a failed quiet job after its linger, since nothing offers to dismiss it", () => {
    const h = startActivity({ kind: "memory", quiet: true });
    h.fail(new Error("boom"));
    expect(first()).toMatchObject({ status: "error", quiet: true });
    vi.advanceTimersByTime(2600);
    expect(activity.get()).toHaveLength(0);
  });

  it("lets a failure shown on the island go by itself after 30 seconds", () => {
    const h = startActivity({ kind: "reply", label: "Reply" });
    h.fail(new Error("boom"));
    vi.advanceTimersByTime(29000);
    expect(first()).toMatchObject({ status: "error" });
    vi.advanceTimersByTime(1100);
    expect(activity.get()).toHaveLength(0);
  });

  it("treats an abort as a cancel, not an error", () => {
    const h = startActivity({ label: "x" });
    h.cancel();
    expect(h.signal.aborted).toBe(true);
    expect(activity.get()).toHaveLength(0);
    const g = startActivity({ label: "y" });
    g.signal.addEventListener("abort", () => {});
    cancelActivity(g.id);
    g.fail(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(activity.get()).toHaveLength(0);
  });

  it("dedupes a running job by key", () => {
    const a = startActivity({ label: "x", dedupeKey: "k" });
    const b = startActivity({ label: "x", dedupeKey: "k" });
    expect(b.id).toBe(a.id);
    expect(activity.get()).toHaveLength(1);
    a.done();
    expect(startActivity({ label: "x", dedupeKey: "k" }).id).not.toBe(a.id);
  });

  it("cancelWhere aborts only matching running jobs", () => {
    const a = startActivity({ label: "a", owner: { chatId: "1" } });
    const b = startActivity({ label: "b", owner: { chatId: "2" } });
    expect(cancelWhere((j) => j.owner.chatId === "1")).toBe(1);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(activity.get().map((j) => j.id)).toEqual([b.id]);
  });

  it("throttles percent to about four a second and lands on the last value", () => {
    const seen = [];
    const off = activity.subscribe(() => seen.push(first()?.percent));
    const h = startActivity({ label: "x" });
    seen.length = 0;
    for (let i = 1; i <= 20; i++) h.progress(i);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(260);
    expect(first().percent).toBe(20);
    expect(seen).toEqual([1, 20]);
    off();
  });

  it("holds a result until it is taken", () => {
    const h = startActivity({ label: "x" });
    h.done({ text: "hi" });
    vi.advanceTimersByTime(60000);
    expect(first().result).toEqual({ text: "hi" });
    expect(takeActivityResult(first().id)).toEqual({ text: "hi" });
    expect(activity.get()).toHaveLength(0);
  });

  it("keeps the latest pending percent when it returns to the displayed value", () => {
    const h = startActivity({ label: "x" });
    h.progress(10);
    h.progress(20);
    h.progress(10);
    vi.advanceTimersByTime(250);
    expect(first().percent).toBe(10);
  });

  it("retains the runActivity result until consumed", async () => {
    const result = { text: "background draft" };
    await expect(runActivity({ label: "draft" }, async () => result)).resolves.toBe(result);
    const id = first().id;
    vi.advanceTimersByTime(60000);
    expect(first()).toMatchObject({ id, status: "done", result });
    expect(takeActivityResult(id)).toBe(result);
    expect(activity.get()).toHaveLength(0);
  });

  it("runActivity finishes or fails for you and passes the signal", async () => {
    const out = await runActivity({ label: "x" }, async (h) => { expect(h.signal).toBeInstanceOf(AbortSignal); return 7; });
    expect(out).toBe(7);
    expect(first().status).toBe("done");
    await expect(runActivity({ label: "y" }, async () => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(activity.get().at(-1)).toMatchObject({ status: "error", error: "nope" });
  });

  it("names the model the way the picker does", () => {
    expect(modelLabel("google/gemini-flash:free")).toBe("gemini-flash");
    const settings = { providers: [], activeProvider: "x" };
    expect(typeof activityModelLabel(settings, "vendor/some-model:free")).toBe("string");
  });
});
