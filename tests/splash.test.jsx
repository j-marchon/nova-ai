// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Splash } from "../src/components/Splash.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

const mount = (props) => {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Splash {...props} />));
  return host.querySelector(".nv-splash");
};

describe("launch splash", () => {
  it("plays its intro, waits for the app, then leaves and ends", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    let el = mount({ ready: false, onDone });
    expect(el.dataset.phase).toBe("intro");
    expect(el.getAttribute("aria-label")).toBe("Loading Nova");
    act(() => vi.advanceTimersByTime(1500));
    expect(el.dataset.phase).toBe("wait"); // still loading: the mark keeps turning
    act(() => root.render(<Splash ready onDone={onDone} />));
    el = host.querySelector(".nv-splash");
    expect(el.dataset.phase).toBe("leave");
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("never cuts the intro short, even when the app is ready at once", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const el = mount({ ready: true, onDone });
    act(() => vi.advanceTimersByTime(1000));
    expect(el.dataset.phase).toBe("intro");
    act(() => vi.advanceTimersByTime(500)); // intro over: it starts to leave
    expect(el.dataset.phase).toBe("leave");
    act(() => vi.advanceTimersByTime(700));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
