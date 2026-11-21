import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Heart, ListFilter, Loader2, Send, Smartphone } from "lucide-react";
import { Avatar, Button } from "../ui.jsx";
import { activeModel, hasKey } from "../../lib/api.js";
import { MOTION, enter, gsap, motionMode, stop, track } from "../motion/runtime.js";

/* ---------- small pieces the phone's apps share ---------- */

/* A hue (0..359) from a name: the same name always gets the same colour. */
export function avatarHue(name) {
  const s = String(name || "?").trim().toLowerCase();
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0) % 360;
}

/* the colour an avatar without a picture gets: mid-dark so white reads on it */
export const avatarColor = (name) => `hsl(${avatarHue(name)} 62% 42%)`;

/* A picture where the account has one (the persona, a card, a universe
   character, a Scope cast member), else its initial in white on a colour
   from its name. */
export function PhoneAvatar({ src, name, size = 36 }) {
  const px = { width: size, height: size };
  if (src) return <span className="shrink-0 inline-flex" style={px}><Avatar src={src} name={name} size="w-full h-full" /></span>;
  const letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden
      data-avatar-hue={hue}
      className="shrink-0 inline-flex items-center justify-center rounded-full font-semibold select-none"
      style={{ ...px, fontSize: Math.round(size * 0.42), backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${(hue + 40) % 360} 65% 36%))`, backgroundColor: avatarColor(name), color: "#fff" }}
    >
      {letter}
    </span>
  );
}

/* An account's profile page: through the stack's own opener when it has one, else as a route. */
export const openAccount = (ctx, key) => (ctx.openAccount ? ctx.openAccount(key) : ctx.open({ app: "profile", account: key }));

/* A one-line text field and a send button: Enter sends, empty cannot.
   The field itself is never disabled (a tap must always bring up the
   keyboard); `disabled` only holds Send back.
   `autoFocus` focuses it as it mounts, inside the tap that opened it, so
   Android shows the keyboard; `inputRef` lets a parent focus it the same way. */
export function PhoneInput({ placeholder, onSend, disabled = false, label, sendLabel = "Send", autoFocus = false, inputRef }) {
  const [text, setText] = useState("");
  const own = useRef(null);
  const field = inputRef || own;
  useLayoutEffect(() => { if (autoFocus) field.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const can = !disabled && !!text.trim();
  const send = () => {
    if (!can) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={placeholder}
          aria-label={label || placeholder}
          enterKeyHint="send"
          maxLength={500}
          className="flex-1 min-w-0 h-10 px-4 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-[var(--nv-ink)]"
        />
        <Button type="button" variant="primary" icon={Send} onClick={send} disabled={!can} aria-label={sendLabel} className="w-10 px-0 shrink-0 [--nv-btn-icon:15px]" />
      </div>
    </div>
  );
}

export function LikeButton({ liked, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!liked}
      aria-label={liked ? `Unlike, ${count} likes` : `Like, ${count} likes`}
      className="inline-flex items-center gap-1.5 h-9 px-2 -ml-2 rounded-full text-xs text-zinc-400 hover:text-zinc-100"
      style={liked ? { color: "var(--nv-ink)" } : undefined}
    >
      <Heart size={15} fill={liked ? "currentColor" : "none"} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

/* the one line an empty app shows */
export const EmptyLine = ({ children }) => <p className="px-5 py-10 text-center text-sm text-zinc-500">{children}</p>;

/* The shape of a post on its way in, in a post card's exact geometry
   (PostCard: px-4 py-3, gap-3, a 40px avatar, the 40px byline row, two
   lines of text, the 40px action row), so a skeleton, the streamed card
   that takes its place and the saved post all stand the same height. It
   only fades in (never rises); a shimmer sweeps it in Full motion only. */
function Bone({ className }) {
  return <span aria-hidden className={`relative block overflow-hidden bg-[var(--nv-control)] ${className}`} data-bone=""><span className="absolute inset-0 block" style={{ background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--nv-ink) 10%, transparent), transparent)", transform: "translateX(-100%)" }} data-shine="" /></span>;
}

export function SkeletonPost() {
  return (
    <div className="flex gap-3 px-4 py-3 min-w-0" data-skeleton-row="">
      <Bone className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="h-10 flex items-center"><Bone className="h-3 w-32 rounded-md" /></div>
        <div className="mt-0.5">
          <div className="h-6 flex items-center"><Bone className="h-3 w-full rounded-md" /></div>
          <div className="h-6 flex items-center"><Bone className="h-3 w-2/3 rounded-md" /></div>
        </div>
        <div className="mt-1 h-10 flex items-center gap-10 max-w-[300px]"><Bone className="h-3.5 w-8 rounded-md" /><Bone className="h-3.5 w-8 rounded-md" /><Bone className="h-3.5 w-8 rounded-md" /></div>
      </div>
    </div>
  );
}

/* fades `el`'s rows in and runs the shimmer (Full only); returns the cleanup */
export function useSkeletonMotion(ref, deps = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    enter(el, { y: 0, duration: MOTION.feedback });
    if (motionMode() !== "full") return () => stop(el);
    const shine = [...el.querySelectorAll("[data-shine]")];
    const t = track(gsap.fromTo(shine, { xPercent: -100 }, { xPercent: 100, duration: 1.2, ease: "power1.inOut", repeat: -1, stagger: 0.08, data: "phone-shimmer" }));
    return () => { t.kill(); stop(el); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function SkeletonRows({ count = 3 }) {
  const box = useRef(null);
  useSkeletonMotion(box);
  return (
    <div ref={box} aria-busy="true" aria-label="Loading" className="divide-y divide-[var(--nv-line)]" data-testid="phone-skeleton">
      {Array.from({ length: count }, (_, i) => <SkeletonPost key={i} />)}
    </div>
  );
}

/* Keeps the first row on screen where it was when rows above it change
   (new posts at the top, a card growing as it fills): the page scrolls by
   what they added. Only once the reader has scrolled; at the very top new
   rows are meant to be seen. Rows are the children of `list` (or of the
   MotionList inside it), measured by layout offset, so a row's own GSAP
   transform never counts as a move. Runs after every render (`deps` to
   narrow it); when it scrolls, any slide just set on the rows is dropped,
   since the rows did not move on screen. */
const offsetTop = (el) => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
export function useScrollAnchor(list, deps) {
  const mark = useRef(null);
  const rowsOf = () => {
    const box = list.current;
    if (!box) return null;
    return box.matches("[data-motion-list]") ? box : box.querySelector(":scope > [data-motion-list]") || box;
  };
  const scroller = () => list.current?.closest?.("[data-route]") || null;
  const keyOf = (el) => el.dataset.motionKey || el.dataset.post || null;
  const record = () => {
    const box = rowsOf();
    const sc = scroller();
    mark.current = null;
    if (!box || !sc || sc.scrollTop <= 0) return;
    const view = offsetTop(sc) + sc.scrollTop;
    for (const el of box.children) {
      if (!keyOf(el) || el.dataset.motionGhost) continue;
      const y = offsetTop(el);
      if (y + el.offsetHeight > view) { mark.current = { key: keyOf(el), y }; return; }
    }
  };
  useLayoutEffect(() => {
    const m = mark.current;
    const sc = scroller();
    const box = rowsOf();
    if (m && sc && box) {
      const el = [...box.children].find((x) => keyOf(x) === m.key);
      const d = el ? offsetTop(el) - m.y : 0;
      if (d) {
        sc.scrollTop += d;
        for (const row of box.children) if (row.dataset.motionKey) { stop(row); gsap.set(row, { clearProps: "transform,opacity" }); }
      }
    }
    record();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sc = scroller();
    if (!sc) return undefined;
    sc.addEventListener("scroll", record, { passive: true });
    return () => sc.removeEventListener("scroll", record);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---------- the first setup ----------

   While the phone is on but not set up yet (ctx.needsSetup) the home
   screen opens with this card and the apps show it as their page: Set up
   phone runs the setup job (tick.setup: profiles, then the first posts and
   messages from the chat as it stands) on the activity island; the chat
   can go on meanwhile, and a toast says when it is done. Without a key and
   a model it says so instead. */
export function SetupCard({ ctx, compact = false }) {
  const [asked, setAsked] = useState(false);
  const running = asked || (typeof ctx.tick?.setupRunning === "boolean" ? ctx.tick.setupRunning : !!ctx.busy && !ctx.h.tick?.seeded);
  const ready = hasKey(ctx.settings || {}) && !!activeModel(ctx.settings || {});
  const start = () => {
    if (running || !ready || !ctx.tick?.setup) return;
    setAsked(true);
    Promise.resolve().then(() => ctx.tick.setup()).catch(() => {}).finally(() => setAsked(false));
  };
  return (
    <section aria-label="Phone setup" className={compact ? "" : "px-5 pt-8 pb-6"} data-testid="phone-setup">
      <div className="nv-phone-pane rounded-2xl px-4 pt-4 pb-4 bg-[var(--nv-control)] border border-[var(--nv-line)] text-center">
        <span className="mx-auto mb-3 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "var(--nv-bg)", color: "var(--nv-ink)" }} aria-hidden>
          <Smartphone size={20} />
        </span>
        <p className="text-sm font-semibold text-zinc-100">Set up your phone</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          {running ? "Setting up… you can keep chatting. You'll get a notice when it's ready." : "Fills it from the story so far: people, posts and messages."}
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={start}
          disabled={running || !ready}
          aria-busy={running || undefined}
          className="mt-4 w-full"
          data-testid="phone-setup-start"
        >
          {running && <Loader2 size={15} className="nv-spin shrink-0" aria-hidden />}
          {running ? "Setting up…" : ready ? "Set up phone" : "Choose a model first"}
        </Button>
      </div>
    </section>
  );
}

/* ---------- sorting the feed and a post's replies ---------- */
export const SORTS = [
  { id: "recent", label: "Most recent" },
  { id: "liked", label: "Most liked" },
  { id: "oldest", label: "Oldest" },
  { id: "least", label: "Least liked" },
];

/* `list` in an order: Most recent keeps it as given (newest first, feed
   order), Oldest reverses it, the likes orders go by the shown likes
   (ctx.statsOf), ties keeping the newest first. Never sorts in place. */
export function sortPosts(ctx, list, order = "recent") {
  if (order === "oldest") return [...list].reverse();
  if (order !== "liked" && order !== "least") return list;
  const likes = new Map(list.map((p) => [p.id, ctx.statsOf?.(p)?.likes ?? 0]));
  const sign = order === "liked" ? -1 : 1;
  return list.map((p, i) => ({ p, i })).sort((a, b) => sign * (likes.get(a.p.id) - likes.get(b.p.id)) || a.i - b.i).map(({ p }) => p);
}

/* A round control that drops down a short list of choices (menuitemradio),
   closing on a pick or a tap elsewhere. `children` is the control's face. */
function ChoiceMenu({ options, value, onChange, label, current, className, style, data, optionData, children }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const menu = useRef(null);
  useLayoutEffect(() => { if (open) enter(menu.current, { y: -6, scale: 0.96, duration: MOTION.feedback, origin: "top right" }); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  return (
    <div ref={wrap} className="relative shrink-0" {...data}>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-label={`${label}: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
        style={style}
        {...optionData?.button}
      >
        {children}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} className="absolute right-0 top-full mt-1.5 z-30 w-44 py-1 rounded-2xl bg-[var(--nv-bg)] border border-[var(--nv-line)] shadow-lg">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === value}
              onClick={() => { setOpen(false); if (o.id !== value) onChange(o.id); }}
              className="w-full flex items-center gap-2 px-3.5 h-10 text-left text-sm text-zinc-100 hover:bg-[var(--nv-control)]"
              {...{ [optionData?.attr || "data-option"]: o.id }}
            >
              <span className="flex-1 min-w-0 truncate">{o.label}</span>
              {o.id === value && <Check size={15} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* The sort as a small filter icon: same size, border and line as the
   header's other round controls; it drops down the four orders. */
export function FilterMenu({ value, onChange, label = "Sort" }) {
  const current = SORTS.find((o) => o.id === value) || SORTS[0];
  return (
    <ChoiceMenu
      options={SORTS} value={value} onChange={onChange} label={label} current={current}
      data={{ "data-filter-menu": "" }}
      optionData={{ attr: "data-sort-option", button: { "data-filter": "" } }}
      className="w-10 h-10 box-border flex items-center justify-center rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)]"
      style={value !== "recent" ? { color: "var(--acc, var(--nv-ink))" } : { color: "var(--nv-ink)" }}
    >
      <ListFilter size={17} aria-hidden />
    </ChoiceMenu>
  );
}

/* How far a Refresh moves the phone's clock: a pill with the step's short
   label ("1h") beside Refresh, dropping down `steps` ({ id, label, short }). */
export function StepMenu({ steps, value, onChange, label = "Refresh step" }) {
  const current = steps.find((o) => o.id === value) || steps[0];
  return (
    <ChoiceMenu
      options={steps} value={current.id} onChange={onChange} label={label} current={current}
      data={{ "data-step-menu": "" }}
      optionData={{ attr: "data-step-option", button: { "data-step": current.id } }}
      className="h-10 min-w-10 px-3 box-border inline-flex items-center justify-center gap-1 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] text-xs font-medium tabular-nums"
      style={{ color: "var(--nv-ink)" }}
    >
      {current.short || current.label}
      <ChevronDown size={13} aria-hidden className="-mr-0.5 text-zinc-500" />
    </ChoiceMenu>
  );
}
