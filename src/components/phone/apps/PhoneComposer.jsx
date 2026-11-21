import { useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, Send, Smartphone, X } from "lucide-react";
import { enter, MOTION } from "../../motion/runtime.js";
import { TEXT_LIMITS } from "../../../lib/phone.js";
import { readPhoto } from "../media.js";
import { Button } from "../../ui.jsx";

/* ---------- the persona's composer ----------

   Three boxes, as the story composer has: the post text (up to 280, "n/280"
   past 80%) on the line with Attach and Post; under Attach, the picture box
   (a device picture, FileReader, up to 10 MB: saved as the post's `image`,
   the way a story's is, so it shows on the post and in Gallery) and the
   description box (the post's `photo`, the words the model reads; "A photo"
   when a picture has none). A description alone is a described card, which
   only Develop turns into a picture; with neither the post is text only. `quote` makes it a quote of that post (text needed);
   `onSend({ text, photo, image })` does the write. */
/* "n/limit" once the text is past 80% of the limit; red when over. */
export const nearLimit = (n, max) => n > max * 0.8;
export function CharCount({ n, max }) {
  if (!nearLimit(n, max)) return null;
  return (
    <span className={`shrink-0 text-[11px] tabular-nums ${n > max ? "text-red-400" : "text-zinc-400"}`} aria-live="polite" data-testid="char-count">
      {n}/{max}
    </span>
  );
}

/* One line: an input, its counter near the limit, and Send (off when over).
   As PhoneInput: the field is never disabled (`disabled` holds Send back);
   `autoFocus` focuses it inside the tap that opened it. */
export function CountedInput({ placeholder, onSend, disabled = false, label, sendLabel = "Send", max, autoFocus = false, inputRef }) {
  const [text, setText] = useState("");
  const own = useRef(null);
  const field = inputRef || own;
  useLayoutEffect(() => { if (autoFocus) field.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const over = text.trim().length > max;
  const can = !disabled && !!text.trim() && !over;
  const send = () => {
    if (!can) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, max + 50))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={placeholder}
          aria-label={label || placeholder}
          aria-invalid={over || undefined}
          enterKeyHint="send"
          className="flex-1 min-w-0 h-10 px-4 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
        />
        <CharCount n={text.trim().length} max={max} />
        <Button type="button" variant="primary" icon={Send} onClick={send} disabled={!can} aria-label={sendLabel} className="w-10 px-0 shrink-0 [--nv-btn-icon:15px]" />
      </div>
    </div>
  );
}

export function PhoneComposer({ ctx, quote = false, placeholder, sendLabel = "Post", onSend, autoFocus = false, children }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [photo, setPhoto] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState("");
  const file = useRef(null);
  const extra = useRef(null);
  const box = useRef(null);
  useLayoutEffect(() => { if (autoFocus) box.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const max = TEXT_LIMITS.post;
  const n = text.trim().length;
  const left = max - n;
  const desc = photo.trim();
  const can = left >= 0 && (quote ? !!text.trim() : !!text.trim() || !!desc || !!image);

  useLayoutEffect(() => { enter(extra.current, { y: 6, duration: MOTION.feedback }); }, [attaching, !!image]);

  const pick = async (e) => {
    const f = [...(e.target.files || [])][0];
    e.target.value = "";
    if (!f) return;
    setAttaching(true);
    try { setImage(await readPhoto(f)); setError(""); } catch (err) { setError(err.message); }
  };
  const reset = () => { setText(""); setImage(null); setPhoto(""); setAttaching(false); setError(""); };
  const send = () => {
    if (!can) return;
    onSend({ text: text.trim(), photo: desc, image });
    reset();
  };

  return (
    <div className="px-4 py-3 border-b border-[var(--nv-line)]" data-testid="phone-composer">
      <div className="flex items-center gap-2 min-w-0">
        <textarea
          ref={box}
          rows={1}
          enterKeyHint="send"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, max + 50))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={placeholder || (quote ? "Add a comment" : "What's happening?")}
          aria-label={placeholder || (quote ? "Add a comment" : "What's happening?")}
          className="flex-1 min-w-0 h-10 max-h-28 py-2 px-4 resize-none rounded-[20px] bg-[var(--nv-control)] border border-[var(--nv-line)] text-sm leading-6 text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
        />
        <CharCount n={n} max={max} />
        {!quote && (
          <Button type="button" variant="icon" icon={ImagePlus} onClick={() => setAttaching((x) => !x)} aria-label="Attach photo" aria-expanded={attaching} className="text-zinc-300 [--nv-btn-icon:18px]" />
        )}
        <Button type="button" variant="primary" onClick={send} disabled={!can} className="shrink-0">
          {sendLabel}
        </Button>
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={pick} data-testid="phone-photo-input" />

      {/* attached: (1) the picture box, the real picture (stored as `image`,
          shown on the post and in Gallery); (2) the description box, what the
          picture shows (stored as `photo`, what the model reads) */}
      <div ref={extra}>
        {attaching && (
          <div className="mt-2 space-y-2" role="group" aria-label="Photo">
            {image ? (
              <div className="relative rounded-2xl overflow-hidden border border-[var(--nv-line)]" data-testid="composer-picture">
                <img src={image} alt={desc || "Attached"} className="block w-full max-h-56 object-cover" />
                <button type="button" onClick={() => setImage(null)} aria-label="Remove photo" className="absolute top-1.5 right-1.5 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--nv-bg)", color: "var(--nv-ink)" }}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => file.current?.click()} className="w-full h-16 rounded-2xl flex items-center justify-center gap-2 text-sm text-zinc-400 bg-[var(--nv-control)] border border-dashed border-[var(--nv-line-strong)]" data-testid="composer-picture-box">
                <Smartphone size={15} className="shrink-0" aria-hidden /> Picture from device
              </button>
            )}
            <div className="relative rounded-2xl border border-[var(--nv-line)]" style={{ background: "color-mix(in srgb, var(--nv-ink) 7%, var(--nv-bg))" }} data-described-photo="">
              <textarea
                rows={2}
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                maxLength={TEXT_LIMITS.photo}
                placeholder={image ? "Describe the picture" : "Or describe a photo"}
                aria-label="What the photo shows"
                className="block w-full resize-none bg-transparent pl-4 pr-12 py-3 text-sm italic leading-relaxed text-zinc-200 placeholder-zinc-500 outline-none"
              />
              <button type="button" onClick={() => { setAttaching(false); setPhoto(""); setImage(null); }} aria-label="Remove described photo" className="absolute top-1 right-1 w-10 h-10 rounded-full flex items-center justify-center text-zinc-400">
                <X size={15} />
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
      {children}
    </div>
  );
}
