/* ---------- what the app is doing in the background ----------

   Anything slow that talks to a model (a reply, a card draft, a side
   job, an image) registers a job here. The island at the top of the screen
   (components/ActivityIsland.jsx) shows the ones that are not quiet
   (see startActivity), and Cancel aborts the job's
   controller. Same shape as toast.js: get, subscribe, and a hook.

   Jobs are replaced, never edited, so a selector can rely on identity.
   useActivity(selector) must return a value that is stable between
   unrelated changes (a job, a count, the whole list), not a fresh array. */

import { useLayoutEffect, useSyncExternalStore } from "react";
import { activeModel, sourceOf } from "./api.js";
import { modelLabel } from "./models.js";

export const PERCENT_MS = 250;   /* percent emits: about 4 per second */
export const LINGER_MS = 2500;   /* a finished job stays for its completion animation */

let jobs = [];
let next = 0;
const subs = new Set();
const timers = new Map();        /* job id -> removal timer */
const controllers = new Map();   /* job id -> AbortController */
const pending = new Map();       /* job id -> { percent, timer, at } */
const focus = new Map();         /* job id -> mounted generation surfaces */
const emit = () => { for (const fn of subs) fn(); };

export const activity = {
  get: () => jobs,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export function useActivity(selector = (list) => list) {
  return useSyncExternalStore(activity.subscribe, () => selector(jobs), () => selector(jobs));
}

/* Hide only the job this surface presents; other work by its owner stays visible. */
export function useActivityFocus(jobId, enabled = true) {
  useLayoutEffect(() => {
    if (!jobId || !enabled || !find(jobId)) return;
    const token = Symbol();
    const claims = focus.get(jobId) || new Set();
    focus.set(jobId, claims);
    claims.add(token);
    if (claims.size === 1) patch(jobId, { focused: true });
    return () => {
      if (focus.get(jobId) !== claims) return;
      claims.delete(token);
      if (!claims.size) {
        focus.delete(jobId);
        patch(jobId, { focused: false });
      }
    };
  }, [jobId, enabled]);
}

const find = (id) => jobs.find((j) => j.id === id);
function patch(id, fields) {
  if (!find(id)) return;
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...fields } : j));
  emit();
}
function drop(id) {
  clearTimeout(timers.get(id)); timers.delete(id);
  clearTimeout(pending.get(id)?.timer); pending.delete(id);
  controllers.delete(id);
  focus.delete(id);
  if (!find(id)) return;
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}
const message = (err) => (typeof err === "string" ? err : err?.message) || "Something went wrong";

/* "Gemini Flash 3.8" for whatever answers right now, or for `modelId`. */
export function activityModelLabel(settings, modelId) {
  const src = sourceOf(settings);
  const id = modelId || activeModel(settings);
  return id ? modelLabel(id, src) : "";
}

function handleFor(id, controller) {
  const live = () => find(id)?.status === "running";
  return {
    id,
    signal: controller.signal,
    progress(pct) {
      if (!live() || typeof pct !== "number" || !Number.isFinite(pct)) return;
      const percent = Math.max(0, Math.min(100, Math.round(pct)));
      const slot = pending.get(id);
      if (slot) { slot.percent = percent; return; }
      if (find(id).percent === percent) return;
      const now = Date.now();
      if (!slot && now - (find(id).lastEmit || 0) >= PERCENT_MS) { patch(id, { percent, lastEmit: now }); return; }
      const wait = PERCENT_MS - (now - find(id).lastEmit);
      const entry = { percent, timer: setTimeout(() => {
        pending.delete(id);
        if (live()) patch(id, { percent: entry.percent, lastEmit: Date.now() });
      }, Math.max(0, wait)) };
      pending.set(id, entry);
    },
    phase(text) { if (live()) patch(id, { phase: String(text || "") }); },
    stream(value) { if (live()) patch(id, { stream: value }); },
    done(result) {
      if (!live()) return;
      clearTimeout(pending.get(id)?.timer); pending.delete(id);
      patch(id, { status: "done", percent: 100, endedAt: Date.now(), ...(result !== undefined ? { result } : {}) });
      /* a held result waits for whoever consumes it */
      if (result === undefined) timers.set(id, setTimeout(() => drop(id), LINGER_MS));
    },
    fail(err) {
      if (!live()) return;
      clearTimeout(pending.get(id)?.timer); pending.delete(id);
      /* an abort is a cancel, not a failure worth showing */
      if (controller.signal.aborted || err?.name === "AbortError") { drop(id); return; }
      patch(id, { status: "error", error: message(err), endedAt: Date.now() });
      /* nothing shows a quiet failure or offers its X, so it leaves by itself */
      if (find(id).quiet) timers.set(id, setTimeout(() => drop(id), LINGER_MS));
    },
    cancel() {
      if (!live()) return;
      controller.abort();
      drop(id);
    },
  };
}

/* Which jobs the island shows. The island is for work the person asked for
   and waits on: chat replies (kind "reply", from pages/chat/replyJob.js)
   and Card Studio drafts (kind "Card Studio · …", from components/
   AiFill.jsx). Everything else is quiet: side jobs (memory, scene notes,
   Scope), images and the anonymous "Model request" jobs that
   api.js opens for callers that pass no activity. A caller can say so with
   `quiet: true`, or opt a new kind in with `quiet: false`; without the
   flag, the kind decides. This is an allow rule on purpose, so new work
   stays off the island until someone chooses to show it.

   Quiet jobs are ordinary jobs: registered, cancellable, deduped, found by
   selectors and takeActivityOpen. Only the island leaves them out. */
const SHOWN_KIND = /^(?:reply$|card studio\b)/i;
export const quietKind = (kind) => !SHOWN_KIND.test(String(kind || ""));

/* meta: { kind, label, model, owner, phase, dedupeKey, stream, quiet } */
export function startActivity(meta = {}) {
  if (meta.dedupeKey) {
    const same = jobs.find((j) => j.status === "running" && j.dedupeKey === meta.dedupeKey);
    if (same) return handleFor(same.id, controllers.get(same.id));
  }
  const id = `act-${++next}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  jobs = [...jobs, {
    id, kind: meta.kind || "Model request", quiet: typeof meta.quiet === "boolean" ? meta.quiet : quietKind(meta.kind || "Model request"), label: meta.label || meta.kind || "Model request",
    model: meta.model || "", owner: meta.owner || {}, dedupeKey: meta.dedupeKey || null,
    status: "running", phase: meta.phase || "", percent: null, lastEmit: 0,
    startedAt: Date.now(), endedAt: null, error: null, controller,
    stream: meta.stream, result: undefined,
  }];
  emit();
  return handleFor(id, controller);
}

/* Runs `fn(handle)`; done or fail is called for you. Rethrows what fn throws. */
export async function runActivity(meta, fn) {
  const h = startActivity(meta);
  try {
    const out = await fn(h);
    h.done(out);
    return out;
  } catch (err) {
    h.fail(err);
    throw err;
  }
}

export function cancelActivity(id) {
  const job = find(id);
  if (!job || job.status !== "running") return false;
  controllers.get(id)?.abort();
  drop(id);
  return true;
}

/* Cancels every running job the predicate accepts; returns how many. */
export function cancelWhere(pred) {
  const hit = jobs.filter((j) => j.status === "running" && pred(j));
  for (const j of hit) cancelActivity(j.id);
  return hit.length;
}

/* Clears a finished or failed job (the X on an error). */
export const dismissActivity = (id) => drop(id);

/* Takes a held result and removes its job. */
export function takeActivityResult(id) {
  const job = find(id);
  if (!job) return undefined;
  drop(id);
  return job.result;
}

/* The island asks for a job's screen to open. A screen that mounts later
   (a form still loading) takes the request when it is for one of its jobs. */
let openRequest = null;
export function requestActivityOpen(id) { openRequest = id; }
export function takeActivityOpen(pred) {
  const job = openRequest && find(openRequest);
  if (!job || !pred(job)) return null;
  openRequest = null;
  return job;
}

/* for tests */
export function clearActivity() {
  openRequest = null;
  for (const t of timers.values()) clearTimeout(t);
  for (const p of pending.values()) clearTimeout(p.timer);
  timers.clear(); pending.clear(); controllers.clear(); focus.clear();
  jobs = [];
  emit();
}
