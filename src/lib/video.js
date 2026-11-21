/* ---------- video pictures ----------

   Phones save a downloaded GIF as an MP4 more often than not, so avatars and
   backgrounds take plain videos too. A video is never stored as picked:

     - it is cut to the part you chose, cropped the way you framed it and
       scaled down to what the screen actually shows (a 4K clip as a 56px
       avatar is a decoder working flat out for nothing),
     - its sound is dropped,
     - and it is re-encoded at a modest bitrate,

   by decoding and re-encoding it with WebCodecs (Mediabunny does the file
   formats), much faster than the clip's own length. Where that is missing,
   or the file is one it cannot read, it is played once through a canvas into
   a MediaRecorder instead, which takes as long as the clip. Either way what
   comes out is small, loops cleanly and is cheap to decode.

   The result is a `data:video/...` string, stored and passed around exactly
   like the image data URLs, so every avatar and background field takes one
   without a schema change. Where recording is not available the original
   file is kept instead (capped like a GIF), with the cut as numbers. */

export const isVideo = (s) => typeof s === "string" && s.startsWith("data:video/");

/* A file the picker handed back that should be treated as a video: by type
   when the phone gives one, otherwise by its name. */
export const isVideoFile = (f) =>
  !!f && (/^video\//.test(f.type || "") || /\.(mp4|m4v|webm|mov|3gp|mkv)$/i.test(f.name || ""));

/* Longest clips, in seconds. Long enough for any loop or reaction; short
   enough that what is stored stays a few MB. */
export const MAX_AVATAR_CLIP = 10;
export const MAX_BG_CLIP = 20;

/* Output sizes. A background is drawn at the screen's shape with its longer
   side here. An avatar is a 3:4 portrait, the shape of the character cards;
   the round avatars in lists take its middle. Bitrates are per second. */
export const BG_LONG_SIDE = 1024;
export const BG_BITRATE = 2_000_000;
export const AVATAR_OUT = { w: 360, h: 480 };
export const AVATAR_BITRATE = 800_000;
export const CLIP_FPS = 30;

/* H.264 first: every phone decodes it in hardware. VP8 next, which is cheap
   to encode and decode in software where there is no hardware for it. A bare
   "video/mp4" comes last, because it leaves the codec to the browser and
   that can be one far slower to encode on a phone. */
const MIMES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp8",
  "video/webm;codecs=vp9",
  "video/webm",
  "video/mp4",
];

export function recorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") return null;
  if (!HTMLCanvasElement.prototype.captureStream) return null;
  for (const m of MIMES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return null;
}

export const canEncodeVideo = () => !!recorderMime() || typeof VideoEncoder !== "undefined";

const once = (el, ok, bad = "error") =>
  new Promise((resolve, reject) => {
    const done = () => { el.removeEventListener(ok, done); el.removeEventListener(bad, fail); resolve(); };
    const fail = () => { el.removeEventListener(ok, done); el.removeEventListener(bad, fail); reject(new Error("That video could not be played on this device.")); };
    el.addEventListener(ok, done);
    el.addEventListener(bad, fail);
  });

function quietVideo(src) {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  return v;
}

/* Size and length of a picked video, without decoding more than its header. */
export async function probeVideo(url) {
  const v = quietVideo(url);
  v.preload = "metadata";
  if (v.readyState < 1) await once(v, "loadedmetadata");
  const out = { w: v.videoWidth || 1, h: v.videoHeight || 1, duration: Number.isFinite(v.duration) ? v.duration : 0 };
  v.removeAttribute("src");
  v.load();
  return out;
}

const seek = async (v, t) => {
  if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return;
  const p = once(v, "seeked");
  v.currentTime = t;
  await p;
};

/* where the picture lands on the output canvas, from the editor's geometry */
function placement({ stage, draw, pos, out }) {
  const k = out.w / stage.w;
  const dw = draw.w * k;
  const dh = draw.h * k;
  return { dx: out.w / 2 + pos.x * k - dw / 2, dy: out.h / 2 + pos.y * k - dh / 2, dw, dh };
}

const abortError = () => new DOMException("Cancelled", "AbortError");

/* The fast way: decode, draw each frame framed, encode, all without playing
   anything. Returns null where it cannot run, so the caller can fall back. */
async function convertClip({ file, start, end, stage, draw, pos, out, bitrate, onProgress, signal }) {
  if (!file || typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  const mb = await import("mediabunny");
  const size = { width: out.w, height: out.h, bitrate };
  const codec = (await mb.canEncodeVideo("avc", size)) ? "avc" : (await mb.canEncodeVideo("vp8", size)) ? "vp8" : (await mb.canEncodeVideo("vp9", size)) ? "vp9" : null;
  if (!codec) return null;
  const mp4 = codec === "avc";

  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });

  const canvas = new OffscreenCanvas(out.w, out.h);
  const ctx = canvas.getContext("2d", { alpha: false });
  const { dx, dy, dw, dh } = placement({ stage, draw, pos, out });

  const conversion = await mb.Conversion.init({
    input,
    output,
    trim: { start, end },
    audio: { discard: true },
    video: {
      codec,
      bitrate,
      frameRate: CLIP_FPS,
      forceTranscode: true,
      processedWidth: out.w,
      processedHeight: out.h,
      process: (sample) => {
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, out.w, out.h);
        sample.draw(ctx, dx, dy, dw, dh);
        return canvas;
      },
    },
    showWarnings: false,
  });
  if (!conversion.isValid || conversion.discardedTracks.some((t) => t.track.type === "video")) return null;

  const onAbort = () => conversion.cancel();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener("abort", onAbort);
  conversion.onProgress = (p) => onProgress?.(Math.min(1, Math.max(0, p)));
  try {
    await conversion.execute();
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw abortError();
  const buf = output.target.buffer;
  if (!buf?.byteLength) return null;
  onProgress?.(1);
  return blobToDataUrl(new Blob([buf], { type: mp4 ? "video/mp4" : "video/webm" }));
}

/* Cut, frame and re-encode. Geometry is the editor's own, in its stage
   pixels: `stage` is the frame being filled ({w,h}), `draw` the size the
   picture is drawn at and `pos` the offset of its centre from the middle.
   `out` is the pixel size of the result. `file` is the picked file, for the
   fast path; `url` plays it for the slow one. Resolves to a data URL. */
export async function encodeClip(opts) {
  try {
    const fast = await convertClip(opts);
    if (fast) return fast;
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    /* anything else: the slow way below still has a chance */
  }
  opts.onProgress?.(0);
  return recordClip(opts);
}

async function recordClip({ url, start, end, stage, draw, pos, out, bitrate, onProgress, signal }) {
  const mime = recorderMime();
  if (!mime) throw new Error("Recording video is not supported here.");
  const v = quietVideo(url);
  if (v.readyState < 2) await once(v, "loadeddata");
  await seek(v, start);

  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext("2d", { alpha: false });
  const { dx, dy, dw, dh } = placement({ stage, draw, pos, out });
  const paint = () => {
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, out.w, out.h);
    ctx.drawImage(v, dx, dy, dw, dh);
  };
  paint();

  const stream = canvas.captureStream(CLIP_FPS);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => (rec.onstop = resolve));

  const length = Math.max(0.1, end - start);
  let finished = false;
  let lastMove = performance.now();
  let lastT = -1;

  await new Promise((resolve, reject) => {
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      v.pause();
      signal?.removeEventListener("abort", onAbort);
      if (rec.state !== "inactive") rec.stop();
      err ? reject(err) : resolve();
    };
    const onAbort = () => finish(new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", onAbort);

    const step = () => {
      if (finished) return;
      paint();
      const t = v.currentTime;
      if (t !== lastT) { lastT = t; lastMove = performance.now(); }
      onProgress?.(Math.min(1, Math.max(0, (t - start) / length)));
      if (t >= end || v.ended) { finish(); return; }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    /* a decoder that stops delivering frames (the app sent to the
       background, a broken file) would otherwise hang the sheet forever */
    const watchdog = setInterval(() => {
      if (!finished && !document.hidden && performance.now() - lastMove > 8000) {
        finish(new Error("The video stopped playing while it was being prepared."));
      }
    }, 1000);

    rec.start(500);
    v.play().then(() => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    }, finish);
    v.addEventListener("ended", () => finish(), { once: true });
  });

  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  v.removeAttribute("src");
  v.load();
  const type = mime.split(";")[0];
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error("Nothing was recorded from that video.");
  onProgress?.(1);
  return blobToDataUrl(blob);
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/* One still from a stored video, for the places that need a picture rather
   than a moving one (a PNG card export). */
export async function videoStill(src, at = 0) {
  const url = await acquireUrl(src);
  try {
    const v = quietVideo(url);
    if (v.readyState < 2) await once(v, "loadeddata");
    await seek(v, Math.min(at, Math.max(0, (v.duration || 0) - 0.05)));
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 1;
    c.height = v.videoHeight || 1;
    c.getContext("2d").drawImage(v, 0, 0);
    v.removeAttribute("src");
    v.load();
    return c.toDataURL("image/jpeg", 0.9);
  } finally {
    releaseUrl(src);
  }
}

/* ---------- object URLs ----------

   A video plays from a blob URL rather than its data URL: the media stack
   then reads bytes instead of re-parsing megabytes of base64 every time it
   seeks back to the start of the loop, and the DOM holds a short address
   instead of the whole string. One URL per distinct video, shared by every
   element showing it and freed a little after the last one goes, so
   scrolling past a card does not decode it again. */
const urls = new Map(); // data URL -> { url, refs, promise, timer }

function decode(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const type = dataUrl.slice(5, comma).split(";")[0] || "video/mp4";
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function peekUrl(src) {
  return urls.get(src)?.url || null;
}

export function acquireUrl(src) {
  if (typeof URL === "undefined" || !URL.createObjectURL || !src?.startsWith("data:")) return Promise.resolve(src);
  let e = urls.get(src);
  if (!e) {
    e = { url: null, refs: 0, timer: null, promise: null };
    e.promise = (typeof fetch === "function" ? fetch(src).then((r) => r.blob()) : Promise.reject())
      .catch(() => decode(src))
      .then((blob) => (e.url = URL.createObjectURL(blob)))
      .catch(() => (e.url = src));
    urls.set(src, e);
  }
  e.refs += 1;
  clearTimeout(e.timer);
  return e.promise;
}

export function releaseUrl(src) {
  const e = urls.get(src);
  if (!e) return;
  e.refs -= 1;
  if (e.refs > 0) return;
  clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    if (e.refs > 0) return;
    urls.delete(src);
    if (e.url && e.url.startsWith("blob:")) URL.revokeObjectURL(e.url);
  }, 30000);
}
