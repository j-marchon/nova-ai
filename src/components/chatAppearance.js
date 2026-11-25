import { DEFAULT_THEME, withAlpha } from "../lib/data.js";
import { readableOn } from "../lib/colors.js";

/* a bubble colour picked in Look; anything else is the skin's own */
const picked = (color) => (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : null);

// Shared by the actual chat and backdrop preview. Never fade the text itself.
export function chatAppearance(theme = {}, { hasBackground = false, moving = false } = {}) {
  const saved = Number(theme.bubbleAlpha ?? DEFAULT_THEME.bubbleAlpha);
  const alpha = Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : DEFAULT_THEME.bubbleAlpha;
  const fill = (color, opacity = alpha) => opacity === 0 ? "transparent" : withAlpha(color, opacity);
  const user = picked(theme.userColor), ai = picked(theme.aiColor);
  /* a faint bubble shows the backdrop more than its colour, so the text keeps the page's ink */
  const ink = (color) => (color && alpha >= .5 ? readableOn(color) : "var(--nv-ink)");
  return {
    alpha,
    /* bubble greys (index.css), or a skin's own colours, unless one was picked */
    userBubbleBg: fill(user || "var(--nv-bubble-user)"),
    aiBubbleBg: fill(ai || "var(--nv-bubble-ai)"),
    userBubbleFg: ink(user),
    aiBubbleFg: ink(ai),
    composerBg: fill("var(--nv-surface)"),
    controlBg: fill("var(--nv-control-ink)", alpha * .065),
    composerBlur: hasBackground && !moving && alpha > 0 ? `blur(${(10 * alpha).toFixed(1)}px)` : "none",
    composerBorder: fill("var(--nv-ink)", alpha * .1), bubbleBorder: "transparent", bubbleSheen: "none", glassEdge: "none",
  };
}
