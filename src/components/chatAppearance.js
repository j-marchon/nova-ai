import { DEFAULT_THEME, withAlpha } from "../lib/data.js";

// Shared by the actual chat and backdrop preview. Never fade the text itself.
export function chatAppearance(theme = {}, { hasBackground = false, moving = false } = {}) {
  const saved = Number(theme.bubbleAlpha ?? DEFAULT_THEME.bubbleAlpha);
  const alpha = Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : DEFAULT_THEME.bubbleAlpha;
  const fill = (color, opacity = alpha) => opacity === 0 ? "transparent" : withAlpha(color, opacity);
  return {
    alpha,
    /* bubble greys (index.css), or a skin's own colours */
    userBubbleBg: fill("var(--nv-bubble-user)"),
    aiBubbleBg: fill("var(--nv-bubble-ai)"),
    userBubbleFg: "var(--nv-ink)",
    aiBubbleFg: "var(--nv-ink)",
    composerBg: fill("var(--nv-surface)"),
    controlBg: fill("var(--nv-control-ink)", alpha * .065),
    composerBlur: hasBackground && !moving && alpha > 0 ? `blur(${(10 * alpha).toFixed(1)}px)` : "none",
    composerBorder: fill("var(--nv-ink)", alpha * .1), bubbleBorder: "transparent", bubbleSheen: "none", glassEdge: "none",
  };
}
