import { useMemo } from "react";
import { isRootAnchor } from "../../../lib/anchor.js";
import { EmptyLine } from "../parts.jsx";

/* ---------- Gallery: the chat's pictures ----------

   Pictures attached to or made in the chat's messages (`images`, scene
   art's `image`), and the phone's posts and stories that have a picture
   (`image`; a described photo without one is not a picture), newest first.
   Read-only; a tap opens the chat's lightbox (ctx.onPreview). */
export function galleryOf(messages, posts, stories) {
  const list = messages || [];
  const at = new Map(list.map((m, i) => [m?.id, i]));
  const out = [];
  list.forEach((m, i) => {
    if (!m) return;
    const pics = [...(Array.isArray(m.images) ? m.images : []), ...(typeof m.image === "string" && m.image ? [m.image] : [])];
    pics.forEach((img, j) => {
      const url = typeof img === "string" ? img : img?.url;
      if (url) out.push({ key: `${m.id}:${j}`, url, order: i, sub: -1 - j });
    });
  });
  /* a phone item comes after the message it hangs on; the starting feed before every message */
  const placeOf = (x) => (isRootAnchor(x.anchor) ? -1 : at.has(x.anchor?.id) ? at.get(x.anchor.id) : null);
  const add = (items, kind) => (items || []).forEach((x, idx) => {
    if (typeof x?.image !== "string" || !x.image) return;
    const order = placeOf(x);
    if (order === null) return;
    /* newer tick first; within a tick, array order (the feed is newest first) */
    out.push({ key: `${kind}:${x.id}`, url: x.image, order, sub: (x.tick || 0) * 10000 - idx });
  });
  add(posts, "post");
  add(stories, "story");
  const seen = new Set();
  return out.sort((a, b) => b.order - a.order || b.sub - a.sub).filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

export function Gallery({ ctx, messages }) {
  const items = useMemo(() => galleryOf(messages, ctx.v.posts, ctx.v.stories), [messages, ctx.v.posts, ctx.v.stories]);
  if (!items.length) return <EmptyLine>No pictures yet.</EmptyLine>;
  return (
    <div role="list" aria-label="Pictures" className="grid grid-cols-3 gap-1 p-1">
      {items.map((x) => (
        <div key={x.key} role="listitem" className="aspect-square min-w-0" data-pic={x.key}>
          <button type="button" onClick={() => ctx.onPreview?.(x.url)} aria-label="View picture" className="block w-full h-full overflow-hidden rounded-md bg-[var(--nv-control)]">
            <img src={x.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        </div>
      ))}
    </div>
  );
}
