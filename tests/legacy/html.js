/* ---------- display regex: replies shown as HTML ----------

   A SillyTavern preset's display scripts (tavern.js) restyle what the model
   wrote: tracker blocks become coloured cards and bars, <pink>"…"</pink>
   becomes coloured dialogue. Those presets also have the model write HTML
   itself (<details>, <b>, <br>), which SillyTavern shows as HTML. So while
   the active prompt has display scripts, a bubble is rendered the same way:

     1. the display scripts, on the raw text, in order
     2. hidden notes out (<!-- … -->, see text.js), after the scripts, since
        some of them use the GFX_START / GFX_END comments as anchors
     3. *actions* and **bold** as Nova shows them, outside tags only
     4. sanitised (sanitize below) and set as HTML

   Bubbles keep white-space: pre-wrap, so a line break is a line break; the
   ones between block tags are dropped, or every card would sit in a gap.
   Without display scripts nothing here runs and bubbles are plain text. */

import DOMPurify from "dompurify";
import { RP_SPAN, hideNotes, tidyRP } from "../../src/lib/text.js";
import { applyRegex } from "../../src/lib/tavern.js";

const BLOCK = "(?:div|details|summary|ul|ol|li|p|table|thead|tbody|tr|td|th|h[1-6]|hr|blockquote|section|internal_states)";
const GAP_AFTER = new RegExp(`(<\\/?${BLOCK}\\b[^>]*>)[ \\t]*\\n\\s*`, "gi");
const GAP_BEFORE = new RegExp(`\\s*\\n[ \\t]*(<\\/?${BLOCK}\\b)`, "gi");

const asterisks = (t) =>
  t.replace(RP_SPAN, (p) =>
    p.startsWith("***") && p.endsWith("***") ? `<strong><em>${p.slice(3, -3)}</em></strong>`
      : p.startsWith("**") && p.endsWith("**") ? `<strong>${p.slice(2, -2)}</strong>`
      : `<em>${p.slice(1, -1)}</em>`);

/* Steps 1-3: the HTML source for one message, not yet sanitised. */
export function displaySource(text, rules, role, depth) {
  const s = tidyRP(hideNotes(applyRegex(text, rules, role, depth)));
  return s
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 ? part : asterisks(part)))
    .join("")
    .replace(GAP_AFTER, "$1")
    .replace(GAP_BEFORE, "$1");
}

/* What the model's HTML may do. It is text from a model, so: no scripts,
   no forms, nothing that loads from the network (images, frames, media,
   url() in styles), no classes or ids (the app's own classes could pin a
   block over the whole screen), and no positioning out of the bubble. */
const CONFIG = {
  FORBID_TAGS: ["style", "img", "picture", "source", "video", "audio", "iframe", "frame", "object", "embed", "form", "input", "button", "textarea", "select", "option", "link", "meta", "base", "svg", "math"],
  FORBID_ATTR: ["class", "id", "srcset", "background"],
};

let purify = null;
function purifier() {
  if (purify) return purify;
  purify = DOMPurify(typeof window !== "undefined" ? window : undefined);
  purify.addHook("afterSanitizeAttributes", (node) => {
    const st = node.style;
    if (st && node.hasAttribute?.("style")) {
      for (const prop of Array.from({ length: st.length }, (_, i) => st[i])) {
        const v = st.getPropertyValue(prop);
        if (/^(position|z-index|inset|top|left|right|bottom)$/.test(prop) || /url\s*\(|expression\s*\(/i.test(v)) st.removeProperty(prop);
      }
      if (!st.length) node.removeAttribute("style");
    }
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return purify;
}

/* The finished, safe HTML for one bubble. Actions get Nova's dimmed
   italics after sanitising, which removes every class. */
export function displayHtml(text, rules, role, depth) {
  const p = purifier();
  if (!p.isSupported) return null;
  return p
    .sanitize(displaySource(text, rules, role, depth), CONFIG)
    .replace(/<em>/g, '<em class="opacity-75">');
}
