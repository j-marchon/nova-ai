import { useRef, useState } from "react";
import { Check, Plus, Sparkles } from "lucide-react";
import { AccBtn, Button, Modal, SwapIcon } from "./ui.jsx";
import { ACCENT_GOOD, ACCENT_MIN, accentContrast, fixContrast, hexToHsv, hsvToHex, readableOn } from "../lib/colors.js";

/* Circular HSV wheel: angle = hue, distance from centre = saturation,
   with a brightness bar underneath. Deliberately minimal. */
export function ColorWheel({ initial, onPick, onClose, guard = null }) {
  const start = hexToHsv(initial === "accent" ? "#fafafa" : initial);
  const [h, setH] = useState(start.h);
  const [s, setS] = useState(start.s);
  const [v, setV] = useState(start.v);
  const ringRef = useRef(null);
  const hex = hsvToHex(h, s, v);

  const track = (e) => {
    const el = ringRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const p = e.touches?.[0] || e;
    const dx = p.clientX - cx;
    const dy = p.clientY - cy;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    setH(deg);
    setS(Math.min(1, Math.hypot(dx, dy) / (r.width / 2)));
  };

  const drag = (e) => {
    e.preventDefault();
    track(e);
    const move = (ev) => track(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* marker position inside the wheel */
  const rad = ((h - 90) * Math.PI) / 180;
  const mx = 50 + Math.cos(rad) * s * 50;
  const my = 50 + Math.sin(rad) * s * 50;

  return (
    <Modal title="Custom colour" onClose={onClose}>
      <div className="flex flex-col items-center gap-5">
        <div ref={ringRef} onPointerDown={drag} className="relative w-56 h-56 touch-none select-none cursor-crosshair">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              /* The wheel was drawn half a turn out of step with the value it
                 reported, which is the "palette shows the opposite side"
                 bug. `track` measures the angle clockwise from twelve
                 o'clock and uses it directly as the hue, so the gradient has
                 to start its 0deg hue at twelve o'clock too. `from 180deg`
                 started it at six, putting every colour 180 degrees from
                 where it was picked. The stops are already at exactly
                 0/60/120/180/240/300/360, so `from 0deg` makes screen angle
                 and hue the same number.

                 The white core now fades to 0 at the full radius rather than
                 at 70%, because saturation is measured against the full
                 radius: with the old 70% everything past that ring looked
                 identically saturated while still reporting different values. */
              background:
                "var(--nv-bg)",
              boxShadow: "none",
              filter: `brightness(${0.35 + v * 0.65})`,
            }}
          />
          <div
            className="absolute w-5 h-5 rounded-full border-2 border-white  pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${mx}%`, top: `${my}%`, background: hex }}
          />
        </div>

        <div className="w-full space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Brightness</span>
            <span className="w-6 h-6 rounded-full ring-1 ring-white/15" style={{ background: hex }} />
          </div>
          <input
            type="range" min={0} max={1} step={0.01} value={v}
            onChange={(e) => setV(parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: hex }}
          />
        </div>

        {guard ? <ContrastGuard hex={hex} light={guard.light} onLift={(c) => {
          const n = hexToHsv(c);
          setH(n.h); setS(n.s); setV(n.v);
        }} /> : null}

        <AccBtn
          onClick={() => { onPick(hex); onClose(); }}
          disabled={!!guard && accentContrast(hex, guard.light) < ACCENT_MIN}
          className="w-full"
        >
          Use this colour
        </AccBtn>
      </div>
    </Modal>
  );
}

/* Says whether the colour under the marker can actually be read, and offers to
   fix it in place.

   This is the answer to "let me pick any colour, but stop me picking one that
   makes the text vanish". A hard palette would solve it by removing the
   choice; instead the whole wheel stays live, the readable range is stated,
   and only the genuinely invisible bottom end is blocked. Lifting preserves
   hue and saturation, so the fix reads as "same colour, brighter" and not as
   the app overruling the choice. */
export function ContrastGuard({ hex, light, onLift }) {
  const ratio = accentContrast(hex, light);
  const ok = ratio >= ACCENT_GOOD;
  const usable = ratio >= ACCENT_MIN;
  if (ok) {
    return (
      <div className="w-full flex items-center gap-2 text-[11px] text-zinc-100">
        <Check size={13} className="shrink-0" />
        <span>Reads clearly on this background.</span>
      </div>
    );
  }
  return (
    <div
      className="w-full rounded-lg px-3 py-2.5 space-y-2 border"
      style={{
        borderColor: usable ? "rgba(251,191,36,0.35)" : "rgba(239,68,68,0.4)",
        background: usable ? "rgba(251,191,36,0.08)" : "rgba(239,68,68,0.08)",
      }}
    >
      <p className={`text-[11px] leading-relaxed ${usable ? "text-zinc-100" : "text-zinc-100"}`}>
        {usable
          ? "Dark for an accent — small labels in this colour will be hard to read."
          : "Too dark to use. Text and icons in this colour would disappear into the background."}
      </p>
      <Button
        type="button"
        size="sm"
        onClick={() => onLift(fixContrast(hex, light, ACCENT_GOOD))}
      >
        Brighten it, keep the colour
      </Button>
    </div>
  );
}

/* simple colour palette; the chosen swatch carries a tick and its hex shows underneath */
export function Swatches({ options, value, onChange, size = "w-8 h-8", allowCustom = true, guard = null }) {
  const [open, setOpen] = useState(false);
  const custom = allowCustom && value && value !== "accent" && !options.includes(value);
  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        {options.map((c) => {
          const bg = c === "accent" ? "var(--acc)" : c;
          const on = value === c;
          return (
            <button
              key={c}
              onClick={() => onChange(c)}
              style={{ background: bg }}
              aria-pressed={on}
              data-on={on ? "1" : undefined}
              className={`${size} rounded-full flex items-center justify-center ${on ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : "ring-1 ring-white/10"}`}
              aria-label={c === "accent" ? "Accent colour" : `Colour ${c}`}
              title={c === "accent" ? "Matches your accent colour" : c}
            >
              {on ? <Check size={14} style={{ color: c === "accent" ? "var(--on-acc)" : readableOn(c) }} />
                : c === "accent" && <Sparkles size={13} className="mx-auto" style={{ color: "var(--on-acc)" }} />}
            </button>
          );
        })}

        {allowCustom && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={custom ? { background: value } : {}}
            aria-pressed={!!custom}
            data-on={custom ? "1" : undefined}
            className={`${size} rounded-full flex items-center justify-center   ${
              custom
                ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950"
                : "ring-1 ring-dashed ring-white/25 text-zinc-400 hover:text-zinc-100 hover:ring-white/50"
            }`}
            aria-label={custom ? `Custom colour ${value}` : "Custom colour"}
            title={custom ? value : "Pick a custom colour"}
          >
            <SwapIcon icon={custom ? Check : Plus} size={14} style={custom ? { color: readableOn(value) } : undefined} />
          </button>
        )}
      </div>
      {value && value !== "accent" && <p className="mt-1.5 text-[11px] tabular-nums text-zinc-400">{String(value).toLowerCase()}</p>}
      {open && (
        <ColorWheel
          initial={custom ? value : "#a78bfa"}
          guard={guard}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
