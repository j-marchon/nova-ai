import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, SquarePen } from "lucide-react";
import { Disclosure } from "../../motion/Disclosure.jsx";
import { MotionList } from "../../motion/MotionList.jsx";
import { TEXT_LIMITS, YOU, dmStatus, isRequest, markSeen } from "../../../lib/phone.js";
import { phoneNow, timeLabel } from "../../../lib/phoneClock.js";
import { EmptyLine, PhoneAvatar, SetupCard, SkeletonRows, openAccount } from "../parts.jsx";
import { CountedInput } from "./PhoneComposer.jsx";
import { Button } from "../../ui.jsx";

/* ---------- Messages: private texts ----------

   The inbox (most recent first) with a collapsed Requests section (accounts
   the persona never wrote to), one thread as bubbles (the persona on the
   right), or `pick`: who a new thread can start with, the story's people
   first. */
const unseenIn = (v, key) => (v.threads[key] || []).filter((m) => m.from !== YOU && m.tick > (v.seen.messages[key] || 0)).length;

/* thread keys, the most recent first */
export function inboxOf(threads) {
  const keys = Object.keys(threads || {}).filter((k) => threads[k]?.length).sort((a, b) => {
    const la = threads[a].at(-1), lb = threads[b].at(-1);
    return lb.tick - la.tick || (lb.from === YOU) - (la.from === YOU);
  });
  return {
    inbox: keys.filter((k) => !isRequest(k, threads[k])),
    requests: keys.filter((k) => isRequest(k, threads[k])),
  };
}

/* the picker's order: story characters, then everyone else */
export const pickOrder = (list) => {
  const people = (list || []).filter((p) => p.key !== YOU);
  return [...people.filter((p) => p.story), ...people.filter((p) => !p.story)];
};

export function Messages({ ctx, thread, pick, focus = false }) {
  if (ctx.needsSetup) return <SetupCard ctx={ctx} />;
  if (pick) return <Pick ctx={ctx} />;
  if (thread) return <Thread key={thread} ctx={ctx} personKey={thread} focus={focus} />;
  return <Inbox ctx={ctx} />;
}

function ThreadRow({ ctx, k }) {
  const { v, accounts } = ctx;
  const last = v.threads[k].at(-1);
  const n = unseenIn(v, k);
  const name = accounts.nameOf(k);
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={() => ctx.open({ app: "messages", thread: k })}
        aria-label={`${name}${n ? `, ${n} unread` : ""}`}
        className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px] text-left hover:bg-[var(--nv-control)]"
        data-thread={k}
      >
        <PhoneAvatar src={ctx.avatarOf(k)} name={name} size={44} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm truncate ${n ? "font-semibold text-zinc-100" : "font-medium text-zinc-200"}`}>{name}</p>
          <p className={`text-xs truncate ${n ? "text-zinc-200" : "text-zinc-500"}`}>{last.from === YOU ? "You: " : ""}{last.text}</p>
        </div>
        {n > 0 && <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "var(--nv-ink)" }} data-unread-dot="" />}
      </button>
    </div>
  );
}

function Inbox({ ctx }) {
  const { v } = ctx;
  const { inbox, requests } = useMemo(() => inboxOf(v.threads), [v.threads]);
  const [showRequests, setShowRequests] = useState(false);
  const newRequests = requests.filter((k) => unseenIn(v, k) > 0).length;
  return (
    <div>
      <div className="px-4 pt-3 pb-1">
        <Button type="button" icon={SquarePen} onClick={() => ctx.open({ app: "messages", pick: true })} className="w-full border border-[var(--nv-line)] text-zinc-200 [--nv-btn-icon:15px]">
          New message
        </Button>
      </div>
      {inbox.length ? (
        <MotionList role="list" aria-label="Conversations" className="py-1">
          {inbox.map((k) => <ThreadRow key={k} ctx={ctx} k={k} />)}
        </MotionList>
      ) : !requests.length ? (ctx.waiting ? <SkeletonRows /> : <EmptyLine>{ctx.emptyText}</EmptyLine>) : null}
      {requests.length > 0 && (
        <div className="border-t border-[var(--nv-line)]">
          <button
            type="button"
            onClick={() => setShowRequests((x) => !x)}
            aria-expanded={showRequests}
            aria-controls="phone-requests"
            className="w-full flex items-center gap-2 px-4 min-h-[48px] text-left text-sm text-zinc-200"
          >
            <span className="flex-1 min-w-0 truncate">Requests ({requests.length}){newRequests ? ` · ${newRequests} new` : ""}</span>
            <ChevronRight size={16} aria-hidden className="text-zinc-500 shrink-0 nv-chevron" data-angle="90" data-open={showRequests ? "1" : "0"} />
          </button>
          <Disclosure open={showRequests}>
            <div id="phone-requests">
              {showRequests && (
                <div role="list" aria-label="Message requests" className="pb-1">
                  {requests.map((k) => <ThreadRow key={k} ctx={ctx} k={k} />)}
                </div>
              )}
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

function PersonRow({ ctx, p }) {
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={() => ctx.replace({ app: "messages", thread: p.key, focus: true })}
        className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px] text-left hover:bg-[var(--nv-control)]"
        data-person={p.key}
      >
        <PhoneAvatar src={ctx.avatarOf(p.key)} name={p.name} size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-medium text-zinc-100 truncate">{p.name}</p>
          <p className="text-xs text-zinc-500 truncate">@{p.handle}</p>
        </div>
      </button>
    </div>
  );
}

function Pick({ ctx }) {
  const people = pickOrder(ctx.accounts.list);
  if (!people.length) return <EmptyLine>No one to message yet.</EmptyLine>;
  const story = people.filter((p) => p.story);
  const rest = people.filter((p) => !p.story);
  const head = (t) => <p className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{t}</p>;
  return (
    <div className="py-1">
      {story.length > 0 && head("In the story")}
      {story.length > 0 && <MotionList role="list" aria-label="People in the story">{story.map((p) => <PersonRow key={p.key} ctx={ctx} p={p} />)}</MotionList>}
      {rest.length > 0 && head("Others")}
      {rest.length > 0 && <MotionList role="list" aria-label="Other accounts">{rest.map((p) => <PersonRow key={p.key} ctx={ctx} p={p} />)}</MotionList>}
    </div>
  );
}

function Thread({ ctx, personKey, focus }) {
  const { v, accounts } = ctx;
  const lines = v.threads[personKey] || [];
  const unseen = unseenIn(v, personKey);
  /* opening a thread marks it seen */
  useEffect(() => { if (unseen > 0) ctx.act((x) => markSeen(x, { thread: personKey })); }, [unseen, personKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = lines.at(-1);
  const lastMine = last?.from === YOU;
  /* the phone's in-world now; their answer and their reading are minutes on
     it, decided when the persona wrote (handset.dmWait) */
  const now = phoneNow(ctx.h, ctx.messages);
  const w = ctx.h.dmWait?.[personKey];
  /* typing only while the job runs and their answer is due */
  const typing = lastMine && !!ctx.busy && w?.due != null && now !== null && w.due <= now;
  const read = lastMine && !typing ? dmStatus(ctx.h, personKey, now)?.seen ?? null : null;
  const status = lastMine && !typing ? (read === null ? "Delivered" : now - read < 1 ? "Seen" : `Seen ${timeLabel(now - read)} ago`) : null;
  const log = useRef(null);
  /* the lines are read live from the handset on every render (no copy),
     each keyed by its id, and stand at the bottom by the input (the log is
     justified to its end, as a messaging app's). A new newest line (a reply
     while the thread is open, even at the thread's cap, where the count
     stays the same), the typing row or the status scrolls the page to the
     end: the page's own scrollTop, never scrollIntoView, so nothing else
     on screen (the input) moves. */
  const newest = lines.at(-1)?.id || "";
  useLayoutEffect(() => {
    const sc = log.current?.closest?.("[data-route]");
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [newest, lines.length, typing]);
  const send = (text) => ctx.write.dm(personKey, text);
  const name = accounts.nameOf(personKey);
  return (
    <div className="flex flex-col min-h-full">
      <button
        type="button"
        onClick={() => openAccount(ctx, personKey)}
        aria-label={`${name}'s profile`}
        className="flex items-center gap-2.5 px-4 py-2 min-h-[48px] border-b border-[var(--nv-line)] text-left"
      >
        <PhoneAvatar src={ctx.avatarOf(personKey)} name={name} size={32} />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">@{accounts.handleOf(personKey)}</span>
        <ChevronRight size={15} aria-hidden className="text-zinc-500 shrink-0" />
      </button>
      <div ref={log} className="flex-1 flex flex-col">
        <MotionList role="log" aria-label={`Messages with ${name}`} className="flex-1 flex flex-col justify-end gap-1.5 px-4 py-4" data-testid="phone-thread-log">
          {lines.map((m) => {
            const mine = m.from === YOU;
            return (
              <div key={m.id} className={`nv-dm-line flex ${mine ? "justify-end" : "justify-start"}`} data-line={m.id}>
                <p
                  className={`nv-dm-bubble max-w-[78%] min-w-0 px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${mine ? "rounded-[18px] rounded-br-md" : "rounded-[18px] rounded-bl-md border border-[var(--nv-line)]"}`}
                  style={mine ? { background: "var(--nv-ink)", color: "var(--nv-bg)" } : { background: "var(--nv-control)", color: "var(--nv-ink)" }}
                >
                  {m.text}
                </p>
              </div>
            );
          })}
          {status && (
            <p key="status" className="text-right text-[11px] text-zinc-500" data-testid="phone-unanswered">{status}</p>
          )}
          {typing && (
            <div key="typing" role="status" aria-label={`${name} is typing`} data-testid="phone-typing">
              <span className="nv-wait inline-flex items-center gap-1 px-3.5 py-3 rounded-[18px] rounded-bl-md bg-[var(--nv-control)] border border-[var(--nv-line)]">
                {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--nv-muted)" }} />)}
              </span>
            </div>
          )}
        </MotionList>
      </div>
      <div className="sticky bottom-0 px-4 py-3 border-t border-[var(--nv-line)]" style={{ background: "var(--nv-bg)" }}>
        <CountedInput placeholder="Message…" label="Message" max={TEXT_LIMITS.dm} autoFocus={focus} onSend={send} />
      </div>
    </div>
  );
}
