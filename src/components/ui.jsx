import { layoutViewport, toLayout } from "../lib/uiScale.js";
import { Children, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { blurSwap, enter, MOTION, motionMode, set, stop, tween } from "./motion/runtime.js";
import { useMotionValue } from "./motion/hooks.js";
import { useSelectionMarker, useWheelScroll } from "./motion/navigation.js";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { Media } from "./media.jsx";
import { SEEN_KEY, modelsSeen } from "../lib/api.js";

/* ============================================================
   basic components
   ============================================================ */

/* Without a picture it is an empty circle, never initials: the name shown
   beside it already says who it is. */
export function Avatar({ src, name, size = "w-12 h-12" }) {
  return (
    <div className={`${size} rounded-full overflow-hidden flex items-center justify-center shrink-0 select-none nv-hair`} style={{ background: "var(--nv-control-base)" }}>
      {/* at most 56px on screen: a 160px copy covers it at any phone density */}
      {src && <Media src={src} alt={name} thumb={160} className="w-full h-full object-cover" />}
    </div>
  );
}

/* A picture where there is one, nothing where there isn't: for the small
   ones sitting next to a name, where even an empty circle is just clutter. */
export const Pic = (p) => (p.src ? <Avatar {...p} /> : null);

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="nv-label block mb-2">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full bg-[var(--nv-control)] border border-[var(--nv-line-strong)] rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none  focus:border-[var(--nv-edge-ink)] ";

export function TextInput(props) {
  return <span className="relative block min-w-0 flex-1"><input {...props} className={inputCls + " " + (props.className || "")} /><span data-focus-indicator="" aria-hidden className="absolute inset-0 pointer-events-none rounded-xl border border-[var(--nv-edge-ink)]" style={{ opacity: 0 }} /></span>;
}

export function TextArea(props) {
  return <span className="relative block min-w-0"><textarea {...props} className={inputCls + " resize-y " + (props.className || "")} /><span data-focus-indicator="" aria-hidden className="absolute inset-0 pointer-events-none rounded-xl border border-[var(--nv-edge-ink)]" style={{ opacity: 0 }} /></span>;
}

/* ---------- buttons ----------

   One button for the whole app, so heights, padding, radius, gaps and the
   icon/label centre line match everywhere. Looks come from the .nv-btn
   classes and --nv-btn-* tokens in index.css; themes swap the --nv-* colours.

   variant: primary (ink fill) | secondary (control fill) | ghost (no fill) |
            icon (square, icon only) | danger
   size:    sm | md | lg  (32 / 40 / 48px tall)
   icon, iconRight: lucide components drawn before / after the label
   selected: the app's inverted state (selStyle + data-inverted="1")
   nudge:   optical x offset in px for the icon (lopsided glyphs)
   Everything else goes to the <button>; className can still add layout
   (w-full, flex-1, px-*). */
const BTN_VARIANTS = { primary: "nv-btn--primary nv-primary", secondary: "nv-btn--secondary", ghost: "nv-btn--ghost", icon: "nv-btn--icon", danger: "nv-btn--danger" };
const BTN_SIZES = { sm: "nv-btn--sm", md: "", lg: "nv-btn--lg" };
/* Runs of text become one trimmed label span ("Show more (" 3 " left)" stays
   one label); elements (icons, badges) pass through untouched. */
function btnLabels(children) {
  const out = [];
  let run = null;
  for (const c of Children.toArray(children)) {
    if (typeof c === "string" || typeof c === "number") {
      if (run) run.push(c);
      else out.push(run = [c]);
    } else { run = null; out.push(c); }
  }
  return out.map((c, i) => (Array.isArray(c) ? <span key={`l${i}`} className="nv-btn-label">{c.join("")}</span> : c));
}

export function btnCls(variant = "secondary", size = "md", className = "") {
  return ["nv-btn", BTN_VARIANTS[variant] || BTN_VARIANTS.secondary, BTN_SIZES[size] || "", className].filter(Boolean).join(" ");
}

export function Button({ variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, selected = false, nudge, className = "", style, children, ...props }) {
  const empty = children == null || children === false || children === "";
  if (import.meta.env?.DEV && empty && !props["aria-label"] && !props["aria-labelledby"] && !props.title) {
    console.warn("Button: an icon-only button needs an aria-label.");
  }
  const s = selected || nudge ? { ...style, ...(nudge ? { "--nv-btn-nudge": `${nudge}px` } : null), ...selStyle(selected) } : style;
  return (
    <button
      {...props}
      data-inverted={selected ? "1" : props["data-inverted"]}
      data-nudge={nudge ? "" : undefined}
      style={s}
      className={btnCls(variant, size, className)}
    >
      {Icon && <SwapIcon icon={Icon} aria-hidden="true" className="nv-btn-icon" />}
      {btnLabels(children)}
      {IconRight && <SwapIcon icon={IconRight} aria-hidden="true" className="nv-btn-icon" />}
    </button>
  );
}

/* An icon that blurs into its replacement when it changes (copy → check,
   play → stop), instead of cutting. The first icon just appears. */
export function SwapIcon({ icon: Icon, ...props }) {
  const ref = useRef(null);
  const was = useRef(Icon);
  useLayoutEffect(() => {
    if (was.current === Icon) return;
    was.current = Icon;
    blurSwap(ref.current);
  }, [Icon]);
  return <Icon ref={ref} {...props} />;
}

/* Solid primary action. */
export function AccBtn(props) {
  return <Button variant="primary" {...props} />;
}

/* Inverted monochrome selection. */
export const selStyle = (on) => on ? { borderColor: "var(--nv-ink)", background: "var(--nv-ink)", color: "var(--nv-bg)", "--acc": "var(--nv-bg)" } : {};

/* ---------- sheets ----------

   Open sheets, newest last. Escape closes only the top one: a sheet opened
   from another (a lorebook from the character form) must not take the one
   underneath, and its unsaved edits, with it.

   A sheet opened from inside another is drawn into the app root rather than
   inside its parent. Inside, it was positioned against the parent's
   scrolling panel (frosted glass makes a containing block), so a picture
   editor opened halfway down a form appeared at the top of the form, off
   screen. */
const openModals = [];
const Dismiss = createContext(null);
const ModalParent = createContext(null);
const modalInert = new Map();

function modalChanged() {
  for (const [el, value] of modalInert) {
    if (value === null) el.removeAttribute("inert");
    else el.setAttribute("inert", value);
  }
  modalInert.clear();
  const target = topModal()?.el?.();
  if (target?.isConnected && target.getAttribute("role") === "dialog") {
    // Keep the sheet's scrim interactive; nested sheets live in separate portals.
    let layer = target.classList.contains("nv-screen") ? target : target.parentElement;
    while (layer && layer !== document.body) {
      for (const sibling of layer.parentElement?.children || []) {
        if (sibling === layer) continue;
        modalInert.set(sibling, sibling.getAttribute("inert"));
        sibling.setAttribute("inert", "");
      }
      layer = layer.parentElement;
    }
  }
  window.dispatchEvent(new Event("nova-modals"));
}

/* The sheet or editor on top, if any; back closes it before anything else.
   Opening or closing one fires "nova-modals" on window. */
export const topModal = () => openModals[openModals.length - 1] || null;

/* A screen with its own navigation joins the same stack: while
   it is on top, hardware back, the back gesture and Escape all go to
   `onBack`, which pops its own page or closes it. `el` is what the
   predictive gesture moves. */
export function useBackLayer(onBack, el) {
  const fns = useRef({});
  fns.current = { onBack, el };
  useEffect(() => {
    const me = {
      screen: true,
      el: () => fns.current.el?.(),
      dismiss: () => fns.current.onBack({ instant: false }),
      close: () => fns.current.onBack({ instant: true }),
    };
    openModals.push(me);
    modalChanged();
    const onKey = (e) => { if (e.key === "Escape" && openModals[openModals.length - 1] === me) fns.current.onBack({}); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
      modalChanged();
    };
  }, []);
}

/* screen: a full-screen page with a top bar instead of a sheet, for the
   bigger editors. action: an optional button on the right of that bar. */
/* `fixed`: one size whatever is in it, for a sheet with tabs, so switching
   tabs never resizes or moves it (the content scrolls inside). */
/* `fill`: a full-screen form that uses a desktop's width (its content lays
   itself out in columns from lg up); otherwise it keeps a reading measure. */
/* `scrimCloses` false: a tap beside the sheet does nothing (the update
   dialog, which a stray tap used to dismiss before it was even read) */
export function Modal({ title, onClose, children, wide = false, screen = false, fill = false, fixed = false, action, scrimCloses = true }) {
  const self = useRef({});
  const previousFocus = useRef(null);
  const parent = useContext(ModalParent);
  const close = useRef(onClose);
  close.current = onClose;
  const [closing, setClosing] = useState(false);
  const dismissing = useRef(false);
  const [nested] = useState(() => !!parent || openModals.length > 0);

  /* Slides out, then closes. `after` runs once it is gone. */
  const dismiss = useRef(null);
  dismiss.current = (after) => {
    if (dismissing.current) return;
    dismissing.current = true;
    const done = () => { close.current?.(); after?.(); };
    const target = screen ? screenRef.current : sheetRef.current;
    setClosing(true);
    const scrim = target?.parentElement?.querySelector(".nv-scrim");
    if (scrim) tween(scrim, { opacity: 0, duration: .2 });
    const desktop = !screen && window.matchMedia?.("(min-width: 640px)")?.matches;
    tween(target, { opacity: 0, y: screen || desktop ? 0 : 64, x: screen ? 40 : 0, scale: desktop ? .92 : screen ? .98 : 1, duration: MOTION.exit, ease: MOTION.leave, onComplete: done });
  };

  useEffect(() => {
    const me = self.current;
    previousFocus.current = document.activeElement;
    /* what back (App.jsx) needs of the sheet on top: its element, to move
       with the gesture, and a way to close it with or without its own
       slide-out */
    me.screen = screen;
    me.el = () => (screen ? screenRef.current : sheetRef.current);
    me.dismiss = () => dismiss.current();
    me.close = () => close.current?.();
    me.parent = parent;
    const under = parent?.el?.();
    if (under) tween(under, { opacity: .6, scale: .96, duration: MOTION.transition });
    const childIndex = openModals.findIndex(entry => entry.parent === me);
    openModals.splice(childIndex < 0 ? openModals.length : childIndex, 0, me);
    modalChanged();
    const onKey = (e) => e.key === "Escape" && openModals[openModals.length - 1] === me && dismiss.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (under?.isConnected) tween(under, { opacity: 1, scale: 1, duration: MOTION.transition, ease: "expo.out", clearProps: "opacity,transform" });
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
      modalChanged();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shut = () => dismiss.current();
  const c = closing ? "1" : undefined;

  /* ---- sheet, full screen ----
     A sheet opens as tall as its content needs, up to just short of the
     top of the screen. Dragging its handle up
     follows the finger and lets go into a full screen; dragging down from
     there folds it back, and dragging down from the half sheet closes it.
     The sheet's size is written straight onto the element while the finger
     moves, so a drag is not a React render per frame. */
  const [full, setFull] = useState(false);
  const sheetRef = useRef(null);
  const g = useRef(null);
  /* the height the sheet sits at when it is not full: its handle plus its
     content, capped by the CSS max-height (the top margin, 3rem) */
  const restHeight = (el, vh) => {
    const handle = el.firstElementChild?.offsetHeight || 0;
    const content = el.querySelector(".nv-sheet-body")?.scrollHeight || 0;
    const top = parseFloat(getComputedStyle(el.parentElement).paddingTop) || 0;
    /* a fixed sheet folds back to its own size (.nv-sheet[data-fixed]) */
    if (fixed) return Math.min(vh - top - 48, window.matchMedia?.("(min-width: 640px)")?.matches ? Math.min(vh * .8, 680) : vh * .88);
    return Math.min(vh - top - 48, handle + content);
  };
  const settleSheet = (el, styles, ms, then) => {
    // Height follows the finger natively; settling uses a compositor transform.
    const from = toLayout(el.getBoundingClientRect().height);
    if (styles.height) { el.style.height = styles.height; }
    const to = toLayout(el.getBoundingClientRect().height);
    if (styles.transform) {
      tween(el, { yPercent: 100, duration: ms / 1000, onComplete: () => { set(el, { clearProps: "height,maxHeight,transform" }); then?.(); } });
    } else {
      if (from && to && from !== to && motionMode() === "full") set(el, { scaleY: from / to, transformOrigin: "bottom" });
      tween(el, { scaleY: 1, y: 0, duration: ms / 1000, onComplete: () => { set(el, { clearProps: "height,maxHeight,transform,transformOrigin" }); then?.(); } });
    }
  };
  /* the gesture itself, shared by the handle (pointer events) and the body
     (touch events, below) */
  const dragStart = (y, t) => {
    const el = sheetRef.current;
    if (!el || dismissing.current) return false;
    g.current = { y: toLayout(y), h0: toLayout(el.getBoundingClientRect().height), vh: layoutViewport().height, dy: 0, t, v: 0, moved: false };
    return true;
  };
  const dragMove = (y, t) => {
    const s = g.current;
    const el = sheetRef.current;
    if (!s || !el) return;
    const dy = toLayout(y) - s.y;
    if (!s.moved && Math.abs(dy) < 4) return;
    s.moved = true;
    const dt = Math.max(1, t - s.t);
    s.v = (dy - s.dy) / dt;
    s.dy = dy;
    s.t = t;
    stop(el);
    if (!full && dy > 0) {
      set(el, { y: dy });
    } else {
      set(el, { clearProps: "transform" });
      el.style.maxHeight = "none";
      el.style.height = `${Math.max(120, Math.min(s.vh, s.h0 - dy))}px`;
    }
  };
  const dragEnd = () => {
    const s = g.current;
    const el = sheetRef.current;
    g.current = null;
    if (!s || !el || !s.moved) return;
    const { dy, v, vh, h0 } = s;
    if (!full) {
      if (dy < -60 || v < -0.5) settleSheet(el, { height: `${vh}px` }, 260, () => setFull(true));
      else if (dy > 90 || v > 0.6) settleSheet(el, { transform: "translateY(100%)" }, 200, () => close.current?.());
      else settleSheet(el, { height: `${h0}px`, transform: "" }, 220);
    } else if (dy > vh * 0.6 || (dy > 120 && v > 1.2)) {
      settleSheet(el, { height: "0px" }, 200, () => close.current?.());
    } else if (dy > 90 || v > 0.5) {
      settleSheet(el, { height: `${restHeight(el, vh)}px` }, 260, () => setFull(false));
    } else {
      settleSheet(el, { height: `${vh}px` }, 220);
    }
  };
  const drag = {
    onPointerDown: (e) => {
      if (e.button > 0 || !dragStart(e.clientY, e.timeStamp)) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => dragMove(e.clientY, e.timeStamp),
    onPointerUp: dragEnd,
    onPointerCancel: dragEnd,
  };

  /* Swipe down anywhere on the sheet, not only its handle, once its content
     is scrolled to the top: the content scrolls as long as it can, and past
     the top the sheet itself follows the finger. Touch events with a
     listener that can say no to scrolling, because the browser cancels
     pointer events the moment it starts a scroll. */
  const dragFns = useRef(null);
  dragFns.current = { dragStart, dragMove, dragEnd };
  useEffect(() => {
    if (screen) return;
    const body = sheetRef.current?.querySelector(".nv-sheet-body");
    if (!body) return;
    let s = null;
    const skip = "input, textarea, select, [contenteditable], [data-noswipe], [role=slider]";
    const start = (e) => {
      s = null;
      if (e.touches.length !== 1 || e.target.closest?.(skip)) return;
      const t = e.touches[0];
      s = { x: t.clientX, y: t.clientY, top: body.scrollTop, on: false };
    };
    const move = (e) => {
      if (!s) return;
      const t = e.touches[0];
      if (!s.on) {
        const dy = t.clientY - s.y;
        const dx = toLayout(t.clientX - s.x);
        /* content that was scrolled, an upward or sideways move: not ours */
        if (s.top > 0 || body.scrollTop > 0 || dy < -4 || Math.abs(dx) > Math.max(8, dy)) { s = null; return; }
        if (dy < 8) return;
        s.on = dragFns.current.dragStart(s.y, e.timeStamp);
        if (!s.on) { s = null; return; }
      }
      if (e.cancelable) e.preventDefault();
      dragFns.current.dragMove(t.clientY, e.timeStamp);
    };
    const end = () => {
      if (s?.on) dragFns.current.dragEnd();
      s = null;
    };
    body.addEventListener("touchstart", start, { passive: true });
    body.addEventListener("touchmove", move, { passive: false });
    body.addEventListener("touchend", end);
    body.addEventListener("touchcancel", end);
    return () => {
      body.removeEventListener("touchstart", start);
      body.removeEventListener("touchmove", move);
      body.removeEventListener("touchend", end);
      body.removeEventListener("touchcancel", end);
    };
  }, [screen]);

  /* A full-screen editor goes back the way Android pages do: a swipe in
     from the left edge slides it off to the right. */
  const screenRef = useRef(null);
  useEffect(() => {
    const el = screenRef.current;
    if (!screen || !el) return;
    let s = null;
    const start = (e) => {
      const t = e.touches[0];
      s = e.touches.length === 1 && t.clientX < 24 ? { x: t.clientX, y: t.clientY, dx: 0, t: e.timeStamp, v: 0, on: false } : null;
    };
    const move = (e) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = toLayout(t.clientX - s.x);
      if (!s.on) {
        if (Math.abs(t.clientY - s.y) > Math.max(10, dx)) { s = null; return; }
        if (dx < 10) return;
        s.on = true;
        stop(el);

      }
      if (e.cancelable) e.preventDefault();
      s.v = (dx - s.dx) / Math.max(1, e.timeStamp - s.t);
      s.dx = dx;
      s.t = e.timeStamp;
      set(el, { x: Math.max(0, dx) });
    };
    const end = () => {
      if (!s?.on) { s = null; return; }
      const go = s.dx > layoutViewport().width / 3 || s.v > 0.6;
      tween(el, { x: go ? layoutViewport().width : 0, duration: .22, onComplete: () => {
        if (go) close.current?.();
        else set(el, { clearProps: "transform" });
      } });
      s = null;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [screen]);

  useEffect(() => {
    const previous = previousFocus.current;
    const target = screen ? screenRef.current : sheetRef.current;
    const focusables = () => [...(target?.querySelectorAll('button,input,textarea,select,a[href],[tabindex],[contenteditable="true"]') || [])].filter(el => {
      const style = getComputedStyle(el);
      return el.tabIndex >= 0 && !el.matches(":disabled") && !el.closest('[hidden],[inert],[aria-hidden="true"]') && style.display !== "none" && style.visibility !== "hidden";
    });
    const focus = () => (focusables()[0] || target)?.focus({ preventScroll: true });
    if (topModal() === self.current) focus();
    const contain = (e) => {
      if (topModal() === self.current && !target?.contains(e.target)) focus();
    };
    const trap = (e) => {
      if (e.key !== "Tab" || topModal() !== self.current) return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); target?.focus({ preventScroll: true }); }
      else if (!items.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? items.at(-1) : items[0]).focus(); }
      else if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", trap);
    document.addEventListener("focusin", contain);
    return () => {
      stop(target);
      document.removeEventListener("keydown", trap);
      document.removeEventListener("focusin", contain);
      if (previous?.isConnected && !previous.closest?.("[inert]") && (!topModal() || topModal().el?.()?.contains(previous))) previous.focus?.({ preventScroll: true });
    };
  }, [screen]);

  const body = screen ? (
    <div ref={screenRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="nv-screen nv-safe-x fixed inset-0 z-50 flex flex-col isolate" data-closing={c} style={{ background: "var(--nv-bg)" }}>

      <div className="shrink-0 z-10" style={{ paddingTop: "var(--sa-t)" }}>
        <div className="nv-hair-b">
          <div className={`${fill ? "max-w-3xl lg:max-w-[1360px] lg:px-8" : "max-w-3xl"} mx-auto flex items-center gap-2 px-3 sm:px-5 h-14`}>
            <Button variant="icon" onClick={shut} className="text-zinc-300 -ml-1" aria-label="Close">
              <ChevronLeft size={22} />
            </Button>
            <h3 className="flex-1 min-w-0 text-[17px] font-semibold tracking-tight text-zinc-100 truncate">{title}</h3>
            {action}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className={`${fill ? "max-w-3xl lg:max-w-[1360px] lg:px-8" : "max-w-3xl"} mx-auto px-4 sm:px-6 pt-5`} style={{ paddingBottom: "calc(2rem + var(--sa-b))" }}>{children}</div>
      </div>
    </div>
  ) : (
    <div className={`nv-kb nv-safe-x fixed inset-0 z-50 flex items-end justify-center ${full ? "" : "sm:items-center"}`} style={full ? undefined : { paddingTop: "var(--sa-t)" }}>
      <div className="nv-scrim nv-fade absolute inset-0" data-closing={c} style={{ background: "var(--nv-scrim)" }} onClick={scrimCloses ? shut : undefined} />
      <div
        ref={sheetRef}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`nv-panel nv-frost nv-sheet relative w-full flex flex-col ${full ? "" : wide ? "max-w-2xl" : "max-w-lg"} overflow-hidden border-b-0 ${full ? "" : "sm:border-b"}`}
        data-closing={c}
        data-full={full ? "1" : undefined}
        data-fixed={fixed ? "1" : undefined}
      >
        {/* The handle and the title are the drag zone: up to fill the
            screen, down to fold back or close. No band of its own colour:
            it is the same glass as the rest of the sheet. */}
        <div
          className="shrink-0 touch-none select-none cursor-grab"
          style={full ? { paddingTop: "var(--sa-t)" } : undefined}
          {...drag}
        >
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="nv-sheet-handle" />
          </div>
          <div className="flex items-center gap-3 pl-5 pr-14 pt-1.5 pb-3 min-h-[44px]">
            <h3 className="text-[17px] font-semibold tracking-tight text-zinc-100 truncate">{title}</h3>
          </div>
        </div>
        {/* hovering close, top right */}
        <Button
          icon={X}
          onClick={shut}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-3 z-20 w-10 px-0 text-zinc-300 hover:text-zinc-100"
          /* no blur of its own: it sits on the sheet's frosted glass already,
             and a second blur over the scrolling body was redone on every
             scroll frame */
          style={{ top: full ? "calc(0.75rem + var(--sa-t))" : "0.75rem" }}
          aria-label="Close"
        />
        <div className="nv-sheet-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div className={`px-5 pt-1 ${full ? "max-w-2xl mx-auto" : ""}`} style={{ paddingBottom: "calc(1.25rem + var(--sa-b))" }}>{children}</div>
        </div>
      </div>
    </div>
  );

  const out = <ModalParent.Provider value={self.current}><Dismiss.Provider value={(after) => dismiss.current(after)}>{body}</Dismiss.Provider></ModalParent.Provider>;
  if (nested && typeof document !== "undefined") {
    return createPortal(out, document.querySelector(".nv-root") || document.body);
  }
  return out;
}

/* ---------- context menus ----------

   Built for a thumb. Common actions are big tiles at the top; the rest sit
   in tall rows below, destructive ones last and set apart. The sheet slides
   away before the action runs.

   actions: [{ icon, label, sub?, run, danger?, primary? }] */
export function ActionMenu({ title, preview, actions, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <MenuBody preview={preview} actions={actions} />
    </Modal>
  );
}

function MenuBody({ preview, actions }) {
  const dismiss = useContext(Dismiss);
  const small = actions.filter((a) => a.compact && !a.danger);
  const tiles = actions.filter((a) => a.primary && !a.compact && !a.danger);
  const rows = actions.filter((a) => !a.primary && !a.compact && !a.danger);
  const danger = actions.filter((a) => a.danger);
  const go = (a) => { a.run?.(); dismiss(); };
  const cols = tiles.length === 1 ? "grid-cols-1" : tiles.length === 4 ? "grid-cols-2 min-[380px]:grid-cols-4" : tiles.length % 3 === 0 ? "grid-cols-3" : "grid-cols-2";
  let i = 0;
  return (
    <>
      {preview && <div className="nv-rise mb-4" style={{ "--i": 0 }}>{preview}</div>}

      {/* the quick ones, small: the same actions sit under the newest message */}
      {small.length > 0 && (
        <div className="grid gap-1.5 mb-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))" }}>
          {small.map((a) => (
            <button
              key={a.label}
              onClick={() => go(a)}
              className="nv-tile flex flex-col items-center justify-center gap-1.5 min-h-[58px] px-1 py-2 rounded-xl nv-glass nv-glass-hover text-zinc-100"
              style={{ "--i": ++i }}
            >
              <a.icon size={16} strokeWidth={1.6} />
              <span className="text-[11px] font-medium leading-tight text-center text-balance">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {tiles.length > 0 && (
        <div className={`grid ${cols} gap-2 mb-2`}>
          {tiles.map((a) => (
            <button
              key={a.label}
              onClick={() => go(a)}
              className="nv-tile nv-ticks relative flex flex-col items-center justify-center gap-2.5 min-h-[88px] px-1.5 py-3 rounded-xl nv-glass nv-glass-hover text-zinc-100"
              style={{ "--i": ++i }}
            >
              <a.icon size={20} strokeWidth={1.5} />
              <span className="text-[13px] font-medium leading-tight text-center text-balance">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-2 nv-hair rounded-xl overflow-hidden">
          {rows.map((a) => <MenuRow key={a.label} a={a} i={++i} onClick={() => go(a)} />)}
        </div>
      )}

      {/* deleting: big and red at the foot, each saying exactly what goes.
          `soft` is the lighter of two (only this one), outlined rather than
          filled. */}
      {danger.length > 0 && (
        <div className="mt-4 grid gap-2">
          {danger.map((a) => (
            <button
              key={a.label}
              onClick={() => go(a)}
              className={`nv-tile nv-danger-btn ${a.soft ? "nv-danger-btn--soft" : ""} w-full flex items-center gap-3.5 min-h-[58px] px-4 py-3 rounded-xl text-left`}
              style={{ "--i": ++i }}
            >
              <a.icon size={19} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-tight">{a.label}</span>
                {a.sub && <span className="block text-xs mt-1 leading-snug opacity-85">{a.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MenuRow({ a, i, onClick }) {
  return (
    <button
      onClick={onClick}
      className="nv-tile nv-row-btn w-full flex items-center gap-3.5 min-h-[56px] px-4 py-2.5 rounded-none text-left hover:bg-[var(--nv-control)]"
      style={{ "--i": i }}
    >
      <a.icon size={18} strokeWidth={1.6} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-medium ${a.danger ? "text-zinc-100" : "text-zinc-100"}`}>{a.label}</p>
        {a.sub && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{a.sub}</p>}
      </div>
      <ChevronRight size={15} className="text-zinc-600 shrink-0" />
    </button>
  );
}

/* a small round glass button over a picture or at the end of a row */
export function MoreBtn({ onClick, label = "More options", className = "", children }) {
  return (
    <Button variant="icon" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} className={className}>
      {children}
    </Button>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="nv-rise flex flex-col items-center justify-center py-16 text-center">
      <div className="nv-ticks nv-hair w-20 h-20 mb-5 rounded-none flex items-center justify-center relative">
        <span aria-hidden className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: "var(--nv-line)" }} />
        <span aria-hidden className="absolute top-1/2 left-0 right-0 h-px" style={{ background: "var(--nv-line)" }} />
        <span className="relative flex items-center justify-center w-9 h-9" style={{ background: "var(--nv-bg)" }}><Icon size={18} strokeWidth={1.5} /></span>
      </div>
      <p className="text-[15px] font-medium text-zinc-200">{title}</p>
      {subtitle && <p className="text-xs text-zinc-500 mt-1.5 max-w-xs leading-relaxed">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* Tap once to arm, tap again to delete. Pass `inverted` on a selected (inverted) row so the icon takes the row's
   background colour instead of vanishing into it. */
export function ConfirmDelete({ label, onConfirm, inverted = false }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 2500);
    return () => clearTimeout(t);
  }, [arm]);
  let style, cls;
  if (inverted) {
    // On an ink-filled row: icon in the page colour; armed flips to a page-coloured chip with ink icon.
    style = arm ? { background: "var(--nv-bg)", color: "var(--nv-ink)" } : { color: "var(--nv-bg)" };
    cls = arm ? "" : INVERTED_ACTION;
  } else {
    style = arm ? selStyle(true) : undefined;
    cls = arm ? "" : "text-zinc-500 hover:text-zinc-200 hover:bg-[var(--nv-control)]";
  }
  return (
    <Button
      type="button"
      variant="icon"
      onClick={(e) => {
        e.stopPropagation();
        if (arm) onConfirm();
        else setArm(true);
      }}
      aria-label={arm ? `Confirm delete ${label}` : `Delete ${label}`}
      aria-pressed={arm}
      data-on={arm ? "1" : undefined}
      style={style}
      className={cls}
      title={arm ? "Tap again to delete" : `Delete ${label}`}
      icon={arm ? Check : Trash2}
    />
  );
}

const INVERTED_ACTION = "hover:bg-[color-mix(in_srgb,var(--nv-bg)_22%,transparent)] active:bg-[color-mix(in_srgb,var(--nv-bg)_34%,transparent)]";

/* A selectable list row (reply styles, and meant for personas / note presets too).
   Tapping the main area picks it. The selected row is the app's inverted state (ink fill, page-coloured text), and the
   optional Edit / Remove buttons are siblings of the pick button (never nested) that switch to the inverted colour
   when selected, so they stay visible in dark and light themes.
   Props: on, onPick, title (node), sub (node, small text under the title), leading (node, e.g. avatar or dot),
   onEdit, onRemove (each shows its button only when given), editLabel / removeLabel (names for aria-labels),
   children (extra content under the sub text inside the pick area), className. */
export function PickRow({ on = false, onPick, title, sub, leading, onEdit, onRemove, editLabel = "item", removeLabel = editLabel, children, className = "" }) {
  return (
    <div
      style={on ? selStyle(true) : undefined}
      data-inverted={on ? "1" : undefined}
      className={`flex items-center gap-1 pr-1 rounded-xl ${on ? "" : "nv-glass nv-glass-hover"} ${className}`}
    >
      <button
        type="button"
        onClick={onPick}
        aria-pressed={on}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left px-3.5 py-3 rounded-xl"
      >
        {leading}
        <span className="flex-1 min-w-0 block">
          <span className="flex items-center gap-2 text-sm" style={{ color: on ? "var(--nv-bg)" : "var(--nv-ink)" }}>{title}</span>
          {sub && <span className="block text-[11px] leading-snug mt-0.5 line-clamp-2" style={{ color: on ? "var(--nv-bg)" : "var(--nv-muted)", opacity: on ? 0.8 : 1 }}>{sub}</span>}
          {children}
        </span>
        {on && <Check size={15} className="shrink-0" aria-hidden="true" />}
      </button>
      {onEdit && (
        <Button
          type="button"
          variant="icon"
          icon={Pencil}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          aria-label={`Edit ${editLabel}`}
          title={`Edit ${editLabel}`}
          style={on ? { color: "var(--nv-bg)" } : undefined}
          className={on ? INVERTED_ACTION : "text-zinc-500 hover:text-zinc-200"}
        />
      )}
      {onRemove && <ConfirmDelete label={removeLabel} onConfirm={onRemove} inverted={on} />}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, fmt = (v) => v }) {
  const p = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="nv-label">{label}</span>
        <span className="text-xs nv-num font-medium text-zinc-100">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="nv-range" style={{ "--p": `${p}%`, accentColor: "var(--acc)" }}
      />
    </div>
  );
}

/* ---------- switches and segmented controls ---------- */

export function Toggle({ on }) {
  const thumb = useRef(null);
  const fill = useRef(null);
  const thumbInk = useRef(null);
  const was = useRef(on);
  useMotionValue(thumb, { x: on ? 20 : 0, duration: .5, ease: "expo.out" }, [on]);
  useMotionValue(fill, { opacity: on ? 1 : 0, duration: .26, ease: MOTION.ease }, [on]);
  useMotionValue(thumbInk, { opacity: on ? 1 : 0, duration: .26, ease: MOTION.ease }, [on]);
  /* the thumb stretches toward where it is going, then snaps round */
  useLayoutEffect(() => {
    if (was.current === on) return;
    was.current = on;
    if (motionMode() !== "full" || !thumb.current) return;
    set(thumb.current, { scaleX: 1.4, scaleY: .85, transformOrigin: on ? "0% 50%" : "100% 50%" });
    tween(thumb.current, { scaleX: 1, scaleY: 1, duration: .55, ease: MOTION.bounce, overwrite: false });
  }, [on]);
  return <span aria-hidden className="nv-toggle nv-hair relative inline-block w-11 h-6 shrink-0 rounded-full overflow-hidden" style={{ boxSizing: "border-box" }}>
    <span ref={fill} className="nv-toggle-fill absolute inset-0 rounded-full" style={{ background: "var(--nv-ink)" }} />
    <span ref={thumb} className="nv-toggle-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full overflow-hidden" style={{ background: "var(--nv-muted)" }}>
      <span ref={thumbInk} className="absolute inset-0 rounded-full" style={{ background: "var(--nv-bg)" }} />
    </span>
  </span>;
}

/* An on/off row. `sub` is for a short state, not an explanation. */
export function ToggleRow({ on, onClick, title, sub, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="nv-hair w-full flex items-center gap-3 px-3.5 py-3 min-h-[56px] rounded-xl hover:bg-[var(--nv-control)] text-left"
    >
      {Icon && <Icon size={17} strokeWidth={1.6} className="shrink-0" style={{ color: on ? "var(--nv-ink)" : "var(--nv-muted)" }} />}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100">{title}</p>
        {sub && <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">{sub}</p>}
      </div>
      <Toggle on={on} />
    </button>
  );
}

/* Scrolling tab row: every tab is as wide as its label; the row scrolls and snaps when it overflows. */
export function ScrollTabs({ children, className = "", value, ...props }) {
  const row = useRef(null);
  useWheelScroll(row);
  /* a [data-selection-marker] child slides to the pressed tab */
  useSelectionMarker(row, value);
  return <nav ref={row} className={`nv-settings-tabs relative ${className}`} data-noswipe {...props}>{children}</nav>;
}

/* Mutually exclusive options with a marker that slides to the chosen one.
   options: [{ id, label, icon? }] */
/* `disabled`: shown but not changeable (the chosen option stays readable,
   the others fade) */
export function Segmented({ options, value, onChange, size = "md", disabled = false, describedBy }) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const tall = size === "lg";
  const marker = useRef(null);
  const was = useRef(idx);
  useMotionValue(marker, { xPercent: idx * 100, duration: .5, ease: "expo.out" }, [idx]);
  /* the marker stretches in its direction of travel and wobbles to rest */
  useLayoutEffect(() => {
    if (was.current === idx) return;
    const right = idx > was.current;
    was.current = idx;
    if (motionMode() !== "full" || !marker.current) return;
    set(marker.current, { scaleX: 1.18, transformOrigin: right ? "0% 50%" : "100% 50%" });
    tween(marker.current, { scaleX: 1, duration: .6, ease: MOTION.bounce, overwrite: false });
  }, [idx]);
  return (
    <div
      className="nv-group relative grid"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      data-disabled={disabled ? "1" : undefined}
      onKeyDown={(event) => {
        if (disabled) return;
        const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!direction && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (idx + direction + options.length) % options.length;
        onChange(options[next].id);
        event.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus();
      }}
    >
      <span
        aria-hidden
        ref={marker}
        className="nv-seg-marker absolute"
        style={{
          top: "var(--nv-group-pad)", bottom: "var(--nv-group-pad)", left: "var(--nv-group-pad)",
          borderRadius: "var(--nv-group-r)",
          width: `calc((100% - 2 * var(--nv-group-pad)) / ${options.length})`,

          background: "var(--nv-ink)",
          boxShadow: "none",
        }}
      />
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            aria-pressed={on}
            data-on={on ? "1" : undefined}
            tabIndex={on ? 0 : -1}
            aria-label={o.aria}
            /* held: the chosen one stays reachable by keyboard (and says
               why through aria-describedby), the others are off */
            disabled={disabled && !on}
            aria-disabled={disabled && on ? true : undefined}
            onClick={() => { if (!disabled) onChange(o.id); }}
            className={`relative z-[1] flex ${tall ? "flex-col gap-1.5 py-3" : "gap-1.5 py-2.5"} items-center justify-center text-xs font-medium min-w-0`}
            style={{ color: on ? "var(--on-acc)" : "var(--color-zinc-400)", ...(disabled && on ? { opacity: 1, cursor: "default" } : {}) }}
          >
            {o.icon && <o.icon size={tall ? 19 : 14} />}
            {o.label && <span className="truncate">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- top bars ----------

   The one bar at the top of each tab: its name, anything that belongs on
   the right, and optionally a row below it (the Settings tabs). No tint of
   its own: it shows the page background, with only the line underneath,
   and scrolls away with the page. */
/* The Nova mark and the title on one line, centred on each other. On a
   wide screen the mark is in the rail instead, and the title sits level
   with it there (see .nv-topbar). */
export function TopBar({ title, right, below }) {
  return (
    <header className="nv-topbar">
      <div className="nv-topbar-row">
        <span className="nv-mark-mobile"><NovaMark size={26} /></span>
        <h1 className="flex-1 min-w-0 nv-title text-zinc-100 overflow-hidden pb-1 -mb-1"><span className="nv-reveal inline-block">{title}</span></h1>
        {right}
      </div>
      {below && <div className="mt-5">{below}</div>}
    </header>
  );
}

/* The Nova mark, drawn in the accent: the white logo is used as a mask over
   the same accent gradient as the buttons, so it follows the theme. */
export function NovaMark({ size = 26 }) {
  const url = `url(${import.meta.env?.BASE_URL || "/"}logo.png)`;
  return (
    <span
      aria-label="Nova"
      role="img"
      className="nv-mark shrink-0 inline-block"
      style={{
        width: size,
        height: size,
        background: "var(--nv-ink)",
        WebkitMaskImage: url, maskImage: url,
        WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
      }}
    />
  );
}

export function SectionHead({ title, icon: Icon, aside, index }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 px-0.5">
      {index && <span className="nv-label nv-label--ink">{index}</span>}
      {Icon && !index && <Icon size={14} strokeWidth={1.6} />}
      <h2 className="nv-label">{title}</h2>
      <span aria-hidden className="nv-kicker-rule nv-draw" />
      {aside}
    </div>
  );
}

/* ---------- skeletons ----------

   The shape of what is loading, in place of a blank screen or a spinner.
   The shimmer is a gradient moved by transform on a layer of its own, so it
   costs no repaints; with motion turned down it holds still. */
export function Skeleton({ className = "", style }) {
  return <div aria-hidden className={`nv-skel ${className}`} style={style}><span className="nv-skel-bar" /></div>;
}

/* A page that has not loaded yet: a title and a few cards. */
export function PageSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "calc(1.25rem + var(--sa-t))" }} aria-busy="true">
      <Skeleton className="h-7 w-32 rounded-xl mb-6" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl mb-3" />
      ))}
    </div>
  );
}

/* A chat that has not loaded yet: its header, a few bubbles, the box. */
export function ChatSkeleton() {
  return (
    <div className="nv-safe-x fixed inset-0 z-40 flex flex-col bg-zinc-950" aria-busy="true">
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: "calc(0.75rem + var(--sa-t))" }}>
        <Skeleton className="w-9 h-9 rounded-full" />
        <Skeleton className="h-4 w-28 rounded-lg" />
      </div>
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-5 overflow-hidden">
        {[70, 45, 82, 38, 64].map((w, i) => (
          <Skeleton key={i} className={`h-14 rounded-2xl ${i % 2 ? "ml-auto" : ""}`} style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="px-4 pt-2" style={{ paddingBottom: "calc(0.75rem + var(--sa-b))" }}>
        <Skeleton className="max-w-2xl mx-auto h-[92px] rounded-3xl" />
      </div>
    </div>
  );
}

/* A full-screen editor that has not loaded yet. */
export function ScreenSkeleton() {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--nv-control)]" aria-busy="true">
      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "calc(1rem + var(--sa-t))" }}>
        <Skeleton className="h-6 w-40 rounded-lg mb-6" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl mb-3" />
        ))}
      </div>
    </div>
  );
}

/* The setup marker (Settings, its Model tab): until a provider other than
   Nova Bridge has a key or address, or any provider (the Bridge too) has
   answered with its model list. Re-renders when that first list arrives. */
export function useNeedsSetup(settings) {
  const seen = useModelsSeen();
  return !seen && !(settings?.providers || []).some((p) => p.preset !== "nova-bridge" && (p.preset === "custom" ? !!p.base : !!p.key));
}
function useModelsSeen() {
  const [seen, setSeen] = useState(modelsSeen);
  useEffect(() => {
    if (seen) return;
    const on = () => setSeen(true);
    window.addEventListener(SEEN_KEY, on);
    return () => window.removeEventListener(SEEN_KEY, on);
  }, [seen]);
  return seen;
}
