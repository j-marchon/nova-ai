import { layoutViewport } from "../lib/uiScale.js";
import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { AccBtn, Avatar, Button, Modal, Slider } from "./ui.jsx";
import { BG_MAX_ZOOM, BG_MIN_ZOOM, bgSize, useFraming } from "./framing.js";
import { ClipPreview, ClipProgress, TrimBar } from "./media.jsx";
import { MAX_ANIMATED_MB, readImage, snapshotFile } from "../lib/util.js";
import {
  AVATAR_BITRATE, AVATAR_OUT, MAX_AVATAR_CLIP, blobToDataUrl, canEncodeVideo, encodeClip, isVideoFile, probeVideo,
} from "../lib/video.js";

/* ============================================================
   video avatars
   ============================================================ */

/* The avatar frame, in stage pixels: a 3:4 portrait, the shape of the
   character cards. Round avatars elsewhere show its middle, which the
   circle drawn over the preview marks. */
const STAGE = { w: 300, h: 400 };

/* Frame a picture for an avatar, or cut, frame and shrink a video — the
   background editor's drag, pinch and zoom, with the cut bar under it for a
   video. Give it `file` for a video or `src` (a data URL) for a still.
   Hands back a data URL. */
export function AvatarEditor({ file, src, title = "Avatar", onSave, onClose }) {
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const abortRef = useRef(null);
  const [clip, setClip] = useState(null); // { url, duration }
  const [imgSize, setImgSize] = useState(null);
  const [trim, setTrim] = useState([0, 0]);
  const [hold, setHold] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const frameH = Math.round(Math.min(layoutViewport().height * 0.42, 360));
  const k = frameH / STAGE.h;
  const { pos, scale, setZoom, reset, handlers } = useFraming({ stage: STAGE, k, imgSize, frameRef });
  const draw = imgSize ? bgSize(imgSize, STAGE, scale) : null;

  useEffect(() => {
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => alive && setErr("That picture could not be read.");
    img.src = src;
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let alive = true;
    probeVideo(url).then(
      (m) => {
        if (!alive) return;
        setClip({ url, duration: m.duration });
        setImgSize({ w: m.w, h: m.h });
        setTrim([0, Math.min(m.duration || MAX_AVATAR_CLIP, MAX_AVATAR_CLIP)]);
      },
      (e) => alive && setErr(e?.message || "That video could not be played on this device.")
    );
    return () => {
      alive = false;
      abortRef.current?.abort();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  /* A still is drawn at the avatar's own size, exactly as the preview
     lays it out. */
  const saveStill = () => {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUT.w;
    canvas.height = AVATAR_OUT.h;
    const k2 = AVATAR_OUT.w / STAGE.w; // stage px -> canvas px
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const img = new Image();
    img.onload = () => {
      const dw = draw.w * k2;
      const dh = draw.h * k2;
      ctx.drawImage(img, canvas.width / 2 + pos.x * k2 - dw / 2, canvas.height / 2 + pos.y * k2 - dh / 2, dw, dh);
      onSave(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => setErr("That picture could not be read.");
    img.src = src;
  };

  const save = async () => {
    if (src) { if (draw) saveStill(); return; }
    if (!clip || !draw || busy) return;
    setBusy(true);
    setErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let data = null;
      if (canEncodeVideo()) {
        setProgress(0);
        try {
          data = await encodeClip({
            file, url: clip.url, start: trim[0], end: trim[1], stage: STAGE, draw, pos,
            out: AVATAR_OUT, bitrate: AVATAR_BITRATE, onProgress: setProgress, signal: ac.signal,
          });
        } catch (e) {
          if (e?.name === "AbortError") throw e;
        }
      }
      /* Where video cannot be recorded the file is kept whole, centred: an
         avatar is a plain picture field, with nowhere to keep a cut. */
      if (!data) {
        const mb = file.size / (1024 * 1024);
        if (mb > MAX_ANIMATED_MB) {
          throw new Error(`This phone cannot cut videos, and that one is ${mb.toFixed(1)} MB whole; the limit is ${MAX_ANIMATED_MB} MB.`);
        }
        data = await blobToDataUrl(new Blob([file], { type: /^video\//.test(file.type) ? file.type : "video/mp4" }));
      }
      onSave(data);
    } catch (e) {
      if (e?.name !== "AbortError") setErr(e?.message || "That video could not be prepared.");
    } finally {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <div
          ref={frameRef}
          {...(busy ? {} : handlers)}
          className="relative mx-auto overflow-hidden rounded-2xl bg-zinc-950 border border-zinc-800  cursor-move select-none"
          style={{ width: STAGE.w * k, height: frameH, touchAction: "none" }}
        >
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${k})` }}>
            {src && draw && (
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                style={{ width: draw.w, height: draw.h, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
              />
            )}
            {clip && draw && (
              <ClipPreview
                url={clip.url}
                start={trim[0]}
                end={trim[1]}
                hold={busy ? trim[0] : hold}
                videoRef={videoRef}
                className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                style={{ width: draw.w, height: draw.h, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
              />
            )}
            {/* what a round avatar shows */}
            <div
              className="absolute left-0 rounded-full pointer-events-none"
              style={{ top: (STAGE.h - STAGE.w) / 2, width: STAGE.w, height: STAGE.w, border: "1px solid #fff", outline: "1px solid #000" }}
            />
          </div>
          <p className="absolute top-2 inset-x-0 text-center text-[10px] text-[var(--nv-ink)] pointer-events-none" style={{ }}>
            drag to move · pinch to zoom
          </p>
          {!clip && !(src && imgSize) && !err && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full nv-spin" />
            </div>
          )}
          {progress != null && <ClipProgress value={progress} onCancel={() => abortRef.current?.abort()} />}
        </div>

        <div className="flex items-center justify-center">
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="text-zinc-500 hover:text-zinc-300">
            Reset framing
          </Button>
        </div>

        {clip && clip.duration > 0 && (
          <TrimBar
            duration={clip.duration}
            start={trim[0]}
            end={trim[1]}
            max={MAX_AVATAR_CLIP}
            onChange={(a, b) => setTrim([a, b])}
            onHold={setHold}
            videoRef={videoRef}
          />
        )}
        <Slider label="Zoom" value={scale} min={BG_MIN_ZOOM} max={BG_MAX_ZOOM} step={0.01} onChange={setZoom} fmt={(v) => `${v.toFixed(2)}×`} />

        {err && <p className="text-[11px] text-zinc-100 text-center">{err}</p>}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1"
          >
            Cancel
          </Button>
          <AccBtn onClick={save} disabled={busy || !(clip || (src && imgSize))} className="flex-1">
            {busy ? "Preparing…" : src ? "Use this picture" : "Use this clip"}
          </AccBtn>
        </div>
      </div>
    </Modal>
  );
}

/* The file input behind every avatar button. A still picture or a video
   opens the editor first; an animated picture goes straight through, since
   a canvas crop would freeze it. */
export function useAvatarFile(onChange, title) {
  const fileRef = useRef(null);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState(null); // { file } for a video, { src } for a still

  const take = async (f) => {
    if (!f) return;
    setErr(null);
    if (isVideoFile(f)) { setEdit({ file: f }); return; }
    try {
      /* read large so zooming in on the editor stays sharp */
      const { data, animated } = await readImage(f, 1600, 0.9);
      if (animated) onChange(data);
      else setEdit({ src: data });
    }
    catch (x) { setErr(x?.message || "That file could not be read as an image."); }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      className="hidden"
      onChange={async (e) => {
        const picked = e.target.files?.[0];
        if (!picked) return;
        setErr(null);
        let f;
        /* copied into memory before anything else: on Android the rest of a
           multi-file selection goes stale while the first one is read */
        try { f = await snapshotFile(picked); }
        catch (x) { setErr(x.message); return; }
        finally { e.target.value = ""; }
        take(f);
      }}
    />
  );
  /* A sheet opened from inside another lifts itself to the app root (see
     Modal), so it appears over the form rather than at its top. */
  const editor = edit && (
    <AvatarEditor
      {...edit}
      title={title}
      onSave={(data) => { setEdit(null); onChange(data); }}
      onClose={() => setEdit(null)}
    />
  );
  return { open: () => fileRef.current?.click(), input, editor, err };
}

export function AvatarPicker({ value, onChange, label = "Avatar", action }) {
  const pick = useAvatarFile(onChange, label);
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase mb-1.5">{label}</div>
      <div className="flex items-center gap-3">
        <Avatar src={value} name="?" size="w-14 h-14" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" icon={ImageIcon} onClick={pick.open}>
              Choose picture
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} className="text-zinc-500 hover:text-zinc-300">
                Remove
              </Button>
            )}
          </div>
          {pick.input}
          {pick.err && <p className="text-[11px] text-zinc-100">{pick.err}</p>}
        </div>
        {action}
      </div>
      {pick.editor}
    </div>
  );
}
