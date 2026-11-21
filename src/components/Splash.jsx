import { useEffect, useState } from "react";

/* The launch screen, after the 3.2.2 trailer's opening: the mark turns in
   out of nothing through two faint rings, the name rises under it a letter
   at a time, a hairline draws beneath. It holds at least that long; if the
   saved data is still loading the mark keeps turning. Then it lifts away,
   growing and blurring as it fades, onto the app already drawn beneath.

   Timers rather than animation events, so it ends even where animations do
   not run (a hidden tab, reduced motion). */
const INTRO_MS = 1400, LEAVE_MS = 650;
const QUIET_INTRO_MS = 450, QUIET_LEAVE_MS = 250;
const prefersQuiet = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Splash({ ready, onDone }) {
  const [quiet] = useState(prefersQuiet);
  const [introDone, setIntroDone] = useState(false);
  const leaving = ready && introDone;

  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), quiet ? QUIET_INTRO_MS : INTRO_MS);
    return () => clearTimeout(t);
  }, [quiet]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, quiet ? QUIET_LEAVE_MS : LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, quiet, onDone]);

  const logo = `url(${import.meta.env?.BASE_URL || "/"}logo.png)`;
  return (
    <div
      className="nv-splash"
      data-phase={leaving ? "leave" : introDone ? "wait" : "intro"}
      data-quiet={quiet ? "1" : undefined}
      role="status"
      aria-label={leaving ? undefined : "Loading Nova"}
      aria-hidden={leaving || undefined}
    >
      <div className="nv-splash-stage">
        <div className="nv-splash-mark">
          <span aria-hidden className="nv-splash-ring" />
          <span aria-hidden className="nv-splash-ring nv-splash-ring--outer" />
          <span className="nv-splash-turn">
            <span className="nv-splash-logo" style={{ WebkitMaskImage: logo, maskImage: logo }} />
          </span>
        </div>
        <div className="nv-splash-word" aria-hidden>
          {"Nova".split("").map((c, i) => (
            <span key={i} className="nv-splash-slot"><span style={{ "--i": i }}>{c}</span></span>
          ))}
        </div>
        <span aria-hidden className="nv-splash-rule" />
        <p className="nv-splash-tag">Stories, run on your own models.</p>
      </div>
    </div>
  );
}
