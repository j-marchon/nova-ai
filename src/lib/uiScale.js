// One scale for px, rem, icons, sheets and portaled controls.
export const UI_SCALE_MIN = .85;
export const UI_SCALE_MAX = 1.25;
export const normalizeUiScale = value => {
  const number = typeof value === "number" ? value : NaN;
  return Number.isFinite(number) ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, number)) : 1;
};
export const uiScale = () => typeof document === "undefined" ? 1 : normalizeUiScale(Number(document.documentElement.dataset.uiScale || 1));
export const toLayout = value => value / uiScale();
export const layoutViewport = () => ({ width: toLayout(window.innerWidth), height: toLayout(window.innerHeight) });
export function layoutRect(rect) {
  return { top: toLayout(rect.top), left: toLayout(rect.left), width: toLayout(rect.width), height: toLayout(rect.height) };
}
export function applyUiScale(value) {
  const scale = normalizeUiScale(value);
  const root = document.documentElement;
  root.dataset.uiScale = String(scale);
  root.style.setProperty("--nv-ui-scale", String(scale));
  root.style.zoom = String(scale);
  window.dispatchEvent(new Event("nova-ui-scale"));
  return scale;
}
