import { KEYBOARD, keyboardGlide, tween } from "../components/motion/runtime.js";
import { toLayout } from "./uiScale.js";

/* The keyboard slides up over the app; the app is never resized for it
   (adjustNothing in the Android manifest). A WebView resized for the
   keyboard jumps in one step while the keyboard is still sliding, and shows
   black under itself until it catches up.

   --kb is how much of the keyboard overlays the page. Should a WebView be
   resized anyway (a browser, an older Android), only the part still
   overlaying it is counted. All measurements are physical CSS pixels,
   before Nova's UI zoom.

   Everything the keyboard moves rides its curve (KEYBOARD, the motion
   runtime): the chat's dock by a CSS transition (index.css), and here a
   sheet lifted clear of it, which is laid out at its new place at once and
   drawn gliding there from where it was. Listeners hear "nova-kb-will"
   just before --kb changes and "nova-kb" just after. */
export function watchKeyboard() {
  const root = document.documentElement;
  const keyboard = window.Capacitor?.Plugins?.Keyboard;
  const viewport = window.visualViewport;
  let fullHeight = window.innerHeight;
  let nativeHeight = 0;
  let last = -1;
  const set = (height, visible) => {
    const px = Math.round(Math.max(0, height));
    const moving = px !== last;
    const from = Math.max(0, last);
    const lifted = moving ? beforeLift() : null;
    if (moving) window.dispatchEvent(new CustomEvent("nova-kb-will", { detail: { height: px, from } }));
    if (visible) root.dataset.kb = "1";
    else delete root.dataset.kb;
    root.style.setProperty("--kb", `${px}px`);
    if (!moving) return;
    last = px;
    lifted?.(px > from ? KEYBOARD.ms : KEYBOARD.hideMs);
    window.dispatchEvent(new CustomEvent("nova-kb", { detail: { height: px, from } }));
    if (px > from) requestAnimationFrame(() => revealFocused(px));
  };
  const refresh = () => {
    if (keyboard?.addListener) {
      set(nativeHeight - Math.max(0, fullHeight - window.innerHeight), nativeHeight > 0);
    } else if (viewport) {
      const height = window.innerHeight - viewport.height - viewport.offsetTop;
      set(height > 120 ? height : 0, height > 120);
    }
  };
  /* who the keyboard is for: a message edited in place keeps the chat's
     dock down behind the keyboard (index.css). Kept until another field
     takes the focus, so the dock stays down while the keyboard leaves. */
  const focus = (e) => {
    if (!nativeHeight && root.dataset.kb !== "1") fullHeight = window.innerHeight;
    if (e.target?.closest?.(".nv-edit-box")) root.dataset.kbFor = "edit";
    else delete root.dataset.kbFor;
  };
  document.addEventListener("focusin", focus);
  window.addEventListener("resize", refresh);
  viewport?.addEventListener("resize", refresh);
  viewport?.addEventListener("scroll", refresh);
  const handles = keyboard?.addListener ? [
    keyboard.addListener("keyboardWillShow", info => { nativeHeight = info?.keyboardHeight || 0; refresh(); }),
    keyboard.addListener("keyboardDidShow", info => { nativeHeight = info?.keyboardHeight || 0; refresh(); }),
    keyboard.addListener("keyboardWillHide", () => { nativeHeight = 0; refresh(); }),
    keyboard.addListener("keyboardDidHide", () => { nativeHeight = 0; fullHeight = window.innerHeight; refresh(); }),
  ] : [];
  return () => {
    document.removeEventListener("focusin", focus);
    window.removeEventListener("resize", refresh);
    viewport?.removeEventListener("resize", refresh);
    viewport?.removeEventListener("scroll", refresh);
    handles.forEach(handle => Promise.resolve(handle).then(value => value?.remove?.()).catch(() => {}));
    delete root.dataset.kb;
    delete root.dataset.kbFor;
    root.style.removeProperty("--kb");
  };
}

/* Sheets and the phone sit in an .nv-kb frame, padded clear of the
   keyboard. The padding changes at once; what it carries is drawn where it
   was and glides to its new place with the keyboard. Measured before the
   change, glided after it. */
function beforeLift() {
  const frames = document.querySelectorAll(".nv-kb");
  if (!frames.length) return null;
  const moving = [];
  for (const frame of frames) {
    for (const child of frame.children) {
      if (child.classList.contains("nv-scrim")) continue;
      moving.push([child, child.getBoundingClientRect().top]);
    }
  }
  return (ms) => {
    for (const [el, top] of moving) keyboardGlide(el, toLayout(top - el.getBoundingClientRect().top), { add: true, ms });
  };
}

/* A field being typed in, outside the chat (which keeps its own place), is
   brought clear of the keyboard: its scroller glides just far enough, as the
   keyboard comes up. */
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]';
function revealFocused(kb) {
  const el = document.activeElement;
  if (!el?.matches?.(TEXT_FIELD) || el.closest(".nv-chat-root")) return;
  const r = el.getBoundingClientRect();
  const limit = window.innerHeight - kb - 16;
  if (r.bottom <= limit) return;
  let scroller = el.parentElement;
  while (scroller && scroller !== document.body) {
    const overflow = getComputedStyle(scroller).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.body) scroller = document.scrollingElement;
  if (!scroller) return;
  /* a field taller than the room left keeps its top in sight */
  const by = Math.min(r.bottom - limit, Math.max(0, r.top - 16 - (scroller === document.scrollingElement ? 0 : Math.max(0, scroller.getBoundingClientRect().top))));
  if (by <= 0) return;
  tween(scroller, { scrollTop: scroller.scrollTop + toLayout(by), duration: KEYBOARD.ms / 1000, ease: "power3.out" });
}

/* When the list's own height changes (the message box growing a line, the
   Scope strip appearing), the view stays where it is: what you were reading
   does not move. Only a reader already at the very end is kept there, the
   way a messaging app keeps the newest line in sight. No React updates.

   The keyboard does not change the list's height: the dock rides up over
   its end, and the list gets that much more room at its end (index.css).
   What was just above the message box rises with it, as in any messaging
   app, so nothing you were reading ends up under the box; the top of the
   view moves out instead. When the keyboard goes, the view comes back down
   by as much. Either way the list is scrolled at once and its content
   glides there on the keyboard's curve. A message edited in place centres
   itself as the keyboard comes up (EditableBubble), so the list leaves that
   alone, and only clears up after it when the keyboard goes. */
export function anchorTranscript(element) {
  if (typeof ResizeObserver === "undefined") return () => {};
  let height = element.clientHeight;
  const gap = () => element.scrollHeight - element.scrollTop - element.clientHeight;
  let atEnd = gap() < 4;
  let before = null;
  /* how far the keyboard has carried the view up, to bring it back down */
  let raised = 0;
  const remember = () => {
    // Ignore a browser clamp caused by resizing until the observer handles it.
    if (element.clientHeight === height && !before) atEnd = gap() < 4;
  };
  const observer = new ResizeObserver(() => {
    const nextHeight = element.clientHeight;
    if (nextHeight === height) return;
    height = nextHeight;
    if (atEnd) element.scrollTop = element.scrollHeight;
  });
  const room = () => Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
  const editing = () => !!element.querySelector(".nv-edit-box");
  const will = (e) => {
    if (editing() && e.detail.height > e.detail.from) { before = null; raised = 0; return; }
    before = { top: element.scrollTop, room: room(), atEnd: gap() < 4 };
  };
  const moved = (e) => {
    const was = before;
    before = null;
    if (!was) return;
    const up = e.detail.height > e.detail.from;
    const grew = room() - was.room;
    let top;
    if (up) { top = was.atEnd ? element.scrollHeight - element.clientHeight : was.top + grew; raised += grew; }
    else if (e.detail.height > 0) { top = was.top + grew; raised = Math.max(0, raised + grew); }
    else { top = was.top - raised; raised = 0; }
    element.scrollTop = top;
    atEnd = gap() < 4;
    keyboardGlide(element.firstElementChild, element.scrollTop - was.top, { ms: up ? KEYBOARD.ms : KEYBOARD.hideMs });
  };
  element.addEventListener("scroll", remember, { passive: true });
  window.addEventListener("nova-kb-will", will);
  window.addEventListener("nova-kb", moved);
  observer.observe(element);
  return () => {
    observer.disconnect();
    element.removeEventListener("scroll", remember);
    window.removeEventListener("nova-kb-will", will);
    window.removeEventListener("nova-kb", moved);
  };
}
