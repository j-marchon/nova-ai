/* The start of a long text, for a line or three that the screen clamps
   anyway. The browser lays out every character of a clamped paragraph
   before hiding the rest, so a card showing a 20,000-character description
   in two lines cost as much as showing all of it. */
export const clip = (text, max = 280) => {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max) : s;
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ---------- helpers ---------- */

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  return new Date(ts).toLocaleDateString("en-GB");
}

export function resizeImage(file, size = 220, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, size / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- animated pictures ----------

   Every picture used to go through resizeImage, which draws it onto a canvas
   and saves a JPEG — and a canvas holds one frame, so a GIF came out as a
   still. Animated files are now kept exactly as they are; everything else is
   still shrunk the same way, because a 12-megapixel photo as an avatar is
   just waste.

   "Animated" is read from the bytes rather than the name or the MIME type,
   which phones get wrong: any GIF, a WebP with an ANIM chunk, and an APNG
   (a PNG with an acTL chunk before its first IDAT). */

const ascii = (b, at, s) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

export function animatedMime(b) {
  if (!b || b.length < 12) return null;
  if (ascii(b, 0, "GIF8")) return "image/gif";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    for (let i = 12; i + 4 <= Math.min(b.length, 4096); i++) if (ascii(b, i, "ANIM")) return "image/webp";
    return null;
  }
  if (b[0] === 0x89 && ascii(b, 1, "PNG")) {
    let at = 8;
    while (at + 8 <= b.length) {
      const len = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
      if (ascii(b, at + 4, "acTL")) return "image/png";
      if (ascii(b, at + 4, "IDAT")) return null;
      at += 12 + len;
    }
  }
  return null;
}

/* Kept as is, so it is kept whole: a cap stops one huge file from taking
   over the storage. Big enough for any reasonable reaction GIF or loop. */
export const MAX_ANIMATED_MB = 15;

const asDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/* A picked file copied into memory at once. On Android the picker hands back
   files that are only readable for a moment: the first of a selection reads
   fine and the rest, read later in the queue, fail with a read error. Taken
   while the picker's grant still holds, every one of them stays readable. */
export async function snapshotFile(f) {
  try {
    return new File([await f.arrayBuffer()], f.name || "file", { type: f.type || "", lastModified: f.lastModified });
  } catch {
    throw new Error(`${f.name || "That file"} could not be read. Try picking it again.`);
  }
}

/* A picked or downloaded picture, ready to store: { data, animated }.
   Throws with a readable message when an animation is over the cap. */
export async function readImage(file, size = 220, quality = 0.82) {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const mime = animatedMime(head);
  if (mime) {
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_ANIMATED_MB) {
      throw new Error(`That animation is ${mb.toFixed(1)} MB; the limit is ${MAX_ANIMATED_MB} MB.`);
    }
    const typed = file.type === mime ? file : new Blob([file], { type: mime });
    return { data: await asDataUrl(typed), animated: true };
  }
  return { data: await resizeImage(file, size, quality), animated: false };
}
