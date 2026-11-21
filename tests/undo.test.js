import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreList, undoPatch } from "../src/lib/undo.js";
import { TOAST_CAP, clearToasts, dismissToast, showToast, toasts, undoToast } from "../src/lib/toast.js";

const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };

describe("restoreList", () => {
  it("puts a removed item back in its old place", () => {
    expect(restoreList([a, c], [a, b, c], [a, c])).toEqual([a, b, c]);
  });

  it("puts back several removed items, in order", () => {
    expect(restoreList([], [a, b, c], [])).toEqual([a, b, c]);
  });

  it("keeps what was added since, after the restored ones", () => {
    const d = { id: "d" };
    expect(restoreList([a, d], [a, b], [a])).toEqual([a, b, d]);
  });

  it("does not bring back an item removed again since", () => {
    expect(restoreList([c], [a, b, c], [a, c])).toEqual([b, c]);
  });

  it("restores a replaced item unless it has changed again since", () => {
    const b2 = { id: "b", v: 2 }, b3 = { id: "b", v: 3 };
    expect(restoreList([a, b2], [a, b], [a, b2])).toEqual([a, b]);
    expect(restoreList([a, b3], [a, b], [a, b2])).toEqual([a, b3]);
  });

  it("restores the lists a patch touched and leaves the rest", () => {
    const before = { chats: [a, b], characters: [c], ledger: { spent: 1 } };
    const now = { chats: [a], characters: [c], ledger: { spent: 2 } };
    const out = undoPatch(now, before, { chats: [a] });
    expect(out.chats).toEqual([a, b]);
    expect(out.ledger).toEqual({ spent: 2 });
  });
});

describe("toasts", () => {
  beforeEach(() => clearToasts());

  it("keeps every undo offer, and past the cap drops the oldest expiring toast first", () => {
    showToast("one");
    undoToast("two", () => {});
    undoToast("three", () => {});
    for (let i = 0; i < TOAST_CAP - 2; i++) showToast(`plain ${i}`);
    const texts = toasts.get().map((t) => t.text);
    expect(texts).toHaveLength(TOAST_CAP);
    expect(texts).toContain("two");
    expect(texts).toContain("three");
    expect(texts).not.toContain("one");
    expect(texts.at(-1)).toBe(`plain ${TOAST_CAP - 3}`);
  });

  it("drops the oldest undo offer when only offers are left", () => {
    for (let i = 0; i <= TOAST_CAP; i++) undoToast(`u${i}`, () => {});
    const texts = toasts.get().map((t) => t.text);
    expect(texts).toHaveLength(TOAST_CAP);
    expect(texts[0]).toBe("u1");
  });

  it("runs an undo at most once", () => {
    const restore = vi.fn();
    undoToast("deleted", restore);
    const t = toasts.get()[0];
    t.undo();
    t.undo();
    expect(restore).toHaveBeenCalledTimes(1);
    dismissToast(t.id);
    expect(toasts.get()).toEqual([]);
  });
});
