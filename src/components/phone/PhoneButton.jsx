import { Smartphone } from "lucide-react";

/* The composer's phone button, beside Nova Scope's: a small count while
   something new is on it. Off for this chat, it is grey with a static
   slash, and a tap offers to turn it on (ChatPage's openPhone). */
export function PhoneButton({ unread = 0, on = false, off = !on, onClick }) {
  const n = on ? unread : 0;
  return (
    <span className="relative inline-flex shrink-0 rounded-full">
      <button
        type="button"
        onClick={onClick}
        aria-label={off ? "Phone off. Turn on" : "Open phone"}
        title={off ? "Phone is off" : n ? `Phone: ${n} new` : "Phone"}
        className="nv-phone-btn relative inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
        style={{ background: "var(--nv-control)", color: on ? "var(--acc)" : "var(--color-zinc-400)" }}
      >
        <Smartphone size={14} aria-hidden />
        {off && (
          <span
            data-testid="phone-off-mark"
            aria-hidden
            className="absolute left-1/2 top-1/2 w-[18px] h-[2px] -ml-[9px] -mt-px rounded-full rotate-45 pointer-events-none"
            style={{ background: "currentColor", boxShadow: "0 0 0 1.5px var(--nv-control)" }}
          />
        )}
        {n > 0 && (
          <span
            data-testid="phone-badge"
            aria-hidden
            className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-center pointer-events-none"
            style={{ background: "var(--nv-ink)", color: "var(--nv-bg)" }}
          >
            {n > 9 ? "9+" : n}
          </span>
        )}
      </button>
    </span>
  );
}
