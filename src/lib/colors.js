/* ---------- colour maths ----------

   Everything below hangs off one number: WCAG relative luminance. It decides
   which accents are allowed, what colour text goes on a bubble, and whether a
   custom colour is readable at all. Doing it properly rather than with a
   weighted-RGB eyeball test matters here, because the previous greyscale ramp
   hid the problem: any grey light enough to see was also light enough to read
   on, so a rough test never got caught out. With real hues it does — pure blue
   and pure red have wildly different luminance at the same "brightness". */

export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/* WCAG 2.1 relative luminance. The 0.03928 branch is the sRGB transfer
   function's linear toe; skipping it makes dark colours read as brighter than
   they are, which is exactly the range this app has to judge. */
export function relLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* Contrast ratio between two hex colours, 1 (identical) to 21 (black/white). */
export function contrast(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Pick black or white text for a background, whichever has more contrast. */
export function readableOn(hex) {
  if (!hexToRgb(hex)) return "#fafafa";
  return contrast(hex, "#09090b") >= contrast(hex, "#fafafa") ? "#09090b" : "#fafafa";
}

export const onAccent = readableOn;

/* ---------- accent readability ----------

   The accent is not just a decoration: 11px labels, chip text, the model name
   and the active tab are all painted straight onto the page background with
   it. A dark accent therefore does not look "dark", it looks broken — the text
   disappears. That is the bug being fixed here.

   Rather than banning colour, the rule is a contrast floor against the page.
   ACCENT_MIN is the hard floor: below this the colour cannot be applied at
   all. ACCENT_GOOD is the comfortable bar; between the two the picker warns
   and offers to lift it. 3.0 and 4.5 are the WCAG thresholds for large text /
   UI components and for body text respectively. */
export const ACCENT_MIN = 3.0;

export const ACCENT_GOOD = 4.5;

/* The two page backgrounds an accent has to survive. Checking both means a
   colour stays readable when the theme is flipped to light. */
export const PAGE_DARK = "#09090b";

export const PAGE_LIGHT = "#fafafa";

export function accentContrast(hex, light) {
  return contrast(hex, light ? PAGE_LIGHT : PAGE_DARK);
}

/* Walk a colour toward the readable end until it clears `want`, keeping its
   hue throughout — so "make this readable" turns a navy into a lighter navy,
   never into a different colour.

   Brightness alone is not enough. A fully saturated blue is already at its
   maximum luminance at V=1 and still only reaches 2.3:1 against a near-black
   page, because blue contributes barely 7% of perceived luminance. Left there,
   the picker would simply refuse the entire blue-violet arc of the wheel with
   no way forward, which is not "pick any colour" in any useful sense. So the
   walk has two stages: raise brightness first, and only if that runs out,
   drain saturation toward the pale end of the same hue. */
export function fixContrast(hex, light, want = ACCENT_GOOD) {
  if (!hexToRgb(hex)) return hex;
  if (accentContrast(hex, light) >= want) return hex;
  const { h, s } = hexToHsv(hex);
  let best = hex;
  let bestRatio = accentContrast(hex, light);

  const consider = (cand) => {
    const r = accentContrast(cand, light);
    if (r > bestRatio) { bestRatio = r; best = cand; }
    return r >= want;
  };

  if (light) {
    /* on a light page: darken, and deepen so it does not wash out */
    for (let i = 1; i <= 100; i++) {
      if (consider(hsvToHex(h, Math.min(1, s + i / 250), Math.max(0, 1 - i / 100)))) return best;
    }
    return best;
  }

  /* stage one: brighten at the original saturation */
  for (let i = 1; i <= 100; i++) {
    if (consider(hsvToHex(h, s, Math.min(1, s === 0 ? i / 100 : Math.max(hexToHsv(hex).v, i / 100))))) return best;
  }
  /* stage two: pale it out, still the same hue */
  for (let i = 1; i <= 100; i++) {
    if (consider(hsvToHex(h, Math.max(0, s * (1 - i / 100)), 1))) return best;
  }
  return best;
}

/* ---------- palettes (the user only ever sees colour dots) ---------- */

/* Every accent here clears ACCENT_GOOD against the dark page, which is the
   default. Flipping to light re-checks the current accent and lifts it if
   needed, so a swatch is never left stranded by a scheme change. The custom
   picker enforces the same floor for anything chosen off the wheel. */
export const ACCENTS = [
  "#fafafa", "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6",
];

/* One shared bubble palette. Colour first, then the greys, then near-black —
   the old list was greys only, which is what made every preset look the same.
   "accent" tracks whatever accent is set. Bubble text colour is computed from
   the bubble, so a pale yellow bubble gets dark text automatically. */
export const BUBBLES = [
  "accent",
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
  "#7f1d1d", "#7c2d12", "#14532d", "#134e4a", "#164e63", "#1e3a8a",
  "#312e81", "#4c1d95", "#701a75", "#831843",
  "#f4f4f5", "#a1a1aa", "#52525b", "#3f3f46", "#27272a", "#18181b", "#000000",
];

export const USER_BUBBLES = BUBBLES;

export const AI_BUBBLES = BUBBLES;

/* ---------- colour maths for the custom picker ---------- */
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export function hexToHsv(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return { h: 265, s: 0.7, v: 0.9 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
