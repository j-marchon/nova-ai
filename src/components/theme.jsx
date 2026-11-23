import { layoutViewport } from "../lib/uiScale.js";
import { chatAppearance } from "./chatAppearance.js";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, FastForward, ImageIcon, Palette, Repeat2, Reply, Sparkles, X } from "lucide-react";
import { AccBtn, Button, Modal, Segmented, Slider, ToggleRow } from "./ui.jsx";
import { DEFAULT_THEME, bgListOf } from "../lib/data.js";
import { MAX_ANIMATED_MB, readImage, snapshotFile } from "../lib/util.js";
import { BG_BITRATE, BG_LONG_SIDE, MAX_BG_CLIP, blobToDataUrl, canEncodeVideo, encodeClip, isVideoFile, probeVideo } from "../lib/video.js";
import { BG_MAX_ZOOM, BG_MIN_ZOOM, bgSize, useFraming } from "./framing.js";
import { ClipProgress, ClipPreview, Media, TrimBar } from "./media.jsx";

/* ============================================================
   forms
   ============================================================ */

/* Look & feel for one character or universe: bubble colours and the
   chat backdrop. Lives inside the creation flow so every story can
   carry its own mood. */
export function ThemeSection({ theme, onChange }) {
  const [showBg, setShowBg] = useState(false);
  /* the saved background being framed again for this screen, by index */
  const [recrop, setRecrop] = useState(null);
  const vp = useScreen();
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const set = (patch) => onChange({ ...t, ...patch });
  const bgs = bgListOf(t);
  /* Several images can be saved before React has re-rendered with the first
     one, so the running list is held in a ref as well. Reading `bgs` inside
     the loop would append every image to the same stale array and keep only
     the last. */
  const pendingRef = useRef(null);
  if (pendingRef.current === null) pendingRef.current = bgs;
  /* writing the list also clears the legacy single-image field */
  const setBgs = (list) => set({ bgs: list, bg: null });

  return (
    <div className="nv-block space-y-5 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Palette size={14} style={{ color: "var(--acc)" }} />
        <span className="text-xs font-medium tracking-wide text-zinc-300 uppercase">Look &amp; feel</span>
        <span className="flex-1 nv-rule ml-1" />
      </div>

      <Slider label="Bubble opacity" value={chatAppearance(t).alpha} min={0} max={1} step={0.05}
        onChange={value => set({ bubbleAlpha: value })}
        fmt={value => value === 0 ? "Invisible" : `${Math.round(value * 100)}%`} />

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Chat background</p>
          <span className="text-[11px] text-zinc-600">{bgs.length ? `${bgs.length} saved` : ""}</span>
        </div>

        {bgs.length > 0 && (
          <div className="nv-fade-x flex items-end gap-2 overflow-x-auto pt-2 pb-2 -mx-1 px-1">
            {bgs.map((b, i) => {
              /* this screen's crop when there is one, else the picture's own
                 shape; one this screen's chat skips is shown greyed */
              const shown = bgFor(b, vp);
              const skipped = !bgsForScreen([b], vp, t.bgDesktopOnly).length;
              return (
              <div key={i} className="relative shrink-0">
                {/* tap to frame it again for this screen (a still; a video
                    or GIF keeps its framing) */}
                <button
                  type="button"
                  disabled={!canRecrop(b)}
                  onClick={() => setRecrop(i)}
                  data-skipped={skipped ? "1" : undefined}
                  className="block rounded-lg overflow-hidden"
                  aria-label={`${canRecrop(b) ? `Crop background ${i + 1} again for this screen` : `Background ${i + 1}`}${skipped ? " (not shown on this screen)" : ""}`}
                >
                  <Media
                    src={shown.image}
                    className="block h-28 w-auto max-w-none object-cover rounded-lg border border-zinc-800"
                    /* as tall as the row, as wide as its own shape — 0.64 is
                       what the old 9/14 crops were baked at */
                    style={{
                      aspectRatio: String(shown.aspect || 0.64),
                      opacity: skipped ? 0.3 : Math.max(0.35, b.opacity),
                      filter: skipped ? "grayscale(1)" : undefined,
                    }}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setBgs(bgs.filter((_, n) => n !== i))}
                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-zinc-100 "
                  aria-label="Remove background"
                >
                  <X size={11} />
                </button>
              </div>
              );
            })}
          </div>
        )}

        <Button
          type="button"
          icon={ImageIcon}
          onClick={() => { pendingRef.current = bgs; setShowBg(true); }}
          className="w-full text-xs text-zinc-500 hover:text-zinc-300"
        >
          {bgs.length ? "Add another" : "Add a background image or video"}
        </Button>

        {/* a phone shows only phone-shaped pictures; a computer can do the same for its own */}
        {bgs.length > 0 && !onPhone() && vp.w >= vp.h && (
          <div className="mt-3">
            <ToggleRow
              on={!!t.bgDesktopOnly}
              onClick={() => set({ bgDesktopOnly: !t.bgDesktopOnly })}
              title="Only desktop pictures"
              sub="Skip pictures framed only for a phone"
            />
          </div>
        )}

        {bgs.length > 1 && (
          <div className="mt-3">
            <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase mb-2">Change every</p>
            <div className="flex flex-wrap gap-1.5">
              {[10, 20, 30, 60, 120].map((sec) => {
                const on = (t.bgSeconds || 20) === sec;
                return (
                  <Button
                    key={sec}
                    type="button"
                    size="sm"
                    selected={on}
                    onClick={() => set({ bgSeconds: sec })}
                    aria-pressed={on}
                    className={on ? "" : "text-zinc-400 hover:text-zinc-200"}
                  >
                    {sec < 60 ? `${sec}s` : `${sec / 60} min`}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {recrop != null && bgs[recrop] && (
        <BgEditor
          initial={recropFrom(bgs[recrop], vp)}
          theme={t}
          onSave={(bg) => {
            const { original, ...slim } = bg;
            setBgs(bgs.map((b, n) => (n === recrop ? withCrop(b, slim) : b)));
          }}
          onDone={() => setRecrop(null)}
          onClose={() => setRecrop(null)}
        />
      )}

      {showBg && (
        <BgEditor
          initial={null}
          theme={t}
          /* onSave can fire several times for one opening of the sheet, once
             per image in the queue, so it appends and reads the live list
             rather than closing. The editor calls onDone when the queue is
             empty. */
          onSave={(bg) => {
            /* the full-size source stays with a still, so the other screen's
               shape can be framed later from the real picture */
            const list = bgListOf({ ...t, bgs: pendingRef.current });
            const next = [...list, bg];
            pendingRef.current = next;
            setBgs(next);
          }}
          onDone={() => { pendingRef.current = null; setShowBg(false); }}
          onClose={() => { pendingRef.current = null; setShowBg(false); }}
        />
      )}
    </div>
  );
}

/* ---------- one background, two screen shapes ----------
   A still is baked to the shape of the screen it was framed on. Framed
   again on a screen of the other orientation (a phone's crop on a 16:9
   desktop), the new crop is kept beside it as `alt`, so each screen shows
   its own; ChatBackdrop fits the other one in whole until then. */
const wide = (aspect) => (Number(aspect) || 0.64) >= 1;
export function bgFor(b, vp) {
  const want = vp.w >= vp.h;
  if (b?.alt && wide(b.alt.aspect) === want && wide(b.aspect) !== want) return { ...b, ...b.alt };
  return b;
}
/* whether a background has a crop of that shape, its own or its `alt` */
const hasShape = (b, landscape) => wide(b?.aspect) === landscape || (!!b?.alt && wide(b.alt.aspect) === landscape);
/* The backgrounds a chat on this screen rotates through. A portrait screen
   skips pictures framed only for a computer; a wide one, with "Only
   desktop pictures" on (theme.bgDesktopOnly), skips those framed only for a
   phone. */
export function bgsForScreen(list, vp, desktopOnly = false) {
  if (vp.w < vp.h) return list.filter((b) => hasShape(b, false));
  if (desktopOnly) return list.filter((b) => hasShape(b, true));
  return list;
}
/* The two shapes a chat background is framed for: a phone's screen
   (390 × 844, the usual 9:19.5) and a computer's (16:9). Each crop is kept
   beside the other and each screen shows its own. */
export const STAGES = { phone: { w: 390, h: 844 }, desktop: { w: 1280, h: 720 } };
const onPhone = () => !!globalThis.window?.Capacitor?.isNativePlatform?.() || /Android|iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || "");
const canRecrop = (b) => !!b?.image && !b.video && !b.animated;
/* Framing a saved picture again opens on the crop the row shows, in its own
   shape (a desktop picture at 16:9, on a phone too); the switch picks the
   other. From the kept original it lands on the same crop. */
function recropFrom(b, vp) {
  const shown = bgFor(b, vp);
  return {
    original: b.original || shown.image,
    opacity: b.opacity,
    mode: wide(shown.aspect) ? "desktop" : "phone",
    ...(b.original ? { scale: shown.scale, nx: shown.nx, ny: shown.ny } : {}),
  };
}
function withCrop(b, crop) {
  const { alt, ...base } = b;
  /* the same orientation as the saved crop replaces it; the other is kept beside */
  if (wide(crop.aspect) === wide(b.aspect)) return { ...base, ...crop, ...(alt ? { alt } : {}) };
  return { ...base, opacity: crop.opacity ?? b.opacity, alt: { image: crop.image, aspect: crop.aspect, scale: crop.scale, nx: crop.nx, ny: crop.ny } };
}

/* ---------- chat backdrop: crop, zoom and fade an image ---------- */

/* A chat is `fixed inset-0`, so its backdrop covers the whole viewport.
   The preview therefore has to use the viewport's exact proportions —
   when it doesn't, object-cover re-crops the picture on the way in and
   what you framed is not what you get. The keyboard shrinks innerHeight,
   so keep the tallest height seen at this width: that is the real screen. */
export let SCREEN_SEEN = null;

export function readScreen() {
  const w = Math.max(1, Math.round(layoutViewport().width));
  const h = Math.max(1, Math.round(layoutViewport().height));
  if (!SCREEN_SEEN || SCREEN_SEEN.w !== w) SCREEN_SEEN = { w, h };
  else if (h > SCREEN_SEEN.h) SCREEN_SEEN = { w, h };
  return SCREEN_SEEN;
}

export function useScreen() {
  const [s, setS] = useState(readScreen);
  useEffect(() => {
    const onResize = () => setS(readScreen());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("nova-ui-scale", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("nova-ui-scale", onResize);
    };
  }, []);
  return s;
}

/* the framing maths lives in framing.js, shared with the avatar editor */
export { BG_MAX_ZOOM, BG_MIN_ZOOM, bgSize, clamp, clampBgPos } from "./framing.js";

/* The chat's own furniture, drawn at real size inside the preview so you
   can see what the header, the bubbles and the composer will cover. */
const MOCK_SHADOW = { background: "transparent", color: "var(--nv-ink)" };

/* a speaker line in the mock chat; outside ChatChromeMock so it is not a new
   component type, and remounted, on every render */
function MockName({ children, mine }) {
  return (
    <div className={`flex items-center gap-2 mb-1 px-0.5 ${mine ? "flex-row-reverse" : ""}`}>
      <div className="w-6 h-6 rounded-full bg-zinc-800 border border-[var(--nv-edge-ink)] shrink-0" />
      <span className="text-[11px] text-zinc-400" style={MOCK_SHADOW}>{children}</span>
    </div>
  );
}

export function ChatChromeMock({ theme }) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const paint = chatAppearance(t);
  const { userBubbleBg, aiBubbleBg } = paint;
  const shadow = MOCK_SHADOW;
  const drop = {};
  return (
    <div className="absolute inset-0 flex flex-col pointer-events-none select-none" style={{ "--nv-control": paint.controlBg }}>
      {/* header */}
      <div
        className="flex items-center gap-3 px-4"
        style={{ paddingTop: "calc(0.75rem + var(--sa-t))", paddingBottom: "0.75rem" }}
      >
        <ChevronLeft size={18} className="text-zinc-400" style={drop} />
        <div className="w-9 h-9 rounded-full bg-zinc-800 border border-[var(--nv-edge-ink)] shrink-0" />
        <p className="text-sm font-medium text-zinc-100 truncate flex-1" style={shadow}>Your character</p>
        <Palette size={17} className="text-zinc-400 shrink-0" style={drop} />
        <div
          className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] shrink-0"
          style={{ }}
        >
          <div className="w-6 h-6 rounded-full bg-zinc-800" />
          <span className="text-xs text-zinc-200">You</span>
          <Repeat2 size={13} className="text-zinc-400" />
        </div>
      </div>

      {/* messages — the newest sit at the bottom, as they do in a real chat */}
      <div className="flex-1 min-h-0 px-4 py-6 flex flex-col justify-end gap-5 overflow-hidden">
        <div className="flex flex-col items-start">
          <MockName>Your character</MockName>
          <div
            className="max-w-[90%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-zinc-200 border border-[var(--nv-edge-ink)]"
            style={{ background: aiBubbleBg }}
          >
            <em className="opacity-75">*leans against the doorframe, watching you*</em> You took your time getting here.
          </div>
        </div>
        <div className="flex flex-col items-end">
          <MockName mine>You</MockName>
          <div
            className="max-w-[90%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed text-white"
            style={{ background: userBubbleBg, color: "var(--nv-ink)" }}
          >
            The roads were closed.
          </div>
        </div>
        <div className="flex flex-col items-start">
          <MockName>Your character</MockName>
          <div
            className="max-w-[90%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-zinc-200 border border-[var(--nv-edge-ink)]"
            style={{ background: aiBubbleBg }}
          >
            Then you'll stay until morning.
          </div>
        </div>
      </div>

      {/* composer */}
      <div className="px-4 pt-2" style={{ paddingBottom: "calc(0.75rem + var(--sa-b))" }}>
        <div
          className="rounded-3xl border border-[var(--nv-edge-ink)] px-3 pt-2.5 pb-2"
          style={{ background: paint.composerBg }}
        >
          <div className="px-1 text-sm text-zinc-500" style={{ minHeight: "28px" }}>Message…</div>
          <div className="flex items-center gap-2 mt-1">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
              style={{ background: "var(--nv-control)", color: "var(--nv-ink)" }}
            >
              <Reply size={14} />
              <span className="text-[11px] font-medium">Long</span>
            </div>
            <div className="flex-1" />
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full"
              style={{ background: "var(--nv-control)" }}
            >
              <Sparkles size={14} style={{ color: "var(--acc)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--acc)" }}>Model</span>
            </div>
            <div className="p-2.5 rounded-full shrink-0" style={{ background: "var(--acc)" }}>
              <FastForward size={15} className="text-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BgEditor({ initial, theme, onSave, onDone, onClose }) {
  const fileRef = useRef(null);
  /* Files chosen but not yet framed. Android's picker hands back the whole
     selection at once, so the alternative to a queue was throwing all but the
     first away — which is what it used to do. Each is framed in turn and the
     sheet closes when the queue empties. */
  const [queue, setQueue] = useState([]);
  const [done, setDone] = useState(0);
  const frameRef = useRef(null);
  const screen = useScreen();
  /* Which screen this crop is for: either, on any device. It starts on
     this screen's own shape, or the shape of the picture being reframed. */
  const [mode, setMode] = useState(() => initial?.mode || (onPhone() || screen.w < screen.h ? "phone" : "desktop"));
  const vp = STAGES[mode];
  /* the sheet's inner width, so a 16:9 preview fills it */
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [src, setSrc] = useState(initial?.original || null);
  /* an animated file is kept whole and framed live; see save() */
  const [animated, setAnimated] = useState(!!initial?.animated);
  /* A picked video: { url, file, duration }. It plays from an object URL
     of the file itself, so nothing is read into memory until it is cut. */
  const [clip, setClip] = useState(null);
  const [trim, setTrim] = useState([0, 0]);
  const [hold, setHold] = useState(null);
  const [progress, setProgress] = useState(null);
  const clipVideo = useRef(null);
  const abortRef = useRef(null);
  const [err, setErr] = useState(null);
  const [imgSize, setImgSize] = useState(null); // {w,h}
  const [opacity, setOpacity] = useState(initial?.opacity ?? 0.75);
  const [chrome, setChrome] = useState(true);
  const [busy, setBusy] = useState(false);

  /* ---- the preview is the screen, scaled down by k ---- */
  const frameW0 = mode === "desktop"
    ? Math.min(boxW || screen.w * 0.8, screen.h * 0.55 * (vp.w / vp.h))
    : Math.min(screen.h * 0.5, 460) * (vp.w / vp.h);
  const frameH = Math.round(frameW0 * (vp.h / vp.w));
  const k = frameH / vp.h;
  const frameW = vp.w * k; // left unrounded so the scaled stage fits exactly

  /* offsets are kept as a fraction of the screen, so reopening the editor
     on a different-sized screen still lands on the same crop */
  const { pos, setPos, scale, setScale, setZoom, reset, handlers } = useFraming({
    stage: vp,
    k,
    imgSize,
    frameRef,
    initialScale: initial?.scale || 1,
    initialPos: { x: (initial?.nx ?? 0) * vp.w, y: (initial?.ny ?? 0) * vp.h },
  });
  /* each shape starts from the middle */
  const changeMode = (m) => { if (m !== mode) { setMode(m); setPos({ x: 0, y: 0 }); setScale(1); } };
  const draw = imgSize ? bgSize(imgSize, vp, scale) : null;

  useEffect(() => {
    if (!src || clip) return;
    const img = new Image();
    img.onload = () => setImgSize({ w: img.width, h: img.height });
    img.src = src;
  }, [src, clip]);

  /* the object URL goes with the clip it was made for */
  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadOne = async (f) => {
    setErr(null);
    setHold(null);
    try {
      if (isVideoFile(f)) {
        const url = URL.createObjectURL(f);
        let meta;
        try { meta = await probeVideo(url); }
        catch (e) { URL.revokeObjectURL(url); throw e; }
        setClip({ url, file: f, duration: meta.duration });
        setTrim([0, Math.min(meta.duration || MAX_BG_CLIP, MAX_BG_CLIP)]);
        setSrc(url);
        setAnimated(false);
        setImgSize({ w: meta.w, h: meta.h });
      } else {
        const { data, animated: moving } = await readImage(f, 1600, 0.85);
        setClip(null);
        setSrc(data);
        setAnimated(moving);
        setImgSize(null);
      }
      setPos({ x: 0, y: 0 });
      setScale(1);
      setBusy(false);
    } catch (e) {
      setErr(e?.message || `${f.name || "That file"} could not be read as an image or video.`);
    }
  };

  /* Take the whole selection, frame the first, keep the rest queued. Every
     file is copied in first (see snapshotFile): the ones further down the
     queue would otherwise no longer be readable by the time they come up.
     One that cannot be read is left out rather than stopping the rest. */
  const pickFiles = async (files) => {
    const picked = [...files];
    if (!picked.length) return;
    setErr(null);
    const got = await Promise.all(picked.map((f) => snapshotFile(f).catch(() => null)));
    const list = got.filter(Boolean);
    const lost = picked.length - list.length;
    if (!list.length) { setErr(picked.length > 1 ? "None of those files could be read. Try picking them again." : `${picked[0].name || "That file"} could not be read. Try picking it again.`); return; }
    setDone(0);
    setQueue(list.slice(1));
    await loadOne(list[0]);
    if (lost) setErr(`${lost} of the files could not be read and ${lost === 1 ? "was" : "were"} left out.`);
  };

  /* Called once a framed image has been handed back: move to the next, or
     close if that was the last one. */
  const advance = () => {
    setDone((n) => n + 1);
    if (queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      loadOne(next);
    } else if (onDone) onDone();
    else onClose();
  };

  /* the framing travels as numbers, screen-relative, so it survives a
     different screen */
  const frame = () => ({ opacity, scale, nx: pos.x / vp.w, ny: pos.y / vp.h, aspect: +(vp.w / vp.h).toFixed(4) });

  /* A video is cut and cropped to the screen's shape, then stored like a
     still: the chat only has to stretch it. Where this phone cannot record
     video, the file is kept whole with the cut and the framing as numbers,
     the way a GIF is. */
  const saveClip = async () => {
    const [t0, t1] = trim;
    setBusy(true);
    setErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let saved = null;
      if (canEncodeVideo()) {
        setProgress(0);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const fit = Math.min(1, BG_LONG_SIDE / Math.max(vp.w * dpr, vp.h * dpr));
        const even = (n) => Math.max(2, Math.round(n / 2) * 2);
        const out = { w: even(vp.w * dpr * fit), h: even(vp.h * dpr * fit) };
        try {
          const data = await encodeClip({ file: clip.file, url: clip.url, start: t0, end: t1, stage: vp, draw, pos, out, bitrate: BG_BITRATE, onProgress: setProgress, signal: ac.signal });
          saved = { image: data, video: true, ...frame() };
        } catch (e) {
          if (e?.name === "AbortError") throw e;
          /* fall through to keeping the file whole */
        }
      }
      if (!saved) {
        const mb = clip.file.size / (1024 * 1024);
        if (mb > MAX_ANIMATED_MB) {
          throw new Error(`This phone cannot cut videos, and that one is ${mb.toFixed(1)} MB whole; the limit is ${MAX_ANIMATED_MB} MB.`);
        }
        const type = /^video\//.test(clip.file.type) ? clip.file.type : "video/mp4";
        const data = await blobToDataUrl(new Blob([clip.file], { type }));
        saved = { image: data, animated: true, t0, t1, ...frame() };
      }
      onSave(saved);
      advance();
    } catch (e) {
      if (e?.name !== "AbortError") setErr(e?.message || "That video could not be prepared.");
    } finally {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
    }
  };

  /* Render at the screen's own aspect ratio. Because it matches, the
     object-cover in the chat is a plain scale — no second crop, so the
     preview above is exactly the result. */
  const save = () => {
    if (!src || !imgSize || busy) return;
    if (clip) { saveClip(); return; }
    /* A canvas holds one frame, so baking the crop would freeze a GIF. It is
       stored as it is, with the framing as numbers, and the chat lays it out
       the same way this preview does (see FramedImage). */
    if (animated) {
      onSave({ image: src, animated: true, ...frame() });
      advance();
      return;
    }
    setBusy(true);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const fit = Math.min(1, 1600 / Math.max(vp.w * dpr, vp.h * dpr));
    const cw = Math.max(2, Math.round(vp.w * dpr * fit));
    const ch = Math.max(2, Math.round(vp.h * dpr * fit));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const k2 = cw / vp.w; // stage px -> canvas px
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, cw, ch);
    const img = new Image();
    img.onload = () => {
      const dw = draw.w * k2;
      const dh = draw.h * k2;
      const cx = cw / 2 + pos.x * k2;
      const cy = ch / 2 + pos.y * k2;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      onSave({
        original: src,
        image: canvas.toDataURL("image/jpeg", 0.88),
        ...frame(),
      });
      advance();
    };
    img.onerror = () => setBusy(false);
    img.src = src;
  };

  const mediaStyle = draw
    ? {
        width: draw.w,
        height: draw.h,
        transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
        opacity,
      }
    : null;

  return (
    <Modal title="Chat background" onClose={onClose} wide={screen.w >= 900}>
      <div ref={boxRef} className="space-y-4">
        <Segmented
          value={mode}
          onChange={changeMode}
          options={[{ id: "phone", label: "Phone" }, { id: "desktop", label: "Desktop" }]}
        />
        {!src ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full py-12 rounded-xl border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500  flex flex-col items-center gap-2"
          >
            <ImageIcon size={22} />
            <span className="text-sm">Choose images, GIFs or videos</span>
          </button>
        ) : (
          <>
            <div
              ref={frameRef}
              {...(busy ? {} : handlers)}
              className="relative mx-auto overflow-hidden rounded-[1.75rem] bg-zinc-950 border border-zinc-800  cursor-move select-none"
              style={{ width: frameW, height: frameH, touchAction: "none" }}
            >
              {/* the real screen, drawn at full size and shrunk to fit —
                  every proportion inside is the phone's own */}
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{ width: vp.w, height: vp.h, transform: `scale(${k})` }}
              >
                {imgSize && draw && (clip ? (
                  <ClipPreview
                    url={clip.url}
                    start={trim[0]}
                    end={trim[1]}
                    hold={busy ? trim[0] : hold}
                    videoRef={clipVideo}
                    className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                    style={mediaStyle}
                  />
                ) : (
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                    style={mediaStyle}
                  />
                ))}
                {chrome && <ChatChromeMock theme={theme} />}
              </div>

              <p className="absolute top-2 inset-x-0 text-center text-[10px] text-[var(--nv-ink)] pointer-events-none" style={{ }}>
                drag to move · pinch to zoom
                {queue.length > 0 && ` · ${done + 1} of ${done + 1 + queue.length}`}
              </p>
              {progress != null && <ClipProgress value={progress} onCancel={() => abortRef.current?.abort()} />}
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChrome((v) => !v)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                {chrome ? "Hide chat overlay" : "Show chat overlay"}
              </Button>
              <span className="text-zinc-800">|</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                className="text-zinc-500 hover:text-zinc-300"
              >
                Reset framing
              </Button>
            </div>

            {clip && clip.duration > 0 && (
              <TrimBar
                duration={clip.duration}
                start={trim[0]}
                end={trim[1]}
                max={MAX_BG_CLIP}
                onChange={(a, b) => setTrim([a, b])}
                onHold={setHold}
                videoRef={clipVideo}
              />
            )}
            <Slider label="Zoom" value={scale} min={BG_MIN_ZOOM} max={BG_MAX_ZOOM} step={0.01} onChange={setZoom} fmt={(v) => `${v.toFixed(2)}×`} />
            <Slider label={clip ? "Video opacity" : "Image opacity"} value={opacity} min={0.05} max={1} step={0.05} onChange={setOpacity} fmt={(v) => `${Math.round(v * 100)}%`} />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => (queue.length ? advance() : fileRef.current?.click())}
                disabled={busy}
                className="flex-1"
              >
                {queue.length ? "Skip this one" : clip ? "Change video" : "Change image"}
              </Button>
              <AccBtn onClick={save} disabled={busy} className="flex-1">{busy ? (clip ? "Preparing…" : "Applying…") : queue.length ? "Add & next" : "Add background"}</AccBtn>
            </div>
          </>
        )}
        {err && <p className="text-[11px] text-zinc-100 text-center">{err}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = [...(e.target.files || [])];
            try { await pickFiles(files); }
            finally { e.target.value = ""; }
          }}
        />
      </div>
    </Modal>
  );
}
