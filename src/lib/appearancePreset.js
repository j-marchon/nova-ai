import { UI_SCALE_MAX, UI_SCALE_MIN } from "./uiScale.js";

export function readAppearancePreset(text) {
  const raw = JSON.parse(text);
  const ap = raw?.appearance;
  if (raw?.format !== "nova-appearance-1" || Object.keys(raw).length !== 2 || !ap ||
      Object.keys(ap).length !== 5 || !["light", "dark", "auto"].includes(ap.scheme) ||
      !["full", "calm", "off"].includes(ap.motion) || !Number.isFinite(ap.uiScale) ||
      ap.uiScale < UI_SCALE_MIN || ap.uiScale > UI_SCALE_MAX ||
      !["small", "large", "xl"].includes(ap.cardSize) || typeof ap.cardDesc !== "boolean") {
    throw new Error("Choose a Nova appearance preset.");
  }
  return ap;
}
