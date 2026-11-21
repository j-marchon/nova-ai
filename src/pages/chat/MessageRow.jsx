import { enter, respond } from "../../components/motion/runtime.js";
import { memo, useMemo, useRef, useLayoutEffect } from "react";
import { ChevronLeft, ChevronRight, FastForward, Languages, MoreHorizontal, Pencil, Play, RefreshCw, Trash2, Wand2, X } from "lucide-react";
import { RP } from "../../components/RP.jsx";
import { Button, Pic, Skeleton } from "../../components/ui.jsx";
import { short } from "../../lib/api.js";
import { swipeIndex, swipeList } from "../../lib/swipes.js";
import { joinContinuation } from "../../lib/text.js";
import { EditableBubble, MessageImages, SpeakerName } from "./bubbles.jsx";
import { useStream } from "./streamStore.js";

/* ---------- one message ----------

   Memoised: a row re-renders only when its own message, its flags, or the
   chat's look change. `when` ("5m ago", or null) is a plain string: the
   message's in-world age on the phone's clock, shown by the name. Everything it does goes through `actions`, one object
   that never changes (see useStableActions), so a keystroke in the composer
   or a frame of a streamed reply never reaches the rows at all.

   Off-screen rows skip layout and paint (content-visibility), which is what
   keeps opening the keyboard on a phone from re-laying out a long chat. Not
   on a row that glows (reading aloud) or is highlighted or being edited,
   since paint containment would clip the glow. */

/* A reply being continued in place: the row follows the stream itself, so
   nothing above it has to re-render while the text grows. */
function LiveRow(props) {
  const live = useStream(props.store, "text");
  const content = live ? joinContinuation(props.m.content, live) : props.m.content;
  const m = useMemo(() => (content === props.m.content ? props.m : { ...props.m, content }), [props.m, content]);
  return <RowBody {...props} m={m} />;
}

export const MessageRow = memo(function MessageRow(props) {
  return props.continuing ? <LiveRow {...props} /> : <RowBody {...props} />;
});

function RowBody({
  m, depth, look, avSrc, avName, label, editing, anyEditing, isLast, busy,
  swipeable, highlight, translation, speaking, greetIdx, greetCount, greetLabel, actions, when,
}) {
  const rowRef = useRef(null);
  const previous = useRef({ swipe: m.swipeIdx, greeting: greetIdx, editing: !!editing, highlight });
  useLayoutEffect(() => {
    const target = rowRef.current;
    const old = previous.current;
    let motion = null;
    if (old.swipe !== m.swipeIdx || old.greeting !== greetIdx) {
      const direction = old.swipe !== m.swipeIdx ? (m.swipeIdx || 0) - (old.swipe || 0) : greetIdx - old.greeting;
      motion = enter(target, { x: direction < 0 ? -36 : 36, y: 0, scale: .97, duration: .45 });
    } else if ((highlight && !old.highlight) || old.editing !== !!editing) motion = respond(target);
    previous.current = { swipe: m.swipeIdx, greeting: greetIdx, editing: !!editing, highlight };
    /* end only this effect's own animation, and end it settled: stopping every
       tween on the row also killed the new-reply entrance (useMotionRoot) and
       left the reply invisible at opacity 0 */
    return () => { if (motion) { motion.progress(1); motion.kill(); } };
  }, [m.swipeIdx, greetIdx, !!editing, highlight]);
  const bubbleProps = {
    ...(anyEditing ? {} : actions.longPress(m)),
    onClick: (e) => { e.stopPropagation(); if (!anyEditing) actions.tap(m, e); },
    tabIndex: 0,
    role: "group",
    "aria-label": `${label} message`,
    onContextMenu: (event) => { event.preventDefault(); if (!anyEditing) actions.openMenu(m); },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || anyEditing) return;
      if (event.key === "Enter" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); actions.openMenu(m);
      }
    },
  };
  const isSystemMsg = m.role === "system";
  const bubbleCls = `nv-msg px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
    m.role === "user" ? "rounded-tr-sm" : isSystemMsg ? "rounded-tl-sm italic" : "rounded-tl-sm"
  }`;
  const bubbleStyle = {
    background: m.role === "user" ? look.userBubbleBg : look.aiBubbleBg,
    color: m.role === "user" ? look.userBubbleFg : look.aiBubbleFg,
    border: `1px ${isSystemMsg ? "dashed" : "solid"} ${look.bubbleBorder}`,
    outline: undefined,
    outlineOffset: speaking ? "3px" : undefined,
  };
  const nameStyle = { background: "transparent", color: "var(--nv-ink)" };
  const dropShadow = look.hasBg ? { filter: "none" } : {};
  const contained = !speaking && !highlight && !editing;
  const preview = (url) => actions.preview(url);

  /* quick actions, on the newest message only */
  const quick = [];
  if (isLast && !busy && !anyEditing) {
    if (m.role === "assistant") {
      quick.push({ icon: RefreshCw, label: "Regenerate", run: () => actions.regenerate(m) });
      quick.push({ icon: Wand2, label: "Regenerate with a note", run: () => actions.regenNote(m) });
      quick.push({ icon: Play, label: "Continue this reply", run: () => actions.continueMsg(m) });
    }
    quick.push({ icon: Pencil, label: "Edit", run: () => actions.edit(m) });
    quick.push({ icon: FastForward, label: "Continue the story", run: () => actions.continueStory() });
    quick.push({ icon: Trash2, label: "Delete", danger: true, run: () => actions.askDelete(m) });
  }
  const versions = swipeList(m).length;

  return (
    <div
      ref={rowRef}
      id={`msg-${m.id}`}
      data-msg-id={m.id}
      data-chat-message="1"
      data-highlight={highlight ? "1" : undefined}
      className={`nv-bubble group flex flex-col ${m.role === "user" ? "items-end" : "items-start"} ${
        highlight ? "rounded-2xl" : ""
      }`}
      style={{
        ...(contained ? { contentVisibility: "auto", containIntrinsicSize: "auto 120px" } : null),
        ...(highlight ? { outline: "2px solid var(--nv-ink)", outlineOffset: "3px" } : null),
      }}
    >
      {/* name row above the bubble, so the text gets the full width */}
      <div className={`nv-msg-head flex items-center gap-2 mb-1.5 px-0.5 w-full ${m.role === "user" ? "flex-row-reverse" : ""}`}>
        <Pic src={avSrc} name={avName} size="w-6 h-6" />
        <SpeakerName bare={m.role === "assistant" && !avSrc} style={nameStyle}>
          {label}
        </SpeakerName>
        {/* how long ago in the story (the phone's clock), while the phone is on */}
        {when && <span className="nv-label leading-none" style={{ fontSize: 9.5 }} data-wt="">{when}</span>}
        {speaking && <span aria-label="Reading aloud" className="nv-breathe w-1.5 h-1.5 rounded-full bg-[var(--nv-ink)]" />}
        {m.via && (
          <span
            title={`Written by ${m.via}, not the selected model`}
            className="text-[10px] px-1.5 py-px rounded bg-zinc-900 text-zinc-100"
          >
            via {short(m.via)}
          </span>
        )}
        {/* on a pointer: edit and the menu on any message, shown on hover */}
        {!anyEditing && !isLast && (
          <span className={`nv-row-tools flex items-center ${m.role === "user" ? "mr-auto flex-row-reverse" : "ml-auto"}`}>
            <Button variant="icon" size="sm" icon={Pencil} onClick={() => actions.edit(m)} aria-label="Edit" title="Edit" />
            <Button variant="icon" size="sm" icon={MoreHorizontal} onClick={() => actions.openMenu(m)} aria-label="Message options" title="More" />
          </span>
        )}
      </div>
      <div className={`w-full max-w-full min-w-0 flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
        <div className={`nv-bubble-box relative max-w-full min-w-0 ${editing ? "w-full" : ""}`}>
          {editing ? (
            /* The same bubble, made editable in place: same padding, radius,
               type and width, so every word stays exactly where it was. */
            <EditableBubble
              key={`edit-${m.id}`}
              text={m.content}
              at={editing.at}
              className="nv-msg-edit"
              onSave={actions.saveEdit}
              onCancel={actions.cancelEdit}
            />
          ) : (
            <div {...bubbleProps} className={bubbleCls} style={bubbleStyle}>
              {m.images && m.images.length > 0 && (
                <MessageImages images={m.images} onPreview={preview} />
              )}
              {m.image && <MessageImages images={[m.image]} onPreview={preview} />}
              {m.content ? <RP text={m.content} display={look.display} role={m.role} depth={depth} /> : null}
            </div>
          )}
          {/* translation display */}
          {translation && (
            <div
              data-motion-state={translation.loading ? "loading" : translation.error ? "error" : "ready"} className="nv-fade mt-1.5 px-3 py-2 rounded-2xl text-xs border border-[var(--nv-edge-ink)]"
              style={{
                background: "var(--nv-control)",
              }}
            >
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-medium mb-1">
                <span className="flex items-center gap-1 text-[var(--acc)] font-mono text-[11px]">
                  <Languages size={12} className="shrink-0" />
                  [Translated: {translation.sourceLang || "auto"} &rarr; {translation.targetLang || "en"}]
                </span>
                <button
                  onClick={() => actions.toggleTranslate(m)}
                  className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded "
                  title="Hide translation"
                  aria-label="Hide translation"
                >
                  <X size={12} />
                </button>
              </div>
              {translation.loading ? (
                <div className="space-y-1.5 py-0.5" aria-busy="true" aria-label="Translating">
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-3 w-4/5 rounded" />
                </div>
              ) : translation.error ? (
                <p className="text-zinc-100">{translation.error}</p>
              ) : (
                <div className="leading-relaxed whitespace-pre-wrap text-zinc-200">
                  {translation.translatedText}
                </div>
              )}
            </div>
          )}

        </div>

        {/* opening scenarios — only under an untouched opening */}
        {greetCount > 0 && (
          <div className="nv-fade flex items-center gap-1 mt-2">
            <button
              onClick={() => actions.pickGreeting((greetIdx - 1 + greetCount) % greetCount)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-[var(--nv-control)] "
              style={dropShadow}
              aria-label="Previous opening"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => actions.showGreetings()}
              className="px-2.5 py-1 rounded-full border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] hover:bg-[var(--nv-control)] text-[11px] text-zinc-300  max-w-48 truncate"
              style={look.blurChips ? { } : {}}
            >
              {greetLabel}
              <span className="text-zinc-500 ml-1.5">{greetIdx + 1}/{greetCount}</span>
            </button>
            <button
              onClick={() => actions.pickGreeting((greetIdx + 1) % greetCount)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-[var(--nv-control)] "
              style={dropShadow}
              aria-label="Next opening"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {quick.length > 0 && (
          <div className={`nv-message-actions nv-fade flex items-center gap-0.5 mt-1.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {swipeable && (
              <div className="flex items-center mr-1.5" style={dropShadow}>
                <Button
                  variant="icon"
                  size="sm"
                  icon={ChevronLeft}
                  onClick={() => actions.swipeBack(m)}
                  disabled={swipeIndex(m) === 0}
                  className="text-zinc-400"
                  aria-label="Previous version"
                />
                {versions > 1 && (
                  <span className="text-[11px] text-zinc-400 tabular-nums min-w-8 text-center">
                    {swipeIndex(m) + 1}/{versions}
                  </span>
                )}
                <Button
                  variant="icon"
                  size="sm"
                  icon={ChevronRight}
                  onClick={() => actions.swipeForward(m)}
                  className="text-zinc-400"
                  aria-label={swipeIndex(m) < versions - 1 ? "Next version" : "New version"}
                  title={swipeIndex(m) < versions - 1 ? "Next version" : "Write a new version"}
                />
              </div>
            )}
            {quick.map((a) => (
              <Button
                key={a.label}
                variant="icon"
                size="sm"
                icon={a.icon}
                onClick={a.run}
                title={a.label}
                aria-label={a.label}
                className={a.danger ? "text-zinc-500 hover:bg-zinc-900" : "text-zinc-500"}
                style={dropShadow}
                {...(a.icon === Play ? { "data-glyph": "play" } : {})}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
