import { MotionList } from "../../components/motion/MotionList.jsx";
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FastForward, NotebookPen, Plus, Reply, Send, Smartphone, Sparkles, Square, UserRound, Users, X } from "lucide-react";
import { AccBtn, Button, selStyle, SwapIcon } from "../../components/ui.jsx";
import { suggestSlashCommands } from "../../lib/slash.js";
import { uid } from "../../lib/util.js";
import { showToast } from "../../lib/toast.js";

/* ---------- the message box ----------

   It owns what you are typing. The draft used to live in the chat view, so
   every letter re-rendered the whole conversation — on a phone that is the
   lag between a key and the letter appearing. Now a keystroke re-renders
   this box and nothing else.

   The chat reaches the draft through the ref (writing your reply for you,
   quick replies that insert, attaching a picture from the + menu), and gets
   what you send through `actions.send`. */
export const Composer = memo(forwardRef(function Composer({
  actions, busy, scopeActive, canContinue, impersonating, sendAs, scope = { mode: "off", cast: [] },
  styleName, styleColor, styleOn = false, noteOn = false, modelName, modelFull, modelOn = false, look, phoneUnread = 0, phoneOn = false,
}, ref) {
  const [draft, setDraft] = useState("");
  const scopeOn = scope.mode !== "off";
  const [draftImages, setDraftImages] = useState([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useImperativeHandle(ref, () => ({
    getDraft: () => draftRef.current,
    setDraft: (v) => setDraft(v),
    focus: () => textareaRef.current?.focus(),
    pickImage: () => fileInputRef.current?.click(),
  }), []);

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 10 * 1024 * 1024) {
        showToast("That picture is over 10 MB.", { tone: "warn" });
        continue;
      }
      const reader = new FileReader();
      reader.onerror = () => showToast("Couldn't read that picture.", { tone: "warn" });
      reader.onload = (event) => {
        const url = event.target?.result;
        if (typeof url === "string") {
          setDraftImages((prev) => [
            ...prev,
            {
              id: uid(),
              url,
              name: file.name || "image",
              mimeType: file.type || "image/jpeg",
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const removeDraftImage = (i) => {
    setDraftImages((prev) => prev.filter((_, idx) => idx !== i));
  };

  /* something to send: text, a picture, or both */
  const hasDraft = !!draft.trim() || draftImages.length > 0;

  /* ---------- Slash Commands Autocomplete ---------- */
  const slashSuggestions = useMemo(() => {
    if (!draft.startsWith("/") || draft.includes("\n") || draft.includes(" ")) return [];
    return suggestSlashCommands(draft.slice(1));
  }, [draft]);

  const showSlashSuggestions =
    !slashDismissed &&
    draft.startsWith("/") &&
    !draft.includes("\n") &&
    !draft.includes(" ") &&
    slashSuggestions.length > 0;

  const selectSlashCommand = (cmd) => {
    const needsArg = ["roll", "sendas", "note", "setvar", "getvar", "branch", "think"].includes(cmd.name);
    setDraft(`/${cmd.name}${needsArg ? " " : ""}`);
    setSlashDismissed(false);
    textareaRef.current?.focus();
  };

  const send = () => {
    const text = draft.trim();
    if (!text && (!draftImages || !draftImages.length)) return;
    const imagesToSend = draftImages && draftImages.length ? [...draftImages] : undefined;
    setDraft("");
    setDraftImages([]);
    actions.send(text, imagesToSend);
  };

  return (
    <div
      data-chat-composer="1"
      className="nv-composer relative rounded-3xl px-3 pt-2.5 pb-2 focus:border-[var(--nv-edge-ink)]"
      style={{
        background: look.composerBg,
        border: `1px solid ${look.composerBorder}`,
        boxShadow: look.glassEdge,
      }}
    >
      <span data-focus-indicator="" aria-hidden className="absolute inset-0 pointer-events-none rounded-3xl border border-[var(--nv-edge-ink)]" style={{ opacity: 0 }} />
      {/* Slash command autocomplete popup */}
      {showSlashSuggestions && (
        <div
          role="listbox"
          aria-label="Slash command suggestions"
          className="nv-popup absolute left-0 right-0 bottom-full mb-2 nv-glass rounded-2xl p-1.5  border border-[var(--nv-line)] max-h-56 overflow-y-auto nv-no-scrollbar z-30"
          style={{
            background: "var(--nv-control)",
          }}
        >
          <div className="text-[10px] font-medium text-zinc-400 px-2.5 py-1 uppercase tracking-wider flex items-center justify-between border-b border-[var(--nv-edge-ink)] mb-1">
            <span>Commands</span>
            <span className="font-normal text-[10px] text-zinc-500">Tab / Enter to select</span>
          </div>
          {slashSuggestions.map((cmd, idx) => {
            const isSelected = idx === slashIndex;
            return (
              <button
                key={cmd.name}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => selectSlashCommand(cmd)}
                onMouseEnter={() => setSlashIndex(idx)}
                className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2  ${
                  isSelected
                    ? "bg-[var(--acc)]/20 text-white border border-[var(--acc)]/30"
                    : "text-zinc-200 hover:bg-[var(--nv-control)] border border-transparent"
                }`}
              >
                <span className="font-mono text-xs font-medium text-[var(--acc)] shrink-0">
                  {cmd.syntax}
                </span>
                <span className="text-[11px] text-zinc-400 truncate shrink min-w-0">
                  {cmd.description}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Draft images thumbnail strip */}
      {draftImages.length > 0 && (
        <MotionList horizontal className="nv-fade-x flex items-center gap-2 px-1 pt-1 pb-2 overflow-x-auto" data-testid="draft-images-strip">
          {draftImages.map((img, i) => (
            <div key={img.id || i} className="nv-attachment relative group shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] ">
              <img src={img.url} alt={img.name || "Attachment"} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeDraftImage(i)}
                className="absolute top-1 right-1 p-1 rounded-full bg-[var(--nv-control)] hover:bg-black text-[var(--nv-ink)] hover:text-white "
                aria-label="Remove image"
                title="Remove image"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </MotionList>
      )}

      {/* Send As indicator */}
      {sendAs.type !== "user" && (
        <div className="nv-chip flex items-center justify-between text-xs px-2.5 py-1 mb-1.5 rounded-xl bg-[var(--acc)]/10 border border-[var(--acc)]/25 text-zinc-200">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-zinc-400">Sending as:</span>
            <span className="font-medium text-[var(--acc)] truncate">{sendAs.name}</span>
            {sendAs.lock && <span className="text-[10px] text-zinc-400 bg-[var(--nv-control)] px-1 rounded">(locked)</span>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconRight={X}
            onClick={() => actions.resetSendAs()}
            className="text-zinc-400 hover:text-zinc-100"
          >
            Reset to You
          </Button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        aria-label="Write a message"
        rows={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSlashDismissed(false);
          setSlashIndex(0);
          /* typing is stepping in: the scene stops playing on its own */
          if (e.target.value) actions.typing();
        }}
        onKeyDown={(e) => {
          if (showSlashSuggestions && slashSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSlashIndex((prev) => (prev + 1) % slashSuggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSlashIndex((prev) => (prev - 1 + slashSuggestions.length) % slashSuggestions.length);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              if (slashSuggestions[slashIndex]) {
                e.preventDefault();
                selectSlashCommand(slashSuggestions[slashIndex]);
                return;
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setSlashDismissed(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={impersonating ? "Writing as you…" : sendAs.type === "system" ? "Narrate a scene event or time skip…" : sendAs.type !== "user" ? `Message as ${sendAs.name}…` : "Message…"}
        className="w-full max-h-32 resize-none bg-transparent px-1 text-[15px] text-zinc-100 placeholder-zinc-600 outline-none"
        style={{ minHeight: "28px" }}
      />

      <div className="nv-composer-actions flex items-center gap-1.5 mt-1 min-w-0">
        {/* Everything about how the story is told, in one island of icons.
            Each one shines (full ink and a soft glow) while it is on and sits
            greyed out while it is off: reply style, author's note, Nova
            Scope, the phone (which also carries its count) and the model,
            lit whenever one is picked. */}
        <div className="nv-composer-island" role="toolbar" aria-label="Chat options">
          <IslandBtn icon={Reply} label="Reply style" title={`Reply style: ${styleName}`} on={styleOn} onClick={() => actions.openStyle()} />
          <IslandBtn icon={NotebookPen} label={noteOn ? "Author's note (on)" : "Author's note"} title={noteOn ? "Author's note: on" : "Author's note"} on={noteOn} onClick={() => actions.openNote()} />
          <IslandBtn
            icon={scopeOn ? Users : UserRound}
            label="Nova Scope"
            title={scopeOn ? `Nova Scope: ${scope.mode}${scope.cast?.length ? ` · ${scope.cast.length + 1} in the scene` : ""}` : "Nova Scope"}
            on={scopeOn}
            onClick={() => actions.openScope()}
          />
          <IslandBtn
            icon={Smartphone}
            label={phoneOn ? "Open phone" : "Phone off. Turn on"}
            title={phoneOn ? (phoneUnread ? `Phone: ${phoneUnread} new` : "Phone") : "Phone is off"}
            on={phoneOn}
            className="nv-phone-btn"
            onClick={() => actions.openPhone?.()}
          >
            {!phoneOn && (
              <span data-testid="phone-off-mark" aria-hidden className="absolute left-1/2 top-1/2 w-[18px] h-[2px] -ml-[9px] -mt-px rounded-full rotate-45 pointer-events-none" style={{ background: "currentColor" }} />
            )}
            {phoneOn && phoneUnread > 0 && (
              <span data-testid="phone-badge" aria-hidden className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-center pointer-events-none" style={{ background: "var(--nv-ink)", color: "var(--nv-bg)" }}>
                {phoneUnread > 9 ? "9+" : phoneUnread}
              </span>
            )}
          </IslandBtn>
          <IslandBtn icon={Sparkles} label="Model" title={modelFull || modelName} on={modelOn} onClick={() => actions.openModel()} />
        </div>
        <div className="nv-composer-tools">
        {/* attach a picture, write your reply for you, send as someone
            else, quick replies */}
        <button
          type="button"
          onClick={() => actions.openMenu()}
          className={`p-2.5 rounded-full  shrink-0 ${impersonating ? "nv-breathe" : ""}`}
          style={sendAs.type !== "user" || impersonating ? selStyle(true) : { background: "var(--color-zinc-800)", color: "var(--color-zinc-300)" }}
          aria-pressed={sendAs.type !== "user" || !!impersonating}
          data-on={sendAs.type !== "user" || impersonating ? "1" : undefined}
          aria-label="More options"
        >
          <Plus size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="image-file-input"
          onChange={handleImageSelect}
        />

        {busy && !(scopeActive && hasDraft) ? (
          <button
            onClick={() => actions.stop()}
            className="p-2.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300  shrink-0"
            aria-label="Stop generating"
          >
            <Square size={15} />
          </button>
        ) : (
          /* empty box -> carry the scene forward instead of sending */
          <AccBtn
            onClick={() => (hasDraft ? send() : actions.continueScene())}
            disabled={!hasDraft && !canContinue}
            className="p-2.5 shrink-0"
            style={{ borderRadius: "12px" }}
            aria-label={hasDraft ? "Send" : "Continue the story"}
            data-motion={hasDraft ? "launch" : "nudge"}
            title={hasDraft ? "Send" : "Continue the story"}
          >
            <SwapIcon icon={hasDraft ? Send : FastForward} size={15} />
          </AccBtn>
        )}
        </div>
      </div>
    </div>
  );
}));

/* one icon of the island; `on` lights it (index.css, [data-active]) */
function IslandBtn({ icon: Icon, label, title, on = false, onClick, className = "", children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title || label}
      data-active={on ? "1" : undefined}
      className={`nv-island-btn relative ${className}`}
    >
      <span className="nv-ico relative inline-flex">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      {children}
    </button>
  );
}
