/* ---------- swipes ----------

   A reply can hold several versions. Regenerating no longer throws the old
   one away: it adds a version, and the arrows (or a sideways swipe on the
   bubble) move between them. Whichever version is showing is the one the
   conversation continues from.

   `content` is always the version on screen, so everything else in the app —
   the prompt, the history list, editing, export — keeps reading one field and
   never has to know swipes exist. The versions live beside it:

     swipes    [{ text, via? }]   every version, oldest first
     swipeIdx  number             which one `content` is

   A message that has never been regenerated has neither field; it is a list
   of one. */

/* Every version of a message, the plain single-version case included. */
export function swipeList(m) {
  if (Array.isArray(m?.swipes) && m.swipes.length) return m.swipes;
  return [m?.via ? { text: m?.content || "", via: m.via } : { text: m?.content || "" }];
}

export const swipeIndex = (m) => {
  const n = swipeList(m).length;
  const i = Number.isInteger(m?.swipeIdx) ? m.swipeIdx : n - 1;
  return Math.min(Math.max(0, i), n - 1);
};

/* `via` names the model that wrote a version when it was not the one picked.
   Absent rather than undefined, so it never shows up as a stray key. */
function withVersion(m, v) {
  const { via, ...rest } = m;
  return v.via ? { ...rest, content: v.text, via: v.via } : { ...rest, content: v.text };
}

/* A new version, shown straight away. */
export function addSwipe(m, text, via) {
  const swipes = [...swipeList(m), via ? { text, via } : { text }];
  return withVersion({ ...m, swipes, swipeIdx: swipes.length - 1, at: Date.now() }, swipes[swipes.length - 1]);
}

/* Show version i (clamped). */
export function showSwipe(m, i) {
  const list = swipeList(m);
  const k = Math.min(Math.max(0, i), list.length - 1);
  return withVersion({ ...m, swipes: list, swipeIdx: k }, list[k]);
}

/* An edit changes the version on screen and leaves the others alone. */
export function editMessage(m, text) {
  if (!Array.isArray(m?.swipes) || !m.swipes.length) return { ...m, content: text };
  const k = swipeIndex(m);
  const swipes = m.swipes.map((v, i) => (i === k ? { ...v, text } : v));
  return { ...m, swipes, content: text };
}
