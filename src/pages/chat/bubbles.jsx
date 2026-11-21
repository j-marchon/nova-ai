import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "../../components/ui.jsx";
import { keyboardGlide } from "../../components/motion/runtime.js";
import { toLayout, uiScale } from "../../lib/uiScale.js";
import { RP_SPAN, hideNotes, notesOf, tidyRP } from "../../lib/text.js";

/* The speaker's name over a bubble. A character with no picture has only
   this to tell them apart, so it is drawn larger and brighter; the user's
   own name stays small either way. */
export const SpeakerName = ({ bare, style, children }) => (
  <span className={`nv-msg-label ${bare ? "text-zinc-100" : ""}`} style={{ ...style, ...(bare ? null : { color: "var(--nv-muted)" }) }}>
    {children}
  </span>
);

export function MessageImages({ images, onPreview }) {
  if (!images || !images.length) return null;
  const count = images.length;
  if (count === 1) {
    const img = images[0];
    const url = typeof img === "string" ? img : img.url;
    const name = typeof img === "string" ? "Image" : img.name || "Image";
    return (
      <div className="nv-media-entry mb-2 max-w-xs sm:max-w-sm rounded-xl overflow-hidden border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] ">
        <button
          type="button"
          onClick={() => onPreview?.(url)}
          className="block w-full text-left overflow-hidden cursor-pointer group"
          aria-label={"View " + name}
        >
          <img
            src={url}
            alt={name}
            className="w-full max-h-72 object-cover rounded-xl   "
            loading="lazy"
          />
        </button>
      </div>
    );
  }
  return (
    <div className={"grid " + (count === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3") + " gap-2 mb-2 max-w-sm w-full"}>
      {images.map((img, idx) => {
        const url = typeof img === "string" ? img : img.url;
        const name = typeof img === "string" ? "Image" : img.name || "Image";
        return (
          <div
            key={img.id || idx}
            className="nv-media-entry relative rounded-xl overflow-hidden border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] aspect-square "
          >
            <button
              type="button"
              onClick={() => onPreview?.(url)}
              className="w-full h-full block cursor-pointer group"
              aria-label={"View " + name}
            >
              <img
                src={url}
                alt={name}
                className="w-full h-full object-cover   "
                loading="lazy"
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- editing a message in place ----------

   The bubble itself becomes editable, drawn from the same markup the chat
   renders, so nothing moves: the narration stays in italics, the speech
   stays plain, and the cursor can land on the word that was double tapped.
   What is in the bubble is turned back into the chat's own markup on save
   (italics back to *asterisks*). */

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* The chat's markup as HTML, the same split RP makes. */
export function rpHtml(text) {
  return tidyRP(hideNotes(text))
    .split(RP_SPAN)
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith("***") && p.endsWith("***") && p.length > 6) return `<strong><em>${esc(p.slice(3, -3))}</em></strong>`;
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return `<strong>${esc(p.slice(2, -2))}</strong>`;
      if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return `<em>${esc(p.slice(1, -1))}</em>`;
      return esc(p);
    })
    .join("");
}

/* And back: the edited bubble's DOM as the chat's markup. Lines the browser
   wrapped in a <div> or broke with a <br> come back as line breaks. */
export function rpText(node) {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === "BR") { out += "\n"; return; }
    const inner = rpText(n);
    if (tag === "EM" || tag === "I") out += inner.trim() ? `*${inner}*` : inner;
    else if (tag === "STRONG" || tag === "B") out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === "DIV" || tag === "P") out += (out && !out.endsWith("\n") ? "\n" : "") + inner;
    else out += inner;
  });
  return out.replace(/​/g, "");
}

/* Where a tap landed in the rendered text, as an index into the raw text
   it was drawn from: the markup characters (*, _) are not on screen, so
   they are skipped while counting. Close enough to put the cursor on the
   word that was tapped. */
function rawIndex(raw, shown) {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (seen >= shown) return i;
    if (raw[i] !== "*") seen++;
  }
  return raw.length;
}

/* The message being edited: the text as written (markup and all) in a
   field that grows with it, attached to its own bar with Save and Cancel.
   A real textarea, so selection, autocorrect, IME composition and undo all
   behave the way the phone's keyboard expects. Enter is a new line; Ctrl or
   Cmd+Enter saves; Escape cancels. `at.offset` is where a double tap landed
   in the rendered text. */
export function EditableBubble({ text, at, className = "", style, onSave, onCancel }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [initial] = useState(() => hideNotes(text || ""));
  const [value, setValue] = useState(initial);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit();
    el.focus({ preventScroll: true });
    const pos = at?.offset != null ? rawIndex(initial, at.offset) : initial.length;
    try { el.setSelectionRange(pos, pos); } catch { /* not focusable yet */ }
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* As the keyboard comes up, the line you tapped glides to the middle of
     what is left above it, on the keyboard's own curve and in step with it:
     the list is scrolled at once and its content drawn gliding there
     (keyboardGlide). Nothing moves when no keyboard opens (a desktop), and
     the browser's own jump into view is not used: it moved the whole page
     as well as the chat. Rectangles, innerHeight and the keyboard are all
     physical pixels; only the scroll is in layout pixels. */
  useEffect(() => {
    const center = (kb) => {
      const el = ref.current;
      const scroller = el?.closest(".nv-chat-messages");
      if (!el || !scroller || !(kb > 0)) return;
      const lineY = el.getBoundingClientRect().top + caretTop(el, el.selectionStart ?? 0) * uiScale();
      const top = scroller.getBoundingClientRect().top;
      /* the dock stays down behind the keyboard while editing (index.css) */
      const bottom = window.innerHeight - kb;
      const delta = toLayout(lineY - (top + bottom) / 2);
      if (Math.abs(delta) < 6) return;
      const from = scroller.scrollTop;
      scroller.scrollTop = from + delta;
      keyboardGlide(scroller.firstElementChild, scroller.scrollTop - from);
    };
    const now = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb")) || 0;
    if (now > 0) requestAnimationFrame(() => center(now));
    const onKb = (e) => center(e.detail?.height || 0);
    window.addEventListener("nova-kb", onKb);
    return () => window.removeEventListener("nova-kb", onKb);
  }, []);

  const save = () => {
    const now = (ref.current?.value ?? value).replace(/\s+$/, "");
    /* hidden notes are not in the field, so they go back on unchanged */
    const notes = notesOf(text);
    onSave(notes ? `${now}\n\n${notes}` : now, now !== initial.replace(/\s+$/, ""));
  };
  /* a press on the bar must not take the focus out of the field first, or
     the keyboard drops and the layout jumps before the tap lands */
  const hold = (e) => e.preventDefault();

  return (
    <div ref={box} className={`nv-edit-box ${className}`} style={style} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={value}
        aria-label="Edit message"
        spellCheck
        rows={1}
        onChange={(e) => { setValue(e.target.value); fit(); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        }}
        style={{ color: "inherit" }}
      />
      <div className="nv-edit-bar">
        <span className="nv-label flex-1 min-w-0 truncate">Editing<span className="nv-edit-hint"> · Ctrl+Enter saves</span></span>
        <Button size="sm" variant="ghost" icon={X} onPointerDown={hold} onMouseDown={hold} onClick={onCancel} aria-label="Cancel edit">Cancel</Button>
        <Button size="sm" variant="primary" icon={Check} onPointerDown={hold} onMouseDown={hold} onClick={save} aria-label="Save edit">Save</Button>
      </div>
    </div>
  );
}

/* How far down a textarea the line holding `pos` sits, in its own pixels:
   the text up to there is laid out in an invisible copy with the same font,
   width and padding, and the end of that copy is measured. */
function caretTop(ta, pos) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing", "textTransform", "wordSpacing", "tabSize"]) mirror.style[k] = cs[k];
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", width: `${ta.clientWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" });
  mirror.textContent = ta.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const y = mark.offsetTop + mark.offsetHeight / 2 - ta.scrollTop;
  mirror.remove();
  return y;
}
