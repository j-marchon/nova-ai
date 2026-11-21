import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Avatar, Modal } from "./ui.jsx";
import { motionMode, onMotionChange, stop, tween } from "./motion/runtime.js";

/* The "+" beside a Nova Scope chat's first name: everyone else in it. A
   small orbit (Nova Scope's mark: people circling one scene) turns slowly
   around it while it is on screen and Motion is Full; tapping it lists the
   whole cast with their pictures. */
export function CastPlus({ people, title = "In this chat" }) {
  const [open, setOpen] = useState(false);
  const host = useRef(null);
  const ring = useRef(null);
  const others = (people || []).length - 1;

  useEffect(() => {
    const el = ring.current;
    if (!el || others < 1) return undefined;
    let seen = false;
    let spin = null;
    const update = () => {
      const go = seen && motionMode() === "full" && document.visibilityState === "visible";
      if (go && !spin) spin = tween(el, { rotate: "+=360", duration: 9, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
      else if (!go && spin) { stop(el); spin = null; }
    };
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; update(); }) : null;
    if (io && host.current) io.observe(host.current); else { seen = true; update(); }
    document.addEventListener("visibilitychange", update);
    const unsub = onMotionChange(update);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", update); unsub(); stop(el); };
  }, [others]);

  if (others < 1) return null;
  const names = people.map((p) => p.name).filter(Boolean);
  return (
    <>
      <button
        ref={host}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="relative inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-zinc-300 hover:text-zinc-100"
        aria-label={`${others} more: ${names.join(", ")}`}
        title={names.join(", ")}
      >
        <svg ref={ring} viewBox="0 0 24 24" width="24" height="24" className="absolute inset-0" aria-hidden>
          <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1" strokeDasharray="1.5 2.5" />
          <circle cx="12" cy="1.5" r="1.4" fill="currentColor" />
        </svg>
        <Plus size={12} strokeWidth={2.25} />
      </button>
      {open && (
        /* a portal still bubbles through React to the row it sits in (a chat
           in the list opens on click): the list keeps its events to itself */
        <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <Modal title={title} onClose={() => setOpen(false)}>
          <ul className="space-y-1">
            {people.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-3 py-1.5">
                <Avatar src={p.src} name={p.name || "?"} size="w-9 h-9" />
                <span className="text-sm text-zinc-100 truncate">{p.name}</span>
              </li>
            ))}
          </ul>
        </Modal>
        </span>
      )}
    </>
  );
}
