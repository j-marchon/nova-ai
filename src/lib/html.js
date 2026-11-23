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
import { RP_SPAN, hideNotes, tidyRP } from "./text.js";
import { applyRegex } from "./tavern.js";

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
   url() in styles), and nothing that can reach outside its bubble. A preset
   that styles its trackers and hover cards brings its own <style>, classes
   and small SVG icons, so those are kept, fenced in: every class and id is
   renamed with a pv- prefix and every rule in a <style> is limited to the
   bubble (scopeCss), so none of it can restyle the app. */
const CONFIG = {
  FORBID_TAGS: ["img", "picture", "source", "video", "audio", "iframe", "frame", "object", "embed", "form", "input", "button", "textarea", "select", "option", "link", "meta", "base", "math", "use", "foreignObject", "image", "script"],
  FORBID_ATTR: ["srcset", "background"],
  FORCE_BODY: true,
};

const MAX_CSS = 60000;
const unsafeValue = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i;

/* One declaration list ("a:b;c:d"), minus what may not leave the bubble. */
function cleanDeclarations(list) {
  const out = [];
  for (const raw of list.split(/;(?![^(]*\))/)) {
    const i = raw.indexOf(":");
    if (i < 1) continue;
    const prop = raw.slice(0, i).trim().toLowerCase();
    let value = raw.slice(i + 1).trim();
    if (!prop || !value || unsafeValue.test(value)) continue;
    if (prop === "position" && /^(fixed|sticky)\b/i.test(value)) continue;
    if (prop === "z-index") value = String(Math.max(-1, Math.min(20, parseInt(value, 10) || 0)));
    out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

/* ".name" and "#name" in a selector renamed, leaving strings and
   [attributes] alone; html, body and :root cannot be scoped and are cut. */
function scopeSelector(sel) {
  const t = sel.trim().replace(/^(?:html|body|:root)\b\s*/i, "");
  if (!t || /^[>+~]/.test(t) || /^(?:html|body|:root)$/i.test(sel.trim())) return "";
  const renamed = t.split(/(\[[^\]]*\]|"[^"]*"|'[^']*')/).map((part, i) => (i % 2 ? part : part.replace(/([.#])(-?[_a-zA-Z][\w-]*)/g, "$1pv-$2"))).join("");
  return `.nv-pv ${renamed}`;
}

/* A preset's CSS, limited to the bubble it came in. */
export function scopeCss(css) {
  const src = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "").slice(0, MAX_CSS);
  const walk = (text) => {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const semi = text.indexOf(";", i);
      if (open < 0) break;
      if (semi >= 0 && semi < open && text.slice(i, semi).trim().startsWith("@")) { i = semi + 1; continue; }
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      i = j;
      if (prelude.startsWith("@")) {
        if (/^@(media|supports|container|layer)\b/i.test(prelude)) { const inner = walk(body); if (inner) out += `${prelude}{${inner}}`; }
        else if (/^@(-webkit-)?keyframes\b/i.test(prelude)) { const frames = body.replace(/([^{}]+)\{([^{}]*)\}/g, (m, k, d) => `${k.trim()}{${cleanDeclarations(d)}}`); out += `${prelude}{${frames}}`; }
        continue;
      }
      const selectors = prelude.split(/,(?![^(]*\))/).map(scopeSelector).filter(Boolean);
      const decls = cleanDeclarations(body);
      if (selectors.length && decls) out += `${selectors.join(",")}{${decls}}`;
    }
    return out;
  };
  return walk(src);
}

let purify = null;
function purifier() {
  if (purify) return purify;
  purify = DOMPurify(typeof window !== "undefined" ? window : undefined);
  purify.addHook("afterSanitizeElements", (node) => {
    if (node.nodeName?.toLowerCase() !== "style") return;
    const css = scopeCss(node.textContent);
    if (css) node.textContent = css;
    else node.parentNode?.removeChild(node);
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    const st = node.style;
    if (st && node.hasAttribute?.("style")) {
      for (const prop of Array.from({ length: st.length }, (_, i) => st[i])) {
        const v = st.getPropertyValue(prop);
        if ((prop === "position" && /^(fixed|sticky)/.test(v)) || unsafeValue.test(v)) st.removeProperty(prop);
        else if (prop === "z-index") st.setProperty(prop, String(Math.max(-1, Math.min(20, parseInt(v, 10) || 0))));
      }
      if (!st.length) node.removeAttribute("style");
    }
    for (const attr of ["class", "id"]) {
      const v = node.getAttribute?.(attr);
      if (v == null) continue;
      node.setAttribute(attr, attr === "id" ? `pv-${v}` : v.split(/\s+/).filter(Boolean).map((c) => `pv-${c}`).join(" "));
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
  if (typeof text !== "string" || typeof role !== "string" || typeof depth !== "number") return render(p, text, rules, role, depth);
  const key = `${rulesId(rules)}\0${role}\0${depth}\0${text}`;
  let html = htmlMemo.get(key);
  if (html !== undefined) {
    htmlMemo.delete(key);
  } else {
    html = render(p, text, rules, role, depth);
    if (htmlMemo.size >= HTML_MEMO_SIZE) htmlMemo.delete(htmlMemo.keys().next().value);
  }
  htmlMemo.set(key, html);
  return html;
}

const render = (p, text, rules, role, depth) =>
  p.sanitize(displaySource(text, rules, role, depth), CONFIG).replace(/<em>/g, '<em class="opacity-75">');

/* Sanitising is the slow part of a bubble, and the same bubbles are drawn
   again and again, so the last few hundred results are kept. A rule list is
   told apart by identity: a changed preset is a new array. */
const HTML_MEMO_SIZE = 300;
const htmlMemo = new Map();
const ruleIds = new WeakMap();
let nextRulesId = 1;
function rulesId(rules) {
  if (!rules || typeof rules !== "object") return `~${typeof rules}:${rules}`;
  let id = ruleIds.get(rules);
  if (!id) ruleIds.set(rules, (id = nextRulesId++));
  return id;
}
