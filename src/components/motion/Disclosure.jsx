import { Component, createRef } from "react";
import { toLayout } from "../../lib/uiScale.js";
import { enter, MOTION, motionMode, onMotionChange, set, stop, tween } from "./runtime.js";

// Geometry commits once; neighboring sections travel with transforms only.
export class Disclosure extends Component {
  host = createRef();
  moving = new Set();
  ghost = null;
  componentDidMount() { this.unsubscribe = onMotionChange(this.clear); }
  clear = () => {
    if (this.ghost) { stop(this.ghost); this.ghost.remove(); this.ghost = null; }
    for (const node of this.moving) { stop(node); set(node, { clearProps: "transform,opacity" }); }
    this.moving.clear();
  };
  componentWillUnmount() { this.unsubscribe?.(); this.clear(); }
  getSnapshotBeforeUpdate(previous) {
    if (previous.open === this.props.open || motionMode() === "off") return null;
    const host = this.host.current;
    const siblings = new Map();
    let branch = host;
    for (let level = 0; level < 2 && branch?.parentElement; level++, branch = branch.parentElement) {
      for (let next = branch.nextElementSibling; next; next = next.nextElementSibling) siblings.set(next, next.getBoundingClientRect());
    }
    const rect = host.getBoundingClientRect();
    return { siblings, clone: !this.props.open && rect.height ? host.firstElementChild?.cloneNode(true) : null, height: toLayout(rect.height) };
  }
  componentDidUpdate(_props, _state, snapshot) {
    if (!snapshot) return;
    this.clear();
    const host = this.host.current;
    if (this.props.open) { this.moving.add(host.firstElementChild); enter(host.firstElementChild, { y: 12, scale: .98 }); }
    else if (snapshot.clone) {
      const ghost = snapshot.clone; this.ghost = ghost;
      ghost.inert = true; ghost.dataset.motionGhost = "1"; ghost.setAttribute("aria-hidden", "true");
      for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
      Object.assign(ghost.style, { position: "absolute", inset: "0 0 auto", height: `${snapshot.height}px`, pointerEvents: "none" });
      host.append(ghost);
      tween(ghost, { opacity: 0, y: -8, duration: MOTION.exit, ease: MOTION.leave, onComplete: () => { ghost.remove(); if (this.ghost === ghost) this.ghost = null; } });
    }
    if (motionMode() !== "full") return;
    for (const [node, before] of snapshot.siblings) {
      const after = node.getBoundingClientRect();
      const y = toLayout(before.top - after.top);
      if (!y || !after.width || after.bottom < 0 || after.top > innerHeight) continue;
      this.moving.add(node); set(node, { y });
      tween(node, { y: 0, duration: .5, ease: "expo.out", clearProps: "transform" });
    }
  }
  render() {
    return <div ref={this.host} className="nv-collapse relative" data-motion-disclosure="" data-open={this.props.open ? "1" : "0"}>{this.props.children}</div>;
  }
}
