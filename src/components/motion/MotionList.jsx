import { Children, Component, createRef } from "react";
import { toLayout } from "../../lib/uiScale.js";
import { enter, MOTION, motionMode, onMotionChange, set, stop, tween } from "./runtime.js";

// React's pre-commit snapshot measures the old layout before DOM mutation.
// A dedicated wrapper owns movement; the control inside owns press/drag feedback.
export class MotionList extends Component {
  host = createRef();
  ghosts = new Set();
  componentDidMount() {
    this.unsubscribe = onMotionChange(() => this.clear());
    this.arrive();
  }
  getSnapshotBeforeUpdate(previous) {
    if (previous.children === this.props.children && previous.className === this.props.className && previous.style === this.props.style) return null;
    const keys = Children.toArray(this.props.children).map(child => child.key);
    const was = Children.toArray(previous.children).map(child => child.key);
    /* a plain re-render (same rows in the same order, same box) neither
       measures nor animates, so a row still fading in is never cut short */
    if (previous.className === this.props.className && previous.style === this.props.style && keys.length === was.length && keys.every((k, i) => k === was[i])) return null;
    const host = this.host.current;
    if (!host || motionMode() === "off" || document.hidden || host.querySelector('[data-lifted="1"]')) return null;
    const bounds = host.getBoundingClientRect();
    const nextKeys = new Set(keys);
    const result = new Map();
    for (const el of host.children) {
      if (!el.dataset.motionKey) continue;
      const rect = el.getBoundingClientRect();
      // Only visible items participate; never clone a whole screen or transcript.
      if (!rect.width || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      result.set(el.dataset.motionKey, { rect, left: toLayout(rect.left - bounds.left) + host.scrollLeft, top: toLayout(rect.top - bounds.top) + host.scrollTop, clone: nextKeys.has(el.dataset.motionKey) || el.firstElementChild?.hasAttribute("data-motion-still") ? null : el.cloneNode(true) });
    }
    result.was = new Set(was);
    return result;
  }
  componentDidUpdate(_props, _state, before) { this.arrive(before); }
  clear = () => {
    for (const ghost of this.ghosts) { stop(ghost); ghost.remove(); }
    this.ghosts.clear();
    for (const el of this.host.current?.children || []) { stop(el); set(el, { clearProps: "transform,opacity" }); }
  };
  componentWillUnmount() { this.unsubscribe?.(); this.clear(); }
  arrive(before) {
    const host = this.host.current;
    if (!host || (this.mounted && !before)) return;
    let index = 0;
    for (const el of host.children) {
      if (!el.dataset.motionKey) continue;
      const old = before?.get(el.dataset.motionKey);
      const rect = el.getBoundingClientRect();
      before?.delete(el.dataset.motionKey);
      if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) continue;
      if (!old) {
        if (!before && this.mounted) continue;
        /* a row that was already here (off screen when measured) is settled, not entered */
        if (before?.was?.has(el.dataset.motionKey)) { stop(el); set(el, { clearProps: "transform,opacity" }); continue; }
        /* a row whose content already arrived elsewhere (a streamed card it replaces) shows at once */
        if (el.firstElementChild?.matches("[data-arrived],[data-motion-still]")) continue;
        enter(el, { y: 14, scale: .96, duration: .5, ease: "expo.out", ...this.props.from, delay: Math.min(index++ * MOTION.stagger, MOTION.staggerCap) });
      } else {
        /* an interrupted entry ends fully shown, never frozen half-faded */
        stop(el); set(el, { clearProps: "transform,opacity" });
        /* an item that holds its own place (fixed slots) never slides */
        if (motionMode() !== "full" || el.firstElementChild?.hasAttribute("data-motion-still") || host.querySelector('[data-lifted="1"]')) continue;
        const dest = el.getBoundingClientRect();
        const x = toLayout(old.rect.left - dest.left), y = toLayout(old.rect.top - dest.top);
        if (Math.abs(x) + Math.abs(y) < .5) continue;
        set(el, { x, y });
        tween(el, { x: 0, y: 0, duration: .5, ease: "expo.out", clearProps: "transform" });
      }
    }
    for (const { clone, left, top, rect } of before?.values() || []) {
      if (!clone) continue;
      if (this.ghosts.size >= 12) break;
      clone.removeAttribute("data-motion-key");
      clone.dataset.motionGhost = "1"; clone.inert = true; clone.setAttribute("aria-hidden", "true");
      for (const node of [clone, ...clone.querySelectorAll("[id]")]) node.removeAttribute("id");
      Object.assign(clone.style, { position: "absolute", pointerEvents: "none", margin: "0", left: `${left}px`, top: `${top}px`, width: `${toLayout(rect.width)}px`, height: `${toLayout(rect.height)}px` });
      host.append(clone); this.ghosts.add(clone);
      tween(clone, { opacity: 0, scale: .9, y: -6, duration: MOTION.exit, ease: MOTION.leave, onComplete: () => { clone.remove(); this.ghosts.delete(clone); } });
    }
    this.mounted = true;
  }
  render() {
    const { children, horizontal, style, from: _from, ...props } = this.props;
    return <div {...props} ref={this.host} data-motion-list="" style={{ ...style, position: props.className?.split(" ").includes("fixed") ? "fixed" : "relative" }}>
      {Children.toArray(children).map(child => <div key={child.key} data-motion-key={child.key} style={{ minWidth: 0, ...(horizontal ? { flexShrink: 0 } : {}) }}>{child}</div>)}
    </div>;
  }
}
