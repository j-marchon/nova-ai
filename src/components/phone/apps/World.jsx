import { useState } from "react";
import { CalendarDays, CalendarRange, Clock, Globe2 } from "lucide-react";
import { MotionList } from "../../motion/MotionList.jsx";
import { Button } from "../../ui.jsx";
import { YOU } from "../../../lib/phone.js";
import { EmptyLine } from "../parts.jsx";
import { Incoming, useLinger } from "../Incoming.jsx";
import { CharCount } from "./PhoneComposer.jsx";
import { streamedPosts } from "./Murmur.jsx";

/* ---------- World: the story's world, not a chat ----------

   Nothing here answers. "Write an event" puts a line in the story's world
   log (tick.world(text), no reply, no DM, no chat reply); it shows at once
   under "Events you wrote". "Skip time" moves the story on a day, a week or
   a month (tick.skip(span), a quiet job on the activity island like
   Refresh): skeleton rows and the streamed posts and stories (tick.preview)
   while it runs, then "Time moved to …" from the scene note. */

export const EVENT_MAX = 500;
export const SPANS = [
  { id: "day", label: "Skip a day", icon: Clock },
  { id: "week", label: "Skip a week", icon: CalendarDays },
  { id: "month", label: "Skip a month", icon: CalendarRange },
];

/* the persona's own events: the log's lines marked as theirs, then the ones
   written in this opening of the phone that the log does not show yet */
export function eventsOf(ctx) {
  const log = (ctx.worldLog || []).filter((e) => e && (e.by === YOU || e.mine === true || e.source === "you" || e.source === "user"));
  const known = new Set(log.map((e) => String(e.text).trim()));
  const drafts = (ctx.worldDrafts || []).filter((d) => !known.has(d.text));
  return [...drafts, ...log.slice().reverse().map((e, i) => ({ id: e.id || `log${i}`, text: e.text }))];
}

export function World({ ctx }) {
  const [text, setText] = useState("");
  const [skipping, setSkipping] = useState(null);
  const [moved, setMoved] = useState(false);
  const canWorld = typeof ctx.tick?.world === "function";
  const canSkip = typeof ctx.tick?.skip === "function";
  const body = text.trim();
  const over = body.length > EVENT_MAX;
  const can = canWorld && !!body && !over;
  const events = eventsOf(ctx);
  /* what the skip brings, in fixed slots as on the feed */
  const streamed = streamedPosts(ctx);
  const [show, gone] = useLinger(!!skipping);
  const ex = ctx.tick?.expect;
  const slots = ex && !ex.post && ex.posts > 0 ? ex.posts : 2;

  const post = () => {
    if (!can) return;
    ctx.addWorldDraft?.(body);
    Promise.resolve().then(() => ctx.tick.world(body)).catch(() => {});
    setText("");
  };
  const skip = (span) => {
    if (!canSkip || skipping || ctx.busy) return;
    setSkipping(span);
    setMoved(false);
    Promise.resolve()
      .then(() => ctx.tick.skip(span))
      .then(() => setMoved(true), () => {})
      .finally(() => setSkipping(null));
  };

  return (
    <div className="pb-6" data-testid="world-page">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 min-w-0">
        <Globe2 size={18} className="shrink-0 text-zinc-400" aria-hidden />
        <h3 className="flex-1 min-w-0 text-lg font-bold text-zinc-100 truncate">World</h3>
      </div>
      <p className="px-4 pb-3 text-xs text-zinc-500">The story's world. Nothing here replies.</p>

      <section aria-labelledby="world-write" className="px-4 py-3 border-t border-[var(--nv-line)]">
        <p id="world-write" className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Write an event</p>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, EVENT_MAX + 50))}
          placeholder="A storm hits the harbour…"
          aria-label="Event"
          aria-invalid={over || undefined}
          className="block w-full resize-none rounded-2xl px-4 py-3 bg-[var(--nv-control)] border border-[var(--nv-line)] text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
        />
        <div className="mt-2 flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0 text-[11px] text-zinc-500 truncate">{canWorld ? "Goes into the story's world log" : "Not available yet"}</span>
          <CharCount n={body.length} max={EVENT_MAX} />
          <Button type="button" variant="primary" onClick={post} disabled={!can} className="px-5 shrink-0">
            Post
          </Button>
        </div>
        <p className="mt-4 mb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Events you wrote</p>
        {events.length ? (
          <MotionList role="list" aria-label="Events you wrote" className="divide-y divide-[var(--nv-line)] rounded-2xl border border-[var(--nv-line)] overflow-hidden">
            {events.map((e) => (
              <div key={e.id} role="listitem" className="px-3.5 py-2.5 text-sm text-zinc-200 whitespace-pre-wrap break-words" data-event={e.id}>{e.text}</div>
            ))}
          </MotionList>
        ) : <p className="py-2 text-sm text-zinc-500">None yet.</p>}
      </section>

      <section aria-labelledby="world-skip" className="px-4 py-3 border-t border-[var(--nv-line)]">
        <p id="world-skip" className="mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Skip time</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Skip time">
          {SPANS.map((s) => {
            const busy = skipping === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => skip(s.id)}
                disabled={!canSkip || !!skipping || ctx.busy}
                aria-busy={busy || undefined}
                data-skip={s.id}
                className="min-w-0 h-14 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-zinc-100 bg-[var(--nv-control)] border border-[var(--nv-line)] disabled:opacity-50"
              >
                <s.icon size={16} aria-hidden />
                <span className="truncate max-w-full">{busy ? "Skipping…" : s.label}</span>
              </button>
            );
          })}
        </div>
        {moved && !skipping && ctx.sceneWhen && (
          <p role="status" className="mt-3 text-sm text-zinc-300" data-testid="world-moved">Time moved to {ctx.sceneWhen}.</p>
        )}
      </section>
      {show && (
        <div role="list" className="border-t border-[var(--nv-line)]" aria-label="What happened meanwhile">
          <Incoming ctx={ctx} items={skipping ? streamed : []} slots={slots} active={!!skipping} onGone={gone} />
        </div>
      )}
      {!canSkip && !canWorld && <EmptyLine>The world will open here soon.</EmptyLine>}
    </div>
  );
}
