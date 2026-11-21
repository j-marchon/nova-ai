import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { activity, useActivity } from "../../lib/activity.js";
import {
  RESPOND_DELAY, loadMorePhone, loadMoreReplies, notePhoneAction, phoneEstimates, phoneQueueOf, refreshPhone, requestPhone, requestRespond, retryPhone, setupPhone, skipTime, subscribePhoneQueue, worldEvent,
} from "../../pages/chat/phoneJob.js";
import { syncPendingOf } from "../../lib/phoneClock.js";

/* ---------- the phone's job, for the UI ----------

   The persona's own actions on the phone are local (phone.js); they set
   `tick.pending`, and the chat's phone queue (pages/chat/phoneJob.js)
   answers them with a respond batch after a short delay. Nothing runs while
   the chat's reply is being written; the queue waits for it.

     usePhoneTick({ chatId, getData, update })   the queue (preferred)
     usePhoneTick(start, chatId)                 legacy: now/later call `start`

   Returns { now, later(hint), refresh(step?), more, moreReplies(postId),
   respond, retry, setup(), skip(span), world(text), checkDue(), estimate(),
   pending, busy, error, preview, loadingReplies, syncPending, expect,
   setupRunning }.
   refresh(step): moves the phone's clock by a REFRESH_STEPS id
   (phoneClock.js; the handset's chosen step when left out) and brings what
   appeared meanwhile; a step of a day is a time skip, "sync" a Sync to chat
   (the phone catches up with the story; returns its promise).
   expect: what the running batch should bring, for placeholders
   ({ mode, posts, place: "top" | "bottom", post? } or null).
   setupRunning: a setup runs or waits. `later({ dm: true })`
   is the DM path (2.5 s to a story character); `later({ action: { kind:
   "like"|"repost", post } })` keeps a like or repost for the next batch;
   `later({ action: { kind: "transfer", to, amount } })` after transfer()
   lets the payee react (2.5 s for a story character). moreReplies returns
   loadMoreReplies' promise; loadingReplies lists the post ids it is busy with.
   setup() runs the phone's setup, by hand ("Set up phone"; nothing seeds by
   itself): profiles, then a seed from the chat as it stands; not quiet; a
   promise of "merged" | "dropped" | "error" | "aborted".
   preview holds the finished items of a streaming seed, setup or load more
   so far ({ posts, stories, dms, ... }), growing one item at a time.
   world(text) writes the user's story event at once (worldEvent; returns
   the log entry or null); skip(span) runs a time skip, "day" | "week" |
   "month" (skipTime; a promise), quiet, activity kind "world".
   syncPending: story replies since the phone last caught up with the chat
   (syncPendingOf), for the Sync badge. checkDue() asks for the DM answers
   that came due while the person was chatting (the phone opened; nothing
   is sent unless something is owed). estimate() is the phone's expected
   token use per kind of request (phoneEstimates; no request). Nothing on
   the phone refreshes by itself. */
export const PHONE_TICK_DELAY = RESPOND_DELAY;

const replyRunning = (chatId) => activity.get().some((j) => j.status === "running" && j.dedupeKey === `reply:${chatId}`);

export function usePhoneTick(arg, legacyChatId) {
  const legacy = typeof arg === "function";
  const chatId = legacy ? legacyChatId : arg?.chatId;
  const depsRef = useRef(null);
  depsRef.current = legacy ? null : arg?.getData && arg?.update ? { getData: arg.getData, update: arg.update } : null;
  const startRef = useRef(legacy ? arg : null);
  startRef.current = legacy ? arg : null;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const methods = useMemo(() => {
    const deps = () => depsRef.current || undefined;
    const start = () => { if (!replyRunning(chatId)) startRef.current?.(); };
    if (legacy) {
      return {
        now: start,
        later: (hint) => {
          if (hint?.action) notePhoneAction(chatId, hint.action);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => { timer.current = null; start(); }, PHONE_TICK_DELAY);
        },
        refresh: (step) => refreshPhone(chatId, undefined, typeof step === "string" ? { step } : undefined),
        more: () => loadMorePhone(chatId),
        moreReplies: (postId) => loadMoreReplies(chatId, postId),
        setup: () => setupPhone(chatId),
        world: (text) => worldEvent(chatId, text),
        skip: (span) => skipTime(chatId, span),
        respond: () => requestPhone(chatId, { mode: "respond" }),
        retry: () => retryPhone(chatId),
      };
    }
    return {
      now: () => refreshPhone(chatId, deps()),
      later: (hint) => requestRespond(chatId, { dm: !!hint?.dm, ...(hint?.action ? { action: hint.action } : {}), ...(deps() || {}) }),
      refresh: (step) => refreshPhone(chatId, deps(), typeof step === "string" ? { step } : undefined),
      more: () => loadMorePhone(chatId, deps()),
      moreReplies: (postId) => loadMoreReplies(chatId, postId, deps()),
      setup: () => setupPhone(chatId, deps()),
      world: (text) => worldEvent(chatId, text, deps()),
      skip: (span) => skipTime(chatId, span, deps()),
      respond: () => requestPhone(chatId, { mode: "respond" }, deps()),
      retry: () => retryPhone(chatId, deps()),
      checkDue: () => requestRespond(chatId, { dm: true, ...(deps() || {}) }),
      estimate: () => (deps() ? phoneEstimates(chatId, deps()) : null),
    };
  }, [chatId, legacy]);

  const queue = usePhoneQueue(chatId);
  const busy = usePhoneBusy(chatId);
  /* read every render (cheap): the chat changes with each saved reply */
  const chat = !legacy && arg?.getData ? arg.getData()?.chats?.find((c) => c.id === chatId) : null;
  const syncPending = chat ? syncPendingOf(chat) : 0;
  return useMemo(() => ({
    ...methods, pending: queue.pending, busy, error: queue.error, preview: queue.preview, loadingReplies: queue.replies || [], syncPending,
    expect: queue.expect || null, setupRunning: !!queue.setup,
  }), [methods, queue, busy, syncPending]);
}

/* { pending, running, mode, preview, error } of the chat's phone queue */
export const usePhoneQueue = (chatId) => useSyncExternalStore(subscribePhoneQueue, () => phoneQueueOf(chatId), () => phoneQueueOf(chatId));

/* the streamed seed's preview cards (previewBatch), or null */
export const usePhonePreview = (chatId) => usePhoneQueue(chatId).preview;

/* true while this chat's phone batch runs (phoneJob.js, dedupeKey phone:<chatId>) */
export const usePhoneBusy = (chatId) =>
  useActivity((a) => a.some((j) => j.status === "running" && j.dedupeKey === `phone:${chatId}`));
