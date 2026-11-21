import { ChevronDown, Globe } from "lucide-react";
import { RP } from "../../components/RP.jsx";
import { Pic } from "../../components/ui.jsx";
import { SpeakerName } from "./bubbles.jsx";
import { useStream } from "./streamStore.js";

/* ---------- the reply arriving ----------

   The only part of the chat that re-renders while a reply streams: it reads
   the text straight from the stream store. A reply with several speakers
   is one bubble, its **Name:** labels shown as bold text. */
export function StreamingBubble({
  store, look, streamSpeaker, title, isUni, universe, character,
  isThinking, thinkOpen, onToggleThink,
}) {
  const streamText = useStream(store, "text");
  const thinkText = useStream(store, thinkOpen ? "think" : null) || "";
  const nameStyle = { background: "transparent", color: "var(--nv-ink)" };
  const bubbleStyle = { background: look.aiBubbleBg, color: look.aiBubbleFg, border: `1px solid ${look.bubbleBorder}` };

  /* the bubble is headed by whoever leads the reply, else the chat's own */
  const globe = !streamSpeaker && isUni && !universe?.avatar;
  const src = streamSpeaker ? streamSpeaker.avatar : isUni ? universe?.avatar : character?.avatar;
  const name = streamSpeaker?.name || title || "?";

  return (
      <div className="nv-bubble flex flex-col items-start">
        <div className="flex items-center gap-2 mb-1 px-0.5">
          {globe ? (
            <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <Globe size={11} className="text-zinc-500" />
            </div>
          ) : (
            <Pic src={src} name={name} size="w-6 h-6" />
          )}
          <SpeakerName bare={!globe && !src} style={nameStyle}>
            {name}
          </SpeakerName>
        </div>
        <div className="nv-bubble-box nv-msg-stream max-w-full min-w-0 px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed whitespace-pre-wrap" style={bubbleStyle}>
          {streamText ? <div className="nv-fade"><RP text={streamText} display={look.display} /></div> : (
            /* Two waiting states, told apart by how they move rather than by
               any text: plain dots while the request is still in the air, a
               slower travelling lift once the model has started thinking.
               The arrow opens the thinking itself, greyed and small so it
               never reads as the reply. Closed, nothing of it is shown. */
            isThinking ? (
              <span className="block">
                <button
                  type="button"
                  onClick={onToggleThink}
                  aria-expanded={thinkOpen}
                  aria-label={thinkOpen ? "Hide thinking" : "Show thinking"}
                  className="inline-flex gap-1.5 items-center py-1"
                >
                  <span className="inline-flex gap-1 items-center nv-think">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--acc)" }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--acc)" }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--acc)" }} />
                  </span>
                  <span className="text-[11px] text-zinc-500 nv-breathe">thinking</span>
                  <ChevronDown size={12} className="text-zinc-500 nv-chevron" data-open={thinkOpen ? "1" : "0"} />
                </button>
                {thinkOpen && (
                  <span className="nv-fade block mt-1.5 max-h-60 overflow-y-auto text-xs italic text-zinc-500 border-l-2 border-zinc-700 pl-2.5">
                    {thinkText.trim() || "Nothing to show: this model thinks without sharing its thoughts."}
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex gap-1 items-center py-1 nv-wait">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              </span>
            )
          )}
          {streamText && <span className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom nv-caret" style={{ background: "var(--acc)" }} />}
        </div>
      </div>
  );
}
