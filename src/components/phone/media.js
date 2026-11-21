import { DEFAULT_NEGATIVE_PROMPT, generateImage, resolveDimensions, resolveImageBackend } from "../../lib/imageGen.js";
import { startActivity, useActivity } from "../../lib/activity.js";
import { setPostImage } from "../../lib/phone.js";

/* ---------- pictures on the phone ----------

   A photo is described (`photo`) unless it has a picture (`image`): one
   developed from the description by the image provider (only ever when the
   persona taps Develop), or one the persona attached from the device. */

/* the largest device picture the composer takes */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/* Whether pictures can be made: an image provider the settings name, with
   the key it needs (as ImageGenModal resolves it). */
export function canDevelop(settings) {
  return !!settings?.imageGen?.provider && !!resolveImageBackend(settings);
}

/* a picture URL as a data URL, so it is kept with the chat; the URL itself
   when it cannot be read */
async function asDataUrl(url) {
  if (typeof url !== "string" || url.startsWith("data:")) return url;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : url);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch { return url; }
}

export const developKey = (postId) => `develop:${postId}`;

/* One quiet image job from a post's (or story's) description; the result
   lands on it through the chat patch (`ctx.act`), so it arrives even if the
   phone was closed meanwhile. */
export function develop(post, { settings, chatId, act }) {
  if (!post?.photo) return;
  const cfg = settings?.imageGen || {};
  const job = startActivity({ kind: "image", label: "Develop photo", owner: { chatId }, dedupeKey: developKey(post.id), model: cfg.model || "", quiet: true });
  const dims = resolveDimensions(cfg.aspectRatio || "square");
  generateImage({
    activity: job,
    prompt: post.photo,
    negativePrompt: cfg.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
    ...resolveImageBackend(settings),
    width: dims.width,
    height: dims.height,
  })
    .then(asDataUrl)
    .then((image) => { act((h) => setPostImage(h, post.id, image)); job.done(); })
    .catch((e) => job.fail(e));
}

/* true while a post's picture is being developed */
export const useDeveloping = (postId) =>
  useActivity((a) => a.some((j) => j.status === "running" && j.dedupeKey === developKey(postId)));

/* A device picture as a data URL (read the way the chat composer reads
   one). Rejects with a message the composer shows: not a picture, or over
   PHOTO_MAX_BYTES. */
export function readPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) { reject(new Error("That file is not a picture.")); return; }
    if (file.size > PHOTO_MAX_BYTES) { reject(new Error("That picture is over 10 MB.")); return; }
    const r = new FileReader();
    r.onload = (ev) => (typeof ev.target?.result === "string" ? resolve(ev.target.result) : reject(new Error("Couldn't read that picture.")));
    r.onerror = () => reject(new Error("Couldn't read that picture."));
    r.readAsDataURL(file);
  });
}
