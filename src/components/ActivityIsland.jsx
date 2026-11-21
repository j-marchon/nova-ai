import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, X } from "lucide-react";
import "./activity.css";
import { Disclosure } from "./motion/Disclosure.jsx";
import { useSwipeAway } from "./motion/useSwipeAway.js";
import { gsap, motionMode, pop, shake, set, stop, track, tween } from "./motion/runtime.js";
import { LINGER_MS, cancelActivity, dismissActivity, useActivity } from "../lib/activity.js";
import { Button } from "./ui.jsx";

/* ---------- the activity island ----------

   A pill under the status bar that says what the app is doing in the
   background: ring, percent, "Model · What". With several jobs it shows the
   newest and a "+N"; a tap opens the list. Each job can be cancelled; a
   job with an owner opens it. A finished job shows a check and leaves; a
   failed one stays until dismissed. Only replies and Card Studio show here
   (quiet jobs are left out), and a swipe toward an edge puts the pill away. */

const R = 10;
const C = 2 * Math.PI * R;
const text = (job) => [job.model, job.label].filter(Boolean).join(" · ");

function Ring({ job }) {
  const arc = useRef(null);
  const first = useRef(true);
  const known = job.percent != null;
  useLayoutEffect(() => {
    if (!known || !arc.current) { first.current = true; return; }
    const el = arc.current;
    const strokeDashoffset = C * (1 - job.percent / 100);
    /* set keeps Calm and Off in step; only Full eases */
    if (first.current || motionMode() !== "full") set(arc.current, { strokeDashoffset });
    else tween(arc.current, { strokeDashoffset, duration: .3, ease: "power2.out" });
    first.current = false;
    return () => stop(el);
  }, [job.percent, known]);
  if (!known) {
    return (
      <svg className="nv-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r={R} stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r={R} stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <circle ref={arc} cx="12" cy="12" r={R} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - job.percent / 100)} transform="rotate(-90 12 12)" />
    </svg>
  );
}

function Mark({ job, check }) {
  return (
    <span className="nv-activity-ring" data-motion-ghost="1">
      {job.status === "done" ? <span ref={check} className="inline-flex"><Check size={20} aria-hidden="true" /></span>
        : job.status === "error" ? <X size={20} aria-hidden="true" />
        : <Ring job={job} />}
    </span>
  );
}

function Readout({ job }) {
  return (
    <span className="nv-activity-text" aria-live="polite" aria-atomic="true">
      <span className="text-xs font-medium text-zinc-100">{text(job)}</span>
      <span className="text-[11px] text-zinc-400">
        {job.status === "error" ? job.error : job.status === "done" ? "Done" : job.phase || (job.percent == null ? "Working" : "")}
      </span>
    </span>
  );
}

const Percent = ({ job }) => job.status === "running" && job.percent != null
  ? <span data-motion-ghost="1" className="text-xs tabular-nums text-zinc-300 shrink-0">{job.percent}%</span> : null;

function Action({ job }) {
  if (job.status === "done") return null;
  const failed = job.status === "error";
  return (
    <Button type="button" variant="icon" icon={X} className="nv-activity-act text-zinc-300" aria-label={`${failed ? "Dismiss" : "Cancel"} ${text(job)}`}
      onClick={(e) => { e.stopPropagation(); failed ? dismissActivity(job.id) : cancelActivity(job.id); }} />
  );
}

export function ActivityIsland({ onOpen, canOpen }) {
  const all = useActivity();
  const [gone, setGone] = useState(() => new Set());
  const [open, setOpen] = useState(false);
  const card = useRef(null);
  const check = useRef(null);

  /* quiet jobs (see activity.js) never show, not even when they fail */
  const jobs = useMemo(() => {
    const now = Date.now();
    return all.filter((j) => !j.quiet && (!j.focused || j.status === "error") && !gone.has(j.id) && (j.status !== "done" || now - j.endedAt < LINGER_MS));
  }, [all, gone]);
  const top = jobs[jobs.length - 1];
  const count = jobs.length;
  const topId = top?.id, topStatus = top?.status;
  const hide = (id) => setGone((g) => new Set(g).add(id));

  /* A swipe left, right or up (the top edge) puts the pill away: it hides
     every job it lists, without cancelling any; a new job shows again. The
     X still cancels or dismisses. Not while a finished job plays out. */
  const swipe = useSwipeAway(card, {
    left: true, right: true, up: true, down: false,
    ignore: ".nv-activity-act",
    enabled: topStatus !== "done",
    onDismiss: () => {
      const ids = jobs.map((j) => j.id);
      flushSync(() => { setGone((g) => new Set([...g, ...ids])); setOpen(false); });
      /* still here only if a job arrived during the fly-out */
      set(card.current, { clearProps: "transform,opacity" });
    },
  });

  useEffect(() => { if (count < 2) setOpen(false); }, [count]);

  /* the shake for an error; the pill stays until it is dismissed */
  useEffect(() => {
    if (topStatus !== "error") return;
    const el = card.current;
    const animation = shake(el);
    return () => { animation?.kill(); set(el, { clearProps: "opacity,transform" }); };
  }, [topId, topStatus]);

  /* completion: pop the check, settle the width, ease out */
  useEffect(() => {
    if (topStatus !== "done") return;
    const el = card.current;
    const id = topId;
    const mode = motionMode();
    if (mode === "off" || document.visibilityState === "hidden" || !el) {
      const t = setTimeout(() => hide(id), 900);
      return () => clearTimeout(t);
    }
    const full = mode === "full";
    const icon = check.current;
    const tl = track(gsap.timeline({ onComplete: () => hide(id) }));
    tl.call(() => pop(icon));
    if (full) tl.fromTo(el, { scaleX: 1.05 }, { scaleX: 1, duration: .2, ease: "power2.out" }, 0);
    tl.to(el, { opacity: 0, ...(full ? { y: -12, scale: .92 } : {}), duration: .45, ease: "power3.out" }, 1);
    return () => { tl.kill(); tl.eventCallback("onInterrupt")?.(); stop(icon); set(el, { clearProps: "opacity,transform" }); };
  }, [topId, topStatus]);

  if (!top) return null;
  const opens = (job) => !!onOpen && !!canOpen?.(job);
  const openJob = (job) => { if (opens(job)) onOpen(job); };
  const main = count > 1 ? () => setOpen((o) => !o) : () => openJob(top);

  return (
    <div className="nv-activity z-[70]">
      <div ref={card} {...swipe} className="nv-frost nv-activity-card text-zinc-100" data-noswipe>
        <div className="nv-activity-row">
          <button type="button" className="nv-activity-main" onClick={main}
            disabled={count === 1 && !opens(top)}
            aria-expanded={count > 1 ? open : undefined}
            aria-label={count > 1 ? `${count} background tasks` : opens(top) ? `Open ${text(top)}` : text(top)}>
            <Mark job={top} check={check} />
            <Readout job={top} />
            <Percent job={top} />
            {count > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "var(--nv-control)" }}>+{count - 1}</span>}
          </button>
          <Action job={top} />
        </div>
        <Disclosure open={open && count > 1}>
          {open && count > 1 ? (
            <ul className="pb-1" aria-label="Background tasks">
              {[...jobs].reverse().map((job) => (
                <li key={job.id} className="nv-activity-row">
                  <button type="button" className="nv-activity-main" disabled={!opens(job)} onClick={() => openJob(job)}
                    aria-label={opens(job) ? `Open ${text(job)}` : text(job)}>
                    <Mark job={job} />
                    <Readout job={job} />
                    <Percent job={job} />
                  </button>
                  <Action job={job} />
                </li>
              ))}
            </ul>
          ) : null}
        </Disclosure>
      </div>
    </div>
  );
}
