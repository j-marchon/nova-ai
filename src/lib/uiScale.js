// One scale for px, rem, icons, sheets and portaled controls.
/* The slider's 100%: the desktop app reads best a size up from the web's
   (a phone keeps its own, as Android already sizes it for the hand). */
export const UI_BASE = typeof window !== "undefined" && window.novaDesktop ? 1.25 : 1;
export const UI_SCALE_MIN = .7;
export const UI_SCALE_MAX = 1.3;
const clampTo = (min, max) => value => {
  const number = typeof value === "number" ? value : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 1;
};
export const normalizeUiScale = clampTo(UI_SCALE_MIN, UI_SCALE_MAX);
/* Chat bubble size (Look): the text in chat bubbles, on top of UI size */
export const BUBBLE_SCALE_MIN = .8;
export const BUBBLE_SCALE_MAX = 1.5;
export const normalizeBubbleScale = clampTo(BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX);
/* the scale the page is drawn at: the slider times UI_BASE */
export const uiScale = () => typeof document === "undefined" ? 1 : Number(document.documentElement.dataset.uiScale) || 1;
export const toLayout = value => value / uiScale();
export const layoutViewport = () => ({ width: toLayout(window.innerWidth), height: toLayout(window.innerHeight) });
export function layoutRect(rect) {
  return { top: toLayout(rect.top), left: toLayout(rect.left), width: toLayout(rect.width), height: toLayout(rect.height) };
}
export function applyUiScale(value) {
  const scale = normalizeUiScale(value) * UI_BASE;
  const root = document.documentElement;
  root.dataset.uiScale = String(scale);
  root.style.setProperty("--nv-ui-scale", String(scale));
  root.style.zoom = String(scale);
  window.dispatchEvent(new Event("nova-ui-scale"));
  return scale;
}
